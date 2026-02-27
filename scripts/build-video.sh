#!/bin/bash
# build-video.sh -- Parameterized video builder
# Reads brand config and product catalog via jq, builds product showcase video.
# Derived from proven build-ugc-v11.sh, with all hardcoded values replaced by config.
#
# Usage: ./build-video.sh BRAND_CONFIG WORKSPACE PRODUCTS_CONFIG
# Or: sourced with env vars already exported by produce-video.sh
set -euo pipefail

# === Arguments / Environment ===
BRAND_CONFIG="${1:-$BRAND_CONFIG}"
WORKSPACE="${2:-$WORKSPACE}"
PRODUCTS_CONFIG="${3:-$PRODUCTS_CONFIG}"

# === Pipeline root (from script location) ===
PIPELINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# === Read brand config via jq ===
BRAND_NAME="${BRAND_NAME:-$(jq -r '.name' "$BRAND_CONFIG")}"
BRAND_SLUG="${BRAND_SLUG:-$(jq -r '.slug' "$BRAND_CONFIG")}"
BRAND_BG="${BRAND_BG:-$(jq -r '.colors.background' "$BRAND_CONFIG")}"
BRAND_ACCENT="${BRAND_ACCENT:-$(jq -r '.colors.accent' "$BRAND_CONFIG")}"
HOOK_ACCENT="${HOOK_ACCENT:-$(jq -r '.colors.hook_accent' "$BRAND_CONFIG")}"
LABEL_COLOR="${LABEL_COLOR:-$(jq -r '.colors.label_brand' "$BRAND_CONFIG")}"
LOGO_FILE="${LOGO_FILE:-$(jq -r '.logo.file' "$BRAND_CONFIG")}"
LOGO_WIDTH="${LOGO_WIDTH:-$(jq -r '.logo.width' "$BRAND_CONFIG")}"
CTA_LINE1="${CTA_LINE1:-$(jq -r '.cta.line1' "$BRAND_CONFIG")}"
CTA_URL="${CTA_URL:-$(jq -r '.cta.line2_url' "$BRAND_CONFIG")}"
CTA_TAGLINE="${CTA_TAGLINE:-$(jq -r '.cta.line3_tagline' "$BRAND_CONFIG")}"
SHOWCASE_KEY="${SHOWCASE_KEY:-$(jq -r '.product_showcase_order' "$BRAND_CONFIG")}"
REACTION_LABEL="${REACTION_LABEL:-$(jq -r '.reaction_label' "$BRAND_CONFIG")}"
FONT="${FONT:-$(jq -r '.font' "$BRAND_CONFIG")}"

# === Resolve paths ===
LOGO="${LOGO:-${PIPELINE_ROOT}/brands/assets/logos/${LOGO_FILE}}"
MUSIC_DIR="${MUSIC_DIR:-${PIPELINE_ROOT}/brands/assets/music}"

# Select music from brand pool if not already set
if [[ -z "${MUSIC:-}" ]]; then
    MUSIC_COUNT=$(jq '.music_pool | length' "$BRAND_CONFIG")
    if [[ "$MUSIC_COUNT" -gt 0 ]]; then
        MUSIC_INDEX=$((RANDOM % MUSIC_COUNT))
        MUSIC_FILE=$(jq -r ".music_pool[${MUSIC_INDEX}]" "$BRAND_CONFIG")
        MUSIC="${MUSIC_DIR}/${MUSIC_FILE}"
    fi
fi

# === Workspace paths ===
MOCKUPS="${WORKSPACE}/mockups"
PHOTOS="${WORKSPACE}/photos"
EXPORTS="${WORKSPACE}/exports"
TMP="${WORKSPACE}/tmp_build"
ORDER_ID="${ORDER_ID:-$(basename "$WORKSPACE")}"

# Detect reaction video if not already set
HAS_REACTION="${HAS_REACTION:-false}"
REACTION_FILE="${REACTION_FILE:-}"
if [[ "$HAS_REACTION" = false ]]; then
    for ext in mov mp4 MOV MP4; do
        if [[ -f "${WORKSPACE}/${ORDER_ID}.${ext}" ]]; then
            HAS_REACTION=true
            REACTION_FILE="${WORKSPACE}/${ORDER_ID}.${ext}"
            break
        fi
    done
    if [[ "$HAS_REACTION" = false ]]; then
        for candidate in "${WORKSPACE}"/reaction.*; do
            if [[ -f "$candidate" ]]; then
                HAS_REACTION=true
                REACTION_FILE="$candidate"
                break
            fi
        done
    fi
fi

# === Video specs (constant, not brand-specific -- QUAL-05) ===
W=1080
H=1920
FPS=30

# === Convert hex colors for ffmpeg (Pitfall 6: shell eats # in filter_complex) ===
BRAND_BG_FF="0x${BRAND_BG#\#}"

# === Dynamic product list from catalog ===
echo "=== Reading product showcase order: ${SHOWCASE_KEY} ==="
PRODUCT_IDS=()
PRODUCT_LABELS_ARR=()
PRODUCT_FILES_ARR=()

# Read showcase order from products.json
while IFS= read -r pid; do
    MOCKUP_FILE="${MOCKUPS}/v11_${pid}.png"
    if [[ -f "$MOCKUP_FILE" ]]; then
        LABEL=$(jq -r ".products[] | select(.id == \"$pid\") | .label" "$PRODUCTS_CONFIG")
        PRODUCT_IDS+=("$pid")
        PRODUCT_LABELS_ARR+=("$LABEL")
        PRODUCT_FILES_ARR+=("v11_${pid}.png")
        echo "  Found: ${pid} (${LABEL})"
    else
        echo "  Skipping: ${pid} (no staged mockup: v11_${pid}.png)"
    fi
done < <(jq -r ".showcase_orders.${SHOWCASE_KEY}[]" "$PRODUCTS_CONFIG")

PRODUCT_COUNT=${#PRODUCT_IDS[@]}

# === Staging validation (QUAL-02) ===
if [[ "$PRODUCT_COUNT" -eq 0 ]]; then
    echo "ERROR: No staged mockups found in ${MOCKUPS}/"
    echo "Expected files matching: v11_*.png"
    echo "Run Gemini staging first, then retry the build."
    exit 1
fi

echo "  Total products with staged mockups: ${PRODUCT_COUNT}"

# === Check illustration ===
ILLUSTRATION="${WORKSPACE}/illustration.jpg"
if [[ ! -f "$ILLUSTRATION" ]]; then
    # Try other common extensions
    for ext in png jpeg webp; do
        if [[ -f "${WORKSPACE}/illustration.${ext}" ]]; then
            ILLUSTRATION="${WORKSPACE}/illustration.${ext}"
            break
        fi
    done
fi

# === Set up tmp directory ===
rm -rf "${TMP}"
mkdir -p "${TMP}/text"

# ========================================================================
# IMAGE PREPARATION (from build-ugc-v11.sh -- brand-agnostic functions)
# ========================================================================

# === prepare_photo: blurred background for real photos/artwork (no crop) ===
prepare_photo() {
    local input="$1"
    local output="$2"
    local tag="$3"
    magick "${input}" -auto-orient "${TMP}/orient_${tag}.png"
    magick "${TMP}/orient_${tag}.png" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" -blur 0x40 -brightness-contrast -30x0 "${TMP}/bg_${tag}.png"
    magick "${TMP}/orient_${tag}.png" -resize "${W}x${H}" -gravity center "${TMP}/fg_${tag}.png"
    magick composite -gravity center "${TMP}/fg_${tag}.png" "${TMP}/bg_${tag}.png" "${output}"
}

# === prepare_product: blurred background fit for staged product mockups ===
prepare_product() {
    local input="$1"
    local output="$2"
    local tag="$3"
    magick "${input}" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" -blur 0x40 -brightness-contrast -20x0 "${TMP}/bg_${tag}.png"
    magick "${input}" -resize "${W}x${H}" -gravity center "${TMP}/fg_${tag}.png"
    magick composite -gravity center "${TMP}/fg_${tag}.png" "${TMP}/bg_${tag}.png" "${output}"
}

echo "=== Preparing images ==="

# === Photos (if available) ===
PHOTO_FILES=()
if [[ -d "$PHOTOS" ]]; then
    for photo in "${PHOTOS}"/*.jpg "${PHOTOS}"/*.jpeg "${PHOTOS}"/*.png; do
        if [[ -f "$photo" ]]; then
            PHOTO_FILES+=("$photo")
        fi
    done
fi

if [[ ${#PHOTO_FILES[@]} -gt 0 ]]; then
    PHOTO_IDX=0
    for photo in "${PHOTO_FILES[@]}"; do
        tag="photo_${PHOTO_IDX}"
        echo "  Preparing $(basename "$photo")..."
        prepare_photo "$photo" "${TMP}/prep_${tag}.png" "${tag}"
        PHOTO_IDX=$((PHOTO_IDX + 1))
    done
fi

# === Illustration ===
HAS_ILLUSTRATION=false
if [[ -f "$ILLUSTRATION" ]]; then
    echo "  Preparing illustration..."
    prepare_photo "${ILLUSTRATION}" "${TMP}/prep_illustration.png" "illust"
    HAS_ILLUSTRATION=true
fi

# === Products (dynamic from catalog) ===
for i in "${!PRODUCT_FILES_ARR[@]}"; do
    file="${PRODUCT_FILES_ARR[$i]}"
    tag="prod_${i}"
    echo "  Preparing ${file} (blurred bg)..."
    prepare_product "${MOCKUPS}/${file}" "${TMP}/prep_${tag}.png" "${tag}"
done

# ========================================================================
# LABEL OVERLAYS (config-driven colors and brand name)
# ========================================================================
echo "=== Creating product label overlays ==="
for i in "${!PRODUCT_LABELS_ARR[@]}"; do
    label="${PRODUCT_LABELS_ARR[$i]}"
    echo "  Label: ${label}"
    magick -size ${W}x110 xc:"rgba(0,0,0,0.75)" \
        -font "${FONT}" \
        -pointsize 38 -fill white \
        -gravity center -annotate +0-15 "${label}" \
        -pointsize 24 -fill "${LABEL_COLOR}" \
        -gravity center -annotate +0+25 "${BRAND_NAME}" \
        "${TMP}/text/label_${i}.png"
done

# ========================================================================
# HOOK TEXT FRAMES (config-driven text and colors)
# ========================================================================
echo "=== Creating hook text frames ==="

# Select hook template (random from array, or first if only one)
HOOK_COUNT=$(jq '.hook_templates | length' "$BRAND_CONFIG")
if [[ "$HOOK_COUNT" -gt 0 ]]; then
    HOOK_INDEX=$((RANDOM % HOOK_COUNT))
    HOOK_BEAT1=$(jq -r ".hook_templates[${HOOK_INDEX}].beat1" "$BRAND_CONFIG")
    HOOK_BEAT2=$(jq -r ".hook_templates[${HOOK_INDEX}].beat2" "$BRAND_CONFIG")
else
    HOOK_BEAT1="check this out"
    HOOK_BEAT2="our latest products"
fi

magick -size ${W}x${H} xc:black \
    -font "${FONT}" \
    -pointsize 64 -fill white -gravity center \
    -annotate +0+0 "${HOOK_BEAT1}" \
    "${TMP}/hook_beat1.png"

magick -size ${W}x${H} xc:black \
    -font "${FONT}" \
    -pointsize 64 -fill white -gravity center \
    -annotate +0-50 "${HOOK_BEAT1}" \
    -pointsize 56 -fill "${HOOK_ACCENT}" \
    -annotate +0+50 "${HOOK_BEAT2}" \
    "${TMP}/hook_beat2.png"

# ========================================================================
# REACTION VIDEO PROCESSING (only if HAS_REACTION=true)
# ========================================================================
if [[ "$HAS_REACTION" = true && -f "$REACTION_FILE" ]]; then
    echo "=== Processing reaction video ==="

    ffmpeg -y -ss 2 -i "${REACTION_FILE}" -t 8 \
        -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=${BRAND_BG_FF},format=yuv420p" \
        -c:v libx264 -crf 18 -preset fast -r ${FPS} \
        -c:a aac -b:a 192k \
        "${TMP}/seg_reaction_with_audio.mp4" 2>/dev/null

    # Reaction text bar
    magick -size ${W}x80 xc:"rgba(0,0,0,0.70)" \
        -font "${FONT}" \
        -pointsize 36 -fill white \
        -gravity center -annotate +0+0 "${REACTION_LABEL}" \
        "${TMP}/text/reaction_bar.png"

    ffmpeg -y -i "${TMP}/seg_reaction_with_audio.mp4" -i "${TMP}/text/reaction_bar.png" \
        -filter_complex "[0:v][1:v]overlay=0:${H}-280,format=yuv420p" \
        -c:v libx264 -crf 18 -preset fast -r ${FPS} \
        -c:a copy \
        "${TMP}/seg_reaction.mp4" 2>/dev/null

    ffmpeg -y -i "${TMP}/seg_reaction.mp4" -vn -c:a aac -b:a 192k "${TMP}/reaction_audio.aac" 2>/dev/null
    echo "  Reaction segment ready"
fi

# ========================================================================
# LOGO END CARD (fully parameterized from brand config)
# ========================================================================
echo "=== Creating logo end card ==="
magick -size ${W}x${H} "xc:${BRAND_BG}" \
    \( "${LOGO}" -resize "${LOGO_WIDTH}x" \) -gravity center -composite \
    -font "${FONT}" \
    -pointsize 44 -fill white -gravity center -annotate +0+120 "${CTA_LINE1}" \
    -pointsize 48 -fill "${BRAND_ACCENT}" -gravity center -annotate +0+190 "${CTA_URL}" \
    -pointsize 26 -fill "gray70" -gravity center -annotate +0+260 "${CTA_TAGLINE}" \
    "${TMP}/logo_card.png"

# ========================================================================
# VIDEO SEGMENT GENERATION
# ========================================================================
echo "=== Generating video segments ==="
SEG_IDX=0

make_segment() {
    local input="$1"
    local duration="$2"
    local name="$3"
    printf -v seg_name "seg_%02d_%s" "${SEG_IDX}" "${name}"
    ffmpeg -y -loop 1 -i "${input}" -t "${duration}" \
        -vf "format=yuv420p" \
        -c:v libx264 -crf 18 -preset fast -r ${FPS} \
        -an "${TMP}/${seg_name}.mp4" 2>/dev/null
    echo "file '${TMP}/${seg_name}.mp4'" >> "${TMP}/concat.txt"
    SEG_IDX=$((SEG_IDX + 1))
}

make_product_segment() {
    local input="$1"
    local label_img="$2"
    local duration="$3"
    local name="$4"
    printf -v seg_name "seg_%02d_%s" "${SEG_IDX}" "${name}"
    ffmpeg -y -loop 1 -i "${input}" -loop 1 -i "${label_img}" \
        -filter_complex "[0:v][1:v]overlay=0:${H}-130,format=yuv420p" \
        -t "${duration}" \
        -c:v libx264 -crf 18 -preset fast -r ${FPS} \
        -an "${TMP}/${seg_name}.mp4" 2>/dev/null
    echo "file '${TMP}/${seg_name}.mp4'" >> "${TMP}/concat.txt"
    SEG_IDX=$((SEG_IDX + 1))
}

rm -f "${TMP}/concat.txt"

# 1. Hook (2s total)
echo "  Hook beat 1 (0.7s)..."
make_segment "${TMP}/hook_beat1.png" 0.7 "hook1"
echo "  Hook beat 2 (1.3s)..."
make_segment "${TMP}/hook_beat2.png" 1.3 "hook2"

# 2. Reaction video (8s) -- UGC only
if [[ "$HAS_REACTION" = true && -f "${TMP}/seg_reaction.mp4" ]]; then
    echo "  Reaction video (8s, video only)..."
    printf -v seg_name "seg_%02d_reaction" "${SEG_IDX}"
    ffmpeg -y -i "${TMP}/seg_reaction.mp4" -an -c:v copy "${TMP}/${seg_name}.mp4" 2>/dev/null
    echo "file '${TMP}/${seg_name}.mp4'" >> "${TMP}/concat.txt"
    SEG_IDX=$((SEG_IDX + 1))

    # 3. Customer photos (only in UGC mode, 1.0s each)
    if [[ ${#PHOTO_FILES[@]} -gt 0 ]]; then
        for i in "${!PHOTO_FILES[@]}"; do
            tag="photo_${i}"
            echo "  Photo ${tag} (1.0s)..."
            make_segment "${TMP}/prep_${tag}.png" 1.0 "${tag}"
        done
    fi
fi

# 4. Illustration (1.5s) -- if available
if [[ "$HAS_ILLUSTRATION" = true ]]; then
    echo "  Illustration (1.5s)..."
    make_segment "${TMP}/prep_illustration.png" 1.5 "illustration"
fi

# 5. Products with labels (1.0s each)
for i in "${!PRODUCT_IDS[@]}"; do
    label="${PRODUCT_LABELS_ARR[$i]}"
    echo "  Product ${label} (1.0s)..."
    make_product_segment "${TMP}/prep_prod_${i}.png" "${TMP}/text/label_${i}.png" 1.0 "prod_${i}"
done

# 6. Logo end card (2s)
echo "  Logo end card (2.0s)..."
make_segment "${TMP}/logo_card.png" 2.0 "logo"

# ========================================================================
# CONCATENATE ALL SEGMENTS
# ========================================================================
echo "=== Concatenating segments ==="
ffmpeg -y -f concat -safe 0 -i "${TMP}/concat.txt" \
    -c:v libx264 -crf 18 -preset fast -r ${FPS} -pix_fmt yuv420p \
    -an "${TMP}/video_only.mp4" 2>/dev/null

VIDEO_DUR=$(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${TMP}/video_only.mp4")
echo "Video duration: ${VIDEO_DUR}s"

# ========================================================================
# AUDIO MIXING
# ========================================================================

# Determine output filename
if [[ "$HAS_REACTION" = true ]]; then
    OUTPUT="${EXPORTS}/${BRAND_SLUG}-${ORDER_ID}-ugc.mp4"
else
    OUTPUT="${EXPORTS}/${BRAND_SLUG}-${ORDER_ID}-reels.mp4"
fi

mkdir -p "${EXPORTS}"

add_music_with_reaction() {
    local music="$1"
    local output="$2"
    local react_start=2.0
    local react_end=10.0
    local fade_out_start
    fade_out_start=$(echo "${VIDEO_DUR} - 1.5" | bc)

    echo "  Mixing music + reaction audio..."
    ffmpeg -y \
        -i "${TMP}/video_only.mp4" \
        -i "${music}" \
        -i "${TMP}/reaction_audio.aac" \
        -filter_complex "
            [1:a]volume='if(between(t,${react_start},${react_end}),0.25,1.0)':eval=frame,afade=t=in:st=0:d=0.5,afade=t=out:st=${fade_out_start}:d=1.5[music];
            [2:a]adelay=$(echo "${react_start} * 1000" | bc | cut -d. -f1)|$(echo "${react_start} * 1000" | bc | cut -d. -f1),apad=whole_dur=${VIDEO_DUR}[reaction];
            [music][reaction]amix=inputs=2:duration=first:dropout_transition=0[out]
        " \
        -map 0:v -map "[out]" \
        -c:v copy -c:a aac -b:a 192k \
        -shortest "${output}" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo "  Saved: ${output}"
    else
        echo "  WARNING: Mixed audio failed, falling back to music-only..."
        add_music_only "${music}" "${output}"
    fi
}

add_music_only() {
    local music="$1"
    local output="$2"
    local fade_out_start
    fade_out_start=$(echo "${VIDEO_DUR} - 1.5" | bc)

    echo "  Adding music track..."
    ffmpeg -y \
        -i "${TMP}/video_only.mp4" \
        -i "${music}" \
        -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
        -af "afade=t=in:st=0:d=0.5,afade=t=out:st=${fade_out_start}:d=1.5" \
        -shortest "${output}" 2>/dev/null

    echo "  Saved: ${output}"
}

# Determine audio mixing approach
if [[ -n "${MUSIC:-}" && -f "${MUSIC}" ]]; then
    echo "=== Adding audio ==="
    if [[ "$HAS_REACTION" = true && -f "${TMP}/reaction_audio.aac" ]]; then
        add_music_with_reaction "${MUSIC}" "${OUTPUT}"
    else
        add_music_only "${MUSIC}" "${OUTPUT}"
    fi
elif [[ "$HAS_REACTION" = true && -f "${TMP}/reaction_audio.aac" ]]; then
    # Reaction audio only, no music
    echo "=== Adding reaction audio (no music available) ==="
    ffmpeg -y \
        -i "${TMP}/video_only.mp4" \
        -i "${TMP}/reaction_audio.aac" \
        -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
        -shortest "${OUTPUT}" 2>/dev/null
    echo "  Saved: ${OUTPUT}"
else
    # No audio sources -- silent video
    echo "=== No audio sources available, producing silent video ==="
    cp "${TMP}/video_only.mp4" "${OUTPUT}"
    echo "  Saved (silent): ${OUTPUT}"
fi

# ========================================================================
# CLEANUP AND REPORT
# ========================================================================
echo ""
echo "=== BUILD COMPLETE ==="
echo "Output: ${OUTPUT}"
ls -lh "${OUTPUT}"

# Optional: clean up tmp directory (keep for debugging)
# rm -rf "${TMP}"
