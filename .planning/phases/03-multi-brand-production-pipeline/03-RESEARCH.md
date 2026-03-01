# Phase 3: Multi-Brand Production Pipeline - Research

**Researched:** 2026-03-01
**Domain:** Multi-brand video production pipeline (OMS integration, API resilience, Drive upload, social copy)
**Confidence:** HIGH

## Summary

Phase 3 connects the brand-aware pipeline (Phase 1) and consent system (Phase 2) into end-to-end production for all five brands. The codebase already has most scripts in place -- `download-order-assets.sh`, `generate-mockups.js`, `stage-products.sh`, `build-video.sh`, `generate-social-copy.js`, `upload-to-drive.js`, `rank-candidates.js`, `approve-orders.js`, `batch-produce.sh`, and `daily-pipeline.sh`. The key gaps are: (1) the scripts assume assets are already present but don't integrate with OMS APIs for shared-OMS brands, (2) PopSmiths has no OMS integration and needs AI-generated lifestyle imagery instead, (3) the pipeline currently builds only one video type per order (UGC or reels) but needs both, (4) Gemini staging already retries 3x but Printful rate limiting is minimal (100ms sleep), (5) social copy and Drive upload scripts exist but aren't wired into a single-command flow that produces both video types per order.

**Primary recommendation:** Wire the existing scripts together by: adding an OMS asset-fetch adapter (shared OMS + PopSmiths Heroku), making `batch-produce.sh` produce both UGC and reels per order, hardening Printful rate limiting, and ensuring upload-to-drive handles both video files plus the social copy doc.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- System auto-ranks candidates by signals: illustration quality proxy (inferred from product category, order completeness, OMS flags), reaction video availability, number of people in illustration, body framing (full-body outranks shoulder-up)
- Luis reviews the ranked list in the approval CLI and can reorder or skip candidates before approving the batch
- Reaction video availability is a strong positive signal but not a hard requirement -- orders without reaction video still qualify (produce standard reel only if no reaction footage)
- Always produce BOTH UGC reel and standard reel for each approved order
- Exception: if no reaction video available, skip the UGC reel and produce standard reel only
- This applies to all 5 brands including PopSmiths
- PopSmiths has no real customer orders yet -- use AI-generated lifestyle imagery as the visual source
- AI generates styled room/interior scenes featuring the PopSmiths art (framed, on walls, in decorated home contexts)
- Video aesthetic: home decoration / art inspiration -- the art is the star, not the person
- Art retrieved from PopSmiths' own Heroku server (not shared OMS) -- adapter pattern, same pipeline downstream
- TurnedComics note: hand-drawn art creates unique composition needs -- address per-brand config during implementation
- Output lands in `/{Brand}/videos/{YYYY-MM-DD}/` per brand
- File naming: `{order_id}_{type}.mp4` where type is `ugc` or `reel`
- Social copy doc alongside: `{order_id}_social.md` in same folder
- Single Markdown doc per order covering all four platforms: YouTube, TikTok, Instagram, X
- Each platform section includes: caption, hashtags, CTA line, audio suggestion, posting notes
- X (Twitter) gets its own section -- short-form copy, different hashtag density
- Doc is human-readable and copy-paste ready
- Gemini staging: retry up to 3x with exponential backoff on FinishReason.OTHER
- Printful API: respect rate limits during batch processing
- Failures are logged and flagged but do not halt the entire batch -- skip the failed order, continue others

### Claude's Discretion
- Exact ranking algorithm weights (illustration quality proxy formula)
- AI image generation service for PopSmiths lifestyle scenes (Midjourney, DALL-E, Gemini -- whichever produces best home-decor aesthetic)
- Exact hashtag sets per platform per brand (can be seeded and refined over time)
- Social copy tone per brand (should match brand voice from brand configs)

### Deferred Ideas (OUT OF SCOPE)
- Review and distribution platform -- a tool for reviewing, scheduling, and publishing social posts across platforms
- PopSmiths with real customer orders -- once orders exist, swap AI-generated lifestyle footage for real customer photos
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRAND-03 | OMS integration for shared-OMS brands (TY, MMJ, TW, TC) | `download-order-assets.sh` already fetches from OMS via `oms_app` config field; needs proper API integration instead of curl-based approach |
| BRAND-04 | PopSmiths integration -- retrieve art from Heroku server | `popsmiths.json` has `oms_app: null`; need adapter that fetches from Heroku instead of OMS; AI lifestyle imagery generation |
| PROD-01 | UGC video build for all brands | `build-video.sh` already supports UGC mode (reaction + photos + products); works for any brand with correct config |
| PROD-02 | Standard reels video build for all brands | `build-video.sh` already supports reels mode (no reaction); needs orchestration to produce both types per order |
| PROD-03 | Order candidate auto-selection with scoring | `lib/scorer.js` exists with scoring algorithm; needs enhancement for illustration quality proxy, people count, body framing signals |
| PROD-05 | Google Drive upload with per-brand folder structure | `upload-to-drive.js` exists, creates date subfolders; needs to upload social copy doc alongside video; needs to handle both UGC and reels files |
| PROD-06 | Gemini staging retry logic | `stage-products.sh` already implements 3x retry with exponential backoff; verify FinishReason.OTHER handling |
| PROD-07 | Printful/Gooten rate limit handling | `generate-mockups.js` has 100ms sleep between requests; needs proper rate limit detection and backoff |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 | Order/consent database | Already in use, fast synchronous SQLite |
| googleapis | ^171.4.0 | Google Drive upload | Already in use, official Google API client |
| nodemailer | ^8.0.1 | Email (consent) | Already in use from Phase 2 |
| express | ^5.2.1 | Consent server | Already in use from Phase 2 |
| dotenv | ^17.3.1 | Environment configuration | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| native https | built-in | OMS/Printful/Gooten API calls | Matches existing codebase pattern (no axios) |
| jq | system | JSON parsing in bash scripts | Already used extensively in build-video.sh |
| ffmpeg/ffprobe | system | Video build and verification | Already used in build-video.sh, verify-video.sh |
| ImageMagick | system | Image preparation | Already used in build-video.sh |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native https | axios/node-fetch | Would break codebase convention (decision [02-01]: use native https) |
| Gemini for PopSmiths AI imagery | DALL-E / Midjourney | Gemini already integrated for staging; reusing same API reduces complexity |

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── oms-adapter.js       # OMS asset fetcher (shared OMS + PopSmiths Heroku adapter)
├── scorer.js            # Enhanced scoring (existing + new signals)
├── social-copy.js       # Existing - enhanced with posting notes/audio suggestions
├── db.js                # Existing database module
├── consent.js           # Existing consent module
├── sheets-client.js     # Existing Google Sheets client
├── email.js             # Existing email module
└── rate-limiter.js      # Rate limit + backoff utility for Printful/Gooten

scripts/
├── download-order-assets.sh  # Enhanced to use oms-adapter
├── generate-mockups.js       # Enhanced with rate limiting
├── stage-products.sh         # Already has retry logic
├── build-video.sh            # Already brand-parameterized
├── batch-produce.sh          # Enhanced to produce both UGC + reels
├── generate-social-copy.js   # Enhanced output format
├── upload-to-drive.js        # Enhanced to upload both videos + social copy
├── rank-candidates.js        # Enhanced scoring signals
├── approve-orders.js         # Already functional
└── daily-pipeline.sh         # Already functional
```

### Pattern 1: OMS Adapter (Strategy Pattern)
**What:** Single interface for fetching order assets regardless of source (shared OMS vs PopSmiths Heroku)
**When to use:** Any time we need to retrieve illustrations, photos, or reaction videos for an order
**Example:**
```javascript
// lib/oms-adapter.js
class OmsAdapter {
  static create(brandConfig) {
    if (brandConfig.oms_app) {
      return new SharedOmsAdapter(brandConfig);
    }
    if (brandConfig.heroku_app) {
      return new PopSmithsAdapter(brandConfig);
    }
    throw new Error(`No OMS configured for brand: ${brandConfig.slug}`);
  }

  async fetchIllustration(orderId) { /* abstract */ }
  async fetchPhotos(orderId) { /* abstract */ }
  async fetchReactionVideo(orderId) { /* abstract */ }
}
```

### Pattern 2: Dual Video Build
**What:** Produce both UGC and reels from same order assets in a single batch-produce run
**When to use:** Every approved order with a reaction video gets both; orders without reaction get reels only
**Example:**
```bash
# In batch-produce.sh - produce both types
if has_reaction; then
  build-video.sh ... --mode ugc    # UGC reel with reaction
  build-video.sh ... --mode reels  # Standard reel without reaction
else
  build-video.sh ... --mode reels  # Standard reel only
fi
```

### Pattern 3: Rate Limiter with Backoff
**What:** Detect 429/rate limit responses and back off with exponential delay
**When to use:** All Printful and Gooten API calls during batch processing
**Example:**
```javascript
// lib/rate-limiter.js
async function withRateLimit(fn, { maxRetries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.statusCode === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

### Anti-Patterns to Avoid
- **Building a new pipeline from scratch:** The scripts already exist and work. Wire them together, don't rewrite.
- **Mixing OMS-specific logic into scripts:** Use the adapter pattern so download-order-assets.sh doesn't need brand-specific conditionals.
- **Single video type per run:** The context explicitly requires both UGC and reels per order (when reaction video exists).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom delay loops in each script | Shared rate-limiter.js utility | Consistent backoff, retry count, 429 detection across all API calls |
| OMS asset fetch | Brand-specific conditionals in download script | Adapter pattern in oms-adapter.js | Clean separation, easy to add new asset sources |
| AI lifestyle images for PopSmiths | Custom image generation pipeline | Gemini image generation (already integrated for staging) | Same API, same auth, same error handling |
| Social copy formatting | Manual string concatenation per platform | Existing lib/social-copy.js enhanced with missing fields | Already handles 4 platforms, just needs audio suggestions and posting notes |

## Common Pitfalls

### Pitfall 1: File naming mismatch between build and upload
**What goes wrong:** `build-video.sh` outputs `{brand_slug}-{order_id}-ugc.mp4` but CONTEXT.md specifies `{order_id}_ugc.mp4`
**Why it happens:** Existing naming convention differs from context decision
**How to avoid:** Update build-video.sh output naming to match context spec: `{order_id}_{type}.mp4`
**Warning signs:** Upload script can't find the video file

### Pitfall 2: PopSmiths has no orders in database
**What goes wrong:** Scoring and ranking queries return nothing for PopSmiths
**Why it happens:** PopSmiths has no real customer orders yet
**How to avoid:** PopSmiths needs a separate flow for seeding test/demo orders, or the batch-produce script needs a mode for generating from art catalog rather than order database
**Warning signs:** `rank-candidates.js --brand popsmiths` returns empty

### Pitfall 3: Gemini staging uses raw backup file on retry
**What goes wrong:** `stage-products.sh` backs up to `.raw` and then stages in-place; on retry it reads the already-partially-staged file
**Why it happens:** The backup is created before first attempt, but if the first attempt writes partial data before failing, the retry reads corrupted input
**How to avoid:** Always stage from the `.raw` backup, not the in-place file
**Warning signs:** Staged images look double-processed or corrupted

### Pitfall 4: Rate limits during multi-brand batch processing
**What goes wrong:** Processing 5 brands x 5 orders = 25 orders, each with 12 products = 300 Printful API calls
**Why it happens:** 100ms sleep between requests is not sufficient for sustained batch
**How to avoid:** Implement proper 429 detection with exponential backoff, add per-brand delays between batches
**Warning signs:** Printful returns 429 errors mid-batch

### Pitfall 5: Drive folder hierarchy race condition
**What goes wrong:** Two concurrent uploads for same brand on same date both try to create the date subfolder
**Why it happens:** The folder-create-if-not-exists check in upload-to-drive.js is not atomic
**How to avoid:** Not an issue in current serial processing, but document for Phase 4 when Gwen runs autonomously
**Warning signs:** Duplicate date folders in Drive

## Code Examples

### Existing scoring algorithm (lib/scorer.js)
```javascript
// Current signals (100 points max):
// - reaction_score: score * 10 (max 50)
// - clear_product: 15 points
// - layout_bonus: 5 points for portrait
// - recency: 10 points (time-decay)
// - tags_diversity: up to 10 points
// - has_good_hook: 10 points

// Enhancement needed for Phase 3:
// - illustration_quality_proxy: inferred from product category + order completeness
// - people_count: number of people in illustration (from tags or metadata)
// - body_framing: full-body > shoulder-up (from tags or metadata)
```

### Existing batch-produce flow (batch-produce.sh)
```bash
# Current flow per order:
# 1. Verify workspace exists
# 2. Build video (single type: UGC or reels)
# 3. Generate social copy
# 4. Upload to Drive

# Phase 3 enhancement:
# 1. Fetch assets via OMS adapter (if not present)
# 2. Generate mockups (if not present)
# 3. Stage with Gemini (if not staged)
# 4. Build BOTH video types (UGC + reels, or reels-only)
# 5. Generate social copy
# 6. Upload ALL outputs to Drive (both videos + social copy doc)
```

### Existing stage-products.sh retry pattern
```bash
# Already implements 3x retry with exponential backoff:
for attempt in $(seq 1 $MAX_RETRIES); do
    if stage_image "$mockup" "$mockup" "$product_key"; then
        staged=true; break
    else
        if [[ $attempt -lt $MAX_RETRIES ]]; then
            backoff=$((2 ** attempt))
            sleep "$backoff"
        fi
    fi
done
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded TY pipeline | Brand-parameterized scripts | Phase 1 (2026-02-27) | Any brand config drives video build |
| No consent gate | Full consent system | Phase 2 (2026-03-01) | Orders need approval before production |
| Manual order selection | Scoring algorithm | Phase 2 | Automated ranking with manual approval |

**Key codebase facts:**
- `build-video.sh` already supports both UGC (with reaction) and reels (without) via `HAS_REACTION` flag
- `daily-pipeline.sh` already iterates all 5 brands and calls the full pipeline
- `upload-to-drive.js` already creates date-based subfolder hierarchy
- `lib/social-copy.js` already generates 4-platform copy (YouTube, TikTok, Instagram, X)
- Brand configs already have `drive_folder_ids.video_pipeline` for all 5 brands

## Open Questions

1. **PopSmiths art source API**
   - What we know: Art comes from a Heroku server, not the shared OMS
   - What's unclear: Exact API endpoint, authentication method, response format
   - Recommendation: Add `heroku_app` and `heroku_api_url` fields to popsmiths.json config; implementation discovers the exact API during execution

2. **PopSmiths AI lifestyle imagery generation**
   - What we know: Need styled room scenes with framed PopSmiths art
   - What's unclear: Which AI service produces best results for home-decor aesthetic
   - Recommendation: Use Gemini (already integrated for staging) with prompts tuned for interior design scenes. Same API, same auth, same error handling.

3. **TurnedComics composition needs**
   - What we know: Hand-drawn art style may need different composition handling
   - What's unclear: Specific adjustments needed
   - Recommendation: Add optional `composition_overrides` field to brand config (e.g., different framing, padding, or staging prompts for hand-drawn art)

## Sources

### Primary (HIGH confidence)
- Codebase inspection: All scripts in `/Users/lcalderon/github/video-pipeline/scripts/` and `/Users/lcalderon/github/video-pipeline/lib/`
- Brand configs: All 5 JSON files in `/Users/lcalderon/github/video-pipeline/brands/`
- Phase 1 and 2 decisions from STATE.md

### Secondary (MEDIUM confidence)
- Gemini image generation API capabilities (from existing stage-products.sh integration)
- Printful/Gooten API rate limits (inferred from existing generate-mockups.js patterns)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies needed
- Architecture: HIGH - extending existing scripts, not building new systems
- Pitfalls: HIGH - identified from direct codebase inspection

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable codebase, no external dependency changes expected)
