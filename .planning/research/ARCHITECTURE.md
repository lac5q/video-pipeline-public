# Architecture Research

**Domain:** Multi-brand automated video production pipeline with consent management
**Researched:** 2026-02-26
**Confidence:** HIGH (existing proven pipeline, well-documented codebase, brand configs already started)

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Gwen Agent   │  │ Order        │  │ Batch        │              │
│  │ (Daily Run)  │  │ Selector     │  │ Approver     │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                  │                      │
├─────────┴─────────────────┴──────────────────┴──────────────────────┤
│                      CONSENT LAYER                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Email Sender │  │ Consent      │  │ Consent      │              │
│  │ (per brand)  │  │ Tracker      │  │ Gate         │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                  │                      │
├─────────┴─────────────────┴──────────────────┴──────────────────────┤
│                      BRAND CONFIG LAYER                             │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │ Brand Registry (logo, colors, products, CTA, OMS source) │      │
│  └───────────────────────────────────────────────────────────┘      │
│         │                                                           │
├─────────┴───────────────────────────────────────────────────────────┤
│                      PRODUCTION LAYER (existing, proven)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Asset    │  │ Mockup   │  │ Gemini   │  │ Video    │           │
│  │ Download │  │ Generate │  │ Staging  │  │ Build    │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
│         │                                                           │
├─────────┴───────────────────────────────────────────────────────────┤
│                      PUBLISH LAYER                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                          │
│  │ Drive    │  │ Social   │  │ Video    │                          │
│  │ Upload   │  │ Copy Gen │  │ Tracker  │                          │
│  └──────────┘  └──────────┘  └──────────┘                          │
└─────────────────────────────────────────────────────────────────────┘

External Systems:
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │ Shared OMS    │  │ PopSmiths     │  │ Shopify       │
  │ (TY/MMJ/TW/  │  │ Heroku Server │  │ Storefronts   │
  │  TC orders)   │  │ (PS orders)   │  │ (all brands)  │
  └───────────────┘  └───────────────┘  └───────────────┘
```

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Gwen Agent** | Daily autonomous pipeline execution. Picks up approved orders, runs end-to-end production. | Order Selector, Consent Gate, Production Layer |
| **Order Selector** | Queries OMS/PopSmiths for candidate orders based on quality signals (illustration quality, reaction video availability). Ranks and suggests best orders per brand. | Shared OMS, PopSmiths Server, Batch Approver |
| **Batch Approver** | Presents suggested orders to Luis for batch approval. CLI-based approve/reject per order. | Order Selector, Consent Layer |
| **Email Sender** | Sends branded consent request emails to customers. Uses brand-specific templates and sender identity. | Brand Registry, Consent Tracker |
| **Consent Tracker** | Stores consent state per order (pending/approved/denied). Provides lookup for Consent Gate. | Email Sender, Consent Gate |
| **Consent Gate** | Blocks production for orders without explicit customer consent. Single checkpoint that all orders must pass. | Consent Tracker, Production Layer |
| **Brand Registry** | Central config for all 5 brands: logo, colors, accent, CTA text, product catalog, tagline, OMS source, email template. | All components that need brand-specific behavior |
| **Asset Download** | Fetches customer photos, illustration, reaction video from OMS/PopSmiths/Google Drive. Brand-aware (knows which OMS to query). | Shared OMS, PopSmiths Server, Google Drive, Wasabi S3 |
| **Mockup Generate** | Calls Printful/Gooten APIs with brand-appropriate product catalog. Handles orientation detection, rotation, polling. | Printful API, Gooten API, Wasabi S3 |
| **Gemini Staging** | Stages mockups into lifestyle scenes with brand-appropriate prompts. Retry logic for safety filter blocks. | Gemini API |
| **Video Build** | Assembles final video using brand colors, logo, CTA, hook text. Both UGC and standard reels variants. | Brand Registry, ffmpeg, ImageMagick |
| **Drive Upload** | Uploads to brand-specific Google Drive folders. | Google Drive |
| **Social Copy Gen** | Generates platform-specific copy using brand voice, hashtags, and CTA. | Brand Registry |
| **Video Tracker** | Records production metadata (order, brand, version, music, date) in Google Sheets. | Google Sheets |

## Data Flow

### Full Pipeline (Multi-Brand)

```
[Gwen Daily Run]
    │
    ├── 1. ORDER SELECTION (per brand)
    │   │
    │   ├── Query shared OMS (TY, MMJ, TW, TC orders)
    │   ├── Query PopSmiths server (PS orders)
    │   ├── Score by: illustration quality, reaction video exists, recency
    │   └── Output: ranked candidate list per brand
    │
    ├── 2. BATCH APPROVAL (human checkpoint)
    │   │
    │   ├── Present candidates to Luis (CLI)
    │   └── Output: approved order list
    │
    ├── 3. CONSENT CHECK (per approved order)
    │   │
    │   ├── Check Consent Tracker for existing consent
    │   ├── If no record → send branded consent email, mark PENDING
    │   ├── If PENDING → skip (wait for response)
    │   ├── If DENIED → skip permanently
    │   └── If APPROVED → proceed to production
    │
    ├── 4. PRODUCTION (per consented order)  ← existing proven pipeline
    │   │
    │   ├── Load brand config from Brand Registry
    │   ├── Download assets (brand-aware OMS source)
    │   ├── Upload illustration to S3
    │   ├── Generate mockups (brand-specific product catalog)
    │   ├── Stage with Gemini (brand-aware prompts)
    │   └── Build video (brand colors, logo, CTA, hook)
    │
    └── 5. PUBLISH (per completed video)
        │
        ├── Upload to brand-specific Drive folder
        ├── Generate social copy with brand voice
        └── Update video tracker
```

### Consent State Machine

```
[Order Selected]
    │
    ├── No consent record exists
    │   └── Send email → state = PENDING
    │
    ├── PENDING (email sent, no response yet)
    │   └── Skip in daily run, check again next day
    │
    ├── APPROVED (customer clicked approve link)
    │   └── Proceed to production
    │
    └── DENIED (customer clicked deny / no response after N days)
        └── Skip permanently, never re-request
```

### Brand-Aware Asset Resolution

```
[Order] → [Brand Registry] → which OMS?
    │
    ├── TY/MMJ/TW/TC → shared OMS (turnedyellowordermanagement on Heroku)
    │   └── MongoDB → photos[], illustration.url
    │
    └── PopSmiths → PopSmiths Heroku server
        └── own storage → before/after art, but orders via POD OMS
```

## Recommended Project Structure

```
video-pipeline/
├── brands/                    # Brand configuration (replaces external brand-configs/)
│   ├── schema.json            # Brand config schema (validation)
│   ├── turnedyellow.json      # TY config (migrated from .conf)
│   ├── makemejedi.json        # MMJ config
│   ├── turnedwizard.json      # TW config
│   ├── turnedcomics.json      # TC config
│   └── popsmiths.json         # PS config (note: different OMS source)
├── consent/                   # Consent management
│   ├── tracker.json           # Consent state per order (or SQLite DB)
│   ├── templates/             # Brand-specific email templates
│   │   ├── turnedyellow.html
│   │   ├── makemejedi.html
│   │   └── ...
│   └── send-consent-email.sh  # Email dispatch script
├── pipeline/                  # Core production scripts (extracted from build scripts)
│   ├── select-orders.sh       # Order candidate selection
│   ├── download-assets.sh     # Brand-aware asset download
│   ├── generate-mockups.sh    # Printful/Gooten API calls
│   ├── stage-with-gemini.py   # Gemini lifestyle staging
│   ├── build-video.sh         # Brand-parameterized video assembly
│   ├── upload-to-drive.sh     # Brand-aware Drive upload
│   └── generate-social-copy.sh # Brand-voice social copy
├── orders/                    # Per-order workspaces (existing)
│   ├── {brand}-{order_id}/    # Brand prefix on workspace dirs
│   └── ...
├── shared-assets/             # Logos, fonts, music (moved into repo)
│   ├── logos/
│   ├── music/
│   └── fonts/
├── scripts/                   # Utilities
│   └── swap-music.sh
├── docs/                      # Documentation (existing)
└── .planning/                 # Project planning
```

### Structure Rationale

- **brands/:** Centralizes all brand-specific configuration in one place. JSON instead of .conf enables validation, easier parsing by both bash and Node.js scripts, and structured product catalog per brand. Moving brand configs into this repo (from `~/clawd/agents/gwen/workspace/brand-configs/`) gives version control and single source of truth.
- **consent/:** Isolated from production pipeline because consent is a prerequisite gate, not a production step. Could be as simple as a JSON file or SQLite DB since volume is low (5-10 orders/day across all brands).
- **pipeline/:** Extracted, parameterized versions of the proven build scripts. Each script takes a brand config and order ID as arguments instead of having hardcoded values. This is the core refactoring work.
- **orders/:** Keep existing workspace pattern, but prefix with brand for multi-brand disambiguation: `TY-133627/` instead of `133627/`.

## Architectural Patterns

### Pattern 1: Brand Config Registry

**What:** Single JSON config per brand that drives all brand-specific behavior throughout the pipeline. Every component reads from this config rather than having hardcoded brand values.

**When to use:** Everywhere. The brand config is the primary abstraction that turns a TurnedYellow-only pipeline into a multi-brand one.

**Trade-offs:** More indirection (read config instead of hardcoded values), but eliminates per-brand code duplication entirely.

**Example:**
```json
{
  "brand_id": "turnedyellow",
  "display_name": "TurnedYellow",
  "url": "TurnedYellow.com",
  "tagline": "Your Photo. Your Style. Your Products.",
  "style_description": "Hand-illustrated by our artists",
  "colors": {
    "background": "#1a1a2e",
    "accent": "#FF8C00",
    "hook_accent": "#FFD700",
    "label_brand": "rgba(255,200,100,0.9)"
  },
  "logo": "shared-assets/logos/turnedyellow-white.png",
  "logo_width": 540,
  "hook": {
    "line1": "they sent us some photos\nand what did we do?",
    "line2": "WAIT FOR IT..."
  },
  "oms_source": "shared",
  "oms_app": "turnedyellowordermanagement",
  "product_catalog": ["framed_poster", "canvas", "tshirt", "hoodie", ...],
  "consent_email_from": "hello@turnedyellow.com",
  "drive_folder_prefix": "TY Video Pipeline",
  "social_hashtags": ["#TurnedYellow", "#CustomGifts", "#Simpsonized"]
}
```

### Pattern 2: Consent Gate (Pre-Production Checkpoint)

**What:** A mandatory checkpoint between order selection and production. No order enters the production pipeline without explicit customer consent. The gate is a simple state lookup, not a complex workflow engine.

**When to use:** Before every production run. Gwen checks the consent tracker, sends emails for new orders, and only proceeds with APPROVED orders.

**Trade-offs:** Adds latency (orders need 1-3 days for consent response), but this is a legal/ethical requirement that cannot be skipped. The pipeline naturally handles this since it runs daily -- pending orders get checked again the next day.

**Consent storage options (recommendation: JSON file to start):**
- JSON file (`consent/tracker.json`): Simple, version-controllable, sufficient for <100 orders/month. Migrate to SQLite if it grows.
- SQLite: Better querying, but overkill at current scale.
- Google Sheet: Visible to Luis without CLI, but slower API access.

### Pattern 3: Pipeline Parameterization (Config-Driven Build)

**What:** The proven build script logic stays identical, but all brand-specific values (colors, logo, CTA, product list, hook text) are read from the brand config at runtime rather than hardcoded. The build script becomes a template that the brand config fills in.

**When to use:** For the video build step and all other brand-specific pipeline steps.

**Trade-offs:** Requires refactoring existing build scripts to accept parameters, which risks breaking the proven recipe. Mitigate by keeping the existing TY build scripts as "known good" references and testing each parameterized version against TY output first.

**Example:**
```bash
#!/usr/bin/env bash
# build-video.sh -- Brand-parameterized video build
# Usage: build-video.sh <brand_config.json> <order_id> <variant: ugc|reels>

BRAND_CONFIG="$1"
ORDER_ID="$2"
VARIANT="$3"

# Read brand config
BRAND_NAME=$(jq -r '.display_name' "$BRAND_CONFIG")
BRAND_BG=$(jq -r '.colors.background' "$BRAND_CONFIG")
BRAND_ACCENT=$(jq -r '.colors.accent' "$BRAND_CONFIG")
LOGO=$(jq -r '.logo' "$BRAND_CONFIG")
# ... all other brand-specific values from config

# Rest of the build script uses these variables instead of hardcoded values
# The actual ffmpeg/ImageMagick logic is IDENTICAL to the proven build scripts
```

## Anti-Patterns

### Anti-Pattern 1: Per-Brand Build Scripts

**What people do:** Copy the TY build script for each brand and modify hardcoded values (5 copies of 400+ line scripts).

**Why it's wrong:** Any improvement to video structure, timing, or encoding must be applied to all 5 copies. Drift is inevitable. Within 2 months, brands will have inconsistent video quality.

**Do this instead:** One parameterized build script that reads from brand config. Brand differences are expressed as data (config), not code (script copies).

### Anti-Pattern 2: Consent in the OMS

**What people do:** Add consent flags to the existing OMS MongoDB schema and manage consent state alongside order data.

**Why it's wrong:** The OMS is shared infrastructure serving 4 brands. Video consent is a pipeline concern, not an order fulfillment concern. Coupling consent state to the OMS means OMS changes could break the pipeline and vice versa. Also, PopSmiths has a different OMS, so you would need to add consent tracking to two systems.

**Do this instead:** Keep consent tracking in the video pipeline repo. The pipeline owns consent state. It queries the OMS for order data but manages consent independently.

### Anti-Pattern 3: Building a Consent Workflow Engine

**What people do:** Build an elaborate state machine with retry queues, escalation paths, webhook handlers for email responses, admin UI for consent management.

**Why it's wrong:** Current scale is ~5-10 orders/day across all brands. A simple send-email + check-response flow is sufficient. The consent check runs once per daily pipeline execution. Over-engineering consent management delays the actual value (multi-brand video production).

**Do this instead:** JSON file for consent state, a simple script to send branded emails, and a script to check for responses (via Gmail API or link-click tracking). Upgrade if and when scale demands it.

### Anti-Pattern 4: Merging PopSmiths into the Shared OMS

**What people do:** Try to normalize PopSmiths' art storage and order structure into the shared OMS to simplify asset download.

**Why it's wrong:** PopSmiths has fundamentally different art storage (before/after on its own Heroku server, not Wasabi S3), a headless Shopify architecture, and AI-generated art with credits. Forcing it into the shared OMS schema would require extensive OMS modifications and risk breaking PopSmiths ordering.

**Do this instead:** The brand config's `oms_source` field tells the asset download script which system to query. Two code paths for asset download (shared OMS vs. PopSmiths server) are cleaner than one forced-merged path.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Shared OMS (Heroku) | `heroku run` for order queries | 4 brands share this. Read-only from pipeline perspective. |
| PopSmiths Heroku Server | HTTP API for art retrieval | Different endpoint than shared OMS. Brand config specifies URL. |
| Printful API | REST API (create-task + poll) | Rate-limited. Shared across all brands (same API key). |
| Gooten API | REST API (product preview) | Used for blankets/ornaments. Shared recipe ID. |
| Gemini API | Python SDK | Non-deterministic. Retry logic mandatory. Shared API key. |
| Wasabi S3 | aws CLI uploads | Shared bucket, brand-prefixed paths (`s3://turnedyellowimages/video-pipeline/{brand}-{order}/`). |
| Google Drive | MCP or API | Brand-specific folder structure. |
| Gmail API | Send consent emails | Brand-specific sender identity. |
| Google Sheets | Track video production | Single shared tracker across all brands. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestration ↔ Consent | Function call / file read | Gwen checks consent state before triggering production |
| Consent ↔ Production | File-based gate | Production scripts check `consent/tracker.json` before proceeding |
| Brand Config ↔ Everything | File read (JSON) | All components read brand config; none write to it |
| Order Selector ↔ OMS | Heroku CLI / HTTP | Read-only queries to external systems |
| Production ↔ External APIs | REST API / SDK | Printful, Gooten, Gemini -- all existing, proven integrations |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 orders/day (current) | JSON consent tracker, sequential pipeline, manual batch approval. Everything proposed here. |
| 5-20 orders/day | Parallelize mockup generation across orders. Consider SQLite for consent tracker. Auto-approve low-risk orders. |
| 20-50 orders/day | Queue-based production (orders wait for Gemini/Printful capacity). Consent email via dedicated transactional email service (SendGrid/Postmark). Video tracker in database not spreadsheet. |
| 50+ orders/day | Beyond current architecture. Would need a proper task queue, worker processes, and likely a web-based approval UI. |

### Scaling Priorities

1. **First bottleneck: Gemini API rate limits.** At ~12 products per order with 2s delay between each, one order takes ~30s of Gemini time. At 10 orders/day, that is 5 minutes -- fine. At 50 orders/day, that is 25 minutes -- still manageable but should parallelize across brands.
2. **Second bottleneck: Printful API polling.** Each mockup needs ~60s to complete. At 12 products per order, sequential polling takes ~12 minutes per order. Parallelize by submitting all tasks first, then polling all at once.
3. **Third bottleneck: Manual approval.** At high volume, Luis approving every order becomes a bottleneck. Introduce auto-approve criteria (repeat customers, high illustration scores) with human review for edge cases.

## Build Order (Dependencies)

The components must be built in this order due to hard dependencies:

```
1. Brand Registry          ← foundation, everything depends on this
   │
2. Pipeline Parameterization  ← refactor existing scripts to read brand config
   │                            (proves multi-brand works with existing pipeline)
   │
3. Consent Tracker         ← can be built independently of production pipeline
   │
4. Consent Email Sender    ← depends on Brand Registry (templates) + Consent Tracker
   │
5. Consent Gate            ← connects Consent Tracker to Production Pipeline
   │
6. Order Selector          ← depends on Brand Registry (knows which OMS per brand)
   │
7. Batch Approver          ← depends on Order Selector output
   │
8. Gwen Orchestration      ← connects all components into daily autonomous run
   │
9. PopSmiths Integration   ← separate OMS source, different art storage
   │
10. TurnedComics Integration  ← hand-drawn art, printed add-ons (unique constraints)
```

**Rationale for this order:**
- **Brand Registry first** because every other component needs to read brand config.
- **Pipeline Parameterization second** because this is the highest-risk refactoring -- it touches the proven recipe. Getting this right early de-risks everything else. Test by producing a TY video from the parameterized pipeline and comparing to the existing output.
- **Consent before Order Selection** because consent is a hard legal requirement. Building order selection without consent would produce orders that cannot legally be used.
- **PopSmiths and TurnedComics last** because they have unique infrastructure (different OMS, different art types) that add complexity. Get the 3 shared-OMS brands working first (TY, MMJ, TW), then add the edge cases.

## Key Architectural Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Brand config format | JSON (not .conf) | Parseable by bash (`jq`), Node.js, and Python. Supports nested structures (product catalog, color schemes). Validatable with JSON schema. |
| Consent storage | JSON file (upgrade to SQLite later if needed) | Volume is low. JSON is debuggable, version-controllable, and requires no dependencies. |
| Pipeline scripts | Bash with `jq` for config reading | Matches existing codebase. No need to rewrite in Node.js/Python -- the proven ffmpeg/ImageMagick workflow is bash-native. |
| Order workspace naming | `{BRAND_PREFIX}-{order_id}/` (e.g., `TY-133627/`) | Prevents order ID collisions across brands. Makes Drive upload and video naming unambiguous. |
| Consent email delivery | Gmail API via existing Google integration | Already have Google Drive MCP. Gmail API uses the same auth. No need for a third-party email service at current scale. |
| PopSmiths asset path | Separate code path in asset download | PopSmiths' different art storage (own Heroku server) makes a unified OMS adapter impractical. Brand config's `oms_source` field routes to the correct download logic. |

## Sources

- Existing codebase analysis: `/Users/lcalderon/github/video-pipeline/` (all docs, scripts, build files)
- Existing brand configs: `~/clawd/agents/gwen/workspace/brand-configs/` (3 of 5 brands already configured)
- Existing codebase architecture: `/Users/lcalderon/github/video-pipeline/.planning/codebase/ARCHITECTURE.md`
- Existing integration map: `/Users/lcalderon/github/video-pipeline/.planning/codebase/INTEGRATIONS.md`
- PROJECT.md requirements and constraints: `/Users/lcalderon/github/video-pipeline/.planning/PROJECT.md`

---
*Architecture research for: multi-brand automated video production pipeline with consent management*
*Researched: 2026-02-26*
