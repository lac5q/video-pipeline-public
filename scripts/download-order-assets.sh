#!/bin/bash
# download-order-assets.sh -- Download reaction video, photos, and illustration for an order
# Usage: ./scripts/download-order-assets.sh --brand SLUG --order ORDER_ID [--help]
set -euo pipefail

# === Auto-detect pipeline root ===
PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# === Usage ===
usage() {
    cat <<EOF
Usage: $(basename "$0") --brand SLUG --order ORDER_ID [OPTIONS]

Download all assets for a given order into the workspace directory.

Required:
  --brand SLUG        Brand slug (e.g., turnedyellow, makemejedi)
  --order ORDER_ID    Order ID (e.g., 133627)

Options:
  --skip-video        Skip downloading the reaction video
  --skip-photos       Skip downloading customer photos
  --skip-illustration Skip downloading the illustration
  --help              Show this help message

Assets are placed in: orders/{brand}/{order_id}/
  - Reaction video:   orders/{brand}/{order_id}/{order_id}.{ext}
  - Photos:           orders/{brand}/{order_id}/photos/
  - Illustration:     orders/{brand}/{order_id}/mockups/illustration.png

Pipeline root: ${PIPELINE_ROOT}
EOF
    exit 0
}

# === Parse arguments ===
BRAND=""
ORDER_ID=""
SKIP_VIDEO=false
SKIP_PHOTOS=false
SKIP_ILLUSTRATION=false

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
        --skip-video)
            SKIP_VIDEO=true
            shift
            ;;
        --skip-photos)
            SKIP_PHOTOS=true
            shift
            ;;
        --skip-illustration)
            SKIP_ILLUSTRATION=true
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
    exit 1
fi

if [[ -z "$ORDER_ID" ]]; then
    echo "ERROR: --order is required"
    exit 1
fi

# === Load order data from database ===
echo "=== Loading order from database ==="

ORDER_JSON=$(node -e "
  const { getDatabase } = require('${PIPELINE_ROOT}/lib/db');
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get('${ORDER_ID}', '${BRAND}');
  db.close();
  if (!row) {
    console.error('ERROR: Order ${ORDER_ID} not found for brand ${BRAND}');
    process.exit(1);
  }
  console.log(JSON.stringify(row));
")

echo "  Order: ${ORDER_ID} (${BRAND})"

# Parse JSON fields
REACTION_VIDEO_URL=$(echo "$ORDER_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.reaction_video_url||'')")
PHOTOS_URL=$(echo "$ORDER_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.photos_url||'')")
OMS_URL=$(echo "$ORDER_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.oms_url||'')")
ILLUSTRATION_ID=$(echo "$ORDER_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.illustration_id||'')")

# === Create workspace ===
WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND}/${ORDER_ID}"
mkdir -p "${WORKSPACE}/photos"
mkdir -p "${WORKSPACE}/mockups"
mkdir -p "${WORKSPACE}/exports"

echo "  Workspace: ${WORKSPACE}"

# === Download reaction video ===
if [[ "$SKIP_VIDEO" = false ]]; then
    echo ""
    echo "=== Downloading reaction video ==="

    if [[ -z "$REACTION_VIDEO_URL" ]]; then
        echo "  No reaction video URL found; skipping."
    else
        # Extract Google Drive file ID from various URL formats
        DRIVE_FILE_ID=""
        if echo "$REACTION_VIDEO_URL" | grep -q "drive.google.com/file/d/"; then
            DRIVE_FILE_ID=$(echo "$REACTION_VIDEO_URL" | sed -n 's|.*drive.google.com/file/d/\([^/]*\).*|\1|p')
        elif echo "$REACTION_VIDEO_URL" | grep -q "drive.google.com/open?id="; then
            DRIVE_FILE_ID=$(echo "$REACTION_VIDEO_URL" | sed -n 's|.*id=\([^&]*\).*|\1|p')
        fi

        if [[ -n "$DRIVE_FILE_ID" ]]; then
            echo "  Drive file ID: ${DRIVE_FILE_ID}"

            # Try gdown first, fall back to curl with Drive API
            if command -v gdown &>/dev/null; then
                echo "  Using gdown..."
                gdown --id "$DRIVE_FILE_ID" -O "${WORKSPACE}/${ORDER_ID}.mp4" --quiet || {
                    echo "ERROR: gdown failed to download reaction video"
                    echo "  URL: ${REACTION_VIDEO_URL}"
                }
            else
                echo "  Using curl with Google Drive export..."
                CONFIRM_URL="https://drive.google.com/uc?export=download&id=${DRIVE_FILE_ID}"
                curl -L -o "${WORKSPACE}/${ORDER_ID}.mp4" "$CONFIRM_URL" --silent --show-error || {
                    echo "ERROR: curl failed to download reaction video"
                    echo "  URL: ${REACTION_VIDEO_URL}"
                }
            fi

            if [[ -f "${WORKSPACE}/${ORDER_ID}.mp4" ]]; then
                SIZE=$(du -h "${WORKSPACE}/${ORDER_ID}.mp4" | cut -f1)
                echo "  Downloaded: ${ORDER_ID}.mp4 (${SIZE})"
            fi
        else
            echo "  Could not extract Drive file ID from URL: ${REACTION_VIDEO_URL}"
            echo "  Manual download may be required."
        fi
    fi
fi

# === Download customer photos ===
if [[ "$SKIP_PHOTOS" = false ]]; then
    echo ""
    echo "=== Downloading customer photos ==="

    if [[ -z "$PHOTOS_URL" ]]; then
        echo "  No photos URL found; skipping."
    else
        # Extract folder ID from Google Drive folder link
        FOLDER_ID=""
        if echo "$PHOTOS_URL" | grep -q "drive.google.com/drive/folders/"; then
            FOLDER_ID=$(echo "$PHOTOS_URL" | sed -n 's|.*folders/\([^/?]*\).*|\1|p')
        fi

        if [[ -n "$FOLDER_ID" ]]; then
            echo "  Drive folder ID: ${FOLDER_ID}"

            if command -v gdown &>/dev/null; then
                echo "  Using gdown to download folder..."
                gdown --folder --id "$FOLDER_ID" -O "${WORKSPACE}/photos/" --quiet || {
                    echo "ERROR: gdown failed to download photos folder"
                    echo "  URL: ${PHOTOS_URL}"
                }
            else
                echo "  gdown not available. Install with: pip install gdown"
                echo "  Alternatively, download manually from: ${PHOTOS_URL}"
            fi

            PHOTO_COUNT=$(find "${WORKSPACE}/photos" -type f 2>/dev/null | wc -l | tr -d ' ')
            echo "  Photos in workspace: ${PHOTO_COUNT}"
        else
            echo "  Could not extract folder ID from URL: ${PHOTOS_URL}"
            echo "  Manual download may be required."
        fi
    fi
fi

# === Fetch illustration via OMS adapter ===
if [[ "$SKIP_ILLUSTRATION" = false ]]; then
    echo ""
    echo "=== Fetching illustration (via OMS adapter) ==="

    BRAND_CONFIG="${PIPELINE_ROOT}/brands/${BRAND}.json"
    if [[ ! -f "$BRAND_CONFIG" ]]; then
        echo "ERROR: Brand config not found: ${BRAND_CONFIG}"
        exit 1
    fi

    node -e "
      const { OmsAdapter } = require('${PIPELINE_ROOT}/lib/oms-adapter');
      const brandConfig = require('${BRAND_CONFIG}');
      const adapter = OmsAdapter.create(brandConfig);
      adapter.fetchIllustration('${ORDER_ID}', '${WORKSPACE}')
        .then(r => {
          if (r.success) console.log('  Illustration downloaded: ' + r.path);
          else console.log('  Illustration fetch: ' + (r.error || 'not available'));
        })
        .catch(e => { console.error('  ERROR: ' + e.message); });
    " || echo "  OMS adapter call failed"

    # For PopSmiths: generate AI lifestyle imagery after fetching art
    IS_POPSMITHS=$(node -e "const c = require('${BRAND_CONFIG}'); console.log(c.heroku_app ? 'true' : 'false')")
    if [[ "$IS_POPSMITHS" = "true" ]]; then
        echo ""
        echo "=== Generating AI lifestyle imagery (PopSmiths) ==="
        ILLUSTRATION_PATH="${WORKSPACE}/mockups/illustration.png"
        if [[ -f "$ILLUSTRATION_PATH" ]]; then
            node -e "
              const { OmsAdapter } = require('${PIPELINE_ROOT}/lib/oms-adapter');
              const brandConfig = require('${BRAND_CONFIG}');
              const adapter = OmsAdapter.create(brandConfig);
              adapter.generateLifestyleImagery('${ILLUSTRATION_PATH}', '${WORKSPACE}')
                .then(r => {
                  if (r.success) console.log('  Generated ' + r.paths.length + ' lifestyle scenes');
                  else console.log('  Lifestyle generation: ' + (r.error || 'failed'));
                })
                .catch(e => { console.error('  ERROR: ' + e.message); });
            " || echo "  Lifestyle imagery generation failed"
        else
            echo "  No illustration available for lifestyle generation"
        fi
    fi
fi

echo ""
echo "=== Asset download complete ==="
echo "  Workspace: ${WORKSPACE}"
echo "  Contents:"
find "${WORKSPACE}" -type f -not -name '.DS_Store' | sort | while read -r f; do
    echo "    $(echo "$f" | sed "s|${WORKSPACE}/||")"
done
