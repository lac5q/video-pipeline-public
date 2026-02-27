# Product Catalog -- Printful and Gooten API Reference

**Purpose:** Complete reference for every product used in TurnedYellow video mockups, with exact API parameters that produce correct, non-warped results.

**Source:** OMS (`printful-helper.js`), Popsmiths (`mockup-generator.js`), and proven video pipeline builds.

---

## Quick Reference Table

| Product | Provider | Product ID | Variant ID | Placement | Position (WxH) | fill_mode | Special Notes |
|---------|----------|-----------|------------|-----------|----------------|-----------|---------------|
| Framed Poster | Printful | 2 | 4 | default | orientation-aware | cover | 4800x3600 (L) or 3600x4800 (P) |
| Canvas Print | Printful | 3 | 5 (P) / 7 (L) | default | orientation-aware | cover | OMS adds bleed borders (optional for video) |
| Poster Print | Printful | 1 | 2 | default | orientation-aware | cover | Unframed poster |
| T-Shirt | Printful | 71 | 4013 | front | 450x450 | -- | Wrinkled option; MUST use square |
| Hoodie | Printful | 146 | 5524 | front | 450x450 | -- | On Hanger option |
| Sweatshirt | Printful | 145 | 5428 | front | 450x450 | -- | |
| Tank Top | Printful | 248 | 8661 | front | 450x450 | -- | |
| Coffee Mug | Printful | 19 | 1320 | default | 1550x1050 | -- | MUST use "Front view" option |
| Water Bottle | Printful | 382 | 10798 | default | 2557x1582 | -- | |
| iPhone Case | Printful | 181 | 10994 | default | 879x1830 | -- | Rotate 270 for landscape illustrations |
| Samsung Case | Printful | 267 | 11347 | default | 936x1950 | -- | Rotate 270 for landscape illustrations |
| Tote Bag | Printful | 367 | 10458 | front | 1500x1500 | -- | Use "front" NOT "default" |
| Sticker | Printful | 358 | 10163 | default | 1275x1275 | -- | Square |
| Puzzle | Printful | 534 | 13431 | default | 4200x3300 | -- | |
| Greeting Card | Printful | 568 | 14457 | front | 1842x1240 | -- | |
| Throw Blanket | Gooten | -- | -- | -- | -- | -- | MAXFIT=TRUE; SKU below |
| Ornament | Gooten | -- | -- | -- | -- | -- | Rectangular acrylic; special crop coords |

---

## Detailed Product Specifications

### Wall Art

#### Framed Poster (Product 2)

```json
{
  "product_id": 2,
  "variant_ids": [4],
  "placement": "default",
  "fill_mode": "cover"
}
```

**Position (LANDSCAPE illustration):**
```json
{
  "area_width": 4800, "area_height": 3600,
  "width": 4800, "height": 3600, "top": 0, "left": 0
}
```

**Position (PORTRAIT illustration):**
```json
{
  "area_width": 3600, "area_height": 4800,
  "width": 3600, "height": 4800, "top": 0, "left": 0
}
```

**Notes:**
- `fill_mode: 'cover'` ensures aspect ratio is preserved (center-crops if needed)
- The OMS uses different dimensions based on illustration orientation -- this is critical
- Variant 4 = 12x16 inch

**Video quality:** Excellent. Wall art is one of the most visually impactful products.

---

#### Canvas Print (Product 3)

```json
{
  "product_id": 3,
  "variant_ids": [5],
  "placement": "default",
  "fill_mode": "cover"
}
```

**Position:** Same orientation-aware dimensions as Framed Poster.

**Notes:**
- The OMS adds bleed borders via `extendImage()` for fulfillment (gallery wrap edges)
- For video mockups, `fill_mode: 'cover'` without bleed extension works fine
- Variant 5 = portrait canvas, variant 7 = landscape canvas

**Video quality:** Excellent.

---

#### Poster Print (Product 1)

```json
{
  "product_id": 1,
  "variant_ids": [2],
  "placement": "default",
  "fill_mode": "cover"
}
```

**Position:** Same orientation-aware dimensions as Framed Poster.

**Notes:**
- Unframed poster
- OMS uses `fill_mode: 'fit'` for horizontal unframed poster (3600x2400) -- but for video mockups, use cover with the full dimensions
- Variant 2 = standard size

**Video quality:** Good. Less impactful than framed/canvas since there is no frame.

---

### Apparel

**ALL apparel uses 450x450 square position.** This is the OMS approach that prevents stretching of landscape illustrations.

#### T-Shirt (Product 71)

```json
{
  "product_id": 71,
  "variant_ids": [4013],
  "placement": "front",
  "option_groups": ["Wrinkled"],
  "position": {
    "area_width": 450, "area_height": 450,
    "width": 450, "height": 450, "top": 0, "left": 0
  }
}
```

**Notes:**
- Variant 4013 = White
- "Wrinkled" option makes the mockup look more realistic
- NEVER use 1800x2400 -- this stretches landscape illustrations

**Video quality:** Good. Gemini staging on a wooden table works well.

---

#### Hoodie (Product 146)

```json
{
  "product_id": 146,
  "variant_ids": [5524],
  "placement": "front",
  "option_groups": ["On Hanger"],
  "position": {
    "area_width": 450, "area_height": 450,
    "width": 450, "height": 450, "top": 0, "left": 0
  }
}
```

**Notes:**
- Variant 5524 = White
- "On Hanger" looks better than flat-lay for video

**Video quality:** Good. Retail store staging works well.

---

#### Sweatshirt (Product 145)

```json
{
  "product_id": 145,
  "variant_ids": [5428],
  "placement": "front",
  "position": {
    "area_width": 450, "area_height": 450,
    "width": 450, "height": 450, "top": 0, "left": 0
  }
}
```

**Notes:**
- Variant 5428 = White
- No special option_groups needed

**Video quality:** Good.

---

#### Tank Top (Product 248)

```json
{
  "product_id": 248,
  "variant_ids": [8661],
  "placement": "front",
  "position": {
    "area_width": 450, "area_height": 450,
    "width": 450, "height": 450, "top": 0, "left": 0
  }
}
```

**Notes:**
- Variant 8661

**Video quality:** Good. Summer shop staging works well.

---

### Accessories

#### Coffee Mug (Product 19)

```json
{
  "product_id": 19,
  "variant_ids": [1320],
  "placement": "default",
  "options": ["Front view"],
  "position": {
    "area_width": 1550, "area_height": 1050,
    "width": 1550, "height": 1050, "top": 0, "left": 0
  }
}
```

**CRITICAL:** The `"options": ["Front view"]` parameter is essential. Without it, the default view shows the handle side, blocking the artwork.

**Notes:**
- Variant 1320 = 11oz white mug
- The Popsmiths implementation uses 2700x1050 for full wrap -- the OMS uses 1550x1050 for front-only print
- For video mockups, 1550x1050 (front view) is better

**Video quality:** Excellent. Kitchen counter/breakfast table staging works great.

---

#### Water Bottle (Product 382)

```json
{
  "product_id": 382,
  "variant_ids": [10798],
  "placement": "default",
  "position": {
    "area_width": 2557, "area_height": 1582,
    "width": 2557, "height": 1582, "top": 0, "left": 0
  }
}
```

**Notes:**
- Popsmiths uses `contain` with white padding for this product
- For video mockups, sending the raw illustration works because Gemini staging will handle the scene

**Video quality:** Good.

---

#### iPhone Case (Product 181)

```json
{
  "product_id": 181,
  "variant_ids": [10994],
  "placement": "default",
  "position": {
    "area_width": 879, "area_height": 1830,
    "width": 879, "height": 1830, "top": 0, "left": 0
  }
}
```

**PRE-PROCESSING REQUIRED for landscape illustrations:**
The illustration MUST be rotated 270 degrees before sending to Printful. Upload the rotated version to S3 and use that URL.

```bash
magick illustration.jpg -rotate 270 illustration_rotated.jpg
```

**Notes:**
- Variant 10994
- Without rotation, a 4:3 landscape image gets stretched into the 1:2 phone case area -- extreme warping
- Portrait illustrations do NOT need rotation

**Video quality:** Good. Desk/coffee cup staging works well.

---

#### Samsung Case (Product 267)

```json
{
  "product_id": 267,
  "variant_ids": [11347],
  "placement": "default",
  "position": {
    "area_width": 936, "area_height": 1950,
    "width": 936, "height": 1950, "top": 0, "left": 0
  }
}
```

Same rotation requirement as iPhone case.

**Notes:** Typically skip this in favor of iPhone case to avoid two phone cases in the same video (category dedup rule).

---

#### Tote Bag (Product 367)

```json
{
  "product_id": 367,
  "variant_ids": [10458],
  "placement": "front",
  "position": {
    "area_width": 1500, "area_height": 1500,
    "width": 1500, "height": 1500, "top": 0, "left": 0
  }
}
```

**Notes:**
- Placement is `"front"`, NOT `"default"`
- Square 1500x1500 area -- landscape illustrations will be cropped to square
- Variant 10458

**Video quality:** Good.

---

#### Sticker (Product 358)

```json
{
  "product_id": 358,
  "variant_ids": [10163],
  "placement": "default",
  "position": {
    "area_width": 1275, "area_height": 1275,
    "width": 1275, "height": 1275, "top": 0, "left": 0
  }
}
```

**Notes:**
- Square format
- Not typically included in videos (less visually impactful)

---

### Gooten Products

#### Throw Blanket

```json
{
  "SKU": "Blanket-Velveteen-Single-FinishedEdge-50x60",
  "Template": "Single",
  "Images": [{
    "Image": {
      "Url": "ILLUSTRATION_URL",
      "MAXFIT": "TRUE"
    },
    "SpaceId": "FrontImage",
    "LayerId": "Design"
  }]
}
```

**Notes:**
- Gooten's `MAXFIT: "TRUE"` prevents all warping -- it fits the image within the product space while preserving aspect ratio
- The OMS pre-processes blankets with rotation (270 degrees) and resize for fulfillment, but for mockup preview, MAXFIT handles it
- Staging prompt MUST specify "draped flat on a bed" -- otherwise Gemini may show it standing upright

**Video quality:** Good when properly staged on a bed.

---

#### Ornament (Gooten)

```json
{
  "SKU": "AcrylicOrnaments-Rectangle-Single",
  "Template": "Single",
  "Images": [{
    "Image": {
      "Url": "ILLUSTRATION_URL",
      "MAXFIT": "TRUE",
      "X1": 677,
      "X2": 3152,
      "Y1": 72,
      "Y2": 1227
    },
    "SpaceId": "6BF16",
    "LayerId": "19605"
  }]
}
```

**Notes:**
- RECTANGULAR acrylic ornament, NOT circular
- The OMS uses specific crop coordinates to select a portion of the illustration
- Do NOT use Nano Banana Pro for ornament staging -- it generates circular Christmas ornaments (wrong shape)
- Not typically included in standard videos

---

## Products NOT Recommended for Videos

| Product | Reason |
|---------|--------|
| Socks (186) | Artwork gets heavily cropped into tall narrow format; hard to see illustration details |
| Second phone case | Category dedup -- one phone case is enough |
| Duplicate wall art | One framed + one canvas + one poster is already three wall art products |
| Ornament | Niche product, complex crop coordinates |
| Greeting Card (568) | Too small to show illustration details in video |

---

## The Standard 12 for Videos

These 12 products have been proven to work well together in the rapid-fire product showcase:

1. Framed Poster (wall art, premium feel)
2. Canvas Print (wall art, modern look)
3. T-Shirt (apparel, most popular)
4. Hoodie (apparel, cozy)
5. Sweatshirt (apparel, casual)
6. Tank Top (apparel, summer)
7. Coffee Mug (accessory, everyday use)
8. Water Bottle (accessory, active lifestyle)
9. Phone Case (accessory, tech)
10. Tote Bag (accessory, eco-friendly)
11. Throw Blanket (home, cozy)
12. Poster Print (wall art, affordable)

This selection covers all major categories without duplication and provides good visual variety in the video.
