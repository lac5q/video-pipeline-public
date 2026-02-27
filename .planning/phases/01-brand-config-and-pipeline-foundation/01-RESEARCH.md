# Phase 1: Brand Config and Pipeline Foundation - Research

**Researched:** 2026-02-26
**Domain:** Bash/ffmpeg video pipeline parameterization, JSON config system, product mockup quality safeguards
**Confidence:** HIGH

## Summary

Phase 1 transforms a proven but hardcoded TurnedYellow video pipeline into a brand-configurable system. The existing pipeline is a bash/ffmpeg/ImageMagick/Python stack that produces high-quality product showcase videos. Two published videos (TY-133627 and TY-130138) serve as the quality baseline. The core recipe -- Printful API for pixel-perfect mockups, Gemini for lifestyle staging, ffmpeg concat for video assembly -- is proven and must not change.

The primary engineering challenge is extracting the 20+ hardcoded TurnedYellow values (colors, text, paths, product order, CTA copy) from bash scripts into a JSON config system that any of the 5 brands can drive. A secondary challenge is eliminating all hardcoded `/Users/lcalderon/` paths so the pipeline can run from config-driven locations. The product catalog (17 products, shared across all brands) needs to be defined once with OMS-correct position parameters, since the existing `generate-mockups.js` has known bugs (wrong apparel dimensions, missing phone case rotation).

**Primary recommendation:** Build a JSON brand config system in `brands/`, a shared `products.json` catalog with OMS-correct parameters, a `produce-video.sh` CLI entrypoint, and a parameterized `build-video.sh` that reads config instead of hardcoded values. Keep existing TY build scripts untouched as regression baselines.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One JSON file per brand in a `brands/` directory inside the video-pipeline repo (e.g., `brands/turnedyellow.json`, `brands/makemejedi.json`)
- Pipeline repo is self-contained -- carries its own configs (not in clawd workspace)
- Each brand config includes: logo path, accent color, CTA text, music pool (list of tracks), video tone/style (hook templates, pacing), Google Drive folder IDs, OMS/API endpoint identifiers
- Existing .conf files in ~/clawd/agents/gwen/workspace/brand-configs/ will be superseded by these JSON configs
- All 17 products from PRODUCT-CATALOG.md are shared across all 5 brands -- same product set everywhere
- Same Printful/Gooten position parameters for all brands (450x450 for apparel, orientation-aware for wall art, rotated phone cases, front-view mugs)
- Product catalog is defined ONCE (not per-brand) since params are identical
- PopSmiths video showcase order prioritizes home decor (canvas, framed print, poster) over apparel -- the product catalog is the same but the video display order differs
- PopSmiths customers want art for the home primarily; a few other items appear but aren't the main sellers
- CLI: `./produce-video.sh --brand makemejedi --order 12345` (brand + order ID, both required)
- Per-order workspaces live inside the video-pipeline repo: `orders/{brand}/{order_id}/`
- Produces both UGC and standard reels when a reaction video exists; reels-only when no reaction video
- No separate --type flag needed -- auto-detects based on available assets
- Side-by-side: new parameterized scripts go in `scripts/`, old TY scripts stay in `orders/{id}/exports/` untouched
- Phase 1 includes a regression test: run the new pipeline on known TY orders (133627, 130138) and compare output quality to existing published videos
- Old TY scripts retire after Phase 1 passes regression test -- not before
- Use the existing TY-133627 and TY-130138 published videos as the regression baseline
- The proven recipe is: Printful API -> Gemini staging -> ffmpeg build. This must not change
- Mug must always use "Front view" option, blanket must always be Gemini-staged (draped, never flat)
- PopSmiths showcase order: canvas > framed print > poster > blanket > mug > apparel > accessories (home decor first, then everything else)
- All other brands use the current showcase order from the existing pipeline

### Claude's Discretion
- Secrets handling approach (env vars vs config file exclusion)
- Internal script architecture (how brand config gets passed between pipeline stages)
- Exact JSON schema field names and structure
- How regression comparison is performed (frame-by-frame, visual spot check, file size/duration comparison)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRAND-01 | Brand config system with JSON configs (logo, accent color, CTA text, product catalog, music pool, tone) for all 5 brands | Standard Stack: JSON config files in `brands/`, jq for parsing in bash. Existing .conf files provide exact values for 3 brands; TurnedComics and PopSmiths need creation. Architecture Pattern: brand config schema with all required fields. |
| BRAND-02 | Brand-aware video build -- parameterized ffmpeg scripts read brand config instead of hardcoded TY values | Code Examples: extract all hardcoded values from build-ugc-v11.sh into config-driven variables. Architecture Pattern: `build-video.sh` reads brand JSON via jq, substitutes into ffmpeg/magick commands. |
| BRAND-05 | Path abstraction -- eliminate hardcoded `/Users/lcalderon/` paths; use config-driven workspace locations | Pitfalls: 15+ hardcoded absolute paths identified in existing scripts. Pattern: use `$PIPELINE_ROOT` and config-relative paths throughout. |
| QUAL-01 | Zero distortions -- every product uses OMS-correct position parameters | Code Examples: complete product catalog JSON with verified OMS parameters. Key: apparel 450x450, orientation-aware wall art, phone case rotation, mug Front view. |
| QUAL-02 | All products must be Gemini-staged into lifestyle scenes -- no raw Printful mockups in final video | Architecture Pattern: staging validation step checks every v11_*.png exists before video build proceeds. |
| QUAL-03 | Maximum product showcase -- show as many of the order's products as possible in each video | Architecture Pattern: product catalog defines all 17 products; build script iterates available staged mockups dynamically. |
| QUAL-04 | Preserve existing TY pipeline -- keep current working build scripts intact as backup | Architecture Pattern: side-by-side deployment. New scripts in `scripts/`, old scripts in `orders/*/exports/` untouched. |
| QUAL-05 | Video specs enforced -- 1080x1920 portrait, CRF 18, h264, 30fps, blurred background fill | Code Examples: ffprobe verification gate already exists in produce-video.sh. Carry forward with stricter checks. |
</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| bash | 5.x (macOS zsh compatible) | Pipeline orchestration, script entrypoint | Already proven in existing pipeline; all video build logic is bash |
| ffmpeg | 6.x+ | Video encoding, segment concat, audio mixing | Already in use; the only tool that handles h264/CRF 18/concat properly |
| ImageMagick 7 | 7.x (`magick` command) | Image preparation, label rendering, logo cards | Already proven for blurred bg, text overlays, compositing |
| jq | 1.7+ | JSON parsing in bash scripts | Standard tool for reading JSON config from bash; already available on macOS via brew |
| Python 3.10+ | 3.10+ | Gemini staging script | Already used for stage-with-gemini.py |
| google-genai | latest | Gemini API client for image staging | Already in use for lifestyle scene generation |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| ffprobe | (bundled with ffmpeg) | Video spec verification | Quality gate checks after build |
| bc | (pre-installed macOS) | Arithmetic in bash | Audio timing calculations |
| aws CLI | 2.x | Wasabi S3 uploads for illustration URLs | Mockup generation phase (upload illustration for Printful) |
| curl | (pre-installed) | Printful/Gooten API calls | Mockup generation phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| jq for JSON parsing | Python wrapper script | jq is lighter, no Python dependency for config reading; Python overkill for "read a field from JSON" |
| Bash orchestration | Python/Node.js orchestration | Bash is proven and all existing logic is bash; rewriting in another language adds risk with no benefit for Phase 1 |
| Flat JSON config | YAML/TOML | JSON is natively parseable by jq, Python, Node; YAML requires additional parser in bash |

**Installation:**
```bash
brew install jq  # if not already installed
pip install google-genai pillow  # for Gemini staging
```

## Architecture Patterns

### Recommended Project Structure
```
video-pipeline/
├── produce-video.sh              # CLI entrypoint (--brand, --order)
├── brands/                       # One JSON config per brand
│   ├── turnedyellow.json
│   ├── makemejedi.json
│   ├── turnedwizard.json
│   ├── turnedcomics.json
│   └── popsmiths.json
├── products.json                 # Shared product catalog (defined ONCE)
├── scripts/
│   ├── build-video.sh            # Parameterized video builder (reads config)
│   ├── stage-with-gemini.py      # Gemini lifestyle staging
│   ├── generate-mockups.sh       # Printful/Gooten API mockup generation
│   └── verify-video.sh           # Quality gate verification
├── orders/                       # Per-order workspaces
│   ├── turnedyellow/
│   │   ├── 133627/               # Existing TY order
│   │   └── 130138/               # Existing TY order
│   ├── makemejedi/
│   │   └── {order_id}/
│   └── popsmiths/
│       └── {order_id}/
├── docs/                         # Existing documentation (unchanged)
├── research/                     # Existing research (unchanged)
└── requirements/                 # Existing requirements (unchanged)
```

### Pattern 1: Brand Config Schema
**What:** Each brand has a JSON config file containing all brand-specific values that vary between brands.
**When to use:** Any time a script needs brand-specific data (colors, text, logo, etc.)

```json
{
  "name": "TurnedYellow",
  "slug": "turnedyellow",
  "url": "TurnedYellow.com",
  "tagline": "Your Photo. Your Style. Your Products.",
  "style_description": "Hand-illustrated, one-of-a-kind",
  "colors": {
    "background": "#1a1a2e",
    "accent": "#FF8C00",
    "hook_accent": "#FFD700",
    "label_brand": "rgba(255,200,100,0.9)"
  },
  "logo": {
    "file": "turnedyellow-white.png",
    "width": 600
  },
  "cta": {
    "line1": "Shop our collections",
    "line2_url": "TurnedYellow.com",
    "line3_tagline": "Hand-illustrated, one-of-a-kind"
  },
  "hook_templates": [
    {
      "beat1": "this is what happens",
      "beat2": "when a customer\nopens our gift"
    },
    {
      "beat1": "you'll find no other gift",
      "beat2": "that makes them\nlaugh like this"
    }
  ],
  "music_pool": [
    "Tobu - Candyland [Privated NCS Release].mp3",
    "Ehrling - Dance With Me.mp3"
  ],
  "product_showcase_order": "default",
  "reaction_label": "Real customer reaction",
  "drive_folder_ids": {},
  "oms_app": "turnedyellowordermanagement"
}
```

**Key design decisions:**
- `logo.file` is a filename, not an absolute path -- resolved relative to `brands/assets/logos/`
- `music_pool` contains filenames resolved relative to a configured music directory
- `product_showcase_order` is "default" or "home_decor_first" (PopSmiths)
- Secrets (API keys, Drive folder IDs) handled via env vars, not in the JSON

### Pattern 2: Shared Product Catalog
**What:** A single `products.json` defining all 17 products with OMS-correct parameters.
**When to use:** Mockup generation and video build -- both read from this single source of truth.

```json
{
  "products": [
    {
      "id": "framed_poster",
      "label": "Framed Poster",
      "provider": "printful",
      "product_id": 2,
      "variant_id": 4,
      "placement": "default",
      "fill_mode": "cover",
      "orientation_aware": true,
      "position_landscape": {
        "area_width": 4800, "area_height": 3600,
        "width": 4800, "height": 3600, "top": 0, "left": 0
      },
      "position_portrait": {
        "area_width": 3600, "area_height": 4800,
        "width": 3600, "height": 4800, "top": 0, "left": 0
      },
      "staging_prompt": "Place this framed artwork on a living room wall. Modern interior design.",
      "video_include": true,
      "default_order": 1,
      "home_decor_order": 2
    },
    {
      "id": "tshirt",
      "label": "T-Shirt",
      "provider": "printful",
      "product_id": 71,
      "variant_id": 4013,
      "placement": "front",
      "option_groups": ["Wrinkled"],
      "position": {
        "area_width": 450, "area_height": 450,
        "width": 450, "height": 450, "top": 0, "left": 0
      },
      "staging_prompt": "Show this custom printed t-shirt folded neatly on a wooden table in a boutique shop.",
      "video_include": true,
      "default_order": 3,
      "home_decor_order": 8
    }
  ],
  "showcase_orders": {
    "default": ["framed_poster", "canvas", "tshirt", "hoodie", "sweatshirt", "tanktop", "mug", "waterbottle", "phonecase", "totebag", "blanket", "poster"],
    "home_decor_first": ["canvas", "framed_poster", "poster", "blanket", "mug", "tshirt", "hoodie", "sweatshirt", "tanktop", "waterbottle", "phonecase", "totebag"]
  }
}
```

### Pattern 3: Config-Driven Build Script
**What:** The video build script reads all brand-specific values from JSON at startup, then uses variables throughout.
**When to use:** The `build-video.sh` script that replaces the hardcoded `build-ugc-v11.sh`.

```bash
#!/bin/bash
# build-video.sh -- parameterized video builder
set -euo pipefail

BRAND_CONFIG="$1"
WORKSPACE="$2"
PRODUCTS_CONFIG="$3"

# Read brand config via jq
BRAND_NAME=$(jq -r '.name' "$BRAND_CONFIG")
BRAND_BG=$(jq -r '.colors.background' "$BRAND_CONFIG")
BRAND_ACCENT=$(jq -r '.colors.accent' "$BRAND_CONFIG")
HOOK_ACCENT=$(jq -r '.colors.hook_accent' "$BRAND_CONFIG")
LABEL_COLOR=$(jq -r '.colors.label_brand' "$BRAND_CONFIG")
LOGO_FILE=$(jq -r '.logo.file' "$BRAND_CONFIG")
LOGO_WIDTH=$(jq -r '.logo.width' "$BRAND_CONFIG")
CTA_LINE1=$(jq -r '.cta.line1' "$BRAND_CONFIG")
CTA_URL=$(jq -r '.cta.line2_url' "$BRAND_CONFIG")
CTA_TAGLINE=$(jq -r '.cta.line3_tagline' "$BRAND_CONFIG")
REACTION_LABEL=$(jq -r '.reaction_label' "$BRAND_CONFIG")

# Resolve paths relative to pipeline root
PIPELINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${PIPELINE_ROOT}/brands/assets/logos/${LOGO_FILE}"

# All ffmpeg/magick commands use these variables instead of hardcoded values
```

### Pattern 4: Secrets via Environment Variables
**What:** API keys and sensitive values stay in environment variables, never in config files.
**When to use:** Any time the pipeline needs Printful, Gooten, Gemini, or S3 credentials.

**Recommendation (Claude's Discretion area):**
- `PRINTFUL_API_KEY` -- from env var (can retrieve from Heroku if needed)
- `GOOTEN_RECIPEID` -- from env var
- `GEMINI_API_KEY` -- from env var
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` -- from env var for Wasabi S3
- Google Drive folder IDs -- these are not truly secret (folder IDs are not sensitive without auth), so they can live in the brand JSON config
- The pipeline entrypoint validates all required env vars are set before proceeding
- A `.env.example` file documents required variables without containing actual values

### Pattern 5: Path Abstraction
**What:** All paths are resolved relative to `$PIPELINE_ROOT` or derived from config, never hardcoded.
**When to use:** Every file reference in every script.

```bash
# BEFORE (hardcoded):
LOGO="/Users/lcalderon/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png"
WORKSPACE="/Users/lcalderon/clawd/agents/gwen/workspace/turnedyellow-video-ugc-133627"

# AFTER (config-driven):
PIPELINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${PIPELINE_ROOT}/brands/assets/logos/$(jq -r '.logo.file' "$BRAND_CONFIG")"
WORKSPACE="${PIPELINE_ROOT}/orders/${BRAND_SLUG}/${ORDER_ID}"
```

### Anti-Patterns to Avoid
- **Hardcoded absolute paths:** Never reference `/Users/lcalderon/` or any user-specific path. Use `$PIPELINE_ROOT` or `$HOME` with relative resolution.
- **Duplicating product parameters across scripts:** The product catalog is the single source. No script should contain inline product IDs, variant IDs, or position dimensions.
- **Modifying existing TY build scripts:** The old scripts in `orders/*/exports/` are the regression baseline. Do not touch them. New scripts go in `scripts/`.
- **Inline brand values in build scripts:** Every brand-varying value must come from the JSON config. If you see "TurnedYellow" in a build script, it should be `$BRAND_NAME`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing in bash | awk/sed/grep on JSON | `jq` | JSON is structured data; regex on JSON is fragile and breaks on nested values, escaping, arrays |
| Product position parameters | Ad-hoc per-script definitions | `products.json` catalog | OMS-correct parameters are complex (orientation-aware, rotation-dependent); a single source prevents divergence |
| Video spec validation | Manual eyeball check | `ffprobe` + assertion script | Automated check catches resolution, codec, fps deviations that humans miss |
| Illustration orientation detection | Manual width/height check | `magick identify` + conditional in script | Must be automated since every mockup generation depends on this |

**Key insight:** The existing pipeline's biggest problem is that product parameters and brand values are scattered across individual build scripts. The new system must centralize these into JSON configs that are the sole source of truth. Any duplication will eventually diverge and cause quality regressions.

## Common Pitfalls

### Pitfall 1: Wrong Apparel Position Dimensions
**What goes wrong:** Using 1800x2400 (portrait 3:4) instead of 450x450 (square) for apparel products causes Printful to stretch landscape illustrations vertically.
**Why it happens:** The Printful docs suggest 1800x2400 as the "full print area" for front placement. The OMS discovered that 450x450 square prevents stretching for any aspect ratio illustration.
**How to avoid:** The product catalog must specify 450x450 for all apparel (tshirt, hoodie, sweatshirt, tanktop). This is enforced by reading from `products.json`, never inline.
**Warning signs:** Faces look elongated, circles become ovals on apparel mockups.

### Pitfall 2: Missing Phone Case Rotation
**What goes wrong:** Landscape illustrations sent directly to phone case endpoints (879x1830 tall area) get stretched into impossibly tall proportions.
**Why it happens:** Phone case print areas are portrait (~1:2 ratio). A 4:3 landscape image stretched to 1:2 produces extreme warping.
**How to avoid:** The mockup generation script must rotate landscape illustrations 270 degrees before sending to Printful for phone cases. This is a preprocessing step, not a Printful parameter.
**Warning signs:** Everything on the phone case looks impossibly thin and tall.

### Pitfall 3: Hardcoded Paths Surviving Migration
**What goes wrong:** A path like `/Users/lcalderon/clawd/agents/gwen/workspace/shared-assets/logos/turnedyellow-white.png` gets missed and breaks when anyone else (or Gwen) runs the pipeline.
**Why it happens:** Paths are scattered across multiple scripts. Easy to miss one during parameterization.
**How to avoid:** After implementation, run `grep -r '/Users/lcalderon' scripts/ produce-video.sh` and verify zero results. Also grep for any absolute path that doesn't start with `$` (a variable reference).
**Warning signs:** "File not found" errors when running on a different machine or as a different user.

### Pitfall 4: Mug Default View Showing Handle
**What goes wrong:** The mug mockup shows the handle side instead of the front where the artwork is printed.
**Why it happens:** Printful's default mug view is the handle side. The `"options": ["Front view"]` parameter is easy to forget.
**How to avoid:** The product catalog entry for mug must include `"options": ["Front view"]`. The mockup generation script reads this from the catalog.
**Warning signs:** Mug mockup has a large empty area with a handle visible, artwork barely visible.

### Pitfall 5: Blanket Standing Upright in Staging
**What goes wrong:** Gemini stages the blanket propped against a wall or standing upright instead of draped on a bed.
**Why it happens:** Generic staging prompts don't specify "draped flat on a bed."
**How to avoid:** The staging prompt in `products.json` for blankets must explicitly say "draped flat on a bed." This is why staging prompts live in the product catalog.
**Warning signs:** Blanket looks like a rigid board in the staged image.

### Pitfall 6: Shell Eating Hex Colors in ffmpeg
**What goes wrong:** Using `#FFD700` in ffmpeg filter_complex causes the shell to interpret `#` as a comment, eating the rest of the line.
**Why it happens:** Bash treats `#` as a comment character outside of quotes in certain contexts.
**How to avoid:** Use `0xRRGGBB` format in ffmpeg commands. The brand config stores colors as `#RRGGBB` (standard); the build script converts to `0x` format for ffmpeg. ImageMagick commands can use `#RRGGBB` directly.
**Warning signs:** ffmpeg produces black or missing colors; build script silently truncates.

### Pitfall 7: Gemini FinishReason.OTHER Blocking
**What goes wrong:** Gemini safety filter triggers a false positive, blocking a completely benign product staging request.
**Why it happens:** Gemini is non-deterministic; the same prompt may succeed or fail on different attempts. Family portraits on products can trigger safety heuristics.
**How to avoid:** Retry up to 3 times with exponential backoff. On retries, simplify the prompt. Text prompt must come BEFORE image in the API call (image-first triggers more blocks).
**Warning signs:** `FinishReason.OTHER` in Gemini response; no image returned.

### Pitfall 8: Regression During Parameterization
**What goes wrong:** The new parameterized pipeline produces subtly different output than the proven TY scripts (wrong timing, missing labels, different audio levels).
**Why it happens:** When extracting hardcoded values into config, it's easy to change a magic number or miss a nuance.
**How to avoid:** Regression test against TY-133627 and TY-130138 published videos. Compare: duration (+/- 0.5s), resolution (exact match), file size (within 20%), visual spot-check of 5 key frames (hook, reaction, first product, last product, logo card).
**Warning signs:** Duration or file size significantly different from baseline; visual differences in product labels or logo card.

## Code Examples

### Reading Brand Config in Bash
```bash
#!/bin/bash
# Read brand config fields with jq
BRAND_CONFIG="$1"

BRAND_NAME=$(jq -r '.name' "$BRAND_CONFIG")
BRAND_BG=$(jq -r '.colors.background' "$BRAND_CONFIG")

# Convert #hex to 0x hex for ffmpeg
BRAND_BG_FF="0x${BRAND_BG#\#}"

# Read arrays
MUSIC_COUNT=$(jq '.music_pool | length' "$BRAND_CONFIG")
FIRST_MUSIC=$(jq -r '.music_pool[0]' "$BRAND_CONFIG")

# Read hook template
HOOK_BEAT1=$(jq -r '.hook_templates[0].beat1' "$BRAND_CONFIG")
HOOK_BEAT2=$(jq -r '.hook_templates[0].beat2' "$BRAND_CONFIG")
```

### Product Catalog Iteration
```bash
# Read product showcase order for this brand
SHOWCASE_KEY=$(jq -r '.product_showcase_order' "$BRAND_CONFIG")
PRODUCTS=$(jq -r ".showcase_orders.${SHOWCASE_KEY}[]" "$PRODUCTS_CONFIG")

# Iterate products in showcase order
while IFS= read -r product_id; do
    LABEL=$(jq -r ".products[] | select(.id == \"$product_id\") | .label" "$PRODUCTS_CONFIG")
    STAGING_PROMPT=$(jq -r ".products[] | select(.id == \"$product_id\") | .staging_prompt" "$PRODUCTS_CONFIG")
    # ... use in build
done <<< "$PRODUCTS"
```

### Orientation-Aware Mockup Parameters
```bash
# Detect illustration orientation
DIMENSIONS=$(magick identify -format '%wx%h' "$ILLUSTRATION")
WIDTH=${DIMENSIONS%x*}
HEIGHT=${DIMENSIONS#*x}

if [ "$WIDTH" -gt "$HEIGHT" ]; then
    ORIENTATION="landscape"
else
    ORIENTATION="portrait"
fi

# Read position from product catalog based on orientation
if [ "$(jq -r ".products[] | select(.id == \"$PRODUCT_ID\") | .orientation_aware" "$PRODUCTS_CONFIG")" = "true" ]; then
    POSITION=$(jq -c ".products[] | select(.id == \"$PRODUCT_ID\") | .position_${ORIENTATION}" "$PRODUCTS_CONFIG")
else
    POSITION=$(jq -c ".products[] | select(.id == \"$PRODUCT_ID\") | .position" "$PRODUCTS_CONFIG")
fi
```

### Video Spec Verification Gate
```bash
verify_video() {
    local video="$1"
    local pass=true

    WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$video")
    HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$video")
    CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$video")
    FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$video")

    [ "$WIDTH" != "1080" ] && echo "FAIL: width=$WIDTH, expected 1080" && pass=false
    [ "$HEIGHT" != "1920" ] && echo "FAIL: height=$HEIGHT, expected 1920" && pass=false
    [ "$CODEC" != "h264" ] && echo "FAIL: codec=$CODEC, expected h264" && pass=false

    # FPS check (30/1 or 30000/1001)
    FPS_NUM=${FPS%/*}
    [ "$FPS_NUM" -lt 29 ] && echo "FAIL: fps=$FPS, expected ~30" && pass=false

    $pass && echo "PASS: video meets specs"
    $pass
}
```

### Logo End Card (Parameterized)
```bash
# Before (hardcoded TY):
magick -size ${W}x${H} "xc:#1a1a2e" \
    \( "${LOGO}" -resize 600x \) -gravity center -composite \
    -pointsize 48 -fill "#FF8C00" -gravity center -annotate +0+190 "TurnedYellow.com"

# After (config-driven):
magick -size ${W}x${H} "xc:${BRAND_BG}" \
    \( "${LOGO}" -resize "${LOGO_WIDTH}x" \) -gravity center -composite \
    -font "${FONT}" \
    -pointsize 44 -fill white -gravity center -annotate +0+120 "${CTA_LINE1}" \
    -pointsize 48 -fill "${BRAND_ACCENT}" -gravity center -annotate +0+190 "${CTA_URL}" \
    -pointsize 26 -fill "gray70" -gravity center -annotate +0+260 "${CTA_TAGLINE}" \
    "${TMP}/logo_card.png"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.conf` files in clawd workspace | JSON configs in repo `brands/` directory | Phase 1 (now) | Self-contained repo, jq-parseable, richer data structure |
| Hardcoded paths to `/Users/lcalderon/` | `$PIPELINE_ROOT`-relative paths | Phase 1 (now) | Gwen and other agents can execute the pipeline |
| Per-order build scripts with inline values | Parameterized `build-video.sh` reading from config | Phase 1 (now) | Any brand's order can be built with the same script |
| `generate-mockups.js` with wrong parameters | `products.json` with OMS-correct parameters | Phase 1 (now) | Zero-distortion mockups for all products |
| Nano Banana Pro staging (old produce-video.sh) | Gemini staging with proven prompts | Already proven (v11) | Better quality, simpler pipeline |

**Deprecated/outdated:**
- `rembg + ImageMagick composite` approach: Replaced by direct Gemini staging. Products looked like flat cutouts.
- `generate-mockups.js` (in clawd workspace): Has known bugs (wrong apparel dimensions, missing phone case rotation). Replaced by new mockup generation reading from `products.json`.
- `.conf` file format: Replaced by JSON configs. `.conf` files lack arrays, nested structures, and are hard to parse for complex data.

## Open Questions

1. **TurnedComics and PopSmiths brand values**
   - What we know: 3 brands have existing .conf files (TY, MMJ, TW). PopSmiths is a separate Shopify store with different aesthetics.
   - What's unclear: Exact brand colors, logos, taglines, hook templates for TurnedComics and PopSmiths. No .conf files exist for these two brands.
   - Recommendation: Create placeholder configs for TC and PopSmiths with best-guess values. Luis can review and adjust. The config system makes it trivial to update values later.

2. **Font availability across systems**
   - What we know: Existing scripts use `/System/Library/Fonts/HelveticaNeue.ttc` (macOS-specific path).
   - What's unclear: Whether Gwen's execution environment has the same font path. This is technically a hardcoded path.
   - Recommendation: Include font path in brand config or as a pipeline-level config. Fall back to a bundled font if the system font is unavailable.

3. **Regression comparison methodology**
   - What we know: Need to compare new pipeline output against TY-133627 and TY-130138 published videos.
   - What's unclear: Published videos may not be available locally (stored on Google Drive). Frame-by-frame comparison is impractical since Gemini staging is non-deterministic.
   - Recommendation: Compare structural properties (duration within 0.5s, resolution exact, file size within 20%, codec match). Manual visual spot-check of 5 key frames. Do NOT expect pixel-perfect match since Gemini outputs vary.

4. **Music file storage location**
   - What we know: Music currently lives in `/tmp/brand-music/` which is volatile across reboots.
   - What's unclear: Whether to bundle music in the repo (large files, .gitignore'd) or reference an external location.
   - Recommendation: Store music in `brands/assets/music/` within the repo, .gitignore the actual files, and document download instructions. The brand config references filenames, resolved relative to this directory.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `orders/133627/exports/build-ugc-v11.sh` -- proven TY build script, directly analyzed
- Existing codebase: `orders/130138/exports/build-ugc-v1.sh` -- second proven TY build script, directly analyzed
- Existing codebase: `docs/PRODUCT-CATALOG.md` -- complete product API reference with OMS-correct parameters
- Existing codebase: `docs/PIPELINE-GUIDE.md` -- end-to-end build process documentation
- Existing codebase: `docs/LESSONS-LEARNED.md` -- every known pitfall and fix
- Existing codebase: `research/mockup-generation-research.md` -- deep analysis of OMS/Printful/Gooten position parameters
- Existing codebase: `requirements/video-requirements.md` -- hard rules that must not be broken
- Existing external: `/Users/lcalderon/clawd/agents/gwen/workspace/brand-configs/*.conf` -- current brand values for 3 brands
- Existing external: `/Users/lcalderon/clawd/agents/gwen/workspace/produce-video.sh` -- current pipeline orchestrator

### Secondary (MEDIUM confidence)
- jq documentation (well-known stable tool, no version concerns)
- ffmpeg/ffprobe documentation (standard video processing)

### Tertiary (LOW confidence)
- TurnedComics and PopSmiths brand values -- these will need Luis's input as no config files exist yet

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all tools already in use in the proven pipeline; no new dependencies
- Architecture: HIGH - the pattern is straightforward extraction of hardcoded values into JSON config; no novel engineering
- Pitfalls: HIGH - every pitfall is documented from actual mistakes in the codebase (LESSONS-LEARNED.md, mockup-generation-research.md)

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain, no fast-moving dependencies)
