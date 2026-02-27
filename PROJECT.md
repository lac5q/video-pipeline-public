# TurnedYellow Video Pipeline

## Purpose
Automated pipeline for generating social media product showcase videos
for TurnedYellow (and other brands). Takes a customer order's illustration
and photos, generates product mockups, stages them in lifestyle scenes,
and builds a polished video reel.

## Project Structure
```
video-pipeline/
  PROJECT.md                              — This file (start here)
  requirements/
    video-requirements.md                 — Hard requirements (NEVER BREAK THESE)
  research/
    mockup-generation-research.md         — Deep analysis of OMS/Printful/Gooten/Popsmiths mockup generation
  docs/
    PIPELINE-GUIDE.md                     — Step-by-step guide for building ANY video from scratch
    LESSONS-LEARNED.md                    — Every mistake and fix (READ BEFORE STARTING)
    PRODUCT-CATALOG.md                    — Complete Printful/Gooten product API reference
    MUSIC-LIBRARY.md                      — Available music tracks and licensing
    DIRECTORY-STRUCTURE.md                — Per-order workspace layout and file naming conventions
  scripts/
    remove-bg-and-composite.py            — rembg background removal + lifestyle compositing (LEGACY — replaced by Gemini staging)
  orders/
    {order_id}/
      photos/                             — Customer photos (photo1.jpg, photo2.jpg, ...)
      illustration.jpg                    — Customer illustration
      {order_id}.mov                      — Reaction video (for UGC variant)
      mockups/
        v9_*.jpg                          — Printful/Gooten pixel-perfect mockups (source)
        v11_*.png                         — Gemini-staged lifestyle mockups (final)
      exports/
        build-ugc-*.sh                    — Build script for this order
        TY-{order_id}-ugc-*.mp4           — Final video files
      tmp_ugc_*/                          — Temp build files (safe to delete after build)
    133627/exports/build-ugc-v11.sh       — TY-133627 UGC build (12 products, family portrait)
    130138/exports/build-ugc-v1.sh        — TY-130138 UGC build (12 products, couple portrait)
```

## Getting Started -- READ THESE FIRST

If you are building a video for the first time (or lost context), read in this order:

1. **`docs/LESSONS-LEARNED.md`** -- Every mistake that was made, so you do not repeat them
2. **`docs/PIPELINE-GUIDE.md`** -- Complete step-by-step guide for building any video
3. **`docs/PRODUCT-CATALOG.md`** -- Exact Printful/Gooten API parameters for each product
4. **`docs/DIRECTORY-STRUCTURE.md`** -- Where files go, naming conventions, what is safe to delete
5. **`requirements/video-requirements.md`** -- Hard rules that must never be broken

## Pipeline Architecture (PROVEN -- Luis approved 2026-02-26)

### Step 1: Generate Pixel-Perfect Mockups via Printful/Gooten API
- **Printful API** with OMS-correct parameters:
  - Apparel (tshirt, hoodie, sweatshirt, tanktop): **450x450 square position**
  - Wall art (poster, canvas, framed): **Orientation-aware** (4800x3600 for landscape, 3600x4800 for portrait)
  - Phone cases: **Rotate illustration 270 degrees first** for horizontal illustrations
  - Mug: Use `options: ["Front view"]` (default view shows handle blocking art)
  - Accessories (tote, water bottle): Product-specific dimensions
- **Gooten API** with MAXFIT=TRUE for blankets

### Step 2: Stage Products with Gemini into Lifestyle Scenes
- Pass each Printful mockup to **Gemini** (`gemini-3-pro-image-preview`) with a scene prompt
- Gemini places the product into a beautiful, photorealistic lifestyle setting
- **Text prompt MUST come before image** in the API call (avoids FinishReason.OTHER blocks)
- Retry up to 3x on failures — Gemini is non-deterministic
- See `~/.claude/projects/-Users-lcalderon/memory/video-mockup-recipe.md` for proven prompts

### Step 3: Build Video
- ffmpeg concat pipeline: Hook → Reaction → Photos → Illustration → Products → Logo
- Product labels: dark bar + product name + "TurnedYellow" brand in gold
- Audio mixing: reaction audio + ducked background music
- 1080x1920 portrait, CRF 18, h264, 30fps

## Critical Lessons Learned

### The Golden Recipe: Printful → Gemini Staging
Gemini excels at placing products into lifestyle scenes. The slight modifications
it makes to artwork during staging look natural (lighting, shadows, perspective).
This produces the most beautiful, professional results.

**Do NOT use rembg + ImageMagick composite** — products look like flat cutouts
pasted onto backgrounds (blankets stand upright, items float unnaturally).

**Do NOT use Gemini to generate mockups from scratch** — it completely redraws
the illustration, introducing face artifacts and proportion changes.

### Printful position parameters matter enormously
The OMS uses 450x450 square positions for apparel. Using 1800x2400 (portrait)
STRETCHES landscape illustrations. See research/ for full analysis.

## Published Videos
- **TY-133627**: UGC v11, 12 products, Candyland (Tobu), 28.5s
- **TY-130138**: UGC v1, 12 products, Hawaii (LiQWYD), 26.5s
- **TY-207677**: Reels v14, 16 products (legacy build)

## Active Orders
- TY-133627: UGC published, standard reels TODO
- TY-130138: UGC published, standard reels TODO
- TY-207677: Needs rebuild with proven pipeline

## External Dependencies
- Brand configs: ~/clawd/agents/gwen/workspace/brand-configs/
- Shared assets: ~/clawd/agents/gwen/workspace/shared-assets/
- Pipeline orchestrator: ~/clawd/agents/gwen/workspace/produce-video.sh

## API Keys
- Printful: via Heroku `turnedyellowordermanagement` config (PRINTFUL_API_KEY)
- Gooten: via Heroku `turnedyellowordermanagement` config (GOOTEN_RECIPEID)
- Gemini: via environment variable (GEMINI_API_KEY)
- Wasabi S3: via Heroku config (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, bucket: turnedyellowimages)
