#!/bin/bash
# TY-133627 UGC v11 — HYBRID: rembg cutouts on lifestyle scenes + blurred bg for apparel
# 12 products with labels, reaction audio mixed with music, blurred bg for all
# Structure: Hook(2s) → Reaction(8s) → Photos(3s) → Illustration(1.5s) → 12 Products(12s) → Logo(2s) = ~28.5s
set -euo pipefail

WORKSPACE="/Users/lcalderon/clawd/agents/gwen/workspace/turnedyellow-video-ugc-133627"
MOCKUPS="${WORKSPACE}/mockups"
PHOTOS="${WORKSPACE}/photos"
ILLUSTRATION="${WORKSPACE}/illustration.jpg"
REACTION="${WORKSPACE}/133627.mov"
LOGO="/Users/lcalderon/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png"
EXPORTS="${WORKSPACE}/exports"
TMP="${WORKSPACE}/tmp_ugc_v11"
MUSIC_CANDY="/tmp/brand-music/Tobu - Candyland [Privated NCS Release].mp3"

BRAND_DARK="0x1a1a2e"
W=1080
H=1920
FPS=30

rm -rf "${TMP}"
mkdir -p "${TMP}/text"

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

# Photos (photo1, photo3, photo5)
for p in photo1 photo3 photo5; do
    echo "  Preparing ${p}..."
    prepare_photo "${PHOTOS}/${p}.jpg" "${TMP}/prep_${p}.png" "${p}"
done

# Illustration
echo "  Preparing illustration..."
prepare_photo "${ILLUSTRATION}" "${TMP}/prep_illustration.png" "illust"

# 12 hybrid-staged products (Printful pixel-perfect + Gemini lifestyle staging)
PRODUCT_FILES=(
    "v11_framed_poster.png"
    "v11_canvas.png"
    "v11_tshirt.png"
    "v11_hoodie.png"
    "v11_sweatshirt.png"
    "v11_tanktop.png"
    "v11_mug.png"
    "v11_waterbottle.png"
    "v11_phonecase.png"
    "v11_totebag.png"
    "v11_blanket.png"
    "v11_poster.png"
)
PRODUCT_LABELS=(
    "Framed Poster"
    "Canvas Print"
    "T-Shirt"
    "Hoodie"
    "Sweatshirt"
    "Tank Top"
    "Coffee Mug"
    "Water Bottle"
    "Phone Case"
    "Tote Bag"
    "Throw Blanket"
    "Poster Print"
)

for i in "${!PRODUCT_FILES[@]}"; do
    file="${PRODUCT_FILES[$i]}"
    tag="prod_${i}"
    echo "  Preparing ${file} (blurred bg)..."
    prepare_product "${MOCKUPS}/${file}" "${TMP}/prep_${tag}.png" "${tag}"
done

# === Pre-render product label overlays (dark bar + name + brand) ===
echo "=== Creating product label overlays ==="
for i in "${!PRODUCT_LABELS[@]}"; do
    label="${PRODUCT_LABELS[$i]}"
    echo "  Label: ${label}"
    magick -size ${W}x110 xc:"rgba(0,0,0,0.75)" \
        -font "/System/Library/Fonts/HelveticaNeue.ttc" \
        -pointsize 38 -fill white \
        -gravity center -annotate +0-15 "${label}" \
        -pointsize 24 -fill "rgba(255,200,100,0.9)" \
        -gravity center -annotate +0+25 "TurnedYellow" \
        "${TMP}/text/label_${i}.png"
done

# === Hook text frames ===
echo "=== Creating hook text frames ==="

magick -size ${W}x${H} xc:black \
    -font "/System/Library/Fonts/HelveticaNeue.ttc" \
    -pointsize 64 -fill white -gravity center \
    -annotate +0+0 "this is what happens" \
    "${TMP}/hook_beat1.png"

magick -size ${W}x${H} xc:black \
    -font "/System/Library/Fonts/HelveticaNeue.ttc" \
    -pointsize 64 -fill white -gravity center \
    -annotate +0-50 "this is what happens" \
    -pointsize 56 -fill "#FFD700" \
    -annotate +0+50 "when a customer\nopens our gift" \
    "${TMP}/hook_beat2.png"

# === Reaction video processing ===
echo "=== Processing reaction video ==="

ffmpeg -y -ss 2 -i "${REACTION}" -t 8 \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=${BRAND_DARK},format=yuv420p" \
    -c:v libx264 -crf 18 -preset fast -r ${FPS} \
    -c:a aac -b:a 192k \
    "${TMP}/seg_reaction_with_audio.mp4" 2>/dev/null

# Reaction text — solid dark bar for readability
magick -size ${W}x80 xc:"rgba(0,0,0,0.70)" \
    -font "/System/Library/Fonts/HelveticaNeue.ttc" \
    -pointsize 36 -fill white \
    -gravity center -annotate +0+0 "Real customer reaction" \
    "${TMP}/text/reaction_bar.png"

ffmpeg -y -i "${TMP}/seg_reaction_with_audio.mp4" -i "${TMP}/text/reaction_bar.png" \
    -filter_complex "[0:v][1:v]overlay=0:${H}-280,format=yuv420p" \
    -c:v libx264 -crf 18 -preset fast -r ${FPS} \
    -c:a copy \
    "${TMP}/seg_reaction.mp4" 2>/dev/null

ffmpeg -y -i "${TMP}/seg_reaction.mp4" -vn -c:a aac -b:a 192k "${TMP}/reaction_audio.aac" 2>/dev/null
echo "  Reaction segment ready"

# === Logo end card ===
echo "=== Creating logo end card ==="
magick -size ${W}x${H} "xc:#1a1a2e" \
    \( "${LOGO}" -resize 600x \) -gravity center -composite \
    -font "/System/Library/Fonts/HelveticaNeue.ttc" \
    -pointsize 44 -fill white -gravity center -annotate +0+120 "Shop our collections" \
    -pointsize 48 -fill "#FF8C00" -gravity center -annotate +0+190 "TurnedYellow.com" \
    -pointsize 26 -fill "gray70" -gravity center -annotate +0+260 "Hand-illustrated, one-of-a-kind" \
    "${TMP}/logo_card.png"

# === Generate video segments ===
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

# 2. Reaction video (8s)
echo "  Reaction video (8s, video only)..."
printf -v seg_name "seg_%02d_reaction" "${SEG_IDX}"
ffmpeg -y -i "${TMP}/seg_reaction.mp4" -an -c:v copy "${TMP}/${seg_name}.mp4" 2>/dev/null
echo "file '${TMP}/${seg_name}.mp4'" >> "${TMP}/concat.txt"
SEG_IDX=$((SEG_IDX + 1))

# 3. Customer photos (3s: 3 x 1.0s)
for p in photo1 photo3 photo5; do
    echo "  Photo ${p} (1.0s)..."
    make_segment "${TMP}/prep_${p}.png" 1.0 "${p}"
done

# 4. Illustration (1.5s)
echo "  Illustration (1.5s)..."
make_segment "${TMP}/prep_illustration.png" 1.5 "illustration"

# 5. ALL 12 products with LABELS (12 x 1.0s = 12s)
for i in "${!PRODUCT_FILES[@]}"; do
    label="${PRODUCT_LABELS[$i]}"
    echo "  Product ${label} (1.0s)..."
    make_product_segment "${TMP}/prep_prod_${i}.png" "${TMP}/text/label_${i}.png" 1.0 "prod_${i}"
done

# 6. Logo end card (2s)
echo "  Logo end card (2.0s)..."
make_segment "${TMP}/logo_card.png" 2.0 "logo"

# === Concatenate all segments ===
echo "=== Concatenating segments ==="
ffmpeg -y -f concat -safe 0 -i "${TMP}/concat.txt" \
    -c:v libx264 -crf 18 -preset fast -r ${FPS} -pix_fmt yuv420p \
    -an "${TMP}/video_only.mp4" 2>/dev/null

VIDEO_DUR=$(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${TMP}/video_only.mp4")
echo "Video duration: ${VIDEO_DUR}s"

# === Audio mixing ===
REACT_START=2.0
REACT_END=10.0

add_music_with_reaction() {
    local music="$1"
    local output="$2"
    local fade_out_start
    fade_out_start=$(echo "${VIDEO_DUR} - 1.5" | bc)

    echo "  Mixing music + reaction audio..."
    ffmpeg -y \
        -i "${TMP}/video_only.mp4" \
        -i "${music}" \
        -i "${TMP}/reaction_audio.aac" \
        -filter_complex "
            [1:a]volume='if(between(t,${REACT_START},${REACT_END}),0.25,1.0)':eval=frame,afade=t=in:st=0:d=0.5,afade=t=out:st=${fade_out_start}:d=1.5[music];
            [2:a]adelay=$(echo "${REACT_START} * 1000" | bc | cut -d. -f1)|$(echo "${REACT_START} * 1000" | bc | cut -d. -f1),apad=whole_dur=${VIDEO_DUR}[reaction];
            [music][reaction]amix=inputs=2:duration=first:dropout_transition=0[out]
        " \
        -map 0:v -map "[out]" \
        -c:v copy -c:a aac -b:a 192k \
        -shortest "${output}" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo "  Saved: ${output}"
    else
        echo "  WARNING: Mixed audio failed, falling back to music-only..."
        ffmpeg -y \
            -i "${TMP}/video_only.mp4" \
            -i "${music}" \
            -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
            -af "volume='if(between(t,${REACT_START},${REACT_END}),0.3,1.0)':eval=frame,afade=t=in:st=0:d=0.5,afade=t=out:st=${fade_out_start}:d=1.5" \
            -shortest "${output}" 2>/dev/null
        echo "  Saved (music only): ${output}"
    fi
}

echo "=== Adding Candyland music + reaction audio ==="
add_music_with_reaction "${MUSIC_CANDY}" "${EXPORTS}/TY-133627-ugc-v11-candyland.mp4"

echo "=== DONE ==="
ls -lh "${EXPORTS}/TY-133627-ugc-v11-"*.mp4
