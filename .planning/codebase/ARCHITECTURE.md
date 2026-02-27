# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Script-based media pipeline with per-order workspaces

This is NOT a traditional application architecture. It is a **manual-but-reproducible media production pipeline** orchestrated through bash build scripts, with each customer order having its own workspace directory. There is no server, no API, no database in this repo -- it coordinates external APIs (Printful, Gooten, Gemini) and local CLI tools (ffmpeg, ImageMagick) to produce social media videos.

**Key Characteristics:**
- Each order gets an independent workspace under `orders/{order_id}/`
- Build scripts are the "source of truth" -- they are versioned, deterministic recipes for producing a video
- Pipeline is 5 phases executed sequentially: Download Assets -> Upload to S3 -> Generate Mockups -> Stage with AI -> Build Video
- No runtime state -- everything is file-based (images in, video out)
- Heavy reliance on external APIs (Printful, Gooten, Gemini) and CLI tools (ffmpeg, ImageMagick, aws CLI)

## Layers

**Documentation Layer:**
- Purpose: Encode all knowledge needed to build any video from scratch, including hard-won lessons
- Location: `docs/`, `requirements/`, `research/`
- Contains: Step-by-step guides, product API references, lessons learned, music licensing info
- Depends on: Nothing
- Used by: Any Claude agent or human building a video

**Build Script Layer (Core):**
- Purpose: Deterministic video assembly from prepared assets
- Location: `orders/{order_id}/exports/build-ugc-*.sh`
- Contains: Bash scripts that invoke ImageMagick for image prep and ffmpeg for video encoding
- Depends on: Prepared mockup images (`v11_*.png`), customer photos, reaction video, music, brand logo
- Used by: Direct execution via `bash`
- Key abstractions: `prepare_photo()`, `prepare_product()`, `make_segment()`, `make_product_segment()`, `add_music_with_reaction()`

**Utility Script Layer (Legacy):**
- Purpose: Image processing utilities
- Location: `scripts/`
- Contains: Python scripts for background removal and compositing
- Depends on: rembg, Pillow
- Used by: Legacy pipeline (replaced by Gemini staging)

**External Orchestration Layer (outside this repo):**
- Purpose: Higher-level pipeline orchestration and shared assets
- Location: `~/clawd/agents/gwen/workspace/` (external)
- Contains: `produce-video.sh`, `generate-mockups.js`, brand configs, shared logos
- Depends on: This repo's order workspaces
- Used by: The Gwen agent for automated video production

## Data Flow

**Full Pipeline (per order):**

1. **Download Assets** -- Customer photos, illustration, reaction video fetched from OMS (MongoDB via Heroku), Google Drive, and Wasabi S3 (CloudFront)
2. **Upload Illustration to Wasabi S3** -- Makes illustration publicly accessible for API calls (`s3://turnedyellowimages/video-pipeline/{order_id}/illustration.jpg`)
3. **Generate Pixel-Perfect Mockups (Printful/Gooten API)** -- POST to Printful Mockup Generator API for each of 12 products with OMS-correct position parameters; poll for results; download mockup JPGs as `v9_*.jpg`
4. **Stage Mockups with Gemini** -- Pass each `v9_*.jpg` to Gemini `gemini-3-pro-image-preview` with a lifestyle scene prompt; save results as `v11_*.png`
5. **Build Video (ffmpeg)** -- Build script assembles: Hook text frames -> Reaction video segment -> Customer photos (blurred bg) -> Illustration (blurred bg) -> 12 product slides with labels -> Logo end card; concatenate segments; mix reaction audio with ducked background music; output final `.mp4`

**Image Preparation Sub-flow (inside build script):**

1. `prepare_photo()`: Auto-orient -> Create blurred/darkened background (resize^, extent, blur) -> Resize foreground to fit -> Composite centered
2. `prepare_product()`: Same blurred background approach for staged mockup images
3. Label overlay: ImageMagick creates dark semi-transparent bar with product name + brand text
4. `make_segment()`: Static image -> ffmpeg loop -> individual MP4 segment
5. `make_product_segment()`: Static image + label overlay -> ffmpeg composite -> individual MP4 segment

**Audio Sub-flow (inside build script):**

1. Extract reaction audio from trimmed reaction video (`reaction_audio.aac`)
2. Apply music ducking (25% volume during reaction, 100% elsewhere) with fade in/out
3. Mix ducked music + delayed reaction audio via `amix`
4. Mux final audio onto concatenated video

**State Management:**
- No runtime state. All state is files on disk.
- `v9_*.jpg` files are the mockup state (can be regenerated from Printful API)
- `v11_*.png` files are the staged mockup state (non-deterministic Gemini output -- treat as precious)
- `tmp_ugc_*/` contains intermediate build artifacts (disposable)
- Build scripts encode all parameters needed to reproduce a video

## Key Abstractions

**Order Workspace (`orders/{order_id}/`):**
- Purpose: Self-contained workspace for all assets and outputs related to one customer order
- Examples: `orders/133627/`, `orders/130138/`
- Pattern: Convention-based directory structure (photos/, mockups/, exports/)

**Build Script (`exports/build-ugc-*.sh`):**
- Purpose: Reproducible recipe for assembling a video from prepared assets
- Examples: `orders/133627/exports/build-ugc-v11.sh`, `orders/130138/exports/build-ugc-v1.sh`
- Pattern: Self-contained bash script with all paths, timing, and configuration hardcoded; defines reusable shell functions for image/video processing

**Mockup Version Prefixes (`v9_`, `v11_`):**
- Purpose: Track which stage of the pipeline produced an image
- `v9_*.jpg`: Pixel-perfect Printful/Gooten API output (white background)
- `v11_*.png`: Gemini-staged lifestyle scene (final quality)
- Pattern: Version prefix on filename, stored in `mockups/` directory

**Product Array (in build scripts):**
- Purpose: Define the 12 products shown in the video, their files, and their display labels
- Pattern: Parallel bash arrays `PRODUCT_FILES` and `PRODUCT_LABELS` iterated by index

**Segment Concat Pattern:**
- Purpose: Build video as sequential segments then concatenate
- Pattern: Each section (hook, reaction, photos, products, logo) becomes a numbered MP4 segment (`seg_00_hook1.mp4`, `seg_01_hook2.mp4`, etc.), listed in `concat.txt`, then joined via `ffmpeg -f concat`

## Entry Points

**Build Script Execution:**
- Location: `orders/{order_id}/exports/build-ugc-*.sh`
- Triggers: Manual execution via `bash orders/133627/exports/build-ugc-v11.sh`
- Responsibilities: Full video assembly from prepared assets to final MP4

**Gemini Staging Script (documented but not yet in repo):**
- Location: Described in `docs/PIPELINE-GUIDE.md` as `scripts/stage-with-gemini.py`
- Triggers: Manual execution with mockups directory argument
- Responsibilities: Stage all `v9_*.jpg` mockups into `v11_*.png` lifestyle scenes

**Legacy Compositing Script:**
- Location: `scripts/remove-bg-and-composite.py`
- Triggers: Manual execution with `--mockups-dir` and `--config` arguments
- Responsibilities: Background removal (rembg) and compositing onto lifestyle backgrounds (LEGACY -- replaced by Gemini staging)

**External Pipeline Orchestrator (outside repo):**
- Location: `~/clawd/agents/gwen/workspace/produce-video.sh`
- Triggers: Gwen agent automation
- Responsibilities: End-to-end pipeline coordination across all phases

## Error Handling

**Strategy:** Fail-fast with manual recovery

**Patterns:**
- Build scripts use `set -euo pipefail` -- any command failure stops the entire build
- ffmpeg stderr suppressed (`2>/dev/null`) for cleanliness, but failures propagate via exit codes
- Gemini staging has retry logic (3 attempts per product with 5s delay) to handle non-deterministic safety filter blocks
- Audio mixing has a fallback path: if mixed audio fails, falls back to music-only
- No automated error recovery -- failures require human investigation and re-run

## Cross-Cutting Concerns

**Logging:** Echo statements in build scripts provide progress feedback (`=== Phase Name ===`, `  Preparing file...`). No structured logging framework.

**Validation:** Manual visual verification is required at two checkpoints:
1. After Phase 3 (mockup generation): Verify all `v9_*.jpg` have correct artwork placement
2. After Phase 4 (Gemini staging): Verify all `v11_*.png` look natural with no AI artifacts

**Authentication:** All API keys sourced from environment variables or Heroku config vars. Keys needed: `PRINTFUL_API_KEY`, `GOOTEN_RECIPEID`, `GEMINI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

**Brand Consistency:** Hardcoded brand values in build scripts:
- Dark background: `#1a1a2e` / `0x1a1a2e`
- Gold accent: `#FFD700` / `0xFFD700`
- CTA orange: `#FF8C00`
- Label brand gold: `rgba(255,200,100,0.9)`
- Font: `/System/Library/Fonts/HelveticaNeue.ttc`
- Logo: External path `~/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png`

**Video Specs (enforced across all builds):**
- 1080x1920 portrait (9:16)
- h264 / libx264, CRF 18, 30fps, yuv420p
- AAC audio at 192kbps

---

*Architecture analysis: 2026-02-26*
