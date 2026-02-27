#!/bin/bash
# verify-video.sh -- Quality gate for video output verification
# Checks: resolution (1080x1920), codec (h264), fps (~30), file size > 0
# Usage: ./verify-video.sh <video_file>
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $(basename "$0") <video_file>"
    echo "Verifies video meets production specs: 1080x1920, h264, CRF 18, ~30fps"
    exit 1
fi

VIDEO="$1"
PASS=true

if [[ ! -f "$VIDEO" ]]; then
    echo "FAIL: File not found: ${VIDEO}"
    exit 1
fi

# Check file size > 0
FILE_SIZE=$(stat -f%z "$VIDEO" 2>/dev/null || stat --format=%s "$VIDEO" 2>/dev/null || echo "0")
if [[ "$FILE_SIZE" -eq 0 ]]; then
    echo "FAIL: File size is 0 bytes"
    exit 1
fi
echo "PASS: File size: $(du -h "$VIDEO" | cut -f1)"

# Extract video properties via ffprobe
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$VIDEO")
HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$VIDEO")
CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$VIDEO")
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$VIDEO")
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO")

# Check width
if [[ "$WIDTH" != "1080" ]]; then
    echo "FAIL: width=${WIDTH}, expected 1080"
    PASS=false
else
    echo "PASS: width=1080"
fi

# Check height
if [[ "$HEIGHT" != "1920" ]]; then
    echo "FAIL: height=${HEIGHT}, expected 1920"
    PASS=false
else
    echo "PASS: height=1920"
fi

# Check codec
if [[ "$CODEC" != "h264" ]]; then
    echo "FAIL: codec=${CODEC}, expected h264"
    PASS=false
else
    echo "PASS: codec=h264"
fi

# Check FPS (~30, allowing 30/1 or 30000/1001)
FPS_NUM=${FPS%/*}
FPS_DEN=${FPS#*/}
if [[ "$FPS_DEN" != "$FPS" ]]; then
    # Fractional FPS: compute approximate value
    FPS_APPROX=$(echo "scale=1; ${FPS_NUM} / ${FPS_DEN}" | bc)
    FPS_INT=${FPS_APPROX%.*}
else
    FPS_INT=$FPS_NUM
fi

if [[ "$FPS_INT" -lt 29 || "$FPS_INT" -gt 31 ]]; then
    echo "FAIL: fps=${FPS} (~${FPS_INT}), expected ~30"
    PASS=false
else
    echo "PASS: fps=${FPS} (~${FPS_INT}fps)"
fi

# Report duration
echo "INFO: duration=${DURATION}s"

# Final verdict
echo ""
if $PASS; then
    echo "VERDICT: ALL CHECKS PASSED"
    exit 0
else
    echo "VERDICT: FAILED -- video does not meet production specs"
    exit 1
fi
