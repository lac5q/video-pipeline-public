# TurnedYellow Video Pipeline

## Purpose
Automated pipeline for generating social media product showcase videos
for TurnedYellow (and other brands). Takes a customer order's illustration
and photos, generates product mockups, stages them in lifestyle scenes,
and builds a polished video reel.

## Project Structure
```
video-pipeline/
  PROJECT.md                              — This file
  requirements/
    video-requirements.md                 — Hard requirements (NEVER BREAK THESE)
  research/
    mockup-generation-research.md         — Deep analysis of OMS/Printful/Gooten/Popsmiths mockup generation
  scripts/
    remove-bg-and-composite.py            — rembg background removal + lifestyle compositing
  docs/
    (future: guides, SOPs)
```

## Pipeline Architecture (v11 — Current)

### Step 1: Generate Pixel-Perfect Mockups
- **Printful API** with OMS-correct parameters:
  - Apparel (tshirt, hoodie, sweatshirt, tanktop): **450x450 square position**
  - Wall art (poster, canvas, framed): **Orientation-aware dimensions** (4800x3600 for landscape, 3600x4800 for portrait)
  - Phone cases: **Rotate illustration 270 degrees first** for horizontal illustrations
  - Accessories (mug, tote, water bottle): Product-specific dimensions with fill_mode
- **Gooten API** with MAXFIT=TRUE for blankets, puzzles, ornaments

### Step 2: Stage Products into Lifestyle Scenes
- **Wall art + accessories**: Use `rembg` to remove white Printful background, composite cutout onto Gemini-generated lifestyle scene backgrounds using ImageMagick
- **White apparel**: Use Printful mockup directly with blurred background (rembg can't distinguish white garment from white background)
- **Key rule**: Gemini generates EMPTY backgrounds only — it NEVER touches the product image

### Step 3: Build Video
- ffmpeg concat pipeline: Hook → Reaction → Photos → Illustration → Products → Logo
- Product labels: dark bar + product name + brand
- Audio mixing: reaction audio + ducked background music
- 1080x1920 portrait, CRF 18, h264, 30fps

## Critical Lessons Learned

### Gemini REDRAWS artwork (NEVER use for mockup generation)
Gemini/AI image generation modifies artwork when placing illustrations on products.
Even when passing a finished Printful mockup and asking to "stage it in a scene,"
Gemini regenerates face details, proportions, and colors — causing visible artifacts.

**Solution**: Gemini only generates empty lifestyle backgrounds. Products are composited
onto those backgrounds using ImageMagick/PIL (pixel-perfect, no AI modification).

### Printful position parameters matter enormously
The OMS uses 450x450 square positions for apparel. The video pipeline originally used
1800x2400 (portrait), which STRETCHES landscape illustrations. See research/ for full analysis.

### rembg can't handle white-on-white
White garments on white Printful backgrounds get their fabric removed along with the
background. Use blurred background approach for white apparel instead.

## Active Orders
- TY-133627: UGC + standard reels (v11 — current)
- TY-207677: Needs rebuild with same pipeline fixes

## External Dependencies
- Build scripts: ~/clawd/agents/gwen/workspace/*/exports/build-*.sh
- Brand configs: ~/clawd/agents/gwen/workspace/brand-configs/
- Shared assets: ~/clawd/agents/gwen/workspace/shared-assets/
- Pipeline orchestrator: ~/clawd/agents/gwen/workspace/produce-video.sh

## API Keys
- Printful: via Heroku `turnedyellowordermanagement` config
- Gooten: via Heroku `turnedyellowordermanagement` config
- Gemini: via environment variable
- Wasabi S3: via Heroku config (bucket: turnedyellowimages)
