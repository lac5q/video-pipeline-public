---
phase: 01-brand-config-and-pipeline-foundation
plan: 02
subsystem: pipeline
tags: [bash, ffmpeg, imagemagick, jq, video-build, parameterization]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Brand JSON configs and shared product catalog (products.json)"
provides:
  - "produce-video.sh CLI entrypoint parsing --brand/--order and orchestrating pipeline"
  - "scripts/build-video.sh parameterized video builder reading brand config via jq"
  - "scripts/verify-video.sh quality gate checking 1080x1920 h264 30fps via ffprobe"
  - "UGC (with reaction) and reels-only (without) build paths"
affects: [01-03, 02-consent, 03-production, 04-automation]

# Tech tracking
tech-stack:
  added: [ffprobe]
  patterns: [config-driven-build, dynamic-product-iteration, hex-color-conversion, reaction-detection]

key-files:
  created:
    - produce-video.sh
    - scripts/build-video.sh
    - scripts/verify-video.sh
  modified: []

key-decisions:
  - "Build script accepts args OR reads exported env vars from produce-video.sh (dual invocation)"
  - "Music selected randomly from brand pool at runtime"
  - "Photos discovered dynamically from workspace instead of hardcoded photo1/photo3/photo5"
  - "Reels-only builds skip reaction, photos, and reaction audio mixing entirely"

patterns-established:
  - "CLI entrypoint: produce-video.sh --brand SLUG --order ID orchestrates everything"
  - "Config loading: jq reads brand JSON, values exported as env vars for subscripts"
  - "Path abstraction: PIPELINE_ROOT auto-detected, all paths relative to it"
  - "Hex conversion: #RRGGBB stored in config, converted to 0xRRGGBB for ffmpeg"
  - "Product iteration: showcase order from products.json, only staged v11_*.png files included"
  - "Quality gate: verify-video.sh as standalone script, callable after any build"

requirements-completed: [BRAND-02, BRAND-05, QUAL-02, QUAL-05]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 2: Parameterized Pipeline Scripts Summary

**Config-driven produce-video.sh, build-video.sh, and verify-video.sh replacing all hardcoded TY values with jq-read brand config and dynamic product iteration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T07:52:54Z
- **Completed:** 2026-02-27T07:56:39Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created produce-video.sh CLI entrypoint that parses --brand/--order, loads brand config via jq, creates workspace, detects reaction video, and orchestrates build + verify
- Created scripts/build-video.sh as a fully parameterized version of build-ugc-v11.sh with zero hardcoded brand values -- every color, text, path, and product list driven by JSON config
- Created scripts/verify-video.sh quality gate checking 1080x1920, h264, ~30fps, and file size via ffprobe
- Dynamic product iteration from products.json showcase order, only including products with staged mockups (v11_*.png)
- Both UGC (with reaction video + photos + audio mixing) and reels-only (products + illustration only) build paths implemented

## Task Commits

Each task was committed atomically:

1. **Task 1: Create produce-video.sh CLI entrypoint and verify-video.sh quality gate** - `715dac0` (feat)
2. **Task 2: Create parameterized build-video.sh from proven build-ugc-v11.sh** - `1721f44` (feat)

## Files Created/Modified
- `produce-video.sh` - CLI entrypoint (250 lines): parses --brand/--order, loads config, creates workspace, orchestrates build + verify
- `scripts/build-video.sh` - Parameterized video builder (464 lines): reads brand config via jq, dynamic product iteration, UGC + reels paths
- `scripts/verify-video.sh` - Quality gate (89 lines): ffprobe checks for resolution, codec, fps

## Decisions Made
- Build script supports dual invocation: direct args or exported env vars from produce-video.sh (flexibility for testing and scripted use)
- Music randomly selected from brand pool at build time (provides variety across builds of same brand)
- Photos discovered dynamically from workspace directory instead of hardcoded photo1/photo3/photo5 names
- Reels-only mode skips reaction segment, customer photos, and reaction audio mixing (clean separation)
- Illustration is optional -- build continues without it if not present in workspace

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline scripts are ready for regression testing against TY-133627 (Plan 03)
- Brand config, product catalog, and build scripts form the complete parameterized pipeline
- Music files need to exist in brands/assets/music/ for audio mixing to work
- Logo files need to exist in brands/assets/logos/ for logo end card
- Existing TY build scripts in orders/133627/exports/ verified untouched

---
*Phase: 01-brand-config-and-pipeline-foundation*
*Completed: 2026-02-27*
