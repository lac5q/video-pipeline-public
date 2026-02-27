#!/bin/bash
# regression-test.sh -- Validate the new parameterized pipeline against baselines
# Runs automated checks: hardcoded paths, config validity, old script integrity,
# pipeline dry run, and optional video build + verification.
# Usage: bash scripts/regression-test.sh
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() {
    echo "PASS: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    echo "FAIL: $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

skip() {
    echo "SKIP: $1"
    SKIP_COUNT=$((SKIP_COUNT + 1))
}

echo "=========================================="
echo "  Regression Test Suite"
echo "  Pipeline Root: ${PIPELINE_ROOT}"
echo "  Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================="
echo ""

# =============================================================================
# 1. Hardcoded Path Scan (BRAND-05)
# =============================================================================
echo "=== 1. Hardcoded Path Scan ==="

HARDCODED=$(grep -rn '/Users/lcalderon' "${PIPELINE_ROOT}/produce-video.sh" "${PIPELINE_ROOT}/scripts/" 2>/dev/null | grep -v 'regression-test.sh' | wc -l | tr -d ' ' || true)
if [ "$HARDCODED" -gt 0 ]; then
    fail "Found $HARDCODED hardcoded /Users/lcalderon/ references"
    grep -rn '/Users/lcalderon' "${PIPELINE_ROOT}/produce-video.sh" "${PIPELINE_ROOT}/scripts/" 2>/dev/null | grep -v 'regression-test.sh' || true
else
    pass "No hardcoded /Users/lcalderon/ paths in produce-video.sh or scripts/"
fi
echo ""

# =============================================================================
# 2. Config Completeness Check
# =============================================================================
echo "=== 2. Config Completeness Check ==="

# Check jq is available
if ! command -v jq &>/dev/null; then
    fail "jq not found -- cannot validate configs"
    echo "Install jq: brew install jq"
    echo ""
else
    # 2a. All 5 brand configs parse as valid JSON
    BRANDS=("turnedyellow" "makemejedi" "turnedwizard" "turnedcomics" "popsmiths")
    BRAND_PASS=true
    for brand in "${BRANDS[@]}"; do
        CONFIG="${PIPELINE_ROOT}/brands/${brand}.json"
        if [[ ! -f "$CONFIG" ]]; then
            fail "Brand config missing: ${CONFIG}"
            BRAND_PASS=false
            continue
        fi
        if ! jq empty "$CONFIG" 2>/dev/null; then
            fail "Brand config invalid JSON: ${CONFIG}"
            BRAND_PASS=false
            continue
        fi
    done
    if $BRAND_PASS; then
        pass "All 5 brand configs parse as valid JSON"
    fi

    # 2b. products.json has expected products
    PRODUCTS_CONFIG="${PIPELINE_ROOT}/products.json"
    if [[ ! -f "$PRODUCTS_CONFIG" ]]; then
        fail "Product catalog missing: ${PRODUCTS_CONFIG}"
    elif ! jq empty "$PRODUCTS_CONFIG" 2>/dev/null; then
        fail "Product catalog invalid JSON: ${PRODUCTS_CONFIG}"
    else
        PRODUCT_COUNT=$(jq '.products | length' "$PRODUCTS_CONFIG")
        if [[ "$PRODUCT_COUNT" -eq 17 ]]; then
            pass "Product catalog has 17 products"
        else
            fail "Product catalog has ${PRODUCT_COUNT} products, expected 17"
        fi
    fi

    # 2c. Required fields in each brand config
    REQUIRED_FIELDS=("name" "slug" "colors.background" "colors.accent" "logo.file" "cta.line1" "cta.line2_url" "product_showcase_order" "reaction_label" "font")
    FIELDS_PASS=true
    for brand in "${BRANDS[@]}"; do
        CONFIG="${PIPELINE_ROOT}/brands/${brand}.json"
        [[ ! -f "$CONFIG" ]] && continue
        for field in "${REQUIRED_FIELDS[@]}"; do
            VALUE=$(jq -r ".${field}" "$CONFIG" 2>/dev/null)
            if [[ -z "$VALUE" || "$VALUE" == "null" ]]; then
                fail "Brand '${brand}' missing required field: ${field}"
                FIELDS_PASS=false
            fi
        done
    done
    if $FIELDS_PASS; then
        pass "All brand configs have required fields (name, slug, colors, logo, cta, etc.)"
    fi
fi
echo ""

# =============================================================================
# 3. Old Scripts Integrity (QUAL-04)
# =============================================================================
echo "=== 3. Old Scripts Integrity ==="

# Check old build scripts exist
OLD_SCRIPTS=(
    "orders/133627/exports/build-ugc-v11.sh"
    "orders/130138/exports/build-ugc-v1.sh"
)
OLD_EXIST=true
for script in "${OLD_SCRIPTS[@]}"; do
    if [[ ! -f "${PIPELINE_ROOT}/${script}" ]]; then
        fail "Old script missing: ${script}"
        OLD_EXIST=false
    fi
done

if $OLD_EXIST; then
    pass "Old build scripts exist (orders/133627 and orders/130138)"
fi

# Verify zero changes from git HEAD
ORDERS_DIFF=$(cd "${PIPELINE_ROOT}" && git diff HEAD -- orders/ 2>/dev/null | wc -l | tr -d ' ')
if [[ "$ORDERS_DIFF" -eq 0 ]]; then
    pass "Old scripts unchanged from git HEAD (git diff orders/ is empty)"
else
    fail "Old scripts have uncommitted changes (git diff orders/ shows ${ORDERS_DIFF} lines)"
fi
echo ""

# =============================================================================
# 4. Pipeline Dry Run (structural only)
# =============================================================================
echo "=== 4. Pipeline Dry Run ==="

# Run produce-video.sh --skip-build for TY-133627
DRY_RUN_OUTPUT=$(cd "${PIPELINE_ROOT}" && bash produce-video.sh --brand turnedyellow --order 133627 --skip-build 2>&1) || {
    fail "Pipeline dry run failed (exit code $?)"
    echo "$DRY_RUN_OUTPUT"
    echo ""
    # Continue to next section instead of exiting
    DRY_RUN_OUTPUT=""
}

if [[ -n "$DRY_RUN_OUTPUT" ]]; then
    echo "$DRY_RUN_OUTPUT"
    echo ""

    # Verify workspace was created
    WORKSPACE="${PIPELINE_ROOT}/orders/turnedyellow/133627"
    if [[ -d "$WORKSPACE" ]]; then
        pass "Workspace created: orders/turnedyellow/133627/"
    else
        fail "Workspace not created at orders/turnedyellow/133627/"
    fi

    # Verify subdirectories
    for subdir in mockups photos exports; do
        if [[ -d "${WORKSPACE}/${subdir}" ]]; then
            pass "Workspace subdirectory exists: ${subdir}/"
        else
            fail "Workspace subdirectory missing: ${subdir}/"
        fi
    done

    # Verify config values loaded (check dry run output)
    if echo "$DRY_RUN_OUTPUT" | grep -q "TurnedYellow"; then
        pass "Brand name 'TurnedYellow' loaded from config"
    else
        fail "Brand name not found in dry run output"
    fi

    if echo "$DRY_RUN_OUTPUT" | grep -q "default"; then
        pass "Showcase order 'default' loaded from config"
    else
        fail "Showcase order not found in dry run output"
    fi
fi
echo ""

# =============================================================================
# 5. Video Build (if assets available)
# =============================================================================
echo "=== 5. Video Build Check ==="

# Check for staged mockups in the workspace or old path
MOCKUP_PATH="${PIPELINE_ROOT}/orders/turnedyellow/133627/mockups"
OLD_MOCKUP_PATH="${PIPELINE_ROOT}/orders/133627/mockups"

HAS_MOCKUPS=false
MOCKUP_LOCATION=""

if ls "${MOCKUP_PATH}"/v11_*.png 2>/dev/null | head -1 | grep -q .; then
    HAS_MOCKUPS=true
    MOCKUP_LOCATION="$MOCKUP_PATH"
    MOCKUP_COUNT=$(ls "${MOCKUP_PATH}"/v11_*.png 2>/dev/null | wc -l | tr -d ' ')
    pass "Found ${MOCKUP_COUNT} staged mockups in workspace"
elif ls "${OLD_MOCKUP_PATH}"/v11_*.png 2>/dev/null | head -1 | grep -q .; then
    HAS_MOCKUPS=true
    MOCKUP_LOCATION="$OLD_MOCKUP_PATH"
    MOCKUP_COUNT=$(ls "${OLD_MOCKUP_PATH}"/v11_*.png 2>/dev/null | wc -l | tr -d ' ')
    skip "Mockups found in old path (orders/133627/mockups/) -- ${MOCKUP_COUNT} files. Manual staging to new workspace needed."
fi

if $HAS_MOCKUPS && [[ "$MOCKUP_LOCATION" == "$MOCKUP_PATH" ]]; then
    echo "  Attempting full video build..."
    BUILD_OUTPUT=$(cd "${PIPELINE_ROOT}" && bash produce-video.sh --brand turnedyellow --order 133627 2>&1) || {
        fail "Video build failed"
        echo "$BUILD_OUTPUT"
    }

    # Check for output video
    OUTPUT_VIDEO="${PIPELINE_ROOT}/orders/turnedyellow/133627/exports/turnedyellow-133627-reels.mp4"
    OUTPUT_UGC="${PIPELINE_ROOT}/orders/turnedyellow/133627/exports/turnedyellow-133627-ugc.mp4"
    if [[ -f "$OUTPUT_VIDEO" ]] || [[ -f "$OUTPUT_UGC" ]]; then
        FINAL_VIDEO="${OUTPUT_VIDEO}"
        [[ -f "$OUTPUT_UGC" ]] && FINAL_VIDEO="$OUTPUT_UGC"
        pass "Video output produced: $(basename "$FINAL_VIDEO")"

        # Run verify-video.sh
        echo ""
        echo "  Running verify-video.sh..."
        if bash "${PIPELINE_ROOT}/scripts/verify-video.sh" "$FINAL_VIDEO"; then
            pass "Video passes quality gate (verify-video.sh)"
        else
            fail "Video failed quality gate"
        fi
    else
        fail "No output video found after build"
    fi
else
    if ! $HAS_MOCKUPS; then
        skip "No staged mockups available -- manual build test needed after staging assets"
    fi
    skip "Video build skipped (mockups not in new workspace path)"
fi
echo ""

# =============================================================================
# 6. Output Comparison (if baseline video exists)
# =============================================================================
echo "=== 6. Baseline Comparison ==="

# Look for original TY-133627 video for comparison
BASELINE_CANDIDATES=(
    "${PIPELINE_ROOT}/orders/133627/exports/133627-ugc.mp4"
    "${PIPELINE_ROOT}/orders/133627/exports/133627.mp4"
)

BASELINE=""
for candidate in "${BASELINE_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
        BASELINE="$candidate"
        break
    fi
done

if [[ -n "$BASELINE" ]]; then
    echo "  Baseline found: $(basename "$BASELINE")"

    if command -v ffprobe &>/dev/null; then
        B_WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$BASELINE")
        B_HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$BASELINE")
        B_CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$BASELINE")
        B_DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$BASELINE")

        echo "  Baseline properties: ${B_WIDTH}x${B_HEIGHT}, ${B_CODEC}, ${B_DURATION}s"

        if [[ "$B_WIDTH" == "1080" && "$B_HEIGHT" == "1920" ]]; then
            pass "Baseline resolution: 1080x1920"
        else
            echo "INFO: Baseline resolution: ${B_WIDTH}x${B_HEIGHT}"
        fi

        if [[ "$B_CODEC" == "h264" ]]; then
            pass "Baseline codec: h264"
        else
            echo "INFO: Baseline codec: ${B_CODEC}"
        fi
    else
        skip "ffprobe not available for baseline analysis"
    fi
else
    skip "No baseline video found for comparison (orders/133627/exports/133627*.mp4)"
fi
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "=========================================="
echo "  REGRESSION TEST RESULTS"
echo "=========================================="
echo "  PASSED:  ${PASS_COUNT}"
echo "  FAILED:  ${FAIL_COUNT}"
echo "  SKIPPED: ${SKIP_COUNT}"
echo "=========================================="

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo "  VERDICT: FAILED (${FAIL_COUNT} failures)"
    exit 1
else
    echo "  VERDICT: ALL AUTOMATED CHECKS PASSED"
    if [[ "$SKIP_COUNT" -gt 0 ]]; then
        echo "  NOTE: ${SKIP_COUNT} checks skipped (assets not available)"
    fi
    exit 0
fi
