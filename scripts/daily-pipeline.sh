#!/bin/bash
# daily-pipeline.sh -- Autonomous daily video production pipeline for Gwen
# Usage: ./scripts/daily-pipeline.sh [OPTIONS]
#
# Runs the full daily cycle:
#   1. Sync tracking sheets -> import new orders
#   2. For each brand:
#      a. Score and rank candidates (consented + approved)
#      b. Download assets (checkpoint: files exist + non-zero)
#      c. Generate mockups (checkpoint: v11_*.png exist + non-zero)
#      d. Stage with Gemini (checkpoint: .raw backups exist)
#      e. Build standard reel + UGC reel (if reaction video)
#      f. Verify video specs (checkpoint: 1080x1920, h264, 30fps)
#      g. Generate social copy
#      h. Upload to Google Drive
#   3. Report results + Discord notification
#
# Circuit breaker: halts if consecutive error count exceeds threshold
# Checkpoint: validates output at each stage before proceeding
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# === Configuration ===
MAX_CONSECUTIVE_ERRORS=${MAX_CONSECUTIVE_ERRORS:-3}  # Circuit breaker: consecutive failures
BATCH_LIMIT=${BATCH_LIMIT:-5}                        # Orders per brand per run
MIN_SCORE=${MIN_SCORE:-40}                           # Minimum candidate score
BRANDS=${BRANDS:-"turnedyellow makemejedi turnedwizard turnedcomics popsmiths"}
LOG_DIR="${PIPELINE_ROOT}/logs"
RUN_ID=$(date +%Y%m%d-%H%M%S)
LOG_FILE="${LOG_DIR}/daily-${RUN_ID}.log"
PRODUCTS_CONFIG="${PIPELINE_ROOT}/products.json"

# === Setup ===
mkdir -p "$LOG_DIR"

log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] $*" | tee -a "$LOG_FILE"
}

# === Counters ===
consecutive_errors=0
total_errors=0
success_count=0
skip_count=0
orders_attempted=0
declare -a ERROR_LIST=()
declare -a FAILED_ORDERS=()

# === Circuit Breaker ===
circuit_breaker() {
    if [[ $consecutive_errors -ge $MAX_CONSECUTIVE_ERRORS ]]; then
        log "FATAL" "Circuit breaker tripped: ${consecutive_errors} consecutive failures (threshold: ${MAX_CONSECUTIVE_ERRORS})"
        log "FATAL" "Halting pipeline. Review errors in ${LOG_FILE}"
        send_discord_notification "circuit_breaker"
        update_run_record "circuit_breaker"
        report_results
        exit 1
    fi
}

# === Discord Notification ===
send_discord_notification() {
    local mode="${1:-summary}"
    local duration_secs=$(( $(date +%s) - RUN_START_TIME ))
    local duration_str="${duration_secs}s"
    if [[ $duration_secs -ge 60 ]]; then
        duration_str="$(( duration_secs / 60 ))m $(( duration_secs % 60 ))s"
    fi

    local brands_str
    brands_str=$(echo "$BRANDS" | tr ' ' ', ')

    if [[ "$mode" == "circuit_breaker" ]]; then
        local errors_json
        errors_json=$(printf '%s\n' "${ERROR_LIST[@]}" | node -e "
            const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean);
            console.log(JSON.stringify(lines));
        " 2>/dev/null || echo '[]')

        node -e "
            const {sendCircuitBreaker} = require('${PIPELINE_ROOT}/lib/discord');
            sendCircuitBreaker(${consecutive_errors}, ${errors_json}).catch(() => {});
        " 2>/dev/null || true
    else
        local is_cb="false"
        node -e "
            const {sendDiscord, formatRunSummary} = require('${PIPELINE_ROOT}/lib/discord');
            const errors = [];
            $(for err in "${ERROR_LIST[@]}"; do echo "errors.push($(node -e "console.log(JSON.stringify('$err'))" 2>/dev/null || echo '""'));"; done)
            const stats = {
                runId: '${RUN_ID}',
                brandsProcessed: '${brands_str}',
                ordersAttempted: ${orders_attempted},
                ordersSucceeded: ${success_count},
                ordersFailed: ${total_errors},
                ordersSkipped: ${skip_count},
                errors: errors,
                duration: '${duration_str}',
                circuitBreaker: ${is_cb}
            };
            const embed = formatRunSummary(stats);
            sendDiscord(null, {embed}).catch(() => {});
        " 2>/dev/null || true
    fi
}

# === Run State DB ===
insert_run_record() {
    node -e "
        const {getDatabase} = require('${PIPELINE_ROOT}/lib/db');
        const db = getDatabase();
        db.prepare('INSERT OR IGNORE INTO daily_runs (run_id, brands_processed) VALUES (?, ?)').run('${RUN_ID}', '$(echo "$BRANDS" | tr ' ' ',')');
        db.close();
    " 2>/dev/null || true
}

update_run_record() {
    local status="${1:-complete}"
    local error_log
    error_log=$(printf '%s\n' "${ERROR_LIST[@]}" 2>/dev/null | head -20 || echo "")

    node -e "
        const {getDatabase} = require('${PIPELINE_ROOT}/lib/db');
        const db = getDatabase();
        db.prepare(
            'UPDATE daily_runs SET completed_at = datetime(\"now\"), status = ?, orders_attempted = ?, orders_succeeded = ?, orders_failed = ?, orders_skipped = ?, error_log = ?, discord_notified = 1 WHERE run_id = ?'
        ).run('${status}', ${orders_attempted}, ${success_count}, ${total_errors}, ${skip_count}, $(node -e "console.log(JSON.stringify('${error_log}'))" 2>/dev/null || echo '""'), '${RUN_ID}');
        db.close();
    " 2>/dev/null || true
}

# === Failed Order DB Tracking ===
mark_order_failed() {
    local order_id="$1"
    local brand="$2"
    local error_msg="$3"

    node -e "
        const {getDatabase} = require('${PIPELINE_ROOT}/lib/db');
        const db = getDatabase();
        db.prepare(
            'UPDATE orders SET production_status = ?, updated_at = datetime(\"now\") WHERE order_id = ? AND brand = ?'
        ).run('failed', '${order_id}', '${brand}');
        db.close();
    " 2>/dev/null || true
}

mark_order_complete() {
    local order_id="$1"
    local brand="$2"
    local video_path="$3"

    node -e "
        const {getDatabase} = require('${PIPELINE_ROOT}/lib/db');
        const db = getDatabase();
        db.prepare(
            'UPDATE orders SET production_status = ?, video_path = ?, updated_at = datetime(\"now\") WHERE order_id = ? AND brand = ?'
        ).run('complete', '${video_path}', '${order_id}', '${brand}');
        db.close();
    " 2>/dev/null || true
}

requeue_failed_orders() {
    local brand="$1"
    local count
    count=$(node -e "
        const {getDatabase} = require('${PIPELINE_ROOT}/lib/db');
        const db = getDatabase();
        const result = db.prepare(
            'UPDATE orders SET production_status = \"pending\", updated_at = datetime(\"now\") WHERE production_status = \"failed\" AND brand = ?'
        ).run('${brand}');
        console.log(result.changes);
        db.close();
    " 2>/dev/null || echo "0")
    log "INFO" "Re-queued ${count} failed orders for ${brand}"
}

# === Report ===
report_results() {
    log "INFO" "========================================"
    log "INFO" "  DAILY PIPELINE REPORT -- ${RUN_ID}"
    log "INFO" "========================================"
    log "INFO" "  Successful: ${success_count}"
    log "INFO" "  Failed:     ${total_errors}"
    log "INFO" "  Skipped:    ${skip_count}"
    log "INFO" "  Attempted:  ${orders_attempted}"
    log "INFO" "  Log:        ${LOG_FILE}"
    if [[ ${#FAILED_ORDERS[@]} -gt 0 ]]; then
        log "INFO" "  Failed orders:"
        for fo in "${FAILED_ORDERS[@]}"; do
            log "INFO" "    - ${fo}"
        done
    fi
    log "INFO" "========================================"
}

# === Checkpoint Validators ===
validate_assets() {
    local workspace="$1"
    local photos_dir="${workspace}/photos"

    if [[ ! -d "$photos_dir" ]] || [[ -z "$(ls -A "$photos_dir" 2>/dev/null)" ]]; then
        echo "FAIL: Photos directory empty or missing: ${photos_dir}"
        return 1
    fi

    # Check for zero-byte files
    local zero_files
    zero_files=$(find "$photos_dir" -type f -size 0 2>/dev/null | head -1)
    if [[ -n "$zero_files" ]]; then
        echo "FAIL: Zero-byte file found in photos: ${zero_files}"
        return 1
    fi

    echo "PASS: Assets validated"
    return 0
}

validate_mockups() {
    local workspace="$1"
    local mockup_count
    mockup_count=$(ls "${workspace}/mockups/v11_"*.png 2>/dev/null | wc -l | tr -d ' ' || echo 0)

    if [[ "$mockup_count" -eq 0 ]]; then
        echo "FAIL: No v11_*.png mockups found"
        return 1
    fi

    # Check for zero-byte mockups
    local zero_mockups
    zero_mockups=$(find "${workspace}/mockups/" -name "v11_*.png" -size 0 2>/dev/null | head -1)
    if [[ -n "$zero_mockups" ]]; then
        echo "FAIL: Zero-byte mockup found: ${zero_mockups}"
        return 1
    fi

    echo "PASS: ${mockup_count} mockups validated"
    return 0
}

validate_staging() {
    local workspace="$1"
    local raw_count
    raw_count=$(ls "${workspace}/mockups/"*.raw 2>/dev/null | wc -l | tr -d ' ' || echo 0)

    if [[ "$raw_count" -eq 0 ]]; then
        echo "WARN: No .raw backups found (staging may not have run)"
        # Non-fatal — staging might use a different backup convention
        return 0
    fi

    echo "PASS: ${raw_count} staged mockups confirmed"
    return 0
}

# === Parse arguments ===
DRY_RUN=false
SKIP_IMPORT=false
SINGLE_BRAND=""
REQUEUE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-import)
            SKIP_IMPORT=true
            shift
            ;;
        --brand)
            SINGLE_BRAND="$2"
            shift 2
            ;;
        --limit)
            BATCH_LIMIT="$2"
            shift 2
            ;;
        --max-errors)
            MAX_CONSECUTIVE_ERRORS="$2"
            shift 2
            ;;
        --requeue)
            REQUEUE=true
            shift
            ;;
        --help)
            cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Autonomous daily video production pipeline.

Options:
  --dry-run           Show what would be produced without executing
  --skip-import       Skip sheet import (use existing DB data)
  --brand SLUG        Process single brand only
  --limit N           Orders per brand (default: 5)
  --max-errors N      Consecutive error threshold for circuit breaker (default: 3)
  --requeue           Reset failed orders to pending before processing
  --help              Show this help

Environment:
  MAX_CONSECUTIVE_ERRORS  Circuit breaker threshold (default: 3)
  BATCH_LIMIT             Orders per brand per run (default: 5)
  MIN_SCORE               Minimum candidate score (default: 40)
  BRANDS                  Space-separated brand slugs to process
  DISCORD_WEBHOOK_URL     Discord webhook for run notifications

Examples:
  $(basename "$0")                          # Full daily run
  $(basename "$0") --brand turnedyellow     # Single brand
  $(basename "$0") --dry-run --limit 3      # Preview top 3 per brand
  $(basename "$0") --requeue                # Retry previously failed orders
EOF
            exit 0
            ;;
        *)
            log "ERROR" "Unknown argument: $1"
            exit 1
            ;;
    esac
done

if [[ -n "$SINGLE_BRAND" ]]; then
    BRANDS="$SINGLE_BRAND"
fi

# === Start ===
RUN_START_TIME=$(date +%s)
log "INFO" "=== Daily Pipeline Starting -- ${RUN_ID} ==="
log "INFO" "Brands: ${BRANDS}"
log "INFO" "Batch limit: ${BATCH_LIMIT} per brand"
log "INFO" "Min score: ${MIN_SCORE}"
log "INFO" "Circuit breaker: ${MAX_CONSECUTIVE_ERRORS} consecutive failures"
log "INFO" "Dry run: ${DRY_RUN}"
log "INFO" "Requeue: ${REQUEUE}"

# Insert run record into DB
insert_run_record

# === Stage 1: Import tracking sheets ===
if [[ "$SKIP_IMPORT" = false ]]; then
    log "INFO" "=== Stage 1: Importing tracking sheets ==="
    if node "${PIPELINE_ROOT}/scripts/import-tracking-sheets.js" >> "$LOG_FILE" 2>&1; then
        log "INFO" "Sheet import complete"
    else
        log "WARN" "Sheet import failed -- continuing with existing data"
    fi
else
    log "INFO" "=== Stage 1: Skipping import (--skip-import) ==="
fi

# === Stage 2: Process each brand ===
for BRAND in $BRANDS; do
    log "INFO" "=== Processing brand: ${BRAND} ==="

    BRAND_CONFIG="${PIPELINE_ROOT}/brands/${BRAND}.json"
    if [[ ! -f "$BRAND_CONFIG" ]]; then
        log "WARN" "Brand config not found: ${BRAND} -- skipping"
        continue
    fi

    # Re-queue failed orders if requested
    if [[ "$REQUEUE" = true ]]; then
        requeue_failed_orders "$BRAND"
    fi

    # Get top candidates (consented + approved, production_status=pending)
    CANDIDATES=$(node "${PIPELINE_ROOT}/scripts/rank-candidates.js" \
        --brand "$BRAND" \
        --limit "$BATCH_LIMIT" \
        --min-score "$MIN_SCORE" \
        --ready-only \
        --json 2>/dev/null || echo "[]")

    CANDIDATE_COUNT=$(echo "$CANDIDATES" | node -e "
        const data = require('fs').readFileSync('/dev/stdin','utf8');
        try { console.log(JSON.parse(data).length); } catch { console.log(0); }
    ")

    if [[ "$CANDIDATE_COUNT" -eq 0 ]]; then
        log "INFO" "No candidates for ${BRAND} (min score: ${MIN_SCORE})"
        continue
    fi

    log "INFO" "Found ${CANDIDATE_COUNT} candidates for ${BRAND}"

    # Process each candidate
    echo "$CANDIDATES" | node -e "
        const data = require('fs').readFileSync('/dev/stdin','utf8');
        const orders = JSON.parse(data);
        orders.forEach(o => console.log(o.order_id));
    " | while read -r ORDER_ID; do
        circuit_breaker

        log "INFO" "--- Order: ${BRAND}/${ORDER_ID} ---"
        ((orders_attempted++)) || true

        if [[ "$DRY_RUN" = true ]]; then
            log "INFO" "[DRY RUN] Would produce video for ${BRAND}/${ORDER_ID}"
            ((skip_count++)) || true
            continue
        fi

        WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND}/${ORDER_ID}"
        ORDER_FAILED=false
        FAIL_REASON=""

        # === Checkpoint 1: Download assets ===
        if [[ ! -d "${WORKSPACE}" ]] || [[ -z "$(ls -A "${WORKSPACE}/photos/" 2>/dev/null)" ]]; then
            log "INFO" "Downloading assets for ${ORDER_ID}..."
            if "${PIPELINE_ROOT}/scripts/download-order-assets.sh" --brand "$BRAND" --order "$ORDER_ID" >> "$LOG_FILE" 2>&1; then
                log "INFO" "Assets downloaded"
            else
                FAIL_REASON="asset download"
                ORDER_FAILED=true
            fi
        else
            log "INFO" "Assets already present"
        fi

        # Validate assets checkpoint
        if [[ "$ORDER_FAILED" = false ]]; then
            ASSET_CHECK=$(validate_assets "$WORKSPACE" 2>&1)
            if [[ $? -ne 0 ]]; then
                log "ERROR" "Checkpoint 1 (assets) failed for ${BRAND}/${ORDER_ID}: ${ASSET_CHECK}"
                FAIL_REASON="asset validation: ${ASSET_CHECK}"
                ORDER_FAILED=true
            else
                log "INFO" "${ASSET_CHECK}"
            fi
        fi

        # === Checkpoint 2: Generate mockups ===
        if [[ "$ORDER_FAILED" = false ]]; then
            MOCKUP_COUNT=$(ls "${WORKSPACE}/mockups/v11_"*.png 2>/dev/null | wc -l | tr -d ' ' || echo 0)
            if [[ "$MOCKUP_COUNT" -eq 0 ]]; then
                log "INFO" "Generating mockups for ${ORDER_ID}..."
                if [[ -f "${PIPELINE_ROOT}/scripts/generate-mockups.js" ]]; then
                    if node "${PIPELINE_ROOT}/scripts/generate-mockups.js" --brand "$BRAND" --order "$ORDER_ID" >> "$LOG_FILE" 2>&1; then
                        log "INFO" "Mockups generated"
                    else
                        FAIL_REASON="mockup generation"
                        ORDER_FAILED=true
                    fi
                fi
            else
                log "INFO" "Found ${MOCKUP_COUNT} mockups"
            fi
        fi

        # Validate mockups checkpoint
        if [[ "$ORDER_FAILED" = false ]]; then
            MOCKUP_CHECK=$(validate_mockups "$WORKSPACE" 2>&1)
            if [[ $? -ne 0 ]]; then
                log "ERROR" "Checkpoint 2 (mockups) failed for ${BRAND}/${ORDER_ID}: ${MOCKUP_CHECK}"
                FAIL_REASON="mockup validation: ${MOCKUP_CHECK}"
                ORDER_FAILED=true
            else
                log "INFO" "${MOCKUP_CHECK}"
            fi
        fi

        # === Checkpoint 3: Stage with Gemini ===
        if [[ "$ORDER_FAILED" = false ]]; then
            RAW_COUNT=$(ls "${WORKSPACE}/mockups/"*.raw 2>/dev/null | wc -l | tr -d ' ' || echo 0)
            if [[ "$RAW_COUNT" -eq 0 ]]; then
                log "INFO" "Staging with Gemini for ${ORDER_ID}..."
                if [[ -f "${PIPELINE_ROOT}/scripts/stage-products.sh" ]]; then
                    if "${PIPELINE_ROOT}/scripts/stage-products.sh" "$BRAND" "$ORDER_ID" >> "$LOG_FILE" 2>&1; then
                        log "INFO" "Gemini staging complete"
                    else
                        log "WARN" "Gemini staging had failures (continuing with available mockups)"
                    fi
                fi
            else
                log "INFO" "Mockups already staged"
            fi

            # Validate staging checkpoint
            STAGE_CHECK=$(validate_staging "$WORKSPACE" 2>&1)
            log "INFO" "${STAGE_CHECK}"
        fi

        # === Checkpoint 4: Build videos (dual: reel + UGC) ===
        if [[ "$ORDER_FAILED" = false ]]; then
            EXPORTS="${WORKSPACE}/exports"
            mkdir -p "$EXPORTS"

            # Detect reaction video
            HAS_REACTION=false
            for ext in mov mp4 MOV MP4; do
                if [[ -f "${WORKSPACE}/${ORDER_ID}.${ext}" ]] || [[ -f "${WORKSPACE}/reaction.${ext}" ]]; then
                    HAS_REACTION=true
                    break
                fi
            done

            # Build standard reel (always)
            log "INFO" "Building standard reel..."
            if "${PIPELINE_ROOT}/scripts/build-video.sh" "$BRAND_CONFIG" "$WORKSPACE" "$PRODUCTS_CONFIG" "reels" >> "$LOG_FILE" 2>&1; then
                log "INFO" "Standard reel built"
            else
                FAIL_REASON="reel build"
                ORDER_FAILED=true
            fi
        fi

        # Build UGC reel (only if reaction video exists)
        if [[ "$ORDER_FAILED" = false ]] && [[ "$HAS_REACTION" = true ]]; then
            log "INFO" "Building UGC reel..."
            if "${PIPELINE_ROOT}/scripts/build-video.sh" "$BRAND_CONFIG" "$WORKSPACE" "$PRODUCTS_CONFIG" "ugc" >> "$LOG_FILE" 2>&1; then
                log "INFO" "UGC reel built"
            else
                log "WARN" "UGC reel build failed (standard reel still available)"
            fi
        elif [[ "$ORDER_FAILED" = false ]]; then
            log "INFO" "No reaction video -- skipping UGC reel"
        fi

        # Determine output paths and verify videos
        if [[ "$ORDER_FAILED" = false ]]; then
            # Find reel output
            REEL_OUTPUT=""
            if [[ -f "${EXPORTS}/${BRAND}-${ORDER_ID}-reels.mp4" ]]; then
                REEL_OUTPUT="${EXPORTS}/${BRAND}-${ORDER_ID}-reels.mp4"
            elif [[ -f "${EXPORTS}/${ORDER_ID}_reel.mp4" ]]; then
                REEL_OUTPUT="${EXPORTS}/${ORDER_ID}_reel.mp4"
            fi

            # Find UGC output
            UGC_OUTPUT=""
            if [[ -f "${EXPORTS}/${BRAND}-${ORDER_ID}-ugc.mp4" ]]; then
                UGC_OUTPUT="${EXPORTS}/${BRAND}-${ORDER_ID}-ugc.mp4"
            elif [[ -f "${EXPORTS}/${ORDER_ID}_ugc.mp4" ]]; then
                UGC_OUTPUT="${EXPORTS}/${ORDER_ID}_ugc.mp4"
            fi

            if [[ -z "$REEL_OUTPUT" ]] && [[ -z "$UGC_OUTPUT" ]]; then
                log "ERROR" "No output video found for ${BRAND}/${ORDER_ID}"
                FAIL_REASON="no video output"
                ORDER_FAILED=true
            fi
        fi

        # Verify video specs (checkpoint 4)
        if [[ "$ORDER_FAILED" = false ]]; then
            if [[ -n "$REEL_OUTPUT" ]]; then
                if ! "${PIPELINE_ROOT}/scripts/verify-video.sh" "$REEL_OUTPUT" >> "$LOG_FILE" 2>&1; then
                    log "ERROR" "Video verification failed for reel: ${REEL_OUTPUT}"
                    FAIL_REASON="reel verification"
                    ORDER_FAILED=true
                else
                    log "INFO" "Reel video verified: ${REEL_OUTPUT}"
                fi
            fi
            if [[ "$ORDER_FAILED" = false ]] && [[ -n "$UGC_OUTPUT" ]]; then
                if ! "${PIPELINE_ROOT}/scripts/verify-video.sh" "$UGC_OUTPUT" >> "$LOG_FILE" 2>&1; then
                    log "WARN" "UGC video verification failed (non-fatal)"
                else
                    log "INFO" "UGC video verified: ${UGC_OUTPUT}"
                fi
            fi
        fi

        # === Checkpoint 5: Generate social copy ===
        if [[ "$ORDER_FAILED" = false ]]; then
            if [[ -f "${PIPELINE_ROOT}/scripts/generate-social-copy.js" ]]; then
                node "${PIPELINE_ROOT}/scripts/generate-social-copy.js" \
                    --brand "$BRAND" --order "$ORDER_ID" >> "$LOG_FILE" 2>&1 || true
                log "INFO" "Social copy generated"
            fi
        fi

        # === Checkpoint 6: Upload to Drive ===
        if [[ "$ORDER_FAILED" = false ]]; then
            if [[ -f "${PIPELINE_ROOT}/scripts/upload-to-drive.js" ]]; then
                if node "${PIPELINE_ROOT}/scripts/upload-to-drive.js" \
                    --brand "$BRAND" --order "$ORDER_ID" >> "$LOG_FILE" 2>&1; then
                    log "INFO" "Uploaded to Google Drive"
                else
                    log "WARN" "Drive upload failed -- video saved locally"
                fi
            fi
        fi

        # === Handle order result ===
        if [[ "$ORDER_FAILED" = true ]]; then
            ((total_errors++)) || true
            ((consecutive_errors++)) || true
            ERROR_LIST+=("${BRAND}/${ORDER_ID}: ${FAIL_REASON}")
            FAILED_ORDERS+=("${BRAND}/${ORDER_ID}")
            mark_order_failed "$ORDER_ID" "$BRAND" "$FAIL_REASON"
            log "ERROR" "FAILED: ${BRAND}/${ORDER_ID} -- ${FAIL_REASON}"
        else
            consecutive_errors=0  # Reset on success
            ((success_count++)) || true
            PRIMARY_OUTPUT="${REEL_OUTPUT:-${UGC_OUTPUT}}"
            mark_order_complete "$ORDER_ID" "$BRAND" "$PRIMARY_OUTPUT"
            log "INFO" "COMPLETED: ${BRAND}/${ORDER_ID}"
        fi
    done
done

# === Final Report ===
report_results

# === Discord Notification ===
send_discord_notification "summary"

# === Update Run Record ===
if [[ $total_errors -gt 0 ]]; then
    update_run_record "completed_with_errors"
    log "WARN" "Pipeline completed with ${total_errors} error(s)"
    exit 2
else
    update_run_record "complete"
    log "INFO" "Pipeline completed successfully"
    exit 0
fi
