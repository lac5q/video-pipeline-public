# Coding Conventions

**Analysis Date:** 2026-02-26

## Languages

**Primary: Bash**
- All video build scripts are written in Bash
- Location: `orders/{order_id}/exports/build-ugc-*.sh`

**Secondary: Python 3**
- Utility scripts for image processing
- Location: `scripts/remove-bg-and-composite.py`
- Inline script in `docs/PIPELINE-GUIDE.md` (`scripts/stage-with-gemini.py`)

**Configuration: JSON**
- Product compositing configs
- Location: `orders/{order_id}/*.json` (e.g., `orders/133627/v11_apparel_fix.json`)

## Naming Patterns

**Files:**
- Build scripts: `build-{variant}-v{N}.sh` (e.g., `build-ugc-v11.sh`, `build-ugc-v1.sh`)
- Python scripts: `kebab-case.py` (e.g., `remove-bg-and-composite.py`)
- Final videos: `TY-{order_id}-{variant}-v{N}-{music}.mp4` (e.g., `TY-133627-ugc-v11-candyland.mp4`)
- Mockup source images: `v9_{product}.jpg` (Printful/Gooten pixel-perfect)
- Staged images: `v11_{product}.png` (Gemini lifestyle scenes)
- Temporary files: `prep_*.png`, `seg_*.mp4`, `hook_*.png`, `label_*.png`

**Bash Variables:**
- Use UPPER_SNAKE_CASE for constants and configuration: `WORKSPACE`, `MOCKUPS`, `BRAND_DARK`, `FPS`
- Use lowercase for loop variables and local function parameters: `local input="$1"`, `local tag="$3"`

**Bash Functions:**
- Use snake_case: `prepare_photo()`, `prepare_product()`, `make_segment()`, `make_product_segment()`, `add_music_with_reaction()`
- Descriptive, verb-first naming

**Python Functions:**
- Use snake_case: `remove_background()`, `add_shadow()`, `composite_product()`
- Type hints on parameters and return types

**Python Variables:**
- Use snake_case: `mockup_path`, `bg_path`, `output_path`, `target_size`

## Code Style

**Formatting:**
- No formatter enforced for Bash or Python
- Bash scripts use 4-space indentation
- Python scripts use 4-space indentation (PEP 8 style)

**Linting:**
- No linting tools configured (no `.eslintrc`, `.flake8`, `.pylintrc`, `ruff.toml`, etc.)
- Code quality relies on manual review and documentation

## Bash Script Structure

**Every build script follows this exact pattern:**

1. **Shebang and header comment** describing order, structure, and timing
2. **`set -euo pipefail`** for strict error handling
3. **Variable declarations** (workspace paths, brand constants, video specs)
4. **Cleanup** (`rm -rf "${TMP}"` then `mkdir -p`)
5. **Helper functions** (`prepare_photo`, `prepare_product`, etc.)
6. **Image preparation** (photos, illustration, products)
7. **Label generation** (ImageMagick text overlays)
8. **Hook frame creation** (text-on-black images)
9. **Reaction video processing** (ffmpeg trim, overlay, audio extract)
10. **Logo end card** (ImageMagick composite)
11. **Segment generation** (each image to short mp4 clip)
12. **Concatenation** (ffmpeg concat demuxer)
13. **Audio mixing** (music ducking + reaction audio)
14. **Done message** with file listing

**Template:** Use `orders/133627/exports/build-ugc-v11.sh` as the canonical reference for new build scripts.

## Bash Conventions

**Strict mode:**
```bash
set -euo pipefail
```
Use this at the top of every build script. Never omit it.

**Quoting:**
- Always double-quote variable expansions: `"${WORKSPACE}"`, `"${TMP}/file.png"`
- Use `${VAR}` brace syntax, not bare `$VAR`

**Progress output:**
- Use `echo "=== Section Name ==="` for major phases
- Use `echo "  Step description..."` for individual steps (2-space indent)
- Print file sizes after saving: `echo "    Saved: ${output_path} ($(os.path.getsize(output_path)) bytes)"`

**ffmpeg stderr suppression:**
- Redirect ffmpeg stderr to `/dev/null`: `ffmpeg -y ... 2>/dev/null`
- Always use `-y` flag to overwrite without prompting

**Segment naming:**
- Use zero-padded sequential index: `printf -v seg_name "seg_%02d_%s" "${SEG_IDX}" "${name}"`
- Append each segment to concat list: `echo "file '${TMP}/${seg_name}.mp4'" >> "${TMP}/concat.txt"`

**Array iteration:**
```bash
for i in "${!PRODUCT_FILES[@]}"; do
    file="${PRODUCT_FILES[$i]}"
    label="${PRODUCT_LABELS[$i]}"
    # ...
done
```

## Python Conventions

**Module docstrings:**
- Include purpose, usage example, and config format at top of file
- See `scripts/remove-bg-and-composite.py` lines 1-22 for the pattern

**Argument parsing:**
- Use `argparse` for CLI scripts
- Use `sys.argv` for simpler scripts (staging script in docs)

**File path handling:**
- Mix of `os.path` and `pathlib.Path` (Python script uses `os.path`, staging script uses `pathlib.Path`)
- For new code: prefer `pathlib.Path`

**Image handling:**
- Use PIL/Pillow for image manipulation
- Always convert to RGBA for compositing: `.convert("RGBA")`
- Save final output as PNG: `.convert("RGB").save(output_path, "PNG")`

**Error handling in Python:**
```python
# Skip missing files with a warning
if not os.path.exists(mockup_path):
    print(f"  SKIP {p['mockup']}: not found")
    continue
```

**Retry pattern (Gemini API):**
```python
MAX_RETRIES = 3
for attempt in range(1, MAX_RETRIES + 1):
    try:
        # API call
        return True
    except Exception as e:
        print(f"  Error (attempt {attempt}): {e}")
    if attempt < MAX_RETRIES:
        time.sleep(5)
```

## Error Handling

**Bash:**
- `set -euo pipefail` stops on any error
- Explicit file existence checks before processing:
  ```bash
  if not os.path.exists(mockup_path):
      print(f"  SKIP {p['mockup']}: not found")
      continue
  ```
- Fallback patterns for audio mixing:
  ```bash
  if [ $? -eq 0 ]; then
      echo "  Saved: ${output}"
  else
      echo "  WARNING: Mixed audio failed, falling back to music-only..."
      # Simplified fallback command
  fi
  ```

**Python:**
- Broad `except Exception as e` for API calls with retry
- `continue` to skip missing files rather than failing

## Logging

**Framework:** `print()` / `echo` (no logging framework)

**Patterns:**
- Phase markers: `echo "=== Phase Name ==="` (Bash) or `print(f"Processing {len(products)} products...")` (Python)
- Step progress: `echo "  Step description..."` with 2-space indent
- Completion: `echo "Done!"` or `echo "=== DONE ==="`
- File output confirmation: Print path and size after saving

## Comments

**Bash:**
- Header comment block: order number, variant, product count, structure with timing
- Section separators: `# === Section Name ===`
- Inline comments for non-obvious parameters: `# Trim reaction: start at 2s, take 8s`

**Python:**
- Module-level docstring with usage instructions
- Function docstrings (one-line): `"""Remove background from a product mockup image."""`
- Inline comments for complex operations

## Import Organization (Python)

**Order:**
1. Standard library (`argparse`, `json`, `os`, `sys`, `time`)
2. Blank line
3. Third-party packages (`PIL`, `rembg`, `google.genai`)

**Example from `scripts/remove-bg-and-composite.py`:**
```python
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageFilter, ImageEnhance
from rembg import remove
```

## JSON Configuration

**Structure:** Arrays of product objects with these fields:
```json
{
    "mockup": "v9_tshirt.jpg",
    "background": "bg_wooden_table.png",
    "output": "v11_tshirt.png",
    "scale": 1.0,
    "position": "center",
    "offset_y": -20
}
```

**Conventions:**
- Use snake_case for keys
- File names reference the product type
- Optional fields use defaults in code: `p.get("scale", 0.6)`

## Video Encoding Conventions

**Always use these ffmpeg parameters for consistency:**
```bash
-c:v libx264 -crf 18 -preset fast -r 30 -pix_fmt yuv420p  # Video
-c:a aac -b:a 192k                                          # Audio
```

**Resolution:** 1080x1920 (portrait 9:16) -- stored as variables `W=1080`, `H=1920`

**Color format:** Use `0x` prefix for ffmpeg hex colors, `#` prefix for ImageMagick hex colors

## Brand Constants

**Always define these at the top of build scripts:**
```bash
BRAND_DARK="0x1a1a2e"
W=1080
H=1920
FPS=30
```

---

*Convention analysis: 2026-02-26*
