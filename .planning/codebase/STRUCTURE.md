# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
video-pipeline/
├── .gitignore                          # Media files excluded, scripts/JSON included
├── PROJECT.md                          # Project overview and getting started (READ FIRST)
├── docs/                               # Pipeline documentation and reference
│   ├── PIPELINE-GUIDE.md               # Complete step-by-step build guide (6 phases)
│   ├── LESSONS-LEARNED.md              # Every mistake made and how to avoid them
│   ├── PRODUCT-CATALOG.md              # Printful/Gooten API params for all products
│   ├── MUSIC-LIBRARY.md                # Available music tracks and licensing rules
│   └── DIRECTORY-STRUCTURE.md          # Per-order workspace layout reference
├── requirements/                       # Hard rules that must never be broken
│   └── video-requirements.md           # Absolute rules: illustration integrity, no zoompan, etc.
├── research/                           # Deep technical analysis
│   └── mockup-generation-research.md   # OMS/Printful/Gooten/Popsmiths mockup analysis
├── scripts/                            # Utility scripts
│   └── remove-bg-and-composite.py      # LEGACY: rembg bg removal + compositing (replaced by Gemini)
└── orders/                             # Per-order workspaces
    ├── 130138/                         # TY-130138 order workspace
    │   └── exports/
    │       └── build-ugc-v1.sh         # Build script: couple portrait, 12 products
    ├── 133627/                         # TY-133627 order workspace
    │   ├── v11_apparel_fix.json        # Legacy rembg compositing config
    │   └── exports/
    │       └── build-ugc-v11.sh        # Build script: family portrait, 12 products
    └── {new_order_id}/                 # Template for new orders (not yet created)
        ├── photos/                     # Customer photos (photo1.jpg, photo2.jpg, ...)
        ├── illustration.jpg            # Customer illustration
        ├── {order_id}.mov              # Reaction video
        ├── mockups/                    # Generated product mockups
        │   ├── v9_*.jpg                # Printful/Gooten pixel-perfect mockups
        │   └── v11_*.png               # Gemini-staged lifestyle scenes
        ├── exports/                    # Build scripts and final videos
        │   ├── build-ugc-*.sh          # Build recipe (versioned, committed to git)
        │   └── TY-{order}-ugc-*.mp4   # Final video output
        └── tmp_ugc_*/                  # Temp build artifacts (safe to delete)
```

## Directory Purposes

**`docs/`:**
- Purpose: All pipeline documentation, reference guides, and accumulated knowledge
- Contains: Markdown files covering every aspect of the pipeline
- Key files:
  - `PIPELINE-GUIDE.md`: The canonical step-by-step guide for building any video
  - `LESSONS-LEARNED.md`: MUST READ before starting any work -- prevents repeating mistakes
  - `PRODUCT-CATALOG.md`: Exact Printful/Gooten API parameters for all 12+ products
  - `MUSIC-LIBRARY.md`: Track list, licensing rules, mixing settings
  - `DIRECTORY-STRUCTURE.md`: File naming conventions and what is safe to delete

**`requirements/`:**
- Purpose: Hard rules that must NEVER be broken
- Contains: `video-requirements.md` -- the constitution of the pipeline
- Key rules: Illustration integrity (zero tolerance), no zoompan, blurred bg (not crop), product labels required, category dedup

**`research/`:**
- Purpose: Deep technical analysis informing pipeline decisions
- Contains: `mockup-generation-research.md` -- exhaustive analysis of how OMS, Popsmiths, and the video pipeline handle mockup generation
- Key insight: Why 450x450 for apparel, why orientation-aware dimensions for wall art, why phone cases need rotation

**`scripts/`:**
- Purpose: Reusable Python utility scripts
- Contains: `remove-bg-and-composite.py` (LEGACY -- replaced by direct Gemini staging)
- Note: The Gemini staging script described in `docs/PIPELINE-GUIDE.md` should be added here as `stage-with-gemini.py`

**`orders/`:**
- Purpose: Per-order workspaces containing all assets, build scripts, and outputs
- Contains: One subdirectory per order ID
- Key convention: Only `exports/*.sh` and `*.json` config files are committed to git. All media files (images, videos, audio) are gitignored.

**`orders/{order_id}/photos/`:**
- Purpose: Customer-submitted photos
- Contains: `photo1.jpg`, `photo2.jpg`, etc. (typically 3-8 per order)
- Not committed to git (images gitignored)

**`orders/{order_id}/mockups/`:**
- Purpose: Product mockup images at two pipeline stages
- Contains: `v9_*.jpg` (Printful/Gooten raw) and `v11_*.png` (Gemini-staged)
- Not committed to git (images gitignored)
- WARNING: `v11_*.png` files are non-deterministic Gemini outputs -- back up before deleting

**`orders/{order_id}/exports/`:**
- Purpose: Build scripts (committed) and final video outputs (not committed)
- Contains: `build-ugc-*.sh` scripts and `TY-{order}-ugc-*.mp4` videos
- Build scripts ARE committed to git -- they are the reproducible recipe

**`orders/{order_id}/tmp_ugc_*/`:**
- Purpose: Temporary intermediate files during video build
- Contains: Oriented photos, blurred backgrounds, foregrounds, label overlays, individual video segments, concat list
- Safe to delete after successful build
- Not committed to git

## Key File Locations

**Entry Points:**
- `PROJECT.md`: Start here -- project overview, reading order, architecture summary
- `orders/{order_id}/exports/build-ugc-*.sh`: Execute to build a video

**Configuration:**
- `.gitignore`: Media files excluded, scripts/JSON force-included via `!` patterns
- `orders/{order_id}/*.json`: Per-order config files (e.g., `v11_apparel_fix.json` for legacy compositing)

**Core Logic:**
- `orders/133627/exports/build-ugc-v11.sh`: Canonical build script -- copy this for new orders
- `orders/130138/exports/build-ugc-v1.sh`: Second proven build script
- `scripts/remove-bg-and-composite.py`: Legacy compositing script (rembg + PIL)

**Documentation:**
- `docs/PIPELINE-GUIDE.md`: Complete 6-phase pipeline walkthrough with code examples
- `docs/LESSONS-LEARNED.md`: All known mistakes and their fixes
- `docs/PRODUCT-CATALOG.md`: API reference for all products
- `requirements/video-requirements.md`: Hard rules
- `research/mockup-generation-research.md`: Deep mockup analysis

**External Dependencies (outside this repo):**
- `~/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png`: Brand logo
- `~/clawd/agents/gwen/workspace/brand-configs/`: Brand configuration files
- `~/clawd/agents/gwen/workspace/produce-video.sh`: External pipeline orchestrator
- `~/clawd/agents/gwen/workspace/generate-mockups.js`: External mockup generation script
- `/tmp/brand-music/*.mp3`: Music files (ephemeral -- may be cleared on reboot)

## Naming Conventions

**Files:**
- Build scripts: `build-{variant}-v{N}.sh` (e.g., `build-ugc-v11.sh`, `build-reels-v1.sh`)
- Final videos: `TY-{order_id}-{variant}-v{N}-{music_name}.mp4` (e.g., `TY-133627-ugc-v11-candyland.mp4`)
- Mockups (raw): `v9_{product_name}.jpg` (e.g., `v9_framed_poster.jpg`, `v9_tshirt.jpg`)
- Mockups (staged): `v11_{product_name}.png` (e.g., `v11_framed_poster.png`)
- Customer photos: `photo{N}.jpg` (e.g., `photo1.jpg`, `photo2.jpg`)
- Temp files: `prep_{name}.png`, `bg_{name}.png`, `fg_{name}.png`, `orient_{name}.png`
- Segments: `seg_{NN}_{name}.mp4` (zero-padded index, e.g., `seg_00_hook1.mp4`)
- Labels: `label_{N}.png` (index matching product array position)

**Directories:**
- Order workspaces: `orders/{order_id}/` (numeric order ID)
- Temp build dirs: `tmp_{variant}_v{N}/` (e.g., `tmp_ugc_v11/`)
- Subdirectory for text overlays: `tmp_*/text/`

**Documentation:**
- All-caps for pipeline docs: `PIPELINE-GUIDE.md`, `LESSONS-LEARNED.md`
- Kebab-case for filenames: `video-requirements.md`, `mockup-generation-research.md`

## Where to Add New Code

**New Order:**
1. Create workspace: `mkdir -p orders/{order_id}/{photos,mockups,exports}`
2. Download assets into `photos/`, `illustration.jpg`, `{order_id}.mov`
3. Copy canonical build script: `cp orders/133627/exports/build-ugc-v11.sh orders/{order_id}/exports/build-ugc-v1.sh`
4. Customize: order ID, photo selection, hook text, reaction trim points, audio timing
5. Generate mockups (v9) and stage them (v11) per `docs/PIPELINE-GUIDE.md`
6. Run: `bash orders/{order_id}/exports/build-ugc-v1.sh`

**New Utility Script:**
- Place in `scripts/` directory
- Use Python 3.10+ with dependencies installable via pip
- Example: `scripts/stage-with-gemini.py` (documented in PIPELINE-GUIDE but not yet committed)
- Example: `scripts/swap-music.sh` (referenced in docs but not yet committed)

**New Product Type:**
1. Add API parameters to `docs/PRODUCT-CATALOG.md`
2. Add Gemini staging prompt to the staging script
3. Add to the `PRODUCT_FILES` and `PRODUCT_LABELS` arrays in build scripts
4. Update `docs/PIPELINE-GUIDE.md` with the API call example

**New Video Variant (e.g., standard reels without reaction):**
1. Create new build script in `orders/{order_id}/exports/build-reels-v1.sh`
2. Remove reaction video sections (no reaction trim, no audio mixing, no "Real customer reaction" overlay)
3. Adjust timing: Hook -> Photos -> Illustration -> Products -> Logo
4. Update `requirements/video-requirements.md` if new rules apply

**New Documentation:**
- Pipeline guides and references: `docs/`
- Hard requirements: `requirements/`
- Technical research: `research/`

## Special Directories

**`tmp_ugc_*/ (and tmp_reels_*/)`:**
- Purpose: Intermediate build artifacts generated during video assembly
- Generated: Yes, by build scripts
- Committed: No (gitignored via `tmp_*/` pattern)
- Safe to delete: Yes, after successful build

**`orders/*/mockups/`:**
- Purpose: Product mockup images at various pipeline stages
- Generated: Yes, by Printful/Gooten APIs and Gemini
- Committed: No (images gitignored)
- WARNING: `v11_*.png` are non-deterministic -- back up before deleting

**`orders/*/exports/`:**
- Purpose: Build scripts AND final video outputs
- Generated: Scripts are manually created; videos are generated by scripts
- Committed: Only `*.sh` files (via `!orders/*/exports/*.sh` in `.gitignore`)

## Git Tracking Rules

**Committed (tracked in git):**
- `orders/*/exports/*.sh` -- Build scripts (the reproducible recipe)
- `orders/*/*.json` -- Config files
- Everything in `docs/`, `scripts/`, `requirements/`, `research/`
- `PROJECT.md`, `.gitignore`

**NOT committed (gitignored):**
- All media: `*.mp4`, `*.mov`, `*.mp3`, `*.aac`, `*.wav`
- All images: `*.jpg`, `*.jpeg`, `*.png`
- Temp dirs: `tmp_*/`
- OS files: `.DS_Store`, `Thumbs.db`
- Dependencies: `node_modules/`, `__pycache__/`, `.venv/`
- Secrets: `.env`, `.env.local`

---

*Structure analysis: 2026-02-26*
