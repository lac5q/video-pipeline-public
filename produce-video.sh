#!/bin/bash
# produce-video.sh -- CLI entrypoint for brand-agnostic video production
# Usage: ./produce-video.sh --brand SLUG --order ORDER_ID [--skip-build] [--help]
set -euo pipefail

# === Auto-detect pipeline root ===
PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# === Usage ===
usage() {
    cat <<EOF
Usage: $(basename "$0") --brand SLUG --order ORDER_ID [OPTIONS]

Produce a product showcase video for any brand.

Required:
  --brand SLUG        Brand slug (e.g., turnedyellow, makemejedi, popsmiths)
  --order ORDER_ID    Order ID (e.g., 133627)

Options:
  --skip-build        Set up workspace only, do not build video
  --help              Show this help message

Examples:
  $(basename "$0") --brand turnedyellow --order 133627
  $(basename "$0") --brand popsmiths --order 50001 --skip-build

The script reads brand config from brands/{SLUG}.json and product catalog
from products.json. All paths are resolved relative to the pipeline root.

Pipeline root: \${PIPELINE_ROOT} (auto-detected)
EOF
    exit 0
}

# === Parse arguments ===
BRAND=""
ORDER_ID=""
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --brand)
            BRAND="$2"
            shift 2
            ;;
        --order)
            ORDER_ID="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
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

if [[ -z "$ORDER_ID" ]]; then
    echo "ERROR: --order is required"
    echo "Run '$(basename "$0") --help' for usage."
    exit 1
fi

# === Validate config files ===
BRAND_CONFIG="${PIPELINE_ROOT}/brands/${BRAND}.json"
PRODUCTS_CONFIG="${PIPELINE_ROOT}/products.json"

if [[ ! -f "$BRAND_CONFIG" ]]; then
    echo "ERROR: Brand config not found: ${BRAND_CONFIG}"
    echo "Available brands:"
    ls "${PIPELINE_ROOT}/brands/"*.json 2>/dev/null | while read -r f; do
        basename "$f" .json
    done
    exit 1
fi

if [[ ! -f "$PRODUCTS_CONFIG" ]]; then
    echo "ERROR: Product catalog not found: ${PRODUCTS_CONFIG}"
    exit 1
fi

# === Check for required tools ===
for tool in jq ffmpeg ffprobe magick bc; do
    if ! command -v "$tool" &>/dev/null; then
        echo "ERROR: Required tool not found: $tool"
        exit 1
    fi
done

# === Warn if GEMINI_API_KEY is not set (staging may already be done) ===
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
    echo "WARNING: GEMINI_API_KEY is not set. Gemini staging will not be available."
    echo "         If mockups are already staged (v11_*.png files exist), the build can proceed."
fi

# === Load brand config via jq ===
echo "=== Loading brand config: ${BRAND} ==="

BRAND_NAME=$(jq -r '.name' "$BRAND_CONFIG")
BRAND_SLUG=$(jq -r '.slug' "$BRAND_CONFIG")
BRAND_BG=$(jq -r '.colors.background' "$BRAND_CONFIG")
BRAND_ACCENT=$(jq -r '.colors.accent' "$BRAND_CONFIG")
HOOK_ACCENT=$(jq -r '.colors.hook_accent' "$BRAND_CONFIG")
LABEL_COLOR=$(jq -r '.colors.label_brand' "$BRAND_CONFIG")
LOGO_FILE=$(jq -r '.logo.file' "$BRAND_CONFIG")
LOGO_WIDTH=$(jq -r '.logo.width' "$BRAND_CONFIG")
CTA_LINE1=$(jq -r '.cta.line1' "$BRAND_CONFIG")
CTA_URL=$(jq -r '.cta.line2_url' "$BRAND_CONFIG")
CTA_TAGLINE=$(jq -r '.cta.line3_tagline' "$BRAND_CONFIG")
SHOWCASE_KEY=$(jq -r '.product_showcase_order' "$BRAND_CONFIG")
REACTION_LABEL=$(jq -r '.reaction_label' "$BRAND_CONFIG")
FONT=$(jq -r '.font' "$BRAND_CONFIG")

echo "  Brand: ${BRAND_NAME} (${BRAND_SLUG})"
echo "  Showcase order: ${SHOWCASE_KEY}"

# === Resolve paths ===
LOGO="${PIPELINE_ROOT}/brands/assets/logos/${LOGO_FILE}"
MUSIC_DIR="${MUSIC_DIR:-${PIPELINE_ROOT}/brands/assets/music}"

# Select music: first available track from the pool
MUSIC_COUNT=$(jq '.music_pool | length' "$BRAND_CONFIG")
MUSIC=""
if [[ "$MUSIC_COUNT" -gt 0 ]]; then
    # Pick a random track from the pool
    MUSIC_INDEX=$((RANDOM % MUSIC_COUNT))
    MUSIC_FILE=$(jq -r ".music_pool[${MUSIC_INDEX}]" "$BRAND_CONFIG")
    MUSIC="${MUSIC_DIR}/${MUSIC_FILE}"
    echo "  Music: ${MUSIC_FILE}"
fi

# === Create per-order workspace ===
WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND_SLUG}/${ORDER_ID}"
echo "=== Workspace: ${WORKSPACE} ==="

mkdir -p "${WORKSPACE}/mockups"
mkdir -p "${WORKSPACE}/photos"
mkdir -p "${WORKSPACE}/exports"

# === Detect reaction video ===
HAS_REACTION=false
REACTION_FILE=""
for ext in mov mp4 MOV MP4; do
    if [[ -f "${WORKSPACE}/${ORDER_ID}.${ext}" ]]; then
        HAS_REACTION=true
        REACTION_FILE="${WORKSPACE}/${ORDER_ID}.${ext}"
        break
    fi
done

# Also check for any reaction file with common naming patterns
if [[ "$HAS_REACTION" = false ]]; then
    for candidate in "${WORKSPACE}"/reaction.*; do
        if [[ -f "$candidate" ]]; then
            HAS_REACTION=true
            REACTION_FILE="$candidate"
            break
        fi
    done
fi

if [[ "$HAS_REACTION" = true ]]; then
    echo "  Reaction video found: $(basename "$REACTION_FILE")"
    echo "  Build type: UGC (reaction + products)"
else
    echo "  No reaction video found"
    echo "  Build type: Reels-only (products only)"
fi

# === Export config for subscripts ===
export PIPELINE_ROOT
export BRAND_CONFIG
export PRODUCTS_CONFIG
export BRAND_NAME BRAND_SLUG BRAND_BG BRAND_ACCENT HOOK_ACCENT LABEL_COLOR
export LOGO_FILE LOGO_WIDTH LOGO FONT
export CTA_LINE1 CTA_URL CTA_TAGLINE
export SHOWCASE_KEY REACTION_LABEL
export MUSIC_DIR MUSIC
export WORKSPACE ORDER_ID
export HAS_REACTION REACTION_FILE

# === Build video (unless --skip-build) ===
if [[ "$SKIP_BUILD" = true ]]; then
    echo ""
    echo "=== Skip build requested ==="
    echo "Workspace set up at: ${WORKSPACE}"
    echo "To build later, run:"
    echo "  ${PIPELINE_ROOT}/scripts/build-video.sh \"${BRAND_CONFIG}\" \"${WORKSPACE}\" \"${PRODUCTS_CONFIG}\""
    exit 0
fi

echo ""
echo "=== Starting video build ==="
"${PIPELINE_ROOT}/scripts/build-video.sh" "${BRAND_CONFIG}" "${WORKSPACE}" "${PRODUCTS_CONFIG}"
BUILD_EXIT=$?

if [[ $BUILD_EXIT -ne 0 ]]; then
    echo "ERROR: Video build failed (exit code: ${BUILD_EXIT})"
    exit $BUILD_EXIT
fi

# === Find output video and verify ===
# Determine expected output filename
if [[ "$HAS_REACTION" = true ]]; then
    OUTPUT_VIDEO="${WORKSPACE}/exports/${BRAND_SLUG}-${ORDER_ID}-ugc.mp4"
else
    OUTPUT_VIDEO="${WORKSPACE}/exports/${BRAND_SLUG}-${ORDER_ID}-reels.mp4"
fi

if [[ ! -f "$OUTPUT_VIDEO" ]]; then
    echo "ERROR: Expected output not found: ${OUTPUT_VIDEO}"
    echo "Checking exports directory:"
    ls -la "${WORKSPACE}/exports/" 2>/dev/null || echo "  (empty)"
    exit 1
fi

echo ""
echo "=== Verifying output video ==="
"${PIPELINE_ROOT}/scripts/verify-video.sh" "${OUTPUT_VIDEO}"
VERIFY_EXIT=$?

if [[ $VERIFY_EXIT -ne 0 ]]; then
    echo ""
    echo "WARNING: Video verification failed. Output may not meet quality specs."
    echo "Output file: ${OUTPUT_VIDEO}"
    exit $VERIFY_EXIT
fi

echo ""
echo "=== SUCCESS ==="
echo "Output: ${OUTPUT_VIDEO}"
echo "Size: $(du -h "${OUTPUT_VIDEO}" | cut -f1)"
echo "Brand: ${BRAND_NAME}"
echo "Order: ${ORDER_ID}"
echo "Type: $(if [[ "$HAS_REACTION" = true ]]; then echo "UGC"; else echo "Reels"; fi)"
