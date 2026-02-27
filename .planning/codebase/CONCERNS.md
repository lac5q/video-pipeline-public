# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Massive Code Duplication Between Build Scripts:**
- Issue: `orders/133627/exports/build-ugc-v11.sh` and `orders/130138/exports/build-ugc-v1.sh` are ~95% identical (281 and 282 lines respectively). Functions `prepare_photo()`, `prepare_product()`, `make_segment()`, `make_product_segment()`, `add_music_with_reaction()`, label generation, logo card generation, and the entire concat/audio pipeline are copy-pasted verbatim.
- Files: `orders/133627/exports/build-ugc-v11.sh`, `orders/130138/exports/build-ugc-v1.sh`
- Impact: Every new order requires copying ~280 lines and manually changing ~10 variables. Bugs fixed in one script are not propagated to others. As orders grow, maintaining consistency becomes impossible.
- Fix approach: Extract shared functions into a `scripts/lib-ugc.sh` sourced by per-order scripts. Per-order scripts should only define variables (WORKSPACE, PRODUCT_FILES, PRODUCT_LABELS, hook text, reaction trim points, REACT_START/END) and call shared functions. The `docs/PIPELINE-GUIDE.md` already says "Copy an existing build script and modify it" -- this should become "Source the shared library and configure variables."

**Hardcoded Absolute Paths Throughout:**
- Issue: Both build scripts reference hardcoded absolute paths to a completely different directory tree (`/Users/lcalderon/clawd/agents/gwen/workspace/...`) rather than the repository's own `orders/` directory. The WORKSPACE, LOGO, and MUSIC_CANDY variables all point outside the repo.
- Files: `orders/133627/exports/build-ugc-v11.sh` (lines 7-15), `orders/130138/exports/build-ugc-v1.sh` (lines 8-16)
- Impact: Scripts are not portable -- they only run on one specific machine with one specific directory layout. They also reference a workspace path that is separate from the git repo, creating confusion about where the canonical assets live. The `docs/PIPELINE-GUIDE.md` shows the repo path (`/Users/lcalderon/github/video-pipeline/orders/${ORDER}`) but the actual scripts use a different path.
- Fix approach: Make WORKSPACE relative to the script location or the repo root. Use `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"` and derive paths from there. Accept WORKSPACE as a command-line argument or environment variable with a sensible default.

**Legacy Script Still in Repository:**
- Issue: `scripts/remove-bg-and-composite.py` is explicitly marked as "LEGACY -- replaced by Gemini staging" in `PROJECT.md` (line 24). The rembg approach was abandoned after v10/v11 failures (flat cutout look, white-on-white removal issues).
- Files: `scripts/remove-bg-and-composite.py`
- Impact: New contributors or future sessions may mistakenly use this script. It is the only Python script in the repo yet represents a dead-end approach.
- Fix approach: Either delete the script entirely (the git history preserves it) or move it to a `scripts/deprecated/` directory with a clear warning comment.

**Gemini Staging Script Not Actually in Repository:**
- Issue: `docs/PIPELINE-GUIDE.md` contains a full Python script for Gemini staging (`scripts/stage-with-gemini.py`, lines 569-698) embedded in documentation, but the actual file does not exist in the `scripts/` directory. The only script in `scripts/` is the legacy `remove-bg-and-composite.py`.
- Files: `docs/PIPELINE-GUIDE.md` (lines 567-699), `scripts/` directory
- Impact: The proven staging workflow requires manually copying ~130 lines of Python from a markdown file. This is error-prone and makes the script unversioned as an executable artifact.
- Fix approach: Extract the Gemini staging script from the documentation into `scripts/stage-with-gemini.py` as an actual executable file.

**`swap-music.sh` Referenced But Does Not Exist:**
- Issue: Both `docs/MUSIC-LIBRARY.md` (line 104) and `requirements/video-requirements.md` (line 55) reference `swap-music.sh` for quick audio-only changes, but this script does not exist anywhere in the repository.
- Files: `docs/MUSIC-LIBRARY.md`, `requirements/video-requirements.md`
- Impact: Users following documentation will fail when trying to swap music without a full rebuild. The 3-minute rebuild penalty for music changes persists.
- Fix approach: Create `scripts/swap-music.sh` that takes `--input`, `--music`, and `--output` arguments and uses ffmpeg to replace the audio track.

**Contradictory Documentation on Staging Approach:**
- Issue: `requirements/video-requirements.md` (lines 100-105) describes a workflow where Gemini generates EMPTY backgrounds and rembg is used for compositing. But `PROJECT.md` (lines 63-67), `docs/LESSONS-LEARNED.md` (lines 51-53), and `docs/PIPELINE-GUIDE.md` all describe passing Printful mockups directly to Gemini for staging. These are fundamentally different approaches.
- Files: `requirements/video-requirements.md` (lines 99-106), `PROJECT.md` (lines 63-67)
- Impact: Future sessions may follow the wrong approach depending on which document they read first. The requirements doc (which claims "NEVER BREAK THESE") describes the abandoned approach.
- Fix approach: Update `requirements/video-requirements.md` Step 2 to match the proven Gemini direct-staging approach documented everywhere else.

## Security Considerations

**Music Files in /tmp/:**
- Risk: `/tmp/brand-music/` is used for music storage but `/tmp/` is cleared on reboot (macOS) or periodically by system cleanup. `docs/MUSIC-LIBRARY.md` acknowledges this (line 11) but the build scripts still reference `/tmp/` paths.
- Files: `orders/133627/exports/build-ugc-v11.sh` (line 15), `orders/130138/exports/build-ugc-v1.sh` (line 16), `docs/MUSIC-LIBRARY.md` (line 9)
- Current mitigation: Documentation warns about the risk and provides yt-dlp re-download instructions.
- Recommendations: Move music to a persistent location outside `/tmp/` (e.g., `~/brand-music/` or a shared-assets directory). Alternatively, add a pre-flight check to build scripts that verifies music files exist before starting the build.

**API Keys Referenced in Multiple Locations:**
- Risk: `PROJECT.md` lists how to obtain API keys (Printful, Gooten, Gemini, Wasabi S3) via Heroku config and environment variables. The `docs/PIPELINE-GUIDE.md` shows inline `export GEMINI_API_KEY="your-key-here"` patterns that could lead to keys being pasted into shell history.
- Files: `PROJECT.md` (lines 108-111), `docs/PIPELINE-GUIDE.md` (lines 34-39, 703)
- Current mitigation: `.gitignore` excludes `.env` files. No actual key values are stored in the repo.
- Recommendations: Add a `scripts/setup-env.sh` that sources keys from a secure location (e.g., 1Password CLI, Heroku config) rather than manual export commands in documentation.

## Performance Bottlenecks

**Sequential Image Processing in Build Scripts:**
- Problem: Build scripts process all 12 product images sequentially with ImageMagick (each `prepare_product` call runs 3 `magick` commands). Similarly, all 12+ ffmpeg segment encodes run one at a time.
- Files: `orders/133627/exports/build-ugc-v11.sh` (lines 88-93, lines 218-225)
- Cause: Simple for-loops with no parallelism. Each `magick` and `ffmpeg` call waits for the previous one to complete.
- Improvement path: Use GNU `parallel` or `xargs -P` for image preparation and segment encoding. Product image prep and segment encoding are embarrassingly parallel -- all 12 products are independent. This could reduce build time from ~3 minutes to ~1 minute on a multi-core machine.

**No Caching of Intermediate Artifacts:**
- Problem: `rm -rf "${TMP}"` at the start of every build script deletes all intermediate files. If only the hook text or reaction trim changes, all 12 product images are re-prepared and re-encoded.
- Files: `orders/133627/exports/build-ugc-v11.sh` (line 22), `orders/130138/exports/build-ugc-v1.sh` (line 23)
- Cause: Simplicity of the bash-based pipeline -- no dependency tracking.
- Improvement path: Check if intermediate files already exist and skip re-processing. Use file modification timestamps or checksums to detect when source files have changed.

## Fragile Areas

**ffmpeg Audio Mixing with Shell Arithmetic Inside filter_complex:**
- Files: `orders/133627/exports/build-ugc-v11.sh` (lines 249-261), `orders/130138/exports/build-ugc-v1.sh` (lines 251-262)
- Why fragile: The `add_music_with_reaction()` function embeds `$(echo ... | bc | cut -d. -f1)` shell command substitutions INSIDE an ffmpeg filter_complex string. This mixes shell expansion, bc arithmetic, and ffmpeg filter syntax in a single multi-line string. Any quoting error silently produces wrong audio timing.
- Safe modification: The fallback (music-only) on line 265 catches ffmpeg failures, but the `if [ $? -eq 0 ]` check after a `2>/dev/null` redirect means ffmpeg errors are silently consumed. Remove `2>/dev/null` during development to see actual errors.
- Test coverage: No automated testing. Audio mixing correctness is verified only by manual playback.

**Hardcoded macOS Font Path:**
- Files: `orders/133627/exports/build-ugc-v11.sh` (lines 101, 113, 120, 136, 155), `orders/130138/exports/build-ugc-v1.sh` (same lines)
- Why fragile: Every ImageMagick text rendering command uses `-font "/System/Library/Fonts/HelveticaNeue.ttc"`. This path is macOS-specific and may change across macOS versions. The scripts will fail on any Linux or CI/CD environment.
- Safe modification: Define `FONT="/System/Library/Fonts/HelveticaNeue.ttc"` as a variable at the top of each script (or in a shared config) and use `${FONT}` throughout. For cross-platform support, detect the OS and fall back to a bundled font.
- Test coverage: None.

**Product File Array Must Match Label Array Exactly:**
- Files: `orders/133627/exports/build-ugc-v11.sh` (lines 59-86), `orders/130138/exports/build-ugc-v1.sh` (lines 60-87)
- Why fragile: `PRODUCT_FILES` and `PRODUCT_LABELS` are separate bash arrays that must have matching indices. Adding, removing, or reordering products in one array without updating the other produces mismatched labels (e.g., "Hoodie" label on a mug image). There is no validation that the arrays have the same length.
- Safe modification: Use an associative array or a JSON config file that pairs each product file with its label. The existing `v11_apparel_fix.json` pattern shows this approach is already partially adopted.
- Test coverage: None -- mismatch is only caught by visual inspection.

## Scaling Limits

**One Script Per Order:**
- Current capacity: 2 orders with build scripts (133627, 130138). 1 additional order mentioned (207677) that needs rebuilding.
- Limit: The copy-paste-modify approach breaks down at ~10 orders. Finding and updating common patterns (e.g., changing label font size, adjusting logo card layout) requires editing every script individually.
- Scaling path: Create a parameterized build system. Accept a JSON or YAML config per order that defines all variable inputs (paths, product list, hook text, reaction trim points). A single `scripts/build-ugc.sh` reads the config and produces the video.

**No Automation or Orchestration:**
- Current capacity: Each video is built manually by running a shell script after manually completing 4 prior phases (download, S3 upload, Printful API calls, Gemini staging).
- Limit: Building a video requires reading multiple documentation pages, running ~20 manual API calls, waiting for results, and verifying images before triggering the build. This takes 30-60 minutes of active work per order.
- Scaling path: `PROJECT.md` references an external orchestrator (`~/clawd/agents/gwen/workspace/produce-video.sh`) but it is not in this repository. Bringing orchestration into the repo would make the pipeline self-contained.

## Dependencies at Risk

**Gemini Model Version Pinned to Preview:**
- Risk: The pipeline depends on `gemini-3-pro-image-preview` (referenced in `docs/PIPELINE-GUIDE.md` line 563). Preview models are typically deprecated when the GA version ships. Google may remove this model without notice.
- Impact: All Gemini staging breaks. No new v11 mockups can be generated.
- Migration plan: Monitor Google AI Studio for model updates. Update the model string in `docs/PIPELINE-GUIDE.md` and any staging scripts when the GA version ships. Test that staging quality remains acceptable with the new model.

**rembg Dependency in Legacy Script:**
- Risk: `scripts/remove-bg-and-composite.py` depends on `rembg[cpu]>=2.0.0` which pulls in ONNX Runtime (~200MB). This is dead code.
- Impact: Minimal since the script is not used, but it may confuse dependency audits.
- Migration plan: Delete or deprecate the script.

## Missing Critical Features

**No Standard Reels Build Script:**
- Problem: `PROJECT.md` (lines 98-99) lists "standard reels TODO" for both active orders. The `requirements/video-requirements.md` (line 66) defines a "Standard Reels" structure (without reaction video) but no build script exists for this variant.
- Blocks: Cannot produce non-UGC video content. Every published video requires a customer reaction video, limiting which orders can be featured.

**No Automated Verification:**
- Problem: Every phase requires manual visual verification (checking mockups, staged images, final video). There is no programmatic validation (e.g., checking image dimensions, verifying all 12 products are present, validating video duration matches expected timing).
- Blocks: Cannot run the pipeline unattended. Human must inspect every intermediate output.

## Test Coverage Gaps

**No Tests Exist:**
- What's not tested: The entire codebase has zero automated tests. No unit tests, no integration tests, no smoke tests.
- Files: All `.sh` and `.py` files
- Risk: Any change to shared functions (`prepare_photo`, `prepare_product`, `make_segment`, `add_music_with_reaction`) could silently break video output. The only validation is manual playback of the final video.
- Priority: Medium -- the pipeline is small and manually operated, but as it grows, regressions will become harder to catch. Start with smoke tests that verify: (1) build script produces a video file, (2) video has expected dimensions and duration, (3) all expected segments are present in the concat file.

---

*Concerns audit: 2026-02-26*
