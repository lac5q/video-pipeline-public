# Phase 1: Brand Config and Pipeline Foundation - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Parameterize the proven TurnedYellow video pipeline so any brand's config drives a correct, quality-validated video build without hardcoded values. Create the brand config system, abstract hardcoded paths, enforce quality safeguards (distortion-free mockups, Gemini staging, video specs). Existing TY build scripts remain intact as backup — new pipeline is side-by-side.

</domain>

<decisions>
## Implementation Decisions

### Config Structure
- One JSON file per brand in a `brands/` directory inside the video-pipeline repo (e.g., `brands/turnedyellow.json`, `brands/makemejedi.json`)
- Pipeline repo is self-contained — carries its own configs (not in clawd workspace)
- Each brand config includes: logo path, accent color, CTA text, music pool (list of tracks), video tone/style (hook templates, pacing), Google Drive folder IDs, OMS/API endpoint identifiers
- Existing .conf files in ~/clawd/agents/gwen/workspace/brand-configs/ will be superseded by these JSON configs

### Secrets and Sensitive Values
- Claude's Discretion — pick the best security approach for API keys, Drive folder IDs, and other sensitive values (env vars vs config)

### Product Catalog
- All 17 products from PRODUCT-CATALOG.md are shared across all 5 brands — same product set everywhere
- Same Printful/Gooten position parameters for all brands (450x450 for apparel, orientation-aware for wall art, rotated phone cases, front-view mugs)
- Product catalog is defined ONCE (not per-brand) since params are identical
- PopSmiths video showcase order prioritizes home decor (canvas, framed print, poster) over apparel — the product catalog is the same but the video display order differs
- PopSmiths customers want art for the home primarily; a few other items appear but aren't the main sellers

### Pipeline Invocation
- CLI: `./produce-video.sh --brand makemejedi --order 12345` (brand + order ID, both required)
- Per-order workspaces live inside the video-pipeline repo: `orders/{brand}/{order_id}/`
- Produces both UGC and standard reels when a reaction video exists; reels-only when no reaction video
- No separate --type flag needed — auto-detects based on available assets

### Migration Strategy
- Side-by-side: new parameterized scripts go in `scripts/`, old TY scripts stay in `orders/{id}/exports/` untouched
- Phase 1 includes a regression test: run the new pipeline on known TY orders (133627, 130138) and compare output quality to existing published videos
- Old TY scripts retire after Phase 1 passes regression test — not before

### Claude's Discretion
- Secrets handling approach (env vars vs config file exclusion)
- Internal script architecture (how brand config gets passed between pipeline stages)
- Exact JSON schema field names and structure
- How regression comparison is performed (frame-by-frame, visual spot check, file size/duration comparison)

</decisions>

<specifics>
## Specific Ideas

- Use the existing TY-133627 and TY-130138 published videos as the regression baseline — the new pipeline must produce output of equal or better quality on these same orders
- The proven recipe is: Printful API → Gemini staging → ffmpeg build. This must not change — only the hardcoded TY values get parameterized
- Mug must always use "Front view" option, blanket must always be Gemini-staged (draped, never flat)
- PopSmiths showcase order: canvas > framed print > poster > blanket > mug > apparel > accessories (home decor first, then everything else)
- All other brands use the current showcase order from the existing pipeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-brand-config-and-pipeline-foundation*
*Context gathered: 2026-02-26*
