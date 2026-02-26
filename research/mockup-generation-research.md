# Mockup Generation Research — TurnedYellow OMS, Popsmiths, and Video Pipeline

**Date:** 2026-02-26
**Scope:** Deep analysis of how product mockups are generated across three codebases, with focus on illustration warping/distortion prevention.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Printful Mockup Generation API](#printful-mockup-generation-api)
3. [Gooten Mockup Generation API](#gooten-mockup-generation-api)
4. [OMS (TurnedYellow) Implementation](#oms-turnedyellow-implementation)
5. [Popsmiths Implementation](#popsmiths-implementation)
6. [Video Pipeline generate-mockups.js](#video-pipeline-generate-mockupsjs)
7. [Image Pre-Processing Pipeline](#image-pre-processing-pipeline)
8. [Position Object Deep Dive](#position-object-deep-dive)
9. [Warping/Distortion Analysis](#warpingdistortion-analysis)
10. [Product Reference Table](#product-reference-table)
11. [Key Findings and Recommendations](#key-findings-and-recommendations)

---

## 1. Executive Summary

All three systems use the same two APIs (Printful Mockup Generator and Gooten Product Preview) but handle image preprocessing very differently. The critical insight is:

**Printful does NOT resize or fit your image for you.** When you set `width=area_width` and `height=area_height` (full-bleed), Printful stretches your image to fill the entire print area. The `fill_mode` parameter (`cover` or `fit`) only applies when `width < area_width` or `height < area_height`.

The OMS prevents warping through **preprocessing the image with Sharp before sending it to the API**. This is the critical step that the video pipeline `generate-mockups.js` is MISSING for many products.

---

## 2. Printful Mockup Generation API

### Endpoint

```
POST https://api.printful.com/mockup-generator/create-task/{productId}
```

### Request Body Structure

```json
{
  "variant_ids": [4013],
  "format": "jpg",
  "option_groups": ["Wrinkled"],
  "files": [
    {
      "placement": "front",
      "image_url": "https://...",
      "fill_mode": "cover",
      "position": {
        "area_width": 1800,
        "area_height": 2400,
        "width": 1800,
        "height": 2400,
        "top": 0,
        "left": 0
      }
    }
  ]
}
```

### Polling Endpoint

```
GET https://api.printful.com/mockup-generator/task?task_key={taskKey}
```

### The `position` Object Explained

| Field | Meaning |
|-------|---------|
| `area_width` | Total available print area width (px) — defined by the product template |
| `area_height` | Total available print area height (px) — defined by the product template |
| `width` | How wide the image should be placed within the area |
| `height` | How tall the image should be placed within the area |
| `top` | Vertical offset from top of area |
| `left` | Horizontal offset from left of area |

**Critical rule:** When `width == area_width` AND `height == area_height`, the image fills the ENTIRE print area. Printful will STRETCH the image to fit, regardless of its native aspect ratio.

### The `fill_mode` Parameter

| Value | Behavior |
|-------|----------|
| `cover` | Image covers the entire position area, cropping excess. Preserves aspect ratio. |
| `fit` | Image fits within the position area, may have empty space. Preserves aspect ratio. |
| (omitted) | Image is stretched to fill the exact `width` x `height` specified. **CAN WARP.** |

**IMPORTANT:** `fill_mode` only works when the image does NOT match the position dimensions. If you pre-resize the image to exactly match `width x height`, `fill_mode` has no effect because Printful has nothing to "fit" or "cover" -- the image already matches.

### The `placement` Parameter

| Value | Use Case |
|-------|----------|
| `default` | Wall art (posters, canvas, framed), phone cases, socks, stickers, blankets, water bottles, puzzles |
| `front` | Apparel (t-shirts, hoodies, sweatshirts, tank tops), tote bags, greeting cards |

---

## 3. Gooten Mockup Generation API

### Endpoint

```
POST https://api.print.io/api/v/5/source/api/productpreview?recipeid={GOOTEN_RECIPEID}
```

### Request Body Structure

```json
{
  "SKU": "Blanket-Velveteen-Single-FinishedEdge-50x60",
  "Template": "Single",
  "Images": [
    {
      "Image": {
        "Url": "https://...",
        "MAXFIT": "TRUE"
      },
      "SpaceId": "FrontImage",
      "LayerId": "Design"
    }
  ]
}
```

### The `MAXFIT` Parameter

When `MAXFIT: "TRUE"`, Gooten fits the image within the product space while preserving aspect ratio. This is Gooten's built-in warping prevention -- it NEVER stretches the image.

### Gooten Product Configurations (from OMS)

| Product | SKU | SpaceId | LayerId | Coord Area |
|---------|-----|---------|---------|------------|
| Ornament | `AcrylicOrnaments-Rectangle-Single` | `6BF16` | `19605` | 0,0 to 1400,1200 |
| Throw Pillow 18x18 | `ThrowPillow-PolyTwill-18x18-Zippered` | `61107` | `7618A` | 0,0 to 3900,3900 |
| Laptop Sleeve 13" | `LaptopSleeve-13` | `3FFAF` | `C2385` | 0,0 to 4125,3000 |
| Mousepad | `Mousepad-779x925` | `17F7A` | `4A16F` | 0,0 to 2925,2475 |
| Kids T-Shirt | `ApparelTee-DTG-YouthApparelTee-Gildan-5000B-M-White-CF` | `DE4F1` | `92C25` | 0,0 to 8300,7568 |
| Kids Hoodie | `ApparelHoodie-DTG-YouthApparelHoodie-Gildan-18500B-M-White-CF` | `D45E3` | `74CA5` | 0,0 to 10200,9305 |
| Blanket 50x60 | `Blanket-Velveteen-Single-FinishedEdge-50x60` | `FrontImage` | `Design` | N/A |
| Puzzle 10x14 | `Puzzle-10x14` | `FrontImage` | `Design` | N/A |

### Ornament Mockup — Special Case

The OMS has a separate `generateOrnamentMockup` function with explicit crop coordinates:

```javascript
// gooten.helper.js — line 349-371
Images: [{
  Image: {
    Url: illustrationURL,
    MAXFIT: 'TRUE',
    X1: 677,
    X2: 3152,
    Y1: 72,
    Y2: 1227,
  }
}]
```

This crops a specific region of the illustration for the ornament, rather than using the full image.

---

## 4. OMS (TurnedYellow) Implementation

**File:** `/Users/lcalderon/github/OMS/server/helpers/printful-helper.js`

### Architecture Overview

The OMS generates mockups in a queue-based system:
1. `mockup-queue.helper.js` manages a MongoDB-backed queue
2. When an order is ready, `getMockupUrls()` is called
3. It creates Printful tasks for ALL products in parallel
4. Each product has its own function with hardcoded position parameters
5. After task creation, it waits 60 seconds then polls all tasks

### How OMS Determines Orientation

```javascript
// mockup-queue.helper.js — line 142-143
const { mockups, additionalMockups } = await printfulHelper.getMockupUrls(
  illustartion.url,
  true,
  false,
  illustartion.height > illustartion.width  // isVertical flag
);
```

The `isVertical` flag is determined by comparing the illustration's `height` vs `width` properties stored in the database.

### OMS Mockup Functions — EXACT Parameters

#### Wall Art (Posters, Canvas, Framed)

**Vertical Poster (Framed, product 2):**
```javascript
position: {
  area_width: 3600, area_height: 4800,
  width: 3600, height: 4800, top: 0, left: 0
}
fill_mode: 'cover'
variant_ids: [4]  // 12x16
```

**Horizontal Poster (Framed, product 2):**
```javascript
position: {
  area_width: 4800, area_height: 3600,
  width: 4800, height: 3600, top: 0, left: 0
}
fill_mode: 'cover'
variant_ids: [4]  // 12x16
```

**Key insight:** The OMS uses DIFFERENT position dimensions for horizontal vs vertical. For horizontal art, `area_width: 4800, area_height: 3600`. For vertical art, `area_width: 3600, area_height: 4800`. Both use `fill_mode: 'cover'` so Printful center-crops the image to fit.

**Horizontal Unframed Poster (product 1):**
```javascript
position: {
  area_width: 3600, area_height: 2400,
  width: 3600, height: 2400, top: 0, left: 0
}
fill_mode: 'fit'  // NOTE: uses 'fit', not 'cover'
variant_ids: [2]
```

**Canvas (product 3):**
Before sending to Printful, canvas images are extended with transparent bleed borders via `extendImage()`:
```javascript
async function extendImage(url, type) {
  // For horizontal: extends top/bottom by (3*width/24), left/right by (4*height/18)
  // For vertical: extends top/bottom by (3*width/18), left/right by (3*height/24)
}
```

Canvas position uses same 3600x4800 or 4800x3600 as posters.

#### Apparel

**T-Shirt (product 71):**
```javascript
position: {
  area_width: 450, area_height: 450,
  width: 450, height: 450, top: 0, left: 0
}
placement: 'front'
option_groups: ['Wrinkled']
variant_ids: [4013]  // White
```

**CRITICAL FINDING:** The OMS uses `450x450` for the T-shirt position area, NOT `1800x2400`. This is a **square** area, which means the illustration (whether 4:3 landscape or 3:4 portrait) gets centered within a square, preventing the stretching that would occur with a 3:4 rectangular area.

**Hoodie (product 146):**
```javascript
position: {
  area_width: 450, area_height: 450,
  width: 450, height: 450, top: 0, left: 0
}
placement: 'front'
option_groups: ['On Hanger']
variant_ids: [5524]  // White
```

Same 450x450 square as T-shirt.

**Tank Top (product 248):**
```javascript
position: {
  area_width: 450, area_height: 450,
  width: 450, height: 450, top: 0, left: 0
}
variant_ids: [8661]
```

**Sweatshirt (product 145):**
```javascript
position: {
  area_width: 450, area_height: 450,
  width: 450, height: 450, top: 0, left: 0
}
variant_ids: [5428]
```

#### Accessories

**iPhone Case (product 181):**
```javascript
// Pre-processing: if illustration is HORIZONTAL, rotate 270 degrees first
if (!isVertical) {
  url = await sharpHelper.resizeImage(url, 879, 1830, 'cover', 270, true);
}
position: {
  area_width: 879, area_height: 1830,
  width: 879, height: 1830, top: 0, left: 0
}
variant_ids: [10994]
```

**Samsung Case (product 267):**
```javascript
if (!isVertical) {
  url = await sharpHelper.resizeImage(url, 879, 1830, 'cover', 270, true);
}
position: {
  area_width: 936, area_height: 1950,
  width: 936, height: 1950, top: 0, left: 0
}
variant_ids: [11347]
```

**Blanket (product 395):**
```javascript
// Pre-processing: ALWAYS rotates 270 degrees, plus resizes to fill
url = await sharpHelper.resizeImage(url, 7950, 9450, 'fill', 270, true);
position: {
  area_width: 7950, area_height: 9450,
  width: 7950, height: 9450, top: 0, left: 0
}
variant_ids: [10986]
```

**Socks (product 186):**
```javascript
// Pre-processing: resize with 'cover' to crop into tall format
url = await sharpHelper.resizeImage(url, 700, 1200, 'cover', undefined, true);
position: {
  area_width: 700, area_height: 1200,
  width: 700, height: 1200, top: 0, left: 0
}
variant_ids: [7291]
```

**Mug (product 19):**
```javascript
position: {
  area_width: 1550, area_height: 1050,
  width: 1550, height: 1050, top: 0, left: 0
}
options: ['Front view']
variant_ids: [1320]  // 11oz
```

**Tote Bag (product 367):**
```javascript
position: {
  area_width: 1500, area_height: 1500,
  width: 1500, height: 1500, top: 0, left: 0
}
placement: 'front'
variant_ids: [10458]
```

**Stickers (product 358):**
```javascript
position: {
  area_width: 1275, area_height: 1275,
  width: 1275, height: 1275, top: 0, left: 0
}
variant_ids: [10163]
```

**Water Bottle (product 382):**
```javascript
position: {
  area_width: 2557, area_height: 1582,
  width: 2557, height: 1582, top: 0, left: 0
}
variant_ids: [10798]
```

**Puzzle (product 534):**
```javascript
position: {
  area_width: 4200, area_height: 3300,
  width: 4200, height: 3300, top: 0, left: 0
}
variant_ids: [13431]
```

**Greeting Card (product 568):**
```javascript
position: {
  area_width: 1842, area_height: 1240,
  width: 1842, height: 1240, top: 0, left: 0
}
placement: 'front'
variant_ids: [14457]
```

---

## 5. Popsmiths Implementation

**File:** `/Users/lcalderon/github/sketchpop_art_app/apps/backend/src/services/mockup-generator.js`

### Architecture

Popsmiths has the most sophisticated preprocessing pipeline. It:
1. Downloads the artwork
2. Analyzes orientation via Sharp metadata
3. Applies product-specific preprocessing (rotate, resize, crop, pad)
4. Uploads preprocessed image to R2 storage
5. Sends the preprocessed URL to Printful/Gooten

### Preprocessing Rules (from `preprocessImageForMockup()`)

```javascript
// Phone cases: rotate 270 if horizontal, resize with 'cover'
if (productId === 181) {  // iPhone
  if (isHorizontal) pipeline = pipeline.rotate(270);
  pipeline = pipeline.resize(879, 1830, { fit: 'cover', position: 'center' });
}

// Blanket: resize to portrait, cover-crop
else if (productId === 395) {
  pipeline = pipeline.resize(7950, 9450, { fit: 'cover', position: 'center' });
  // NOTE: No rotation — PopSmiths AI outputs portrait, so no rotation needed
}

// Socks: cover-crop to tall format
else if (productId === 186 || productId === 442 || productId === 882) {
  pipeline = pipeline.resize(700, 1200, { fit: 'cover', position: 'center' });
}

// All-Over Print Tank Top (276): contain with white padding
else if (productId === 276) {
  pipeline = pipeline.resize(4050, 5100, { fit: 'contain', background: white });
}

// All-Over Print Kids T-Shirt (384): contain with white padding
else if (productId === 384) {
  pipeline = pipeline.resize(2400, 3600, { fit: 'contain', background: white });
}

// Kids Fleece Hoodie (533): contain with white padding
else if (productId === 533) {
  pipeline = pipeline.resize(1500, 1800, { fit: 'contain', background: white });
}

// Mug (19): cover-crop to full wrap
else if (productId === 19) {
  pipeline = pipeline.resize(2700, 1050, { fit: 'cover', position: 'center' });
}

// Puzzle (534): cover-crop
else if (productId === 534) {
  pipeline = pipeline.resize(4200, 3300, { fit: 'cover', position: 'center' });
}

// Sticker (358): contain with white padding (square)
else if (productId === 358) {
  pipeline = pipeline.resize(1275, 1275, { fit: 'contain', background: white });
}

// All-Over Print Tote Bag (84): cover-crop
else if (productId === 84) {
  pipeline = pipeline.resize(2550, 2475, { fit: 'cover', position: 'center' });
}

// Greeting Card: cover-crop
else if (productId === 568 || productId === 329) {
  pipeline = pipeline.resize(1842, 1240, { fit: 'cover', position: 'center' });
}

// Water Bottle: contain with white padding
else if (productId === 382 || productId === 597) {
  pipeline = pipeline.resize(2557, 1582, { fit: 'contain', background: white });
}

// APPAREL (71, 146, 145, 372, 302, 304, 167, 248): NO preprocessing
// These all use 3:4 ratio (1800x2400) which matches AI output perfectly
else if ([71, 146, 145, 372, 302, 304, 167, 248].includes(productId)) {
  return artworkUrl;  // Pass through as-is
}
```

### Popsmiths Printful Position Configs

Popsmiths uses **full-bleed** for ALL products (`width == area_width`, `height == area_height`, `top: 0`, `left: 0`):

```javascript
// T-Shirt (71): 1800x2400 (3:4)
{ area_width: 1800, area_height: 2400, width: 1800, height: 2400, top: 0, left: 0 }

// Hoodie (146): 1800x2400 (3:4)
{ area_width: 1800, area_height: 2400, width: 1800, height: 2400, top: 0, left: 0 }

// Mug (19): 2700x1050
{ area_width: 2700, area_height: 1050, width: 2700, height: 1050, top: 0, left: 0 }

// Canvas (3): 3600x4800
{ area_width: 3600, area_height: 4800, width: 3600, height: 4800, top: 0, left: 0 }

// Blanket (395): 7950x9450
{ area_width: 7950, area_height: 9450, width: 7950, height: 9450, top: 0, left: 0 }
```

### Key Difference: PopSmiths vs OMS for Apparel

- **OMS uses 450x450 square** position for T-shirt/Hoodie mockups (lets Printful handle it)
- **PopSmiths uses 1800x2400 full-bleed** position but relies on the AI always outputting 3:4 portrait art

This works for PopSmiths because their AI-generated art is ALWAYS 3:4 portrait. For TurnedYellow, where illustrations are 4:3 landscape (4800x3600), the OMS's 450x450 square is safer -- Printful will center-fit the image within the square area.

---

## 6. Video Pipeline generate-mockups.js

**File:** `/Users/lcalderon/clawd/agents/gwen/workspace/generate-mockups.js`

### Complete PRODUCT_MAP

| Index | Label | Provider | Product ID | Variant IDs | Placement | Position (WxH) | fillMode | Notes |
|-------|-------|----------|-----------|-------------|-----------|-----------------|----------|-------|
| 0 | Framed Poster | Printful | 2 | [4] | default | 3600x4800 | cover | |
| 1 | Framed Poster | Printful | 2 | [4] | default | 3600x4800 | cover | Duplicate of 0 |
| 2 | Canvas Print | Printful | 3 | [5] | default | 3600x4800 | cover | |
| 3 | Canvas Print | Printful | 3 | [5] | default | 3600x4800 | cover | Duplicate of 2 |
| 4 | T-Shirt | Printful | 71 | [4013] | front | 1800x2400 | (none) | **PROBLEM: uses 1800x2400 not 450x450** |
| 5 | (Mug) | SKIP | - | - | - | - | - | Known broken for portrait |
| 6 | Poster Print | Printful | 1 | [1] | default | 3600x4800 | cover | |
| 7 | Poster Print | Printful | 1 | [1] | default | 3600x4800 | cover | Duplicate of 6 |
| 8 | Hoodie | Printful | 146 | null | front | 1800x2400 | (none) | **SKIP: no variantIds** |
| 9 | Socks | Printful | 186 | null | default | 700x1200 | (none) | **SKIP: no variantIds; NO preprocessing** |
| 10 | iPhone Case | Printful | 181 | [10994] | default | 879x1830 | (none) | **PROBLEM: no rotation for horizontal** |
| 11 | Samsung Case | Printful | 267 | null | default | 936x1950 | (none) | SKIP: no variantIds |
| 12 | Throw Blanket | Gooten | - | - | - | - | - | Uses MAXFIT=TRUE |
| 13 | (Sticker) | SKIP | - | - | - | - | - | |
| 14 | Tote Bag | Printful | 361 | [9695] | front | 1500x1500 | (none) | |
| 15 | (Greeting Card) | SKIP | - | - | - | - | - | |
| 16 | Tank Top | Printful | 248 | null | front | 1800x2400 | (none) | SKIP: no variantIds |
| 17 | Sweatshirt | Printful | 145 | null | front | 1800x2400 | (none) | SKIP: no variantIds |

### Problems Identified in generate-mockups.js

1. **Wall Art uses PORTRAIT positions (3600x4800) for LANDSCAPE illustrations.**
   The OMS uses `4800x3600` for horizontal art and `3600x4800` for vertical art. The video pipeline ALWAYS uses `3600x4800` (portrait) regardless of illustration orientation. With `fill_mode: 'cover'`, Printful will center-crop, which may cut off the sides of a landscape illustration.

2. **T-Shirt uses 1800x2400 instead of 450x450.**
   The OMS uses a 450x450 square for the T-shirt/Hoodie mockup position. The video pipeline uses 1800x2400 (portrait 3:4). For a 4:3 landscape illustration sent raw:
   - With 1800x2400 and NO fill_mode: Printful STRETCHES the 4:3 image into 3:4, causing visible warping
   - With 450x450 (OMS approach): Printful fits the image naturally within the square

3. **iPhone Case has no rotation preprocessing.**
   The OMS rotates horizontal illustrations 270 degrees before sending to Printful. The video pipeline sends the raw landscape image, which gets stretched into the tall 879x1830 case area.

4. **Socks have no preprocessing.**
   The OMS resizes with `cover` to 700x1200 before sending. The video pipeline sends raw.

5. **No `fill_mode` on apparel.**
   The video pipeline omits `fill_mode` for T-shirt (index 4). Without `fill_mode`, and with `width == area_width`, Printful will STRETCH the image to fill the exact dimensions.

---

## 7. Image Pre-Processing Pipeline

### OMS Sharp Helper

**File:** `/Users/lcalderon/github/OMS/server/helpers/sharp.helper.js`

```javascript
module.exports.resizeImageWithOptions = async ({
  url, width, height, fit, rotationAngle, returnJpg, position, returnBuffer
}) => {
  const imageResponse = await axios({ url, responseType: 'arraybuffer' });
  let buffer = Buffer.from(imageResponse.data, 'binary');
  const image = await sharp(buffer);

  if (rotationAngle) {
    image.rotate(rotationAngle);
  }

  if (width && height) {
    image.resize(width, height, {
      fit: fit || 'contain',          // DEFAULT is 'contain' (letterboxed, no warping)
      background: { r: 243, g: 193, b: 58, alpha: 0 },  // Transparent background
      position: position || 'centre',
    });
  }

  // Upload to S3 and return URL
};
```

**Key defaults:**
- `fit` defaults to `'contain'` -- image is letterboxed within target dimensions, NEVER stretched
- Background is transparent (alpha: 0) for contain padding
- Returns a new S3 URL for the preprocessed image

### OMS Image Helper (Canvas Bleed Borders)

**File:** `/Users/lcalderon/github/OMS/server/helpers/image.helper.js`

For canvas and vertical prints, the OMS uses a Python script (`image.helper.py`) to add blurred bleed borders. Parameters passed:
- `-u` URL
- `-d` DPI (125 for 18x24, 150 for smaller)
- `-v` vertical flag
- `-b` blur flag (true for canvas)
- `-w` width, `-t` height

### Gooten Order Pre-Processing

**File:** `/Users/lcalderon/github/OMS/server/helpers/gooten.helper.js`

The `productStrategies` object defines preprocessing for Gooten fulfillment (NOT mockups):

```javascript
const productStrategies = {
  canvas:      { width/height based on size, fit: 'fill' },
  mug:         { 2475x1155 for 11oz, 2550x1278 for 15oz },
  tshirt:      { width: 4500, height: 5700, position: 'top' },
  ornament:    { width: 1275, height: 975, fit: 'fill' },
  blanket:     { width: 5200, height: 6200, position: 'fill' },
  hoodie:      { width: 4200, height: 3000, position: 'top' },
  sweatshirt:  { width: 4200, height: 4800, position: 'top' },
  tankTop:     { width: 3600, height: 4800, position: 'top' },
  throwPillow: { width: 3100, height: 3100, position: 'fill' },
  laptopSleeve:{ width: 3600, height: 2700, position: 'fill' },
  mousepad:    { width: 2925, height: 2475, position: 'fill' },
  puzzle:      { width: 3953, height: 3095, fit: 'fill' },
};
```

Note: `position: 'top'` is used for apparel to keep the face/head at the top of the print area.

### Printful Order Pre-Processing (`getPrintURL()`)

For actual fulfillment (NOT mockups), the OMS preprocesses differently:

```javascript
async function getPrintURL(url, productId, variantId, productType, isVertical) {
  switch (productType.toLowerCase()) {
    case 'iphone case':
    case 'samsung case':
      if (!isVertical) {
        url = await sharpHelper.resizeImage(url, undefined, undefined, 'cover', 270, true);
      }
      break;
    case 'throw blanket':
      if (!isVertical) {
        url = await sharpHelper.resizeImage(url, 9450, 7950, 'fill', undefined, true);
      } else {
        url = await sharpHelper.resizeImage(url, 7950, 9450, 'fill', 270, true);
      }
      break;
    case 'black foot sublimated socks':
      url = await sharpHelper.resizeImage(url, 700, 1200, 'cover', undefined, true);
      break;
    default:
      url = await sharpHelper.resizeImageWithOptions({ url, returnJpg: true });
      break;
  }
}
```

---

## 8. Position Object Deep Dive: What Happens with a 4800x3600 Landscape Illustration?

### Scenario: 4800x3600 (4:3 landscape) illustration sent to various products

#### Framed Poster with 3600x4800 position + fill_mode: 'cover'

The image (landscape) is sent into a portrait area. With `cover`, Printful:
1. Scales the image up until it fills the 3600x4800 area
2. Crops the sides (the landscape image gets cropped to portrait)
3. Result: A portrait crop of the landscape illustration -- it looks correct but loses left/right content

**The OMS solves this** by using `4800x3600` for horizontal art, matching the illustration's native ratio.

#### T-Shirt with 1800x2400 position + NO fill_mode

The image (4:3) is sent into a 3:4 area with no fill_mode. Printful:
1. STRETCHES the 4:3 image to fill 3:4 dimensions
2. Result: **Visible vertical stretching** -- faces look elongated, circles become ovals

**The OMS solves this** by using 450x450 (square) position for apparel, which lets Printful naturally center the image.

#### iPhone Case with 879x1830 position + NO fill_mode

The landscape image is sent into a very tall area. Without rotation:
1. Printful stretches the 4:3 image into ~1:2 proportions
2. Result: **Extreme warping** -- everything looks impossibly tall and thin

**The OMS solves this** by rotating the image 270 degrees first (making it portrait), then using `cover` to crop.

---

## 9. Warping/Distortion Analysis

### Why Some Products Show Warped Illustrations

The root cause is a **mismatch between the illustration's aspect ratio and the product's print area aspect ratio**, combined with **missing preprocessing or fill_mode**.

| Product | Print Area Ratio | Illustration Ratio (TY) | Mismatch? | OMS Solution | Video Pipeline Problem |
|---------|-----------------|------------------------|-----------|--------------|----------------------|
| Poster/Canvas (portrait) | 3:4 | 4:3 | YES | Uses 4800x3600 for landscape | Always uses 3600x4800 |
| T-Shirt | 3:4 (1800x2400) | 4:3 | YES | Uses 450x450 square | Uses 1800x2400 with no fill_mode |
| Hoodie | 3:4 (1800x2400) | 4:3 | YES | Uses 450x450 square | N/A (skipped, no variantId) |
| iPhone Case | ~1:2 (879x1830) | 4:3 | YES | Rotate 270 + cover | No rotation, no fill_mode |
| Blanket | ~5:6 (7950x9450) | 4:3 | YES | Rotate 270 + resize to fill | Gooten MAXFIT handles it |
| Socks | ~7:12 (700x1200) | 4:3 | YES | Resize with cover | N/A (skipped, no variantId) |
| Tote Bag | 1:1 (1500x1500) | 4:3 | YES | Same 1500x1500 | Same -- landscape crops to square |
| Mug | ~3:2 (1550x1050) | 4:3 | Close | Same dimensions | N/A (skipped) |

### The Three Anti-Warping Strategies

**Strategy 1: Use `fill_mode: 'cover'`**
- Printful center-crops the image to fill the area
- Preserves aspect ratio but LOSES content at the edges
- Used by OMS for: posters, canvas, framed prints

**Strategy 2: Use a square position (450x450)**
- The image is naturally centered within the square
- Printful fits it without stretching
- Used by OMS for: T-shirts, hoodies, tank tops, sweatshirts

**Strategy 3: Preprocess with Sharp before sending**
- Rotate, resize, crop, or pad the image to match the target area
- Most reliable -- guarantees the image matches the product's expectations
- Used by OMS for: phone cases (rotate), blankets (rotate+resize), socks (cover-resize)
- Used by PopSmiths for: ALL products that need it

---

## 10. Product Reference Table

### Complete Product Map Across All Three Systems

| OMS Index | Product | Printful Product ID | OMS Variant | OMS Position | OMS Preprocessing | Video Pipeline Position | Video Pipeline Issue |
|-----------|---------|-------------------|-------------|--------------|-------------------|------------------------|---------------------|
| 0 | Framed Poster H | 2 | 4 | 4800x3600 (H) / 3600x4800 (V) | fill_mode:cover | 3600x4800 always | Wrong for landscape |
| 1 | Framed Poster V | 2 | 4 | 3600x4800 | fill_mode:cover | 3600x4800 | OK for portrait only |
| 2 | Canvas H | 3 | 7 | 4800x3600 + bleed extend | fill_mode:cover | 3600x4800 | Wrong for landscape |
| 3 | Canvas V | 3 | 5 | 3600x4800 + bleed extend | fill_mode:cover | 3600x4800 | OK for portrait only |
| 4 | T-Shirt | 71 | 4013 | **450x450** | None | **1800x2400** | **WARPS landscape art** |
| 5 | Mug | 19 | 1320 | 1550x1050 | None for mockup | SKIP | - |
| 6 | Poster H | 1 | 2 | 3600x2400 | fill_mode:fit | 3600x4800 | Wrong dimensions |
| 7 | Poster V | 1 | 1 | 3600x4800 | fill_mode:cover | 3600x4800 | OK for portrait only |
| 8 | Hoodie | 146 | 5524 | **450x450** | None | 1800x2400 | SKIP (no variantId) |
| 9 | Socks | 186 | 7291 | 700x1200 | cover resize | 700x1200 | SKIP (no variantId) |
| 10 | iPhone | 181 | 10994 | 879x1830 | **Rotate 270 if horizontal** | 879x1830 | **Missing rotation** |
| 11 | Samsung | 267 | 11347 | 936x1950 | **Rotate 270 if horizontal** | 936x1950 | SKIP (no variantId) |
| 12 | Blanket | Gooten | - | Gooten MAXFIT | Rotate 270 + resize | Gooten MAXFIT | OK (Gooten handles) |
| 14 | Tote Bag | 361/367 | 9695/10458 | 1500x1500 | None | 1500x1500 | Crops to square (OK) |
| 16 | Tank Top | 248 | 8661 | **450x450** | None | 1800x2400 | SKIP (no variantId) |
| 17 | Sweatshirt | 145 | 5428 | **450x450** | None | 1800x2400 | SKIP (no variantId) |

---

## 11. Key Findings and Recommendations

### Finding 1: OMS Uses 450x450 for Apparel Mockups -- Video Pipeline Uses 1800x2400

The most critical difference. The OMS's 450x450 square position tells Printful "here is a small square area on the garment; fit the image inside it." This prevents any stretching because the image is naturally centered. The video pipeline's 1800x2400 tells Printful "fill this entire 3:4 rectangle," which STRETCHES a 4:3 landscape image.

**Recommendation:** Change the video pipeline T-shirt position from `1800x2400` to `450x450` to match OMS behavior. OR add `fill_mode: 'cover'` to let Printful center-crop.

### Finding 2: Wall Art Should Use Orientation-Aware Dimensions

The OMS uses `4800x3600` for horizontal illustrations and `3600x4800` for vertical. The video pipeline always uses `3600x4800`.

**Recommendation:** The video pipeline should detect illustration orientation and use the correct dimensions, or rely on `fill_mode: 'cover'` (already set) which will handle it by cropping.

### Finding 3: Phone Cases Need Rotation

The OMS rotates horizontal illustrations 270 degrees before sending to Printful for phone case mockups. The video pipeline does not.

**Recommendation:** Add Sharp preprocessing to rotate horizontal illustrations 270 degrees before generating phone case mockups.

### Finding 4: PopSmiths Has the Best Preprocessing

PopSmiths' `preprocessImageForMockup()` function is the gold standard. It handles every product type with appropriate Sharp transformations (rotate, cover, contain, etc.) BEFORE sending to the API.

**Recommendation:** Port PopSmiths' preprocessing approach to the video pipeline.

### Finding 5: Gooten's MAXFIT Prevents All Warping

For Gooten products (blanket, ornament, pillow, etc.), `MAXFIT: "TRUE"` ensures the image is never stretched. This is why the blanket mockup from the video pipeline (which uses Gooten) looks fine while the T-shirt (Printful) looks warped.

### Finding 6: fill_mode is the Simplest Fix

Adding `fill_mode: 'cover'` to ALL Printful mockup requests in the video pipeline would prevent the worst warping. It will crop rather than stretch. Not perfect (content gets cut off) but dramatically better than stretching.

**Quick fix for generate-mockups.js:**
```javascript
// Add fillMode: 'cover' to ALL entries in PRODUCT_MAP
4: { label: 'T-Shirt', ..., fillMode: 'cover', position: { area_width: 1800, area_height: 2400, ... } }
```

Or better yet, match the OMS approach:
```javascript
4: { label: 'T-Shirt', ..., position: { area_width: 450, area_height: 450, width: 450, height: 450, top: 0, left: 0 } }
```

---

## Appendix: File Locations

| File | Path |
|------|------|
| OMS Printful Helper | `/Users/lcalderon/github/OMS/server/helpers/printful-helper.js` |
| OMS Gooten Helper | `/Users/lcalderon/github/OMS/server/helpers/gooten.helper.js` |
| OMS Sharp Helper | `/Users/lcalderon/github/OMS/server/helpers/sharp.helper.js` |
| OMS Image Helper | `/Users/lcalderon/github/OMS/server/helpers/image.helper.js` |
| OMS Mockup Queue | `/Users/lcalderon/github/OMS/server/helpers/mockup-queue.helper.js` |
| PopSmiths Mockup Generator | `/Users/lcalderon/github/sketchpop_art_app/apps/backend/src/services/mockup-generator.js` |
| PopSmiths Generate Mockup Tool | `/Users/lcalderon/github/sketchpop_art_app/apps/backend/tools/generate-mockup.js` |
| PopSmiths Product Catalog | `/Users/lcalderon/github/sketchpop_art_app/packages/config/src/products.ts` |
| Video Pipeline Mockup Script | `/Users/lcalderon/clawd/agents/gwen/workspace/generate-mockups.js` |
