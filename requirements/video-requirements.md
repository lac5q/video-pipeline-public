# TurnedYellow Video Pipeline — Hard Requirements

## Overview
Automated pipeline for generating social media reels (TikTok, Instagram, YouTube Shorts, X)
showcasing customer orders with their custom illustration on various POD products.

---

## ABSOLUTE RULES (Never Break These)

### 1. Illustration Integrity — ZERO TOLERANCE
- The customer's illustration MUST appear exactly as the original file
- NO re-drawing, NO artifacts, NO warping, NO stretching, NO squishing
- If the illustration is 4:3 landscape, it must display as 4:3 landscape on every product
- Gemini/AI image generation WILL modify the artwork — do NOT use AI to place artwork on products
- Only use Printful/Gooten API or manual ImageMagick compositing for artwork placement
- Verify every product mockup visually before including in video

### 2. Product Mockups Must Be Staged in Lifestyle Scenes
- Plain product-on-white-background looks cheap (v8 mistake)
- Products should appear in real-life settings (living room, bedroom, kitchen, desk, etc.)
- The staging adds context and helps customers visualize the product
- v7 approach was correct: Gemini-staged lifestyle scenes
- The FIX: Use Printful for pixel-perfect product mockups, THEN stage those mockups into scenes

### 3. Every Product Slide Needs a Title Label
- Dark semi-transparent bar at bottom (rgba(0,0,0,0.75), 1080x110)
- Product name in white (38pt)
- "TurnedYellow" brand in gold (24pt, rgba(255,200,100,0.9))
- Overlay position: y = H - 130 (from top)
- Must be readable during 1-second display

### 4. No Zoompan — EVER
- ffmpeg zoompan causes stretching AND jitter
- Use static images only
- Ken Burns max 1.05x if absolutely needed (but prefer static)

### 5. Video Frame Handling
- 1080x1920 portrait (9:16)
- Photos/illustrations: blurred background fit (prepare_photo approach)
- Staged products: blurred background fit (NOT fill+crop)
- All ffmpeg scale ops MUST use force_original_aspect_ratio=decrease with pad
- CRF 18, h264, 30fps

### 6. Reaction Video (UGC variant)
- Mix reaction audio WITH music — don't mute either
- Duck music to 25-30% volume during reaction, full volume after
- Reaction text overlay: solid dark bar background (NOT stroke text)
- "Real customer reaction" in clean white text on dark bar

### 7. Audio
- Music fades in (0.5s) and out (1.5s)
- For UGC: amix reaction audio with ducked music
- Free NCS beats for YouTube (with credit)
- swap-music.sh for quick audio-only changes (never rebuild entire video for music)

### 8. Category Dedup
- Never show two of the same product type (no two hoodies, no two phone cases)
- Each product in the rapid-fire section must be a unique category

---

## Video Structure

### Standard Reels
Hook (2s) → Photos (3-4s) → Illustration (1.5s) → Products rapid-fire (1.0s each) → Logo CTA (2s)

### UGC Reels (with reaction video)
Hook (2s) → Reaction (8s, mixed audio) → Photos (3s) → Illustration (1.5s) → Products (1.0s each) → Logo CTA (2s)

### Hook Design (v14 pattern)
- Beat 1 (0.7s): Black screen, white text — "this is what happens"
- Beat 2 (1.3s): Add accent color text — "when a customer opens our gift"

### Logo CTA Card
- Brand dark background (#1a1a2e)
- Centered logo (600px wide)
- "Shop our collections" (white, 44pt)
- "TurnedYellow.com" (orange #FF8C00, 48pt)
- "Hand-illustrated, one-of-a-kind" (gray, 26pt)

---

## Product Mockup Pipeline (v11 — Correct Approach)

### Step 1: Generate Pixel-Perfect Mockups
- Use Printful Mockup Generator API with **OMS-correct position parameters**
- Use Gooten API for products not on Printful (blankets, ornaments)
- Use OMS positional mockups (m00-m26) when available
- NEVER use Gemini to place artwork on products

#### Printful Position Parameters (CRITICAL)
- **Apparel (tshirt, hoodie, sweatshirt, tanktop)**: 450x450 square position
- **Wall art**: Orientation-aware (4800x3600 for landscape illustrations, 3600x4800 for portrait)
- **Phone cases**: Rotate illustration 270 degrees BEFORE sending to Printful (for horizontal illustrations)
- **Mug**: 1550x1050, Tote: 1500x1500, Water Bottle: 2557x1582
- **Always use fill_mode: 'cover' for wall art** to prevent stretching

### Step 2: Stage Mockups into Lifestyle Scenes
- **DO NOT pass product mockups to Gemini** — it WILL modify the artwork even when asked not to
- Use Gemini to generate **EMPTY lifestyle background scenes only** (no products in them)
- Use `rembg` (Python) to remove white backgrounds from Printful mockups
- Use ImageMagick/PIL to composite the transparent product cutout onto the lifestyle background
- **Exception — white apparel**: rembg cannot distinguish white garments from white backgrounds.
  Use Printful mockup directly with blurred background treatment instead.

### Step 3: Verify
- Check every staged image before building video
- The illustration on each product must match the original exactly
- No extra fingers, no changed colors, no missing details
- Compare faces/details against the original illustration file

---

## Printful API Reference

### Endpoint
POST https://api.printful.com/mockup-generator/create-task/{product_id}

### Key Parameters
```json
{
  "variant_ids": [variant_id],
  "files": [{
    "placement": "front|default",
    "image_url": "https://public-url-to-illustration.jpg",
    "position": {
      "area_width": 1800,
      "area_height": 2400,
      "width": 1800,
      "height": 2400,
      "top": 0,
      "left": 0
    }
  }],
  "option_groups": ["On Hanger"]  // optional
}
```

### Position Object — CRITICAL for preventing warping
- `area_width` / `area_height`: The printable area of the product
- `width` / `height`: How large the image should be within that area
- `top` / `left`: Offset from top-left of printable area
- Setting width/height = area_width/area_height fills the entire printable area
- Printful handles aspect ratio preservation internally via fillMode

### Known Working Products (TY OMS)
See research/mockup-generation-research.md for full product map.

---

## Image Preparation Functions

### prepare_photo() — For customer photos and illustration
```bash
# Blurred background fit — preserves full image, no crop
magick "$input" -auto-orient "$tmp/orient.png"
magick "$tmp/orient.png" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" \
    -blur 0x40 -brightness-contrast -30x0 "$tmp/bg.png"
magick "$tmp/orient.png" -resize "${W}x${H}" -gravity center "$tmp/fg.png"
magick composite -gravity center "$tmp/fg.png" "$tmp/bg.png" "$output"
```

### prepare_product() — For staged product mockups
```bash
# Same blurred bg approach — NEVER use fill+crop (loses content)
magick "$input" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" \
    -blur 0x40 -brightness-contrast -20x0 "$tmp/bg.png"
magick "$input" -resize "${W}x${H}" -gravity center "$tmp/fg.png"
magick composite -gravity center "$tmp/fg.png" "$tmp/bg.png" "$output"
```

### NEVER DO THIS (causes distortion/content loss):
```bash
# BAD — aggressive crop from 1024x1024 to 1080x1920 loses ~44% of image
magick "$input" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" "$output"
```

---

## Color Format Rules
- ImageMagick: use `#RRGGBB` (e.g., `"#FFD700"`)
- ffmpeg filter_complex: use `0xRRGGBB` (e.g., `0xFFD700`) — shell eats `#` as comment

---

## Version History & Lessons

### v1-v5: Initial builds, iterating on structure
### v6: Added 16 products, labels missing, fill+crop distortion
### v7: Added labels, blurred bg, regenerated Gemini images — BUT Gemini warped the artwork
### v8: Used Printful-only mockups — pixel-perfect art BUT plain/unstaged (looked cheap)
### v9 (NEXT): Hybrid — Printful pixel-perfect mockups staged into Gemini lifestyle scenes

**KEY LESSON**: Gemini re-draws illustrations when you ask it to put artwork on a product.
It does NOT copy pixels. It regenerates, introducing artifacts and proportion changes.
The ONLY way to get pixel-perfect artwork on products is Printful/Gooten API or manual compositing.
Then stage the resulting mockup photo into a lifestyle scene as a SECOND step.
