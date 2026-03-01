#!/bin/bash
# batch-produce.sh -- Orchestrate batch video production for top-ranked orders
# Produces BOTH UGC and standard reels per order (UGC only if reaction video exists)
# Usage: ./scripts/batch-produce.sh --brand SLUG [--limit N] [--min-score N] [--dry-run]
set -euo pipefail

# === Auto-detect pipeline root ===
PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# === Usage ===
usage() {
    cat <<EOF
Usage: $(basename "$0") --brand SLUG [OPTIONS]

Run the full production pipeline for top-ranked approved orders.
Produces BOTH UGC and standard reels per order (UGC only if reaction video exists).

Steps per order:
  1. Get top candidates from scorer
  2. For each order:
     a. Download assets (if not present)
     b. Generate mockups (if not present)
     c. Stage with Gemini (if not staged)
     d. Build standard reel (always)
     e. Build UGC reel (if reaction video exists)
     f. Generate social copy
     g. Upload all outputs to Drive
  3. Report results

Required:
  --brand SLUG        Brand slug (e.g., turnedyellow, makemejedi)

Options:
  --limit N           Process top N orders (default 5)
  --min-score N       Minimum score threshold (default 40)
  --dry-run           Show what would be done without executing
  --skip-upload       Skip Google Drive upload step
  --skip-staging      Skip Gemini staging (use raw mockups for debugging)
  --help              Show this help message

Examples:
  $(basename "$0") --brand turnedyellow --limit 3
  $(basename "$0") --brand makemejedi --dry-run
  $(basename "$0") --brand turnedyellow --min-score 60 --limit 10

Environment:
  DB_PATH                          SQLite database path (default: data/pipeline.db)
  GOOGLE_SERVICE_ACCOUNT_KEY       Path to Google service account JSON
  GOOGLE_APPLICATION_CREDENTIALS   Alternative credentials path
  GEMINI_API_KEY                   Gemini API key for staging
  PRINTFUL_API_KEY                 Printful API key for mockup generation
EOF
    exit 0
}

# === Parse arguments ===
BRAND=""
LIMIT=5
MIN_SCORE=40
DRY_RUN=false
SKIP_UPLOAD=false
SKIP_STAGING=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --brand)
            BRAND="$2"
            shift 2
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        --min-score)
            MIN_SCORE="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-upload)
            SKIP_UPLOAD=true
            shift
            ;;
        --skip-staging)
            SKIP_STAGING=true
            shift
            ;;
        --help)
            usage
            ;;
        *)
            echo "ERROR: Unknown argument: $1"
            echo "Run '$(basename "$0") --help' for usage."
            exit 1
            ;;
    esac
done

# === Validate required arguments ===
if [[ -z "$BRAND" ]]; then
    echo "ERROR: --brand is required"
    echo "Run '$(basename "$0") --help' for usage."
    exit 1
fi

# Validate brand config exists
BRAND_CONFIG="${PIPELINE_ROOT}/brands/${BRAND}.json"
if [[ ! -f "$BRAND_CONFIG" ]]; then
    echo "ERROR: Brand config not found: ${BRAND_CONFIG}"
    exit 1
fi

BRAND_NAME=$(jq -r '.name' "$BRAND_CONFIG")
PRODUCTS_CONFIG="${PIPELINE_ROOT}/products.json"

echo "=== Batch Production ==="
echo "  Brand: ${BRAND_NAME} (${BRAND})"
echo "  Limit: ${LIMIT}"
echo "  Min score: ${MIN_SCORE}"
echo "  Dry run: ${DRY_RUN}"
echo "  Skip upload: ${SKIP_UPLOAD}"
echo "  Skip staging: ${SKIP_STAGING}"
echo ""

# === Step 1: Get top candidates ===
echo "=== Step 1: Ranking candidates ==="
CANDIDATES_JSON=$(node "${PIPELINE_ROOT}/scripts/rank-candidates.js" \
    --brand "$BRAND" \
    --limit "$LIMIT" \
    --min-score "$MIN_SCORE" \
    --ready-only \
    --json)

CANDIDATE_COUNT=$(echo "$CANDIDATES_JSON" | jq 'length')

if [[ "$CANDIDATE_COUNT" -eq 0 ]]; then
    echo "No candidates found matching criteria."
    exit 0
fi

echo "  Found ${CANDIDATE_COUNT} candidates"
echo ""

# === Step 2: Process each order ===
PRODUCED=0
FAILED=0
SKIPPED=0
RESULTS=()

for i in $(seq 0 $((CANDIDATE_COUNT - 1))); do
    ORDER_ID=$(echo "$CANDIDATES_JSON" | jq -r ".[$i].order_id")
    SCORE=$(echo "$CANDIDATES_JSON" | jq -r ".[$i].score")
    STATUS=$(echo "$CANDIDATES_JSON" | jq -r ".[$i].consent_status")

    echo "=== Processing order ${ORDER_ID} (score: ${SCORE}, status: ${STATUS}) ==="

    WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND}/${ORDER_ID}"
    EXPORTS="${WORKSPACE}/exports"

    if [[ "$DRY_RUN" = true ]]; then
        echo "  [DRY RUN] Would produce reel + UGC (if reaction) for order ${ORDER_ID}"
        echo "  [DRY RUN] Would generate social copy"
        if [[ "$SKIP_UPLOAD" = false ]]; then
            echo "  [DRY RUN] Would upload to Drive"
        fi
        RESULTS+=("${ORDER_ID}: DRY RUN (score ${SCORE})")
        continue
    fi

    # --- 2a: Download assets if workspace doesn't exist ---
    if [[ ! -d "${WORKSPACE}" ]] || [[ -z "$(ls -A "${WORKSPACE}/photos/" 2>/dev/null)$(ls -A "${WORKSPACE}/mockups/" 2>/dev/null)" ]]; then
        echo "  Downloading assets..."
        if "${PIPELINE_ROOT}/scripts/download-order-assets.sh" --brand "$BRAND" --order "$ORDER_ID"; then
            echo "  Assets downloaded."
        else
            echo "  [SKIP] Asset download failed for order ${ORDER_ID} -- continuing batch"
            FAILED=$((FAILED + 1))
            RESULTS+=("${ORDER_ID}: FAILED (asset download)")
            continue
        fi
    else
        echo "  Assets already present."
    fi

    # --- 2b: Generate mockups if not present ---
    MOCKUP_COUNT=$(ls "${WORKSPACE}/mockups/v11_"*.png 2>/dev/null | wc -l | tr -d ' ' || echo 0)
    if [[ "$MOCKUP_COUNT" -eq 0 ]]; then
        echo "  Generating mockups..."
        if node "${PIPELINE_ROOT}/scripts/generate-mockups.js" --brand "$BRAND" --order "$ORDER_ID"; then
            echo "  Mockups generated."
        else
            echo "  [SKIP] Mockup generation failed for order ${ORDER_ID} -- continuing batch"
            FAILED=$((FAILED + 1))
            RESULTS+=("${ORDER_ID}: FAILED (mockup generation)")
            continue
        fi
    else
        echo "  Found ${MOCKUP_COUNT} mockups."
    fi

    # --- 2c: Stage with Gemini if not staged ---
    if [[ "$SKIP_STAGING" = false ]]; then
        # Check if any .raw backups exist (indicates staging was done)
        RAW_COUNT=$(ls "${WORKSPACE}/mockups/"*.raw 2>/dev/null | wc -l | tr -d ' ' || echo 0)
        if [[ "$RAW_COUNT" -eq 0 ]]; then
            echo "  Staging with Gemini..."
            if "${PIPELINE_ROOT}/scripts/stage-products.sh" "$BRAND" "$ORDER_ID"; then
                echo "  Staging complete."
            else
                echo "  WARNING: Gemini staging had failures (continuing with available mockups)"
            fi
        else
            echo "  Mockups already staged."
        fi
    fi

    # --- 2d: Detect reaction video ---
    HAS_REACTION=false
    for ext in mov mp4 MOV MP4; do
        if [[ -f "${WORKSPACE}/${ORDER_ID}.${ext}" ]] || [[ -f "${WORKSPACE}/reaction.${ext}" ]]; then
            HAS_REACTION=true
            break
        fi
    done

    # --- 2e: Build standard reel (always) ---
    mkdir -p "${EXPORTS}"
    echo "  Building standard reel..."
    if "${PIPELINE_ROOT}/scripts/build-video.sh" "$BRAND_CONFIG" "$WORKSPACE" "$PRODUCTS_CONFIG" "reels"; then
        echo "  Standard reel complete: ${ORDER_ID}_reel.mp4"
    else
        echo "  [SKIP] Standard reel build failed for order ${ORDER_ID} -- continuing batch"
        FAILED=$((FAILED + 1))
        RESULTS+=("${ORDER_ID}: FAILED (reel build)")
        continue
    fi

    # --- 2f: Build UGC reel (only if reaction video exists) ---
    if [[ "$HAS_REACTION" = true ]]; then
        echo "  Building UGC reel..."
        if "${PIPELINE_ROOT}/scripts/build-video.sh" "$BRAND_CONFIG" "$WORKSPACE" "$PRODUCTS_CONFIG" "ugc"; then
            echo "  UGC reel complete: ${ORDER_ID}_ugc.mp4"
        else
            echo "  WARNING: UGC reel build failed (standard reel still available)"
        fi
    else
        echo "  No reaction video -- skipping UGC reel"
    fi

    # --- 2g: Generate social copy ---
    echo "  Generating social copy..."
    if node "${PIPELINE_ROOT}/scripts/generate-social-copy.js" --brand "$BRAND" --order "$ORDER_ID"; then
        echo "  Social copy generated."
    else
        echo "  WARNING: Social copy generation failed for order ${ORDER_ID}"
    fi

    # --- 2h: Upload all outputs to Drive ---
    if [[ "$SKIP_UPLOAD" = false ]]; then
        if [[ -n "${GOOGLE_SERVICE_ACCOUNT_KEY:-}" || -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
            echo "  Uploading outputs to Drive..."
            if node "${PIPELINE_ROOT}/scripts/upload-to-drive.js" --brand "$BRAND" --order "$ORDER_ID"; then
                echo "  Drive upload complete."
            else
                echo "  WARNING: Drive upload failed -- files saved locally"
            fi
        else
            echo "  Skipping Drive upload (no credentials configured)"
        fi
    fi

    PRODUCED=$((PRODUCED + 1))
    RESULTS+=("${ORDER_ID}: OK (reel${HAS_REACTION:+, ugc}) score ${SCORE}")
    echo ""
done

# === Step 3: Report ===
echo ""
echo "=== Batch Production Report ==="
echo "  Brand: ${BRAND_NAME} (${BRAND})"
echo "  Produced: ${PRODUCED}"
echo "  Failed: ${FAILED}"
echo "  Skipped: ${SKIPPED}"
echo ""
echo "  Results:"
for result in "${RESULTS[@]:-}"; do
    if [[ -n "$result" ]]; then
        echo "    - ${result}"
    fi
done
echo ""
echo "=== Batch production complete ==="
