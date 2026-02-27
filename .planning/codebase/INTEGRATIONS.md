# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Product Mockup Generation:**
- **Printful Mockup Generator API** - Generates pixel-perfect product mockups with customer illustration
  - Endpoint: `POST https://api.printful.com/mockup-generator/create-task/{product_id}`
  - Polling: `GET https://api.printful.com/mockup-generator/task?task_key={task_key}`
  - Auth: Bearer token via `PRINTFUL_API_KEY`
  - Source: Heroku config (`heroku config:get PRINTFUL_API_KEY -a turnedyellowordermanagement`)
  - Products: 12 standard products (framed poster, canvas, t-shirt, hoodie, sweatshirt, tank top, mug, water bottle, phone case, tote bag, poster). See `docs/PRODUCT-CATALOG.md` for exact product IDs, variant IDs, and position parameters.
  - Workflow: Create task -> wait ~60s -> poll for completion -> download mockup image URLs
  - Critical parameters: `position` object (area_width, area_height, width, height, top, left), `fill_mode`, `placement`, `option_groups`

- **Gooten Product Preview API** - Generates mockups for products not on Printful (blankets, ornaments)
  - Endpoint: `POST https://api.print.io/api/v/5/source/api/productpreview?recipeid={GOOTEN_RECIPEID}`
  - Auth: Recipe ID via `GOOTEN_RECIPEID`
  - Source: Heroku config (`heroku config:get GOOTEN_RECIPEID -a turnedyellowordermanagement`)
  - Products: Throw blanket (SKU: `Blanket-Velveteen-Single-FinishedEdge-50x60`), ornament
  - Key parameter: `MAXFIT: "TRUE"` prevents all warping

**AI Image Generation:**
- **Google Gemini API** - Stages Printful mockups into photorealistic lifestyle scenes
  - SDK/Client: `google-genai` Python package
  - Model: `gemini-3-pro-image-preview`
  - Auth: `GEMINI_API_KEY` environment variable (Google AI Studio)
  - Usage: Takes a Printful mockup image + text prompt, returns the product placed in a lifestyle scene
  - Config: `response_modalities=["TEXT", "IMAGE"]`, `image_size="1K"`
  - Critical: Text prompt MUST come before image in contents array (avoids FinishReason.OTHER blocks)
  - Retry: Up to 3 attempts per product (Gemini is non-deterministic)
  - Rate limiting: 2-second delay between products
  - Staging script documented inline in `docs/PIPELINE-GUIDE.md` (Phase 4)

## Data Storage

**Databases:**
- **MongoDB** (via Heroku `turnedyellowordermanagement` app)
  - Not directly accessed by this repo
  - OMS queries orders via `mongoose.connect(process.env.MONGODB_URI)`
  - Used to fetch customer photos, illustration URLs, and order details
  - Connection managed by the OMS codebase (`/Users/lcalderon/github/OMS/`)

**File Storage:**
- **Wasabi S3** - Object storage for illustration files needed by Printful API
  - Bucket: `turnedyellowimages`
  - Endpoint: `https://s3.wasabisys.com`
  - Upload path: `s3://turnedyellowimages/video-pipeline/{order_id}/illustration.jpg`
  - Public URL: `https://s3.wasabisys.com/turnedyellowimages/video-pipeline/{order_id}/illustration.jpg`
  - Auth: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (from Heroku config)
  - Upload command: `aws s3 cp ... --endpoint-url https://s3.wasabisys.com --acl public-read`
  - Purpose: Printful API requires publicly accessible illustration URLs; CloudFront URLs can expire

- **AWS CloudFront** (read-only) - CDN for customer photos stored in OMS
  - Domain: `d3ok1s6o7a5ag4.cloudfront.net`
  - Usage: Download customer photos and illustrations from OMS storage
  - Warning: URLs can expire; do NOT use for Printful API calls

- **Local filesystem** - All build artifacts, mockups, staged images, and final videos
  - Order workspaces: `/Users/lcalderon/github/video-pipeline/orders/{order_id}/`
  - Temp builds: `orders/{order_id}/tmp_ugc_*/`
  - Music: `/tmp/brand-music/` (ephemeral)

**Caching:**
- None - Each build is a full pipeline run

## Authentication & Identity

**Auth Provider:**
- No user authentication in this pipeline
- All API keys are stored in Heroku app config (`turnedyellowordermanagement`)
- Retrieved via `heroku config:get KEY_NAME -a turnedyellowordermanagement`

## Monitoring & Observability

**Error Tracking:**
- None - Build scripts use `set -euo pipefail` for fail-fast behavior
- Manual verification of all staged images before video build

**Logs:**
- `echo` statements in bash build scripts for progress tracking
- `print()` statements in Python scripts
- ffmpeg output suppressed via `2>/dev/null`

## CI/CD & Deployment

**Hosting:**
- No deployment - Pipeline runs locally on macOS
- Final videos uploaded to Google Drive, then published to social media platforms

**CI Pipeline:**
- None - No automated testing or continuous integration

## Environment Configuration

**Required env vars:**
- `GEMINI_API_KEY` - Google Gemini API key
- `PRINTFUL_API_KEY` - Printful API bearer token
- `GOOTEN_RECIPEID` - Gooten recipe identifier
- `AWS_ACCESS_KEY_ID` - Wasabi S3 access key
- `AWS_SECRET_ACCESS_KEY` - Wasabi S3 secret key

**Secrets location:**
- Heroku app config: `turnedyellowordermanagement`
- Retrieved at runtime via `heroku config:get` commands
- `.env` file present but gitignored (existence noted, contents not read)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## External Tools & Services (Non-API)

**Google Drive:**
- Reaction videos downloaded from Google Drive (via Google Drive MCP or `gdown`)
- Final videos uploaded to brand-specific Google Drive folders
  - TY-133627 folder: `132YmzgxOlEXiWKU39ymoFT4MUBVhswcb`
  - TY-207677 folder: `1uVLjM9nInRWr6MKW7wQNv82n2S6rZ2mU`

**Google Sheets:**
- Video tracker spreadsheet: `1B0ATlsp_bZpF7h6-1SpqnEbJJhFbYsh83mBmF7nbCp0`
- Records order ID, video version, music track, duration, publish date, platform links

**Heroku:**
- App: `turnedyellowordermanagement` (TurnedYellow OMS)
- Used for: API key retrieval, order data queries via `heroku run`
- Not a deployment target for this pipeline

**Social Media Platforms (publish targets):**
- YouTube Shorts
- TikTok
- Instagram Reels
- X (Twitter)

## Related Codebases

**TurnedYellow OMS:**
- Path: `/Users/lcalderon/github/OMS/`
- Key files: `server/helpers/printful-helper.js`, `server/helpers/gooten.helper.js`, `server/helpers/sharp.helper.js`
- Relationship: Source of truth for correct Printful API position parameters

**Popsmiths Backend:**
- Path: `/Users/lcalderon/github/sketchpop_art_app/apps/backend/`
- Key files: `src/services/mockup-generator.js`
- Relationship: Reference implementation for image preprocessing before Printful API

**Gwen Agent Workspace (external):**
- Brand configs: `~/clawd/agents/gwen/workspace/brand-configs/`
- Shared assets: `~/clawd/agents/gwen/workspace/shared-assets/`
- Pipeline orchestrator: `~/clawd/agents/gwen/workspace/produce-video.sh`
- Mockup generator: `~/clawd/agents/gwen/workspace/generate-mockups.js`

---

*Integration audit: 2026-02-26*
