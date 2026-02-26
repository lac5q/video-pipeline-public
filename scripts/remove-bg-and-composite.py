#!/usr/bin/env python3
"""
Remove white backgrounds from Printful mockups and composite onto lifestyle backgrounds.
Uses rembg for AI-powered background removal, PIL for compositing.

Usage:
    uv run --with "rembg[cpu]>=2.0.0" --with "pillow>=10.0.0" python3 scripts/remove-bg-and-composite.py \
        --mockups-dir /path/to/mockups \
        --config products.json

Config JSON format:
[
    {
        "mockup": "v9_framed_poster.jpg",
        "background": "bg_livingroom_wall.png",
        "output": "v11_framed_poster.png",
        "scale": 0.55,
        "position": "upper-center",
        "offset_y": -100
    }
]
"""
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageFilter, ImageEnhance
from rembg import remove


def remove_background(img: Image.Image) -> Image.Image:
    """Remove background from a product mockup image."""
    return remove(img)


def add_shadow(img: Image.Image, offset=(8, 8), blur=15, opacity=0.4) -> Image.Image:
    """Add a drop shadow behind a transparent image."""
    # Create shadow from alpha channel
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    alpha = img.split()[3]
    shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, int(255 * opacity)))
    shadow.paste(shadow_layer, mask=alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))

    # Create canvas big enough for shadow offset
    w = img.width + abs(offset[0]) + blur * 2
    h = img.height + abs(offset[1]) + blur * 2
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # Paste shadow then image
    sx = max(offset[0], 0) + blur
    sy = max(offset[1], 0) + blur
    canvas.paste(shadow, (sx, sy), shadow)

    ix = max(-offset[0], 0) + blur
    iy = max(-offset[1], 0) + blur
    canvas.paste(img, (ix, iy), img)

    return canvas


def composite_product(
    mockup_path: str,
    bg_path: str,
    output_path: str,
    scale: float = 0.6,
    position: str = "center",
    offset_x: int = 0,
    offset_y: int = 0,
    target_size: tuple = (1024, 1024),
) -> None:
    """Remove bg from mockup and composite onto lifestyle background."""
    print(f"  Processing {os.path.basename(mockup_path)}...")

    # Load and remove background
    mockup = Image.open(mockup_path).convert("RGBA")
    print(f"    Removing background...")
    cutout = remove_background(mockup)

    # Scale the cutout
    new_w = int(target_size[0] * scale)
    new_h = int(cutout.height * new_w / cutout.width)
    cutout = cutout.resize((new_w, new_h), Image.LANCZOS)

    # Add shadow
    cutout_with_shadow = add_shadow(cutout, offset=(6, 8), blur=12, opacity=0.35)

    # Load and resize background
    bg = Image.open(bg_path).convert("RGBA")
    bg = bg.resize(target_size, Image.LANCZOS)

    # Calculate position
    cw, ch = cutout_with_shadow.size
    bw, bh = bg.size

    if position == "upper-center":
        x = (bw - cw) // 2 + offset_x
        y = int(bh * 0.05) + offset_y
    elif position == "center":
        x = (bw - cw) // 2 + offset_x
        y = (bh - ch) // 2 + offset_y
    elif position == "lower-center":
        x = (bw - cw) // 2 + offset_x
        y = int(bh * 0.35) + offset_y
    else:
        x = (bw - cw) // 2 + offset_x
        y = (bh - ch) // 2 + offset_y

    # Composite
    bg.paste(cutout_with_shadow, (x, y), cutout_with_shadow)
    bg.convert("RGB").save(output_path, "PNG")
    print(f"    Saved: {output_path} ({os.path.getsize(output_path)} bytes)")


def main():
    parser = argparse.ArgumentParser(description="Remove backgrounds and composite products")
    parser.add_argument("--mockups-dir", required=True, help="Directory with mockups and backgrounds")
    parser.add_argument("--config", required=True, help="JSON config file")
    args = parser.parse_args()

    with open(args.config) as f:
        products = json.load(f)

    print(f"Processing {len(products)} products...")
    for p in products:
        mockup_path = os.path.join(args.mockups_dir, p["mockup"])
        bg_path = os.path.join(args.mockups_dir, p["background"])
        output_path = os.path.join(args.mockups_dir, p["output"])

        if not os.path.exists(mockup_path):
            print(f"  SKIP {p['mockup']}: not found")
            continue
        if not os.path.exists(bg_path):
            print(f"  SKIP {p['background']}: background not found")
            continue

        composite_product(
            mockup_path=mockup_path,
            bg_path=bg_path,
            output_path=output_path,
            scale=p.get("scale", 0.6),
            position=p.get("position", "center"),
            offset_x=p.get("offset_x", 0),
            offset_y=p.get("offset_y", 0),
        )

    print("Done!")


if __name__ == "__main__":
    main()
