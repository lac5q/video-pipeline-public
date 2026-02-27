# Directory Structure -- Per-Order Workspace

This document describes the standard directory layout for each order in the video pipeline.

---

## Order Workspace Layout

```
orders/{order_id}/
    photos/                    Customer photos
        photo1.jpg             First customer photo
        photo2.jpg             Second customer photo
        photo3.jpg             (etc. -- typically 3-8 photos per order)
    illustration.jpg           The hand-drawn illustration (usually 4800x3600 landscape)
    {order_id}.mov             Reaction video from the customer (for UGC variant)
    mockups/                   Product mockup images
        v9_framed_poster.jpg   Printful-generated mockup (pixel-perfect, white bg)
        v9_canvas.jpg          Printful-generated mockup
        v9_tshirt.jpg          Printful-generated mockup
        v9_hoodie.jpg          Printful-generated mockup
        v9_sweatshirt.jpg      Printful-generated mockup
        v9_tanktop.jpg         Printful-generated mockup
        v9_mug.jpg             Printful-generated mockup
        v9_waterbottle.jpg     Printful-generated mockup
        v9_phonecase.jpg       Printful-generated mockup
        v9_totebag.jpg         Printful-generated mockup
        v9_blanket.jpg         Gooten-generated mockup
        v9_poster.jpg          Printful-generated mockup
        v11_framed_poster.png  Gemini-staged lifestyle scene (FINAL)
        v11_canvas.png         Gemini-staged lifestyle scene
        v11_tshirt.png         Gemini-staged lifestyle scene
        v11_hoodie.png         Gemini-staged lifestyle scene
        v11_sweatshirt.png     Gemini-staged lifestyle scene
        v11_tanktop.png        Gemini-staged lifestyle scene
        v11_mug.png            Gemini-staged lifestyle scene
        v11_waterbottle.png    Gemini-staged lifestyle scene
        v11_phonecase.png      Gemini-staged lifestyle scene
        v11_totebag.png        Gemini-staged lifestyle scene
        v11_blanket.png        Gemini-staged lifestyle scene
        v11_poster.png         Gemini-staged lifestyle scene
    exports/                   Build scripts and final videos
        build-ugc-v1.sh        Build script (versioned)
        TY-{order}-ugc-v1-candyland.mp4   Final video with Candyland music
    tmp_ugc_v1/                Temporary build files (safe to delete after build)
        orient_*.png           Auto-oriented photos
        bg_*.png               Blurred backgrounds
        fg_*.png               Foreground images
        prep_*.png             Prepared frames (photo on blurred bg)
        text/                  Pre-rendered label overlays
            label_0.png        Product label for first product
            label_1.png        ...etc
            reaction_bar.png   "Real customer reaction" overlay bar
        hook_beat1.png         Hook frame 1 (white text on black)
        hook_beat2.png         Hook frame 2 (white + gold text on black)
        logo_card.png          Logo end card
        seg_00_hook1.mp4       Individual video segments
        seg_01_hook2.mp4
        seg_02_reaction.mp4
        ...                    (one segment per photo, product, etc.)
        concat.txt             ffmpeg concat file list
        video_only.mp4         Concatenated video without audio
        reaction_audio.aac     Extracted reaction audio
    v11_apparel_fix.json       (optional) Config for rembg compositing (legacy)
```

---

## File Naming Conventions

### Mockup Versions
| Prefix | Meaning | Source |
|--------|---------|--------|
| `v9_` | Pixel-perfect product mockup, white background | Printful or Gooten API |
| `v11_` | Gemini-staged lifestyle scene | Gemini AI (using v9 as input) |
| `bg_` | Empty lifestyle background (no product) | Legacy approach -- not needed with current recipe |

### Video Versions
| Pattern | Meaning |
|---------|---------|
| `TY-{order}-ugc-v1-{music}.mp4` | UGC variant (with reaction video), version 1, specific music |
| `TY-{order}-reels-v1-{music}.mp4` | Standard reels (no reaction), version 1, specific music |

### Build Scripts
| Pattern | Meaning |
|---------|---------|
| `build-ugc-v{N}.sh` | UGC build script, version N |
| `build-reels-v{N}.sh` | Standard reels build script, version N |

---

## What Can Be Deleted

| Directory/File | Safe to Delete? | Notes |
|----------------|----------------|-------|
| `tmp_ugc_*` | YES | Temporary build artifacts, regenerated each build |
| `v9_*.jpg` | CAUTION | Can be regenerated from Printful API, but costs API calls |
| `v11_*.png` | NO -- BACK UP FIRST | Gemini outputs are non-deterministic; re-staging may produce different results |
| `exports/*.mp4` | CAUTION | Final videos; re-upload from Drive if needed |
| `exports/*.sh` | NO | Build scripts are the recipe; version-controlled in git |

---

## What Goes in Git vs What Does Not

### Tracked in Git (committed)
- `exports/*.sh` -- Build scripts
- `*.json` -- Config files
- All files in `docs/`, `scripts/`, `requirements/`, `research/`

### NOT Tracked (in .gitignore)
- `*.mp4`, `*.mov`, `*.mp3` -- Media files (too large)
- `*.jpg`, `*.jpeg`, `*.png` -- Image files (too large, too many)
- `tmp_*/` -- Temporary build directories
- `.DS_Store` -- macOS metadata
