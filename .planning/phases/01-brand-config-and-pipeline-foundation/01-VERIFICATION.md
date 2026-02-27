---
phase: 01-brand-config-and-pipeline-foundation
verified: 2026-02-27T08:30:00Z
status: human_needed
score: 4/5 must-haves verified
re_verification: false
human_verification:
  - test: "Run full video build with staged TY-133627 assets and compare output visually to original"
    expected: "New pipeline produces video with correct hook text, reaction label, product labels, logo end card, colors, and no distortions -- visually matching the proven build-ugc-v11.sh output"
    why_human: "Staged mockups not available in new workspace path; video build cannot be tested end-to-end without them. Visual quality comparison requires human judgment."
  - test: "Verify PopSmiths and TurnedComics placeholder config values are reasonable"
    expected: "Colors, taglines, and CTA text are acceptable starting points for these brands"
    why_human: "Brand identity decisions require human/business judgment"
---

# Phase 1: Brand Config and Pipeline Foundation Verification Report

**Phase Goal:** Any brand's config can drive a correct, quality-validated video build without hardcoded values. Parameterized pipeline replaces hardcoded TY scripts. No regressions.
**Verified:** 2026-02-27T08:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running the pipeline with a brand name produces a video using that brand's logo, accent color, CTA text, and music -- not TurnedYellow defaults | ? UNCERTAIN | `produce-video.sh` loads all brand values from JSON via jq (lines 114-128). `build-video.sh` uses `$BRAND_NAME`, `$BRAND_ACCENT`, `$CTA_LINE1` etc. throughout (zero hardcoded TY values). However, no end-to-end video build was possible because staged mockups are not in the new workspace path. Config loading verified via dry run. |
| 2 | No hardcoded `/Users/lcalderon/` paths remain in any script -- all paths resolve from config or environment variables | VERIFIED | `grep -rn '/Users/lcalderon' produce-video.sh scripts/` finds only 4 references in `regression-test.sh` which are the grep search patterns themselves (not hardcoded paths). `produce-video.sh` uses `PIPELINE_ROOT` (12 references). Regression test check passed. |
| 3 | Every product uses OMS-correct position parameters (450x450 apparel, orientation-aware wall art, rotated phone cases, front-view mugs) with no distortions | VERIFIED | `products.json` confirms: tshirt/hoodie/sweatshirt/tanktop all 450x450; framed_poster/canvas/poster have `orientation_aware: true`; iphone_case/samsung_case have `requires_rotation: true, rotation_degrees: 270`; mug has `options: ["Front view"]`. All 17 products present with correct Printful/Gooten IDs. |
| 4 | All products are Gemini-staged into lifestyle scenes -- no raw Printful mockups appear | VERIFIED | `build-video.sh` line 93 checks for `v11_${pid}.png` staged mockups. Lines 107-112 fail the build if zero staged products found (`FAIL: No staged products found`). Staging prompts defined per product in `products.json`. |
| 5 | Video output meets spec (1080x1920, CRF 18, h264, 30fps, blurred background fill) and existing TY build scripts remain intact as backup | VERIFIED | `verify-video.sh` (89 lines) checks width=1080, height=1920, codec=h264, fps~30 via ffprobe. `build-video.sh` uses `-crf 18` and 1080x1920 constants. Old scripts preserved: `git diff HEAD -- orders/133627/ orders/130138/` shows 0 lines changed. Both `build-ugc-v11.sh` and `build-ugc-v1.sh` exist. |

**Score:** 4/5 truths verified (1 uncertain -- needs end-to-end build test)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `brands/turnedyellow.json` | TY brand config | VERIFIED | 41 lines, valid JSON, name=TurnedYellow, all required fields present |
| `brands/makemejedi.json` | MMJ brand config | VERIFIED | 34 lines, valid JSON, name=MakeMeJedi, all required fields present |
| `brands/turnedwizard.json` | TW brand config | VERIFIED | 34 lines, valid JSON, name=TurnedWizard, all required fields present |
| `brands/turnedcomics.json` | TC brand config (placeholder) | VERIFIED | 36 lines, valid JSON, name=TurnedComics, `_placeholder: true`, all required fields |
| `brands/popsmiths.json` | PopSmiths config with home_decor_first | VERIFIED | 36 lines, valid JSON, name=PopSmiths, `product_showcase_order: "home_decor_first"`, `oms_app: null` |
| `products.json` | 17 products with OMS-correct params | VERIFIED | 17 products, 2 showcase orders (default=12, home_decor_first=12), valid JSON |
| `.env.example` | Env var documentation | VERIFIED | Documents PRINTFUL_API_KEY, GOOTEN_RECIPEID, GEMINI_API_KEY, AWS creds, PIPELINE_ROOT, MUSIC_DIR |
| `produce-video.sh` | CLI entrypoint | VERIFIED | 250 lines, executable, --brand/--order/--skip-build/--help flags, jq config loading, PIPELINE_ROOT throughout |
| `scripts/build-video.sh` | Parameterized video builder | VERIFIED | 464 lines, executable, reads brand config via jq, dynamic product iteration from products.json, UGC + reels paths |
| `scripts/verify-video.sh` | Quality gate | VERIFIED | 89 lines, executable, ffprobe checks for resolution/codec/fps |
| `scripts/regression-test.sh` | Regression test runner | VERIFIED | 323 lines, executable, 15 checks across 6 categories, 12/12 passed (3 skipped -- no staged assets) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `produce-video.sh` | `brands/*.json` | jq reads brand config at startup | WIRED | Lines 114-128: `jq -r '.name' "$BRAND_CONFIG"` etc. (10+ jq calls) |
| `produce-video.sh` | `scripts/build-video.sh` | calls build script with config and workspace | WIRED | Line 209: `"${PIPELINE_ROOT}/scripts/build-video.sh" "${BRAND_CONFIG}" "${WORKSPACE}" "${PRODUCTS_CONFIG}"` |
| `scripts/build-video.sh` | `products.json` | jq reads product catalog for iteration | WIRED | Line 95: jq reads product label; Line 103: jq reads showcase order array |
| `scripts/verify-video.sh` | output video | ffprobe checks resolution/codec/fps | WIRED | Lines 30-33: ffprobe extracts width, height, codec, fps |
| `brands/*.json` | `products.json` | product_showcase_order references showcase_orders keys | WIRED | All brands reference "default" or "home_decor_first"; both keys exist in products.json showcase_orders |
| `scripts/regression-test.sh` | `produce-video.sh` | invokes pipeline for TY-133627 | WIRED | Line 152: `bash produce-video.sh --brand turnedyellow --order 133627 --skip-build` |
| `scripts/regression-test.sh` | `scripts/verify-video.sh` | runs quality gate on output | WIRED | Line 238: `bash "${PIPELINE_ROOT}/scripts/verify-video.sh" "$FINAL_VIDEO"` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BRAND-01 | 01-01 | Brand config system with JSON configs for all 5 brands | SATISFIED | 5 brand JSON configs in `brands/` with all required fields (name, slug, colors, logo, cta, hook_templates, music_pool, product_showcase_order, oms_app) |
| BRAND-02 | 01-02 | Brand-aware video build -- parameterized scripts read brand config | SATISFIED | `build-video.sh` has zero hardcoded TY values; all colors, text, paths read from brand JSON via jq |
| BRAND-05 | 01-02 | Path abstraction -- no hardcoded `/Users/lcalderon/` paths | SATISFIED | 0 hardcoded paths in produce-video.sh or scripts/ (regression test confirmed). PIPELINE_ROOT auto-detected. |
| QUAL-01 | 01-01 | Zero distortions -- OMS-correct position parameters per product | SATISFIED | products.json has 450x450 for apparel, orientation_aware for wall art, rotation for phone cases, Front view for mug |
| QUAL-02 | 01-02, 01-03 | All products Gemini-staged -- no raw mockups | SATISFIED | build-video.sh checks for v11_*.png staged files; fails build if zero found; staging prompts defined per product |
| QUAL-03 | 01-01 | Maximum product showcase | SATISFIED | Dynamic iteration includes all products with staged mockups; showcase orders define display sequence |
| QUAL-04 | 01-01, 01-03 | Preserve existing TY pipeline as backup | SATISFIED | `git diff HEAD -- orders/133627/ orders/130138/` shows 0 changes; both old scripts verified intact |
| QUAL-05 | 01-02, 01-03 | Video specs enforced (1080x1920, CRF 18, h264, 30fps) | SATISFIED | verify-video.sh checks all specs via ffprobe; build-video.sh uses -crf 18 and 1080x1920 constants |

No orphaned requirements found. All 8 requirement IDs from Phase 1 (BRAND-01, BRAND-02, BRAND-05, QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05) are accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | No TODO/FIXME/PLACEHOLDER/HACK found in any script | - | - |

No anti-patterns detected. All scripts are clean of placeholder code, empty implementations, or unfinished logic.

### Informational Notes

| Item | Details | Severity |
|------|---------|----------|
| Music pool empty for non-TY brands | MMJ, TW, TC, PopSmiths have empty `music_pool` arrays | Info -- will need music files before production builds for those brands |
| `.gitignore` missing music exclusion | Plan specified `brands/assets/music/*.mp3` should be gitignored for large binaries; not found in .gitignore | Info -- minor, music files likely not committed yet |
| 3 regression checks skipped | Video build, output comparison, and baseline checks skipped (no staged assets in new workspace path) | Info -- expected, requires manual staging of TY-133627 assets |

### Human Verification Required

### 1. End-to-End Video Build Test

**Test:** Stage TY-133627 mockups into `orders/turnedyellow/133627/mockups/` as `v11_*.png` files, then run `./produce-video.sh --brand turnedyellow --order 133627`. Compare output video to the original TY-133627 video produced by build-ugc-v11.sh.
**Expected:** New pipeline produces a video that is visually equivalent to the proven TY-133627 output -- correct hook text with gold accent, product labels with brand overlay, logo end card with CTA text, 1080x1920 portrait, no black bars, no distortions.
**Why human:** Staged mockup assets are not available in the new workspace path structure. Visual quality comparison between two videos requires human judgment (color accuracy, text readability, product presentation quality).

### 2. Placeholder Brand Config Review

**Test:** Review `brands/turnedcomics.json` and `brands/popsmiths.json` for reasonable starting values.
**Expected:** Colors, taglines, CTA text, and style descriptions are acceptable starting points for these brands.
**Why human:** Brand identity decisions (colors, messaging, tone) require business/design judgment that cannot be verified programmatically.

### Gaps Summary

No blocking gaps found. All 8 requirements are satisfied at the code/config level. All artifacts exist, are substantive, and are properly wired together.

The single uncertain truth (#1: running the pipeline with a brand name produces a video using that brand's values) is uncertain only because staged mockup assets are not present in the new workspace path to run an end-to-end video build. The code path is fully wired -- produce-video.sh loads brand config via jq, passes values to build-video.sh, which reads product catalog and iterates staged mockups. The dry run confirms config loading works correctly. A full video build test requires staging assets manually.

---

_Verified: 2026-02-27T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
