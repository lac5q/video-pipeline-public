# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- Bash (shell scripts) - Video build pipeline, image preparation, audio mixing (`orders/*/exports/build-ugc-*.sh`)
- Python 3.10+ - Background removal script, Gemini staging script (`scripts/remove-bg-and-composite.py`)

**Secondary:**
- JSON - Product configuration files (`orders/133627/v11_apparel_fix.json`)
- Node.js 18+ - Optional, for Printful API scripts (can use curl instead)

## Runtime

**Environment:**
- macOS (Darwin) - Primary development and build platform
- Python 3.10+ - For Gemini staging and rembg scripts
- Bash/Zsh shell - For build scripts

**Package Manager:**
- pip (Python) - `pip install google-genai pillow`
- uv (Python, optional) - `uv run --with "rembg[cpu]>=2.0.0" --with "pillow>=10.0.0"` for legacy script
- No package.json, no requirements.txt, no lockfile present

## Frameworks

**Core:**
- No application framework - This is a CLI-driven pipeline of shell scripts and Python utilities

**Testing:**
- None detected - No test framework, no test files

**Build/Dev:**
- ffmpeg / ffprobe - Video encoding, concatenation, audio mixing, media inspection
- ImageMagick 7+ (`magick` command) - Image processing, compositing, text rendering, blurred backgrounds
- aws CLI - Wasabi S3 uploads for illustration hosting

## Key Dependencies

**Critical (CLI tools required on PATH):**
- `ffmpeg` / `ffprobe` - All video encoding and audio mixing
- `magick` (ImageMagick 7+) - All image preparation, label rendering, logo card creation
- `bc` - Arithmetic in bash (pre-installed on macOS)
- `aws` CLI - S3 uploads to Wasabi

**Python Libraries:**
- `google-genai` - Google Gemini API client for lifestyle scene staging
- `pillow` (PIL) >= 10.0.0 - Image loading/saving for Gemini staging and rembg compositing
- `rembg[cpu]` >= 2.0.0 - AI background removal (legacy, used in `scripts/remove-bg-and-composite.py`)

**Optional:**
- `yt-dlp` - Downloading music tracks from YouTube
- `gdown` - Downloading reaction videos from Google Drive
- `heroku` CLI - Fetching API keys and order data from Heroku app config
- `jq` - Parsing JSON API responses in shell

## Configuration

**Environment:**
- `GEMINI_API_KEY` - Google AI Studio API key for Gemini image generation
- `PRINTFUL_API_KEY` - Printful Mockup Generator API (fetched via `heroku config:get`)
- `GOOTEN_RECIPEID` - Gooten product preview API (fetched via `heroku config:get`)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - Wasabi S3 credentials for illustration uploads
- `.env` file exists but is gitignored

**Build:**
- Build scripts are self-contained bash files: `orders/*/exports/build-ugc-*.sh`
- Each build script hardcodes workspace paths, product lists, timing, and brand constants
- Brand constants: `BRAND_DARK="0x1a1a2e"`, `W=1080`, `H=1920`, `FPS=30`
- Video specs: CRF 18, h264 (libx264), 30fps, yuv420p, AAC 192kbps

**Shared Assets (external to this repo):**
- Brand logos: `~/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png`
- Brand configs: `~/clawd/agents/gwen/workspace/brand-configs/`
- Music files: `/tmp/brand-music/` (ephemeral, cleared on reboot)

## Platform Requirements

**Development:**
- macOS (scripts reference `/System/Library/Fonts/HelveticaNeue.ttc` for text rendering)
- Homebrew or equivalent for ffmpeg, ImageMagick, aws CLI installation
- Python 3.10+ with pip
- Sufficient disk space for temporary build artifacts (each build creates ~500MB+ in `tmp_ugc_*/`)

**Production:**
- No server deployment - Pipeline runs locally on developer machine
- Final videos (.mp4) are uploaded to Google Drive manually or via Google Drive MCP
- Videos published to YouTube Shorts, TikTok, Instagram Reels, X

## Git Configuration

**Tracked:**
- Shell build scripts (`orders/*/exports/*.sh`)
- JSON configs (`orders/*/*.json`)
- Python scripts (`scripts/*.py`)
- Documentation (`docs/*.md`, `requirements/*.md`, `research/*.md`)
- `.gitignore`

**Gitignored:**
- All media files (*.mp4, *.mov, *.mp3, *.jpg, *.jpeg, *.png)
- Temp build directories (`tmp_*/`)
- Python artifacts (`__pycache__/`, `*.pyc`, `.venv/`)
- Environment files (`.env`, `.env.local`)
- OS files (`.DS_Store`)

---

*Stack analysis: 2026-02-26*
