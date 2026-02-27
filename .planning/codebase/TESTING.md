# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:** None

No automated test framework is configured. There are no test files (`*.test.*`, `*.spec.*`, `test_*`) anywhere in the codebase.

**Assertion Library:** None

**Run Commands:**
```bash
# No test commands exist
```

## Current Verification Approach

Testing is entirely **manual and visual**. The pipeline produces media artifacts (images, videos) that require human review.

### Build Script Verification

Build scripts self-report progress via `echo` statements. Verification is done by:

1. **Watching console output** for errors (scripts use `set -euo pipefail` to fail fast)
2. **Checking file existence and size** after build:
   ```bash
   ls -lh "${EXPORTS}/TY-${ORDER}-ugc-v11-"*.mp4
   ```
3. **Inspecting video properties** with ffprobe:
   ```bash
   ffprobe -v quiet -print_format json -show_format -show_streams "${EXPORTS}/TY-${ORDER}-ugc-v1-candyland.mp4"
   # Expected: 1080x1920, ~24-28s, h264, aac
   ```

### Visual Verification Checklists

**Post-mockup generation (Phase 3)** -- documented in `docs/PIPELINE-GUIDE.md`:
- Illustration appears exactly as the original (no warping, no artifacts)
- Faces/details match the original illustration
- Products look properly proportioned
- Mug shows front view (not handle side)
- Phone case has correct orientation

**Post-staging (Phase 4)** -- documented in `docs/PIPELINE-GUIDE.md`:
- Product appears in a realistic, attractive setting
- Illustration on the product is recognizable (faces, colors, details)
- No floating/pasted-on look -- product has natural shadows and lighting
- Blanket is draped on a bed (NOT standing upright)
- No extra fingers, duplicate faces, or other AI artifacts

**Post-build (Phase 5)** -- documented in `docs/PIPELINE-GUIDE.md`:
- Hook text is readable and punchy
- Reaction video plays smoothly with mixed audio
- Photos look good with blurred backgrounds
- Illustration is crisp
- ALL 12 products have visible labels
- Products are in attractive lifestyle settings
- Logo end card displays correctly
- Music ducks during reaction and fades at end
- No black bars, no stretching, no jitter

## Error Detection

**Runtime errors** are caught by:
- `set -euo pipefail` in Bash scripts -- any non-zero exit halts the script
- File existence checks before processing:
  ```bash
  if not os.path.exists(mockup_path):
      print(f"  SKIP {p['mockup']}: not found")
      continue
  ```

**Fallback handling** for audio mixing in build scripts:
```bash
if [ $? -eq 0 ]; then
    echo "  Saved: ${output}"
else
    echo "  WARNING: Mixed audio failed, falling back to music-only..."
    # Simplified ffmpeg command without reaction audio mixing
fi
```

**API retry** for Gemini staging (from `docs/PIPELINE-GUIDE.md`):
```python
MAX_RETRIES = 3
for attempt in range(1, MAX_RETRIES + 1):
    try:
        response = client.models.generate_content(...)
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                result = PILImage.open(BytesIO(part.inline_data.data))
                result.convert("RGB").save(output_path, "PNG")
                return True
        print(f"  No image in response (attempt {attempt})")
    except Exception as e:
        print(f"  Error (attempt {attempt}): {e}")
    if attempt < MAX_RETRIES:
        time.sleep(5)
```

## Mocking

**Framework:** None
**Patterns:** Not applicable -- no automated tests exist

## Fixtures and Factories

**Test Data:** Not applicable -- no automated tests exist

The codebase uses real customer order data (photos, illustrations, reaction videos) stored in `orders/{order_id}/` directories. Media files are excluded from git via `.gitignore`.

## Coverage

**Requirements:** None enforced
**Tools:** None configured

## Test Types

**Unit Tests:** None

**Integration Tests:** None

**E2E Tests:** None

**Manual Smoke Tests:** The only testing performed is running the build script end-to-end and visually inspecting the output video. This is documented as verification checklists in `docs/PIPELINE-GUIDE.md`.

## What Could Be Tested (Recommendations)

**Bash script validation (shellcheck):**
- All build scripts in `orders/*/exports/build-ugc-*.sh`
- The `scripts/` directory

**Python unit tests for `scripts/remove-bg-and-composite.py`:**
- `add_shadow()` -- verify output dimensions include shadow offset
- `composite_product()` position calculations -- verify `upper-center`, `center`, `lower-center`
- Config loading and validation

**Video property assertions (post-build):**
```bash
# Could be automated with ffprobe
ffprobe -v quiet -show_entries stream=width,height,codec_name -of csv=p=0 output.mp4
# Assert: 1080,1920,h264
```

**Image dimension checks (post-staging):**
```bash
# Verify all v11 images exist and are reasonable size
for f in mockups/v11_*.png; do
    magick identify "$f"  # Should be ~1024x1024
done
```

**JSON config validation:**
- Verify all referenced mockup files exist
- Verify position values are valid enum members

## Test File Organization

**Location:** No test directory exists

**If tests were added, follow this structure:**
```
tests/
    test_composite.py          # Unit tests for remove-bg-and-composite.py
    test_build_validation.sh   # Post-build ffprobe assertions
    test_config_schema.py      # JSON config validation
```

---

*Testing analysis: 2026-02-26*
