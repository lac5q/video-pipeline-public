# Video Pipeline — Multi-Brand Content Production System

## What This Is

An automated content production system that takes customer orders from five brands (TurnedYellow, MakeMeJedi, TurnedWizard, TurnedComics, PopSmiths), manages customer permission/consent, and produces publishable UGC and standard reel videos — uploaded to Google Drive with platform-specific social copy. Gwen (AI agent) runs the pipeline daily with minimal human oversight.

## Core Value

Any approved customer order from any brand becomes a publishable video without manual intervention — from consent request to Drive upload.

## Current Milestone: v2.0 Web Dashboard

**Goal:** Give Luis a visual control surface to browse illustrations, approve candidates, preview videos, and manage the full pipeline without touching the terminal.

**Target features:**
- Stage-gate Kanban view (Candidates → Consent → Ready → Video Review → Drive)
- Illustration thumbnail grid with visual quality inspection before approval
- In-browser video player with approve/reject for Drive upload
- Social copy panel (view per order, per platform)
- Pipeline trigger button with live progress stream
- Consent batch send from UI (no more CLI for consent)
- Drive folder verification and upload links
- Brand + status filter presets

## Requirements

### Validated (v1.0 — shipped)

<!-- Shipped and confirmed valuable. -->

- ✓ Printful/Gooten API mockup generation with OMS-correct parameters
- ✓ Gemini lifestyle staging of product mockups (proven recipe)
- ✓ ffmpeg video build pipeline (UGC + standard reels)
- ✓ Google Drive upload with folder structure
- ✓ Social copy doc generation (YouTube, TikTok, Instagram, X)
- ✓ TurnedYellow brand config and logo
- ✓ Music library with copyright-free tracks
- ✓ Product label overlays on video
- ✓ Multi-brand support (TY, MMJ, TurnedWizard, TurnedComics, PopSmiths)
- ✓ Brand config system (logo, colors, CTA text, product catalog per brand)
- ✓ Order candidate auto-selection and scoring
- ✓ Customer consent email system (branded, opt-in)
- ✓ Consent state tracking per order (SQLite)
- ✓ Batch approval CLI workflow
- ✓ Autonomous daily pipeline (Gwen, circuit breaker, checkpoints)
- ✓ Discord run summaries and circuit breaker alerts

### Active (v2.0)

<!-- Current scope. Building toward these. -->

- [ ] Visual stage-gate dashboard (5-lane Kanban: Candidates → Consent → Ready → Video Review → Drive)
- [ ] Illustration thumbnail grid per brand (visual candidate inspection)
- [ ] In-browser video player with approve/reject controls
- [ ] Consent batch send from dashboard (replaces CLI consent workflow)
- [ ] Social copy panel per order (view all 4 platforms without opening Drive)
- [ ] Pipeline trigger with live progress stream (replaces manual shell run)
- [ ] Drive folder links and upload verification per order
- [ ] Brand and status filter presets

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Auto-posting to social platforms — videos go to Drive, humans post (maintains quality control)
- Thumbnail generation — deferred to future milestone
- Real-time video editing UI — batch production is the model
- Customer-facing video delivery — videos are for brand marketing, not customer delivery
- Mobile app — desktop browser is sufficient for Luis's workflow

## Context

### Brand Family
Five brands share core infrastructure but differ in artistic focus:
- **TurnedYellow** — Simpsons-style family portraits (largest, most established)
- **MakeMeJedi** — Star Wars-style character illustrations
- **TurnedWizard** — Harry Potter-style wizard illustrations
- **TurnedComics** — Fan art focus, hand-drawn artist, sometimes printed add-ons
- **PopSmiths** — AI-generated art with credits, art discovery social features, stronger focus on framed products. Headless Shopify on Heroku, stores before/after art on its own server but uses POD OMS for ordering

### Infrastructure
- All brands use Shopify storefronts (PopSmiths is headless on Heroku)
- TY/MMJ/TW/TC use the shared OMS (turnedyellowordermanagement on Heroku) for photos + illustrations
- PopSmiths stores art on its own Heroku server but orders via POD OMS
- Product fulfillment via Printful and Gooten
- Gwen (MiniMax-M2.5) is the master orchestrator agent via OpenClaw
- Video assets on Wasabi S3 behind CloudFront

### Proven Pipeline (TurnedYellow)
The TY pipeline is proven and published (TY-133627, TY-130138, TY-207677). The pattern is:
1. Download order assets (photos, illustration, reaction video)
2. Generate pixel-perfect mockups via Printful/Gooten API
3. Stage mockups into lifestyle scenes via Gemini
4. Build video with ffmpeg (UGC or standard reels variant)
5. Upload to Google Drive with social copy docs

### Existing Scripts
- `produce-video.sh` — end-to-end orchestrator
- `download-order-assets.sh` — asset retrieval
- `generate-mockups.js` — Printful/Gooten API calls
- `stage-products.sh` — Gemini staging
- `build-brand-video.sh` — ffmpeg video build
- `swap-music.sh` — audio-only replacement
- Brand configs in `~/clawd/agents/gwen/workspace/brand-configs/`

## Constraints

- **Gemini API**: Non-deterministic, needs retry logic (up to 3x on FinishReason.OTHER)
- **Printful rate limits**: Must respect API rate limiting during batch processing
- **Customer consent**: MUST have explicit permission before featuring any order in marketing
- **Music licensing**: Only copyright-free tracks (NCS, LiQWYD, etc.) — no commercial licenses
- **Video specs**: 1080x1920 portrait, CRF 18, h264, 30fps (hard requirement)
- **Product accuracy**: Mockups must use OMS-correct position parameters (450x450 for apparel, orientation-aware for wall art)
- **Brand identity**: Each brand needs distinct logo, accent color, CTA text, and tone

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Printful → Gemini staging (not rembg/composite) | Products look natural in lifestyle scenes vs flat cutouts | ✓ Good |
| Web dashboard for visual approval (v2.0) | Luis requested visual control surface; existing dashboard.js (1,198 lines) extends cleanly | — Active |
| Email-based consent (not OMS flag only) | Professional, gives customers clear opt-in, creates paper trail | — Pending |
| Auto-suggest + batch approve (not fully auto) | Human judgment on order selection maintains quality | — Pending |
| All 5 brands in one system (not per-brand tools) | Shared infrastructure reduces maintenance, brand configs handle differences | — Pending |

---
*Last updated: 2026-03-01 — v2.0 Web Dashboard milestone started*
