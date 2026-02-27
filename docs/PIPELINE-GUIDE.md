# TurnedYellow Video Pipeline -- Complete Step-by-Step Guide

**Last Updated:** 2026-02-26
**Status:** PROVEN and Luis-approved. Used successfully on TY-133627 and TY-130138.

This guide covers everything needed to build a professional product showcase video for any TurnedYellow order, from scratch, with zero prior context.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1: Download Assets](#2-phase-1-download-assets)
3. [Phase 2: Upload Illustration to Wasabi S3](#3-phase-2-upload-illustration-to-wasabi-s3)
4. [Phase 3: Generate Printful Mockups](#4-phase-3-generate-printful-mockups)
5. [Phase 4: Stage Mockups with Gemini](#5-phase-4-stage-mockups-with-gemini)
6. [Phase 5: Build Video with ffmpeg](#6-phase-5-build-video-with-ffmpeg)
7. [Phase 6: Publish](#7-phase-6-publish)
8. [Quick Reference](#8-quick-reference)

---

## 1. Prerequisites

### Required Software
- **ImageMagick 7+** (`magick` command) -- image processing
- **ffmpeg / ffprobe** -- video encoding and inspection
- **Python 3.10+** with pip -- for Gemini staging script
- **Node.js 18+** -- for Printful API scripts (optional, can use curl)
- **aws CLI** -- for Wasabi S3 uploads
- **bc** -- arithmetic in bash (pre-installed on macOS)

### Required API Keys
| Key | Source | How to Get |
|-----|--------|------------|
| `PRINTFUL_API_KEY` | Heroku `turnedyellowordermanagement` config | `heroku config:get PRINTFUL_API_KEY -a turnedyellowordermanagement` |
| `GOOTEN_RECIPEID` | Heroku `turnedyellowordermanagement` config | `heroku config:get GOOTEN_RECIPEID -a turnedyellowordermanagement` |
| `GEMINI_API_KEY` | Google AI Studio | Environment variable |
| Wasabi S3 creds | Heroku `turnedyellowordermanagement` config | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |

### Required Assets (per order)
- Customer photos (photo1.jpg, photo2.jpg, etc.)
- Customer illustration (illustration.jpg)
- Reaction video ({order_id}.mov) -- from Google Drive
- Music file (.mp3) -- from `/tmp/brand-music/`
- Brand logo (turnedyellow-white.png) -- from shared-assets/logos/

### Python Dependencies for Gemini Staging
```bash
pip install google-genai pillow
```

---

## 2. Phase 1: Download Assets

### Directory Setup
```bash
ORDER=133627
WORKSPACE="/Users/lcalderon/github/video-pipeline/orders/${ORDER}"
mkdir -p "${WORKSPACE}/photos" "${WORKSPACE}/mockups" "${WORKSPACE}/exports"
```

### Download Customer Photos from OMS
Photos are stored on Wasabi S3 behind CloudFront: `d3ok1s6o7a5ag4.cloudfront.net`

```bash
# Query OMS for order details (via Heroku)
heroku run --no-tty -a turnedyellowordermanagement node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const Order = mongoose.model('Order', new mongoose.Schema({}, {strict: false}));
    const order = await Order.findOne({order_id: ${ORDER}});
    console.log('PHOTOS:', JSON.stringify(order.photos));
    console.log('ILLUSTRATION:', order.illustration?.url);
    process.exit(0);
  });
"
```

Download each photo:
```bash
curl -o "${WORKSPACE}/photos/photo1.jpg" "https://d3ok1s6o7a5ag4.cloudfront.net/path/to/photo1.jpg"
curl -o "${WORKSPACE}/photos/photo2.jpg" "https://d3ok1s6o7a5ag4.cloudfront.net/path/to/photo2.jpg"
# ... repeat for each photo
```

### Download Illustration
```bash
curl -o "${WORKSPACE}/illustration.jpg" "https://d3ok1s6o7a5ag4.cloudfront.net/path/to/illustration.jpg"
```

### Download Reaction Video
Reaction videos are in Google Drive. Use the Google Drive MCP or download manually.

```bash
# If using gdown:
gdown --id GOOGLE_DRIVE_FILE_ID -O "${WORKSPACE}/${ORDER}.mov"
```

### Determine Illustration Orientation
This is CRITICAL for generating correct mockups.

```bash
magick identify "${WORKSPACE}/illustration.jpg"
# Output example: illustration.jpg JPEG 4800x3600 ...
# 4800x3600 = LANDSCAPE (width > height)
# 3600x4800 = PORTRAIT (height > width)
```

**Record this now -- you need it for Phase 3.**

---

## 3. Phase 2: Upload Illustration to Wasabi S3

Printful API needs a publicly accessible URL for the illustration. Upload to Wasabi S3.

**IMPORTANT:** Do NOT use CloudFront URLs for Printful API calls -- they can expire. Use direct Wasabi URLs.

### Upload Command
```bash
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"

aws s3 cp "${WORKSPACE}/illustration.jpg" \
    "s3://turnedyellowimages/video-pipeline/${ORDER}/illustration.jpg" \
    --endpoint-url https://s3.wasabisys.com \
    --acl public-read

# The public URL will be:
# https://s3.wasabisys.com/turnedyellowimages/video-pipeline/${ORDER}/illustration.jpg
```

Save this URL -- it is used in every Printful API call below.

```bash
ILLUSTRATION_URL="https://s3.wasabisys.com/turnedyellowimages/video-pipeline/${ORDER}/illustration.jpg"
```

### For Phone Cases (Landscape Illustrations Only)
If the illustration is landscape (wider than tall), phone cases need a 270-degree rotated version:

```bash
magick "${WORKSPACE}/illustration.jpg" -rotate 270 "${WORKSPACE}/illustration_rotated.jpg"

aws s3 cp "${WORKSPACE}/illustration_rotated.jpg" \
    "s3://turnedyellowimages/video-pipeline/${ORDER}/illustration_rotated.jpg" \
    --endpoint-url https://s3.wasabisys.com \
    --acl public-read

ILLUSTRATION_URL_ROTATED="https://s3.wasabisys.com/turnedyellowimages/video-pipeline/${ORDER}/illustration_rotated.jpg"
```

---

## 4. Phase 3: Generate Printful Mockups

### Overview
Use the Printful Mockup Generator API to create pixel-perfect product mockups. This ensures the customer's illustration appears exactly as designed on each product -- no AI modification, no warping, no artifacts.

### API Workflow
1. POST to create a mockup generation task
2. Wait ~60 seconds
3. GET to poll the task status
4. Download the resulting mockup image

### Create Task Endpoint
```
POST https://api.printful.com/mockup-generator/create-task/{product_id}
Authorization: Bearer {PRINTFUL_API_KEY}
Content-Type: application/json
```

### Poll Task Endpoint
```
GET https://api.printful.com/mockup-generator/task?task_key={task_key}
Authorization: Bearer {PRINTFUL_API_KEY}
```

---

### Product-by-Product API Calls

#### Framed Poster (Product 2)

**For LANDSCAPE illustrations (4800x3600):**
```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/2" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [4],
    "format": "jpg",
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL}'",
      "fill_mode": "cover",
      "position": {
        "area_width": 4800,
        "area_height": 3600,
        "width": 4800,
        "height": 3600,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**For PORTRAIT illustrations (3600x4800):**
```bash
# Same as above but swap dimensions:
# "area_width": 3600, "area_height": 4800, "width": 3600, "height": 4800
```

**Output:** `v9_framed_poster.jpg`

#### Canvas Print (Product 3)

**For LANDSCAPE illustrations:**
```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/3" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [5],
    "format": "jpg",
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL}'",
      "fill_mode": "cover",
      "position": {
        "area_width": 4800,
        "area_height": 3600,
        "width": 4800,
        "height": 3600,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**For PORTRAIT:** Use `3600x4800`.

**Note:** The OMS adds bleed borders for canvas via `extendImage()`. For video mockups, `fill_mode: 'cover'` without bleed extension produces acceptable results.

**Output:** `v9_canvas.jpg`

#### Poster Print (Product 1)

**For LANDSCAPE:**
```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/1" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [2],
    "format": "jpg",
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL}'",
      "fill_mode": "cover",
      "position": {
        "area_width": 4800,
        "area_height": 3600,
        "width": 4800,
        "height": 3600,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**For PORTRAIT:** Use `3600x4800`.

**Output:** `v9_poster.jpg`

#### T-Shirt (Product 71)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/71" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [4013],
    "format": "jpg",
    "option_groups": ["Wrinkled"],
    "files": [{
      "placement": "front",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 450,
        "area_height": 450,
        "width": 450,
        "height": 450,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**CRITICAL:** Use `450x450` (square), NOT `1800x2400`. The 450x450 square lets Printful naturally center the illustration without stretching, regardless of aspect ratio.

**Output:** `v9_tshirt.jpg`

#### Hoodie (Product 146)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/146" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [5524],
    "format": "jpg",
    "option_groups": ["On Hanger"],
    "files": [{
      "placement": "front",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 450,
        "area_height": 450,
        "width": 450,
        "height": 450,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**Output:** `v9_hoodie.jpg`

#### Sweatshirt (Product 145)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/145" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [5428],
    "format": "jpg",
    "files": [{
      "placement": "front",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 450,
        "area_height": 450,
        "width": 450,
        "height": 450,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**Output:** `v9_sweatshirt.jpg`

#### Tank Top (Product 248)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/248" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [8661],
    "format": "jpg",
    "files": [{
      "placement": "front",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 450,
        "area_height": 450,
        "width": 450,
        "height": 450,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**Output:** `v9_tanktop.jpg`

#### Coffee Mug (Product 19)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/19" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [1320],
    "format": "jpg",
    "options": ["Front view"],
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 1550,
        "area_height": 1050,
        "width": 1550,
        "height": 1050,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**CRITICAL:** Must include `"options": ["Front view"]`. The default mug view shows the handle, which blocks the artwork.

**Output:** `v9_mug.jpg`

#### Water Bottle (Product 382)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/382" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [10798],
    "format": "jpg",
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 2557,
        "area_height": 1582,
        "width": 2557,
        "height": 1582,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**Output:** `v9_waterbottle.jpg`

#### iPhone Case (Product 181)

**For LANDSCAPE illustrations -- MUST rotate first:**
```bash
# Use the pre-rotated illustration URL (see Phase 2)
curl -X POST "https://api.printful.com/mockup-generator/create-task/181" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [10994],
    "format": "jpg",
    "files": [{
      "placement": "default",
      "image_url": "'${ILLUSTRATION_URL_ROTATED}'",
      "position": {
        "area_width": 879,
        "area_height": 1830,
        "width": 879,
        "height": 1830,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**For PORTRAIT illustrations:** Use the normal `ILLUSTRATION_URL` (no rotation needed).

**Output:** `v9_phonecase.jpg`

#### Tote Bag (Product 367)

```bash
curl -X POST "https://api.printful.com/mockup-generator/create-task/367" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant_ids": [10458],
    "format": "jpg",
    "files": [{
      "placement": "front",
      "image_url": "'${ILLUSTRATION_URL}'",
      "position": {
        "area_width": 1500,
        "area_height": 1500,
        "width": 1500,
        "height": 1500,
        "top": 0,
        "left": 0
      }
    }]
  }'
```

**Note:** Placement is `"front"`, not `"default"`.

**Output:** `v9_totebag.jpg`

#### Throw Blanket -- via Gooten API

Printful does not produce good blanket mockups. Use Gooten with MAXFIT.

```bash
curl -X POST "https://api.print.io/api/v/5/source/api/productpreview?recipeid=${GOOTEN_RECIPEID}" \
  -H "Content-Type: application/json" \
  -d '{
    "SKU": "Blanket-Velveteen-Single-FinishedEdge-50x60",
    "Template": "Single",
    "Images": [{
      "Image": {
        "Url": "'${ILLUSTRATION_URL}'",
        "MAXFIT": "TRUE"
      },
      "SpaceId": "FrontImage",
      "LayerId": "Design"
    }]
  }'
```

**Output:** `v9_blanket.jpg`

### Polling and Downloading Results

After creating each Printful task, you receive a `task_key`. Poll until complete:

```bash
TASK_KEY="your-task-key-here"

# Wait 60 seconds then poll
sleep 60

curl "https://api.printful.com/mockup-generator/task?task_key=${TASK_KEY}" \
  -H "Authorization: Bearer ${PRINTFUL_API_KEY}" | jq '.result'
```

When status is `"completed"`, download the mockup URLs from the response:
```bash
# The response contains mockup URLs in result.mockups[].mockup_url
curl -o "${WORKSPACE}/mockups/v9_product.jpg" "MOCKUP_URL_FROM_RESPONSE"
```

### Verification Checklist
After generating all mockups, visually verify EVERY image:
- [ ] Illustration appears exactly as the original (no warping, no artifacts)
- [ ] Faces/details match the original illustration
- [ ] Products look properly proportioned
- [ ] Mug shows front view (not handle side)
- [ ] Phone case has correct orientation

---

## 5. Phase 4: Stage Mockups with Gemini

### The Golden Recipe
Pass each Printful mockup to Gemini and ask it to place the product in a lifestyle scene. Gemini excels at this -- it creates photorealistic settings with natural lighting and shadows.

### Model and Configuration
- **Model:** `gemini-3-pro-image-preview`
- **Image size:** `1K`
- **CRITICAL:** Text prompt MUST come BEFORE the image in the contents array. Putting the image first causes `FinishReason.OTHER` blocks.

### Python Staging Script

Save this as `scripts/stage-with-gemini.py`:

```python
#!/usr/bin/env python3
"""Stage Printful mockups into lifestyle scenes using Gemini."""
import os
import sys
import time
from io import BytesIO
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image as PILImage


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("ERROR: Set GEMINI_API_KEY environment variable")
    sys.exit(1)

client = genai.Client(api_key=GEMINI_API_KEY)

# Proven prompts for each product type
PROMPTS = {
    "framed_poster": "Place this framed artwork on a living room wall. Modern interior design.",
    "canvas": "Show this canvas print hanging on a wall in a cozy bedroom above a bed with soft lighting. The artwork must remain exactly as shown.",
    "poster": "Place this poster on an office wall above a clean desk.",
    "tshirt": "Show this custom printed t-shirt folded neatly on a wooden table in a boutique shop.",
    "hoodie": "Place this hoodie on a hanger in a retail store setting.",
    "sweatshirt": "Show this custom printed crewneck sweatshirt draped over a chair in a cozy room.",
    "tanktop": "Show this custom printed tank top on a bright display shelf in a summer shop.",
    "mug": "Place this printed coffee mug on a kitchen counter or breakfast table with morning light. Show it next to some pastries or a newspaper. The printed design must remain clearly visible.",
    "waterbottle": "Place this printed water bottle on a gym bench or outdoor hiking trail setting. The printed design must remain clearly visible.",
    "phonecase": "Show this custom printed phone case lying on a desk next to a coffee cup and laptop.",
    "totebag": "Place this printed tote bag hanging on a hook by a front door, or being carried in a market setting. The printed design must remain clearly visible.",
    "blanket": "Show this printed throw blanket draped flat on a bed in a bedroom. Keep the printed design visible. Cozy bedroom setting.",
}

MAX_RETRIES = 3


def stage_product(mockup_path: str, product_type: str, output_path: str) -> bool:
    """Stage a single product mockup into a lifestyle scene."""
    prompt = PROMPTS.get(product_type)
    if not prompt:
        print(f"  ERROR: Unknown product type '{product_type}'")
        return False

    img = PILImage.open(mockup_path)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"  Staging {product_type} (attempt {attempt}/{MAX_RETRIES})...")
            response = client.models.generate_content(
                model="gemini-3-pro-image-preview",
                contents=[prompt, img],  # Text FIRST, image SECOND
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    image_config=types.ImageConfig(image_size="1K"),
                ),
            )

            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    result = PILImage.open(BytesIO(part.inline_data.data))
                    result.convert("RGB").save(output_path, "PNG")
                    print(f"  Saved: {output_path}")
                    return True

            print(f"  No image in response (attempt {attempt})")

        except Exception as e:
            print(f"  Error (attempt {attempt}): {e}")

        if attempt < MAX_RETRIES:
            time.sleep(5)

    print(f"  FAILED after {MAX_RETRIES} attempts: {product_type}")
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python stage-with-gemini.py <mockups_dir>")
        print("  Looks for v9_*.jpg files and outputs v11_*.png files")
        sys.exit(1)

    mockups_dir = Path(sys.argv[1])

    # Map file prefixes to product types
    products = [
        ("v9_framed_poster.jpg", "framed_poster", "v11_framed_poster.png"),
        ("v9_canvas.jpg", "canvas", "v11_canvas.png"),
        ("v9_poster.jpg", "poster", "v11_poster.png"),
        ("v9_tshirt.jpg", "tshirt", "v11_tshirt.png"),
        ("v9_hoodie.jpg", "hoodie", "v11_hoodie.png"),
        ("v9_sweatshirt.jpg", "sweatshirt", "v11_sweatshirt.png"),
        ("v9_tanktop.jpg", "tanktop", "v11_tanktop.png"),
        ("v9_mug.jpg", "mug", "v11_mug.png"),
        ("v9_waterbottle.jpg", "waterbottle", "v11_waterbottle.png"),
        ("v9_phonecase.jpg", "phonecase", "v11_phonecase.png"),
        ("v9_totebag.jpg", "totebag", "v11_totebag.png"),
        ("v9_blanket.jpg", "blanket", "v11_blanket.png"),
    ]

    results = {"success": 0, "failed": 0, "skipped": 0}

    for mockup_file, product_type, output_file in products:
        mockup_path = mockups_dir / mockup_file
        output_path = mockups_dir / output_file

        if not mockup_path.exists():
            print(f"  SKIP {mockup_file}: not found")
            results["skipped"] += 1
            continue

        if output_path.exists():
            print(f"  SKIP {mockup_file}: output already exists ({output_file})")
            results["skipped"] += 1
            continue

        success = stage_product(str(mockup_path), product_type, str(output_path))
        if success:
            results["success"] += 1
        else:
            results["failed"] += 1

        # Rate limiting
        time.sleep(2)

    print(f"\nResults: {results['success']} staged, {results['failed']} failed, {results['skipped']} skipped")
```

### Run the Staging Script
```bash
export GEMINI_API_KEY="your-key-here"
python3 scripts/stage-with-gemini.py "${WORKSPACE}/mockups"
```

### Verification Checklist
After staging, visually verify EVERY v11 image:
- [ ] Product appears in a realistic, attractive setting
- [ ] The illustration on the product is recognizable (faces, colors, details)
- [ ] No floating/pasted-on look -- product has natural shadows and lighting
- [ ] Blanket is draped on a bed (NOT standing upright, NOT propped against a wall)
- [ ] No extra fingers, duplicate faces, or other AI artifacts in the scene

### Troubleshooting
- **FinishReason.OTHER:** Gemini safety filter triggered. Retry (non-deterministic). Try simpler prompt on retry.
- **Blank/no image in response:** Retry. Sometimes Gemini returns only text.
- **Product looks wrong:** Re-check the v9 Printful mockup first. If the base mockup is wrong, fix Phase 3.

---

## 6. Phase 5: Build Video with ffmpeg

### Video Structure (UGC variant with reaction video)
```
Hook (2s) -> Reaction (4-8s) -> Photos (3s) -> Illustration (1.5s) -> Products (12s) -> Logo (2s)
Total: ~24-28s depending on reaction length
```

### Video Specifications
| Parameter | Value |
|-----------|-------|
| Resolution | 1080x1920 (portrait 9:16) |
| Codec | h264 (libx264) |
| Quality | CRF 18 |
| Frame rate | 30fps |
| Pixel format | yuv420p |
| Audio | AAC 192kbps |

### Build Script Template

Copy an existing build script and modify it. The canonical reference is `orders/133627/exports/build-ugc-v11.sh`.

Key sections to customize per order:

#### 1. Variables
```bash
ORDER=133627
WORKSPACE="/Users/lcalderon/github/video-pipeline/orders/${ORDER}"
MOCKUPS="${WORKSPACE}/mockups"
PHOTOS="${WORKSPACE}/photos"
ILLUSTRATION="${WORKSPACE}/illustration.jpg"
REACTION="${WORKSPACE}/${ORDER}.mov"
LOGO="/path/to/shared-assets/logos/turnedyellow-white.png"
EXPORTS="${WORKSPACE}/exports"
TMP="${WORKSPACE}/tmp_ugc_v1"
MUSIC="/tmp/brand-music/Tobu - Candyland [Privated NCS Release].mp3"
```

#### 2. Photo List
Adjust which photos to include (pick 3 best, no duplicates):
```bash
for p in photo1 photo3 photo5; do
    prepare_photo "${PHOTOS}/${p}.jpg" "${TMP}/prep_${p}.png" "${p}"
done
```

#### 3. Hook Text
Customize the hook for each order -- it should be engaging and relevant:
```bash
# Beat 1: Setup
"this is what happens"
# Beat 2: Payoff (in gold accent color)
"when a customer\nopens our gift"
```

#### 4. Reaction Trim Points
Adjust `-ss` (start) and `-t` (duration) based on the reaction video:
```bash
# Trim reaction: start at 2s, take 8s
ffmpeg -y -ss 2 -i "${REACTION}" -t 8 ...
```

#### 5. Audio Timing
Set reaction start/end times for music ducking:
```bash
REACT_START=2.0   # When reaction segment starts in the final video
REACT_END=10.0    # When reaction segment ends
```

### Image Preparation Functions

**NEVER CHANGE THESE.** They are proven correct.

#### prepare_photo() -- For customer photos and illustration
Creates a blurred background frame. The full image is shown centered over a blurred, darkened version of itself.

```bash
prepare_photo() {
    local input="$1" output="$2" tag="$3"
    magick "${input}" -auto-orient "${TMP}/orient_${tag}.png"
    magick "${TMP}/orient_${tag}.png" -resize "${W}x${H}^" -gravity center \
        -extent "${W}x${H}" -blur 0x40 -brightness-contrast -30x0 "${TMP}/bg_${tag}.png"
    magick "${TMP}/orient_${tag}.png" -resize "${W}x${H}" -gravity center "${TMP}/fg_${tag}.png"
    magick composite -gravity center "${TMP}/fg_${tag}.png" "${TMP}/bg_${tag}.png" "${output}"
}
```

#### prepare_product() -- For Gemini-staged mockups
Same blurred background approach for product images.

```bash
prepare_product() {
    local input="$1" output="$2" tag="$3"
    magick "${input}" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" \
        -blur 0x40 -brightness-contrast -20x0 "${TMP}/bg_${tag}.png"
    magick "${input}" -resize "${W}x${H}" -gravity center "${TMP}/fg_${tag}.png"
    magick composite -gravity center "${TMP}/fg_${tag}.png" "${TMP}/bg_${tag}.png" "${output}"
}
```

### Product Labels
Dark semi-transparent bar at the bottom of each product segment:
- Bar: 1080x110, rgba(0,0,0,0.75)
- Product name: white, 38pt, centered
- "TurnedYellow" brand: gold rgba(255,200,100,0.9), 24pt, below product name
- Position: y = H - 130 from top

### Logo End Card
- Background: `#1a1a2e` (brand dark)
- Logo: centered, 600px wide
- "Shop our collections" (white, 44pt)
- "TurnedYellow.com" (orange `#FF8C00`, 48pt)
- "Hand-illustrated, one-of-a-kind" (gray70, 26pt)

### Audio Mixing
Music is ducked to 25% volume during the reaction segment, then returns to full volume:
```bash
volume='if(between(t,${REACT_START},${REACT_END}),0.25,1.0)':eval=frame
```

Music fades in (0.5s) and out (1.5s from end):
```bash
afade=t=in:st=0:d=0.5,afade=t=out:st=${fade_out_start}:d=1.5
```

### Running the Build
```bash
chmod +x "${WORKSPACE}/exports/build-ugc-v1.sh"
bash "${WORKSPACE}/exports/build-ugc-v1.sh"
```

### Verification
```bash
# Check video properties
ffprobe -v quiet -print_format json -show_format -show_streams "${EXPORTS}/TY-${ORDER}-ugc-v1-candyland.mp4"

# Expected: 1080x1920, ~24-28s, h264, aac
```

Play the video and verify:
- [ ] Hook text is readable and punchy
- [ ] Reaction video plays smoothly with mixed audio
- [ ] Photos look good with blurred backgrounds
- [ ] Illustration is crisp
- [ ] ALL 12 products have visible labels
- [ ] Products are in attractive lifestyle settings
- [ ] Logo end card displays correctly
- [ ] Music ducks during reaction and fades at end
- [ ] No black bars, no stretching, no jitter

---

## 7. Phase 6: Publish

### Upload to Google Drive

Videos go to brand-specific Google Drive folders.

```
TY Video Drive Folders:
  TY-133627: 132YmzgxOlEXiWKU39ymoFT4MUBVhswcb
  TY-207677: 1uVLjM9nInRWr6MKW7wQNv82n2S6rZ2mU
```

Upload using the Google Drive MCP or manually via Google Drive web interface.

### Update Video Tracker
Spreadsheet ID: `1B0ATlsp_bZpF7h6-1SpqnEbJJhFbYsh83mBmF7nbCp0`

Add a row with:
- Order ID
- Video version
- Music track
- Duration
- Date published
- Platform links

### Social Media Copy Templates

**YouTube Shorts / TikTok:**
```
This is what happens when a customer opens our gift...

Every piece is custom hand-illustrated and printed on premium products.

Get Simpsonized at TurnedYellow.com

#TurnedYellow #CustomGifts #Simpsonized #PersonalizedGifts
```

**Instagram Reels:**
```
Tag someone who deserves a custom gift like this!

Hand-illustrated. One-of-a-kind. Made just for them.

Link in bio - TurnedYellow.com
```

### Music Credit (YouTube)
For NCS tracks, add to video description:
```
Music: Tobu - Candyland [NCS Release]
Free Download/Stream: https://ncs.io/candyland
```

---

## 8. Quick Reference

### The 12 Standard Products (in video order)
1. Framed Poster
2. Canvas Print
3. T-Shirt
4. Hoodie
5. Sweatshirt
6. Tank Top
7. Coffee Mug
8. Water Bottle
9. Phone Case
10. Tote Bag
11. Throw Blanket
12. Poster Print

### Color Codes
| Use | Format | Value |
|-----|--------|-------|
| Brand dark (ffmpeg) | 0x hex | `0x1a1a2e` |
| Brand dark (ImageMagick) | # hex | `#1a1a2e` |
| Hook accent (ImageMagick) | # hex | `#FFD700` (gold) |
| Hook accent (ffmpeg) | 0x hex | `0xFFD700` |
| CTA URL color | # hex | `#FF8C00` (orange) |
| Label brand color | rgba | `rgba(255,200,100,0.9)` |

### File Naming Convention
- `v9_*.jpg` -- Printful/Gooten raw mockups (pixel-perfect, white background)
- `v11_*.png` -- Gemini-staged lifestyle mockups (final quality)
- `bg_*.png` -- AI-generated empty backgrounds (legacy approach, not needed)

### Timing Reference
| Segment | Duration | Notes |
|---------|----------|-------|
| Hook beat 1 | 0.7s | White text on black |
| Hook beat 2 | 1.3s | Add gold accent text |
| Reaction | 4-8s | Trimmed from source video |
| Each photo | 1.0s | 3 photos typical |
| Illustration | 1.5s | Single image |
| Each product | 1.0s | 12 products |
| Logo CTA | 2.0s | End card |
