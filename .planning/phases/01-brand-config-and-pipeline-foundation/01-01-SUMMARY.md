---
phase: 01-brand-config-and-pipeline-foundation
plan: 01
subsystem: config
tags: [json, brand-config, product-catalog, jq, printful, gooten]

# Dependency graph
requires: []
provides:
  - "5 brand JSON configs in brands/ with all brand-specific values"
  - "Shared product catalog (products.json) with 17 products and OMS-correct parameters"
  - "Two showcase orders (default, home_decor_first) for video product sequencing"
  - ".env.example documenting all required environment variables"
affects: [01-02, 01-03, 02-consent, 03-production]

# Tech tracking
tech-stack:
  added: [jq]
  patterns: [json-brand-config, shared-product-catalog, env-var-secrets]

key-files:
  created:
    - brands/turnedyellow.json
    - brands/makemejedi.json
    - brands/turnedwizard.json
    - brands/turnedcomics.json
    - brands/popsmiths.json
    - products.json
    - .env.example
  modified:
    - .gitignore

key-decisions:
  - "Drive folder IDs stored as empty placeholder in brand config (not secret per research)"
  - "TurnedComics and PopSmiths configs marked with _placeholder flag for Luis review"
  - "Samsung case excluded from video showcase orders (category dedup with iPhone case)"
  - "Blanket staging prompt explicitly requires 'draped flat on a bed' to prevent upright staging"
  - "Canvas has variant_id_landscape field (7) in addition to default variant_id (5) for orientation handling"

patterns-established:
  - "Brand config schema: name, slug, url, tagline, colors, logo, cta, hook_templates, music_pool, product_showcase_order, reaction_label, font, drive_folder_ids, oms_app"
  - "Product catalog: single products.json with showcase_orders defining display sequences"
  - "Secrets stay in env vars (.env.example documents them), never in JSON configs"
  - "Placeholder configs use _placeholder: true and _note fields for review tracking"

requirements-completed: [BRAND-01, QUAL-01, QUAL-03, QUAL-04]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 1: Brand Config and Product Catalog Summary

**5 brand JSON configs with all pipeline-driving values plus shared product catalog with 17 OMS-correct products and dual showcase orders**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T07:47:28Z
- **Completed:** 2026-02-27T07:50:08Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created all 5 brand configs (TY, MMJ, TW from existing .conf values; TC and PopSmiths as reviewed placeholders)
- Built shared product catalog with all 17 products, exact OMS-correct position parameters, and Gemini staging prompts
- Defined two showcase orders: default (standard 12 products) and home_decor_first (PopSmiths prioritizing wall art and home decor)
- Documented all required environment variables in .env.example without exposing secrets
- Existing TY build scripts in orders/133627/ and orders/130138/ verified untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Create brand JSON configs for all 5 brands** - `48c9b02` (feat)
2. **Task 2: Create shared product catalog and environment config** - `e80f8e9` (feat)

## Files Created/Modified
- `brands/turnedyellow.json` - TY brand config with colors, logo, CTA, hooks, music from existing .conf
- `brands/makemejedi.json` - MMJ brand config with Jedi-themed values from existing .conf
- `brands/turnedwizard.json` - TW brand config with wizard-themed values from existing .conf
- `brands/turnedcomics.json` - TC placeholder config marked for Luis review
- `brands/popsmiths.json` - PopSmiths config with home_decor_first showcase order, oms_app: null
- `products.json` - Shared catalog: 17 products with Printful/Gooten params, staging prompts, showcase orders
- `.env.example` - Documents PRINTFUL_API_KEY, GOOTEN_RECIPEID, GEMINI_API_KEY, AWS credentials
- `.gitignore` - Added per-order temp file exclusion, explicit brand/product JSON tracking

## Decisions Made
- Drive folder IDs are empty placeholders in brand configs (can be populated later, not secret per research)
- TurnedComics and PopSmiths marked with `_placeholder: true` for easy identification during review
- Samsung case set to `video_include: false` to avoid duplicate phone cases in showcase
- Canvas product includes `variant_id_landscape: 7` for orientation-aware variant selection
- Font path kept in brand config as `/System/Library/Fonts/HelveticaNeue.ttc` (can be overridden per brand)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Brand configs and product catalog ready for Plan 02 (parameterized build scripts)
- Build scripts can read all brand-specific values via jq from these JSON configs
- PopSmiths and TurnedComics configs need Luis review before production use (marked as placeholders)
- Music pool arrays are empty for MMJ, TW, TC, PopSmiths -- music files need to be selected

---
*Phase: 01-brand-config-and-pipeline-foundation*
*Completed: 2026-02-27*
