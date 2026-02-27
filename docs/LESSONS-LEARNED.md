# Lessons Learned -- TurnedYellow Video Pipeline

**Purpose:** Every mistake made during development, so no future session repeats them. Read this BEFORE touching anything.

---

## Version History and What Went Wrong

### v1-v5: Initial Builds
- Iterating on structure, timing, and product selection
- No major insights -- just finding the right format

### v6: Fill+Crop Distortion
**Problem:** Used `magick -resize WxH^ -gravity center -extent WxH` directly on product images to fill the 1080x1920 frame. This crops aggressively -- a 1024x1024 image loses ~44% of its content when forced into 9:16 portrait.

**Fix:** Use the blurred background approach instead. The product image is shown in full over a blurred, darkened version of itself. See `prepare_product()` in the build scripts.

**Rule:** NEVER use `resize WxH^` + `extent` as the final step for product images.

### v7: Gemini Warped the Artwork
**Problem:** Asked Gemini to generate product mockups with the illustration placed on them. Gemini re-draws the illustration entirely -- it does NOT copy pixels. Faces get extra fingers, proportions change, colors shift, details disappear.

**Fix:** Use Printful API for pixel-perfect artwork placement. Gemini should ONLY be used for staging the finished mockup into a lifestyle scene (Step 2), never for artwork placement (Step 1).

**Rule:** NEVER use Gemini (or any AI image generator) to place artwork onto products. Only use Printful/Gooten API.

### v8: Plain Mockups Looked Cheap
**Problem:** Used Printful mockups directly without lifestyle staging. Products on plain white backgrounds look like a dropshipping catalog, not a premium brand showcase.

**Fix:** Stage every mockup with Gemini into a lifestyle scene. Living rooms, bedrooms, kitchens, boutiques -- real environments make products feel aspirational.

**Rule:** ALWAYS stage mockups into lifestyle scenes before including in the video.

### v9: Gemini Modified Faces During Staging
**Problem:** When passing Printful mockups to Gemini for staging, Gemini STILL slightly modified the artwork on the products. Faces could change, colors shifted.

**Finding:** This turned out to be acceptable. Products in real life have lighting, shadows, and perspective that naturally alter their appearance. The staged results look professional and natural. Luis approved this approach.

**Rule:** Minor artwork modifications during Gemini staging are acceptable. The lifestyle context is worth the trade-off.

### v10: rembg + Composite Showed White Boxes
**Problem:** Tried using rembg to remove white backgrounds from Printful mockups, then compositing transparent cutouts onto Gemini-generated backgrounds. White apparel (t-shirts, hoodies) could not be separated from white backgrounds -- rembg stripped the garments too.

**Fix:** Abandoned the rembg approach entirely. Direct Gemini staging of Printful mockups works better.

### v11 Early: Flat Cutout Look
**Problem:** rembg cutouts pasted onto backgrounds looked like flat stickers. Blankets appeared to be standing upright like boards instead of draped naturally. No shadows, no depth, no realism.

**Fix:** Let Gemini handle the entire staging. Gemini naturally adds shadows, reflections, depth, and context.

### v11 Final: THE GOLDEN RECIPE
**Success:** Printful API for pixel-perfect mockups, then Gemini staging for lifestyle scenes. This is the proven, Luis-approved approach that produced both TY-133627 and TY-130138 videos.

---

## Printful API Mistakes

### Wrong Position Dimensions for Apparel
**Problem:** Using `1800x2400` (portrait 3:4) for T-shirt position when the illustration is landscape (4:3). Without `fill_mode`, Printful STRETCHES the image to fill the entire 3:4 area. Faces look elongated, circles become ovals.

**Fix:** Use `450x450` (square) for ALL apparel (T-shirt, hoodie, sweatshirt, tank top). The OMS uses this approach. Printful naturally centers the image within the square without stretching.

### Wrong Wall Art Dimensions for Landscape Illustrations
**Problem:** Using `3600x4800` (portrait) for wall art when the illustration is landscape. With `fill_mode: 'cover'`, Printful center-crops, cutting off left/right content.

**Fix:** Use orientation-aware dimensions. For landscape illustrations: `4800x3600`. For portrait: `3600x4800`. Always include `fill_mode: 'cover'`.

### Missing Phone Case Rotation
**Problem:** Sending a landscape illustration directly to the phone case endpoint (879x1830 tall area). Without rotation, the landscape image gets extremely stretched vertically.

**Fix:** Rotate the illustration 270 degrees BEFORE uploading to S3 and sending to Printful. The OMS does this automatically via Sharp.

### Mug Default View Shows Handle
**Problem:** The default mug mockup view shows the handle side, which blocks the artwork.

**Fix:** Include `"options": ["Front view"]` in the Printful API call. This shows the front of the mug where the artwork is printed.

### Missing fill_mode
**Problem:** Omitting `fill_mode` from the Printful API call. Without it, when the image dimensions do not match the position area dimensions, Printful stretches the image to fill exactly.

**Fix:** Always include `fill_mode: 'cover'` for wall art products. For apparel, use the `450x450` square approach instead.

### CloudFront URLs Can Expire
**Problem:** Using CloudFront URLs (`d3ok1s6o7a5ag4.cloudfront.net`) for the illustration URL in Printful API calls. These URLs can expire, causing the API call to fail.

**Fix:** Upload the illustration to Wasabi S3 directly and use the permanent S3 URL.

---

## ffmpeg and ImageMagick Mistakes

### Never Use zoompan
**Problem:** `zoompan` filter in ffmpeg causes both stretching AND jitter. Even subtle Ken Burns effects look terrible at 1080x1920.

**Fix:** Use static images only. If zoom is absolutely necessary, keep it under 1.05x -- but prefer static.

### Hex Colors in ffmpeg filter_complex
**Problem:** Using `#FFD700` in ffmpeg filter_complex. The shell interprets `#` as a comment and eats the rest of the line.

**Fix:** Use `0xFFD700` format in ffmpeg. Use `#FFD700` in ImageMagick (where it works fine).

### force_original_aspect_ratio is Required
**Problem:** Using `scale=W:H` without `force_original_aspect_ratio=decrease` in ffmpeg. This stretches the video to fit.

**Fix:** Always use:
```
scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:-1:-1:color=COLOR
```

### ImageMagick resize with > flag
**Problem:** Small mockup images getting enlarged and looking blurry.

**Fix:** Use `-resize WxH>` (with `>` flag) to prevent enlargement of images smaller than the target.

---

## Gemini Staging Mistakes

### Image Before Text in API Call
**Problem:** Putting the image before the text prompt in the Gemini `contents` array causes `FinishReason.OTHER` blocks (safety filter false positives).

**Fix:** Text prompt MUST come first: `contents=[prompt_text, image]`

### Blanket Must Be Draped on Bed
**Problem:** Gemini staging prompts that do not specify "draped on bed" produce blankets standing upright, folded on shelves, or propped against walls. None of these look natural.

**Fix:** Use this exact prompt: "Show this printed throw blanket draped flat on a bed in a bedroom. Keep the printed design visible. Cozy bedroom setting."

### Gemini Safety Filter False Positives
**Problem:** Gemini occasionally blocks requests with `FinishReason.OTHER` due to safety filters, even for completely benign content (family portraits on products).

**Fix:** Retry up to 3 times. Gemini is non-deterministic -- the same prompt often succeeds on retry. Use simpler, shorter prompts on subsequent attempts.

---

## Build Script Mistakes

### Music-Only Changes
**Problem:** Rebuilding the entire video just to change the music track. This takes ~3 minutes and risks destroying staged images if any step is skipped.

**Fix:** Use `swap-music.sh` for audio-only changes. It replaces the audio track in ~2 seconds without touching the video.

### Category Deduplication
**Problem:** Including two products of the same type (two hoodies, two phone cases) in the same video. This looks repetitive and wastes video time.

**Fix:** Each product in the rapid-fire section must be a unique category. Pick the best variant if there are multiple.

### Reaction Audio Not Mixed
**Problem:** Muting either the music or the reaction audio. This loses either the emotional impact (reaction) or the energy (music).

**Fix:** Mix both together. Duck the music to 25% volume during the reaction segment, return to full volume after.

---

## General Process Mistakes

### Not Verifying Before Building
**Problem:** Building the video without checking all mockups and staged images first. Discovering issues after a 3-minute build wastes time.

**Fix:** Always verify ALL staged images (v11_*.png) visually before running the build script.

### Not Recording Orientation
**Problem:** Forgetting whether the illustration is landscape or portrait, then using wrong Printful parameters.

**Fix:** Check orientation with `magick identify illustration.jpg` at the START of the process and record it.

### Deleting Staged Images
**Problem:** Accidentally deleting v11_*.png files and having to re-stage everything with Gemini (expensive, slow, results may differ).

**Fix:** Never delete the mockups/ directory without backing up v11 files first. The v9 files can be regenerated from Printful, but v11 files are unique Gemini outputs.
