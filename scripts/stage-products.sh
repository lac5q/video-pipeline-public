#!/bin/bash
# stage-products.sh -- Stage product mockups into lifestyle scenes via Gemini API
# Usage: ./scripts/stage-products.sh BRAND ORDER_ID
#
# Takes raw Printful/Gooten mockups from orders/{brand}/{order_id}/mockups/
# and generates lifestyle-staged versions using Gemini's image generation.
# Retries up to 3x per image with exponential backoff.
#
# Output: v11_*.png files in the mockups directory (overwrites raw mockups)
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# === Arguments ===
BRAND="${1:-}"
ORDER_ID="${2:-}"

if [[ -z "$BRAND" ]] || [[ -z "$ORDER_ID" ]]; then
    echo "Usage: $(basename "$0") BRAND ORDER_ID"
    echo "Example: $(basename "$0") turnedyellow 133627"
    exit 1
fi

# === Config ===
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
if [[ -z "$GEMINI_API_KEY" ]]; then
    echo "ERROR: GEMINI_API_KEY is required"
    echo "Set it in your environment or .env file"
    exit 1
fi

BRAND_CONFIG="${PIPELINE_ROOT}/brands/${BRAND}.json"
if [[ ! -f "$BRAND_CONFIG" ]]; then
    echo "ERROR: Brand config not found: ${BRAND_CONFIG}"
    exit 1
fi

WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND}/${ORDER_ID}"
MOCKUPS_DIR="${WORKSPACE}/mockups"

if [[ ! -d "$MOCKUPS_DIR" ]]; then
    echo "ERROR: Mockups directory not found: ${MOCKUPS_DIR}"
    echo "Run generate-mockups.js first"
    exit 1
fi

BRAND_NAME=$(jq -r '.name' "$BRAND_CONFIG")
MAX_RETRIES=3

echo "=== Gemini Lifestyle Staging ==="
echo "  Brand: ${BRAND_NAME} (${BRAND})"
echo "  Order: ${ORDER_ID}"
echo "  Mockups: ${MOCKUPS_DIR}"
echo ""

# === Scene prompts per product type ===
# These generate lifestyle scenes appropriate for each product
get_scene_prompt() {
    local product_key="$1"
    case "$product_key" in
        framed_poster|canvas|poster)
            echo "Place this framed art print on a stylish living room wall above a modern sofa. Natural lighting, cozy home decor, photorealistic interior design photography."
            ;;
        tshirt)
            echo "Show this t-shirt laid flat on a clean wooden surface with casual lifestyle accessories nearby. Bright, natural lighting, flat lay product photography."
            ;;
        hoodie)
            echo "Show this hoodie hanging on a minimalist wooden hanger against a neutral background. Soft studio lighting, clean product photography."
            ;;
        sweatshirt)
            echo "Show this sweatshirt folded neatly on a clean surface with a coffee cup nearby. Warm, cozy lifestyle photography."
            ;;
        tanktop)
            echo "Show this tank top laid flat on a bright surface with summer accessories. Bright, fresh lifestyle photography."
            ;;
        mug)
            echo "Place this mug on a wooden desk in a cozy home office with steam rising from it. Warm morning light, lifestyle product photography."
            ;;
        waterbottle)
            echo "Show this water bottle on a gym bench or outdoor hiking trail surface. Active lifestyle, natural lighting, product photography."
            ;;
        iphone_case)
            echo "Show this phone case on a modern desk next to a laptop and plant. Clean, minimal tech lifestyle photography."
            ;;
        totebag)
            echo "Show this tote bag on a cafe table or market setting. Casual lifestyle, natural lighting, product photography."
            ;;
        blanket)
            echo "Show this blanket draped over a comfortable couch in a cozy living room. Warm lighting, home comfort lifestyle photography."
            ;;
        *)
            echo "Show this product in an appealing lifestyle setting with natural lighting. Professional product photography."
            ;;
    esac
}

# === Gemini API call ===
stage_image() {
    local input_file="$1"
    local output_file="$2"
    local product_key="$3"

    local prompt
    prompt=$(get_scene_prompt "$product_key")

    local base64_image
    base64_image=$(base64 -i "$input_file")

    local mime_type="image/png"
    if [[ "$input_file" == *.jpg ]] || [[ "$input_file" == *.jpeg ]]; then
        mime_type="image/jpeg"
    fi

    local response
    response=$(curl -s -X POST \
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"contents\": [{
                \"parts\": [
                    {\"text\": \"${prompt}\"},
                    {\"inline_data\": {\"mime_type\": \"${mime_type}\", \"data\": \"${base64_image}\"}}
                ]
            }],
            \"generationConfig\": {
                \"responseModalities\": [\"IMAGE\", \"TEXT\"],
                \"responseMimeType\": \"image/png\"
            }
        }")

    # Check for errors
    local error
    error=$(echo "$response" | jq -r '.error.message // empty' 2>/dev/null)
    if [[ -n "$error" ]]; then
        echo "API Error: $error"
        return 1
    fi

    # Extract image data from response
    local image_data
    image_data=$(echo "$response" | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data // empty' 2>/dev/null)

    if [[ -z "$image_data" ]]; then
        # Check finish reason -- specifically detect FinishReason.OTHER (PROD-06)
        local finish_reason
        finish_reason=$(echo "$response" | jq -r '.candidates[0].finishReason // "UNKNOWN"' 2>/dev/null)
        if [[ "$finish_reason" == "OTHER" ]]; then
            echo "FinishReason.OTHER -- Gemini safety/quality filter triggered (will retry)"
        else
            echo "No image in response (finishReason: ${finish_reason})"
        fi
        return 1
    fi

    # Save the staged image
    echo "$image_data" | base64 -d > "$output_file"
    return 0
}

# === Process each mockup ===
success_count=0
fail_count=0
total=0

for mockup in "${MOCKUPS_DIR}"/v11_*.png "${MOCKUPS_DIR}"/v11_*.jpg; do
    [[ -f "$mockup" ]] || continue
    ((total++)) || true

    filename=$(basename "$mockup")
    # Extract product key from filename: v11_tshirt.png → tshirt
    product_key=$(echo "$filename" | sed 's/^v11_//' | sed 's/_[0-9]*\./\./' | sed 's/\.[^.]*$//')

    echo "  [${total}] Staging: ${filename} (${product_key})"

    # Backup original
    backup="${mockup}.raw"
    if [[ ! -f "$backup" ]]; then
        cp "$mockup" "$backup"
    fi

    # Retry with exponential backoff
    # IMPORTANT: Always stage from .raw backup to prevent double-processing (Pitfall 3)
    staged=false
    for attempt in $(seq 1 $MAX_RETRIES); do
        if stage_image "$backup" "$mockup" "$product_key"; then
            echo "      → Staged successfully"
            staged=true
            break
        else
            if [[ $attempt -lt $MAX_RETRIES ]]; then
                backoff=$((2 ** attempt))
                echo "      → Retry ${attempt}/${MAX_RETRIES} in ${backoff}s..."
                sleep "$backoff"
            fi
        fi
    done

    if [[ "$staged" = true ]]; then
        ((success_count++)) || true
    else
        echo "      → FAILED after ${MAX_RETRIES} attempts, keeping original"
        # Restore original
        cp "$backup" "$mockup"
        ((fail_count++)) || true
    fi
done

# === Report ===
echo ""
echo "=== Staging Complete ==="
echo "  Total:   ${total}"
echo "  Staged:  ${success_count}"
echo "  Failed:  ${fail_count}"
echo "  Output:  ${MOCKUPS_DIR}/"

if [[ $fail_count -gt 0 ]]; then
    echo ""
    echo "WARNING: ${fail_count} images failed Gemini staging."
    echo "Original mockups preserved as .raw backups."
    exit 2
fi
