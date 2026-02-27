# Pitfalls Research

**Domain:** Multi-brand automated video production pipeline (UGC/reels) with customer consent and autonomous agent orchestration
**Researched:** 2026-02-26
**Confidence:** HIGH (domain-specific analysis grounded in project context and verified patterns)

## Critical Pitfalls

### Pitfall 1: Brand Config Leakage Between Brands

**What goes wrong:**
Brand-specific values (logo, accent color, CTA text, domain URL, tone) bleed between brands during batch runs. A TurnedYellow video gets a MakeMeJedi logo end card, or PopSmiths accent colors appear on TurnedWizard content. With five brands sharing one pipeline, the blast radius of a config mistake is every video produced in that batch.

**Why it happens:**
The existing pipeline (see `build-ugc-v11.sh`) hardcodes brand values inline --- `BRAND_DARK="0x1a1a2e"`, `"TurnedYellow.com"`, logo path. When refactoring to multi-brand, developers often use a global/mutable config object that gets loaded once and mutated per brand, or they pass brand context through too many layers, creating opportunities for stale state. Shell scripts are especially prone to this because environment variables persist across function calls.

**How to avoid:**
- Make brand configs immutable, loaded fresh per order --- never reuse a config object across brands in a batch run.
- Each brand config file must be self-contained (logo path, hex colors, CTA text, domain, product catalog, tone keywords). Validate completeness at load time with a schema check.
- Add a brand watermark assertion: before any video export, programmatically verify the logo file basename matches the expected brand.
- Unit test: render one frame of each brand's logo end card and assert pixel color at a known coordinate matches that brand's accent color.

**Warning signs:**
- Brand config is a single mutable dictionary/object shared across a loop.
- No validation step between "load config" and "start render."
- Test videos only ever produced for TurnedYellow (the established brand).

**Phase to address:**
Brand Config System phase (first phase) --- this is the foundation everything else builds on. Must be locked down before any multi-brand video production begins.

---

### Pitfall 2: Consent State Machine Gaps

**What goes wrong:**
The consent tracking system has incomplete state transitions, leading to orders being featured without explicit permission or approved orders never being picked up. Common gaps: no handling for "consent expired" (customer approved 6 months ago, is that still valid?), no handling for "consent revoked after video produced" (video already on Drive/posted), no distinction between "never asked" and "asked, no response."

**Why it happens:**
Consent looks simple on paper (pending/approved/denied) but has real-world edge cases: customers reply to the wrong email, consent emails bounce, a customer approves for TurnedYellow but their order also appears on PopSmiths, customers request removal after publication. Developers build the happy path (ask -> approve -> produce) and skip the failure/edge paths.

**How to avoid:**
- Define a complete state machine upfront: `NOT_REQUESTED -> REQUESTED -> APPROVED | DENIED | BOUNCED | EXPIRED | REVOKED`. Each transition must be explicit and logged with timestamp.
- Consent is per-order AND per-brand. If a customer's art appears in multiple brands, each brand needs separate consent.
- Set a consent expiration window (e.g., 90 days). If not used within that window, re-request.
- Build the revocation path first: "customer wants their video removed" must work before "customer approves" is built. This forces you to design for the hard case.
- Store consent records with immutable audit trail (append-only log, not mutable status field).

**Warning signs:**
- Consent model only has three states (pending/approved/denied).
- No timestamp on consent transitions.
- No automated test for "what happens if consent is revoked after video upload?"
- No bounce handling on consent emails.

**Phase to address:**
Customer Consent System phase --- must be complete (including revocation and expiration) before the autonomous agent starts producing videos. Partial consent systems are worse than no system because they create false confidence.

---

### Pitfall 3: Autonomous Agent Error Compounding

**What goes wrong:**
Gwen (the orchestrator agent) makes a mistake in step 2 of a 5-step pipeline (e.g., picks wrong mockup parameters, selects an order without consent), and the error cascades through all downstream steps. The video gets produced, uploaded to Drive with social copy, and nobody catches it until the content is published. With daily autonomous runs, bad outputs accumulate before human review.

**Why it happens:**
Agent-driven pipelines have a fundamental reliability problem: LLM outputs are probabilistic, not deterministic. The same prompt can produce different decisions on different days. The existing pipeline was designed for human-in-the-loop operation where Luis reviews each step. Removing the human creates gaps where errors go undetected. Additionally, 95% of agentic AI implementations fail to deliver expected returns, often because they lack defined failure modes and graceful degradation.

**How to avoid:**
- Implement checkpoint validation between every pipeline stage: after asset download, verify file count and dimensions; after mockup generation, verify image dimensions match 1080x1920 portrait; after consent check, verify approval timestamp is within window; after video build, verify duration and codec.
- Never let the agent auto-upload without a quality gate. The "batch approval" workflow (system suggests, Luis approves) is the right design --- do not skip it for "efficiency."
- Build a daily production report that Gwen sends before any uploads: "Today I would produce 4 videos: [order list with thumbnails]. Approve?" This is the human-in-the-loop safeguard.
- Implement circuit breakers: if more than N errors in a single run, halt and alert rather than continuing.
- Log every agent decision with reasoning, so failures can be debugged after the fact.

**Warning signs:**
- Agent has write access to Google Drive without an approval gate.
- No validation between pipeline stages.
- "It works when I run it manually" but no automated verification.
- Error handling is `|| true` or silent failures in shell scripts.

**Phase to address:**
Autonomous Agent Pipeline phase (final phase) --- this must come last, after all individual pipeline stages are proven reliable with validation. The agent is only as good as the guardrails around it.

---

### Pitfall 4: Hardcoded Paths and Machine-Specific Dependencies

**What goes wrong:**
The pipeline only works on Luis's machine. The existing scripts reference absolute paths (`/Users/lcalderon/clawd/agents/gwen/workspace/...`), system-specific fonts (`/System/Library/Fonts/HelveticaNeue.ttc`), and local music files (`/tmp/brand-music/...`). When Gwen (running via OpenClaw) tries to execute these scripts, paths break. When moving to a different machine or CI environment, nothing works.

**Why it happens:**
The prototype was built for immediate use on one machine (valid for prototyping). But multi-brand automation requires the pipeline to be environment-agnostic because: (a) Gwen may run from a different execution context, (b) brand assets live in different locations, (c) music/font paths differ across environments.

**How to avoid:**
- Extract all paths into environment variables or a workspace config file (`WORKSPACE_ROOT`, `BRAND_ASSETS_DIR`, `MUSIC_DIR`, `FONT_PATH`).
- Use relative paths from a workspace root, never absolute paths in scripts.
- Bundle fonts with the project or use a font that's guaranteed available (e.g., download a specific Google Font at build time).
- Music files should be referenced from a defined, version-controlled catalog --- not `/tmp`.
- Create a `preflight-check.sh` that validates all required paths, tools (ffmpeg, magick, bc), and API credentials exist before any pipeline run.

**Warning signs:**
- Scripts contain `/Users/lcalderon` anywhere.
- `magick` or `ffmpeg` called without checking availability first.
- No `.env.example` or equivalent documenting required environment setup.
- Pipeline works for Luis but fails for Gwen's execution context.

**Phase to address:**
Brand Config System phase --- path abstraction must happen alongside brand config extraction since both involve making the pipeline parameterized rather than hardcoded.

---

### Pitfall 5: PopSmiths Architecture Mismatch

**What goes wrong:**
PopSmiths is treated as "just another brand config" when it has fundamentally different infrastructure: headless Shopify on Heroku (not standard Shopify), art stored on its own Heroku server (not the shared OMS), stronger frame focus in products, and AI-generated art with credits (not hand-illustrated). Attempting to force PopSmiths into the TurnedYellow pipeline pattern causes asset retrieval failures, wrong mockup parameters, and missing attribution.

**Why it happens:**
The "all 5 brands in one system" decision is correct at the pipeline level (video assembly, upload, social copy) but incorrect at the data access level. PopSmiths needs a different asset retrieval adapter. Developers often try to abstract too early, creating a "universal" order fetcher that handles none of the brands well.

**How to avoid:**
- Use an adapter pattern for data access: a common `OrderAssets` interface with brand-specific implementations. TY/MMJ/TW/TC share one adapter (OMS-based). PopSmiths gets its own adapter (Heroku API-based).
- The pipeline itself (mockup -> stage -> build -> upload) stays unified. Only the "get order data" and "get art assets" steps are brand-specific.
- PopSmiths videos must include artist credit overlays --- this is a video template variation, not just a config difference.
- Test PopSmiths integration separately from the other four brands. Do not assume "if TY works, PopSmiths works."

**Warning signs:**
- Brand config has fields like `oms_url` that PopSmiths leaves blank or points to a different system entirely.
- Asset download script has `if brand == "popsmiths"` conditionals scattered throughout.
- PopSmiths is the last brand integrated and gets the least testing.

**Phase to address:**
PopSmiths Integration phase (dedicated phase) --- should not be lumped into "add all brands." The four OMS-based brands can share a phase; PopSmiths needs its own.

---

### Pitfall 6: Gemini API Non-Determinism at Scale

**What goes wrong:**
The Gemini lifestyle staging step (converting mockups into lifestyle scenes) works well for single-order manual runs but fails unpredictably during batch processing across five brands. Failures include: `FinishReason.OTHER` errors, inconsistent scene quality across brands, rate limiting during multi-brand batches, and occasional NSFW false positives on customer photos.

**Why it happens:**
Gemini is a generative AI API --- its outputs are inherently non-deterministic. The project already documents "retry logic up to 3x on FinishReason.OTHER" as a known constraint. But at batch scale (5 brands x N orders per day), the failure rate compounds. A 5% per-call failure rate means a 40% chance of at least one failure in a 10-order batch.

**How to avoid:**
- Implement exponential backoff with jitter on Gemini retries, not fixed retry count.
- Cache successful staging results: if the same mockup type (e.g., "framed poster in living room") succeeds, store the prompt+result pair for reference. If a retry exhausts attempts, use the cached scene or flag for manual staging.
- Implement per-brand rate limiting: if processing 5 brands simultaneously, stagger Gemini calls rather than firing all at once.
- Add a staging quality gate: after Gemini returns an image, verify dimensions and do a basic perceptual hash comparison against a known-good example to catch obviously broken outputs (solid color, corrupted image).
- Budget for Gemini API costs scaling 5x when adding all brands.

**Warning signs:**
- Retry logic is a simple loop with no backoff.
- No caching of successful staging results.
- Gemini calls for all brands run in parallel without rate awareness.
- No quality check on Gemini output (blindly accepted).
- API costs are not tracked per brand.

**Phase to address:**
Multi-brand Pipeline phase --- Gemini resilience must be hardened before daily autonomous runs begin. The current retry logic is sufficient for manual single-order runs but not for batch automation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline brand values in shell scripts | Fast prototyping, works for TY | Every new brand requires script duplication, brand errors undetectable | Only during initial TY prototyping (already past this) |
| Single monolithic build script per order | Easy to understand, self-contained | Cannot reuse stages, cannot test stages independently, no partial re-runs | Never for multi-brand (must decompose) |
| Storing consent as a flat file or simple DB column | Quick to implement | No audit trail, no state machine, difficult to prove compliance | Only for initial testing with fake data |
| Using system fonts in ffmpeg/magick | No font management needed | Breaks on different OS/machine, inconsistent across environments | Never for automated pipeline |
| Manual music file placement in /tmp | Quick for prototyping | Files disappear on reboot, no version control, no catalog | Never for production pipeline |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Printful API | Firing all mockup requests simultaneously, hitting 120/min rate limit | Implement a request queue with 100/min target (leaving headroom). Mockup generation endpoint has even lower limits --- test empirically and respect it |
| Shopify (multi-store) | Using same API credentials/scopes for all brands, assuming identical order schemas | Each Shopify store has its own API credentials. PopSmiths headless store may have different order metadata. Use per-store credential management |
| Google Drive API | Uploading files to root then moving to brand folder (two API calls) | Create file directly in target folder by setting `parents` in the create request. Batch uploads limited to 100 calls per batch request. Media (video files) cannot be batched --- must upload individually |
| Shared OMS (Heroku) | Assuming OMS API is always available, no timeout handling | OMS is on Heroku free/hobby tier (if applicable) --- may sleep after inactivity. Add health check before batch runs, implement timeouts, handle 503s gracefully |
| Gemini API | Trusting staging output without validation | Verify output image dimensions, file size > 0, and basic sanity before proceeding to video build |
| Email (consent) | Using personal Gmail for consent emails | Use a branded sender domain with proper SPF/DKIM/DMARC. Personal accounts hit send limits and look unprofessional. Consent emails from `noreply@turnedyellow.com` not `lcalderon@gmail.com` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential single-threaded video builds | Daily pipeline takes 2+ hours for 5 brands | Parallelize video builds per brand (each brand's ffmpeg pipeline is independent). Use GNU parallel or background jobs with wait | At 3+ brands with 3+ orders each |
| No intermediate file cleanup | Disk fills up with temp files from `TMP` directories | Add cleanup step after successful export. Each order's temp dir can be 2-5 GB (staging images + video segments) | After 1-2 weeks of daily runs |
| Gemini API without caching | Same product types re-staged every run, burning API quota and time | Cache staged lifestyle images by product type + brand. A "TY framed poster in living room" scene is reusable across orders | At 10+ orders/day across brands |
| Downloading full-resolution assets when thumbnails suffice | Asset download takes 10+ minutes per order | For preview/approval workflows, download thumbnails. Only fetch full-res after consent is confirmed and production is approved | At 5+ orders/day |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing API keys (Printful, Shopify, Gemini) in brand config JSON files | Keys committed to git, leaked in logs, accessible to anyone with repo access | Use environment variables or a secrets manager. Brand configs contain brand identity (colors, logos) not credentials. Add `*.env` to `.gitignore` |
| Consent records without access controls | Anyone with Drive/repo access can see which customers consented, their email addresses, order details | Consent database should be separate from the video pipeline repo. Access restricted to Luis and Gwen's service account only |
| Customer photos/illustrations stored in public or shared directories | Customer PII (faces in photos) exposed beyond necessary scope | Order assets should be in a private workspace, cleaned up after video production. Never commit customer photos to git |
| Email consent system without unsubscribe mechanism | CAN-SPAM violation (US). Even transactional/one-time consent requests should include opt-out from future requests | Include unsubscribe link in consent emails. Track opt-outs to prevent re-requesting |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Consent email looks like spam or phishing | Customer ignores or reports it, consent rate drops to near-zero | Use branded email template matching the store's visual identity. Include order details (product thumbnail, order number) so customer recognizes it. Short, clear ask: "Can we feature your order in our social media?" |
| Batch approval shows only order numbers | Luis cannot make quality judgments without seeing the actual content | Batch approval must show: customer photo thumbnail, illustration preview, product mockup samples, and reaction video thumbnail. Visual approval, not text-based |
| No feedback on why an order was auto-rejected | Unclear why pipeline skipped certain orders, hard to tune selection criteria | Log rejection reasons: "no reaction video," "illustration quality score below threshold," "consent not yet approved." Surface in daily report |
| Social copy is identical across brands | Each brand has different audience and tone; generic copy feels inauthentic | Social copy templates must be per-brand with tone guidelines. TurnedYellow is warm/family-oriented, MakeMeJedi is playful/fandom, PopSmiths is artistic/discovery-focused |

## "Looks Done But Isn't" Checklist

- [ ] **Brand config system:** Often missing product catalog mapping (which Printful/Gooten product IDs belong to which brand) --- verify each brand config includes its complete product-to-mockup-parameter mapping
- [ ] **Consent email:** Often missing bounce handling --- verify what happens when the customer's email bounces (status should move to BOUNCED, not stay in REQUESTED forever)
- [ ] **Video build:** Often missing audio normalization --- verify loudness levels are consistent across brands and music tracks (LUFS target)
- [ ] **Google Drive upload:** Often missing folder existence check --- verify the brand's Drive folder structure exists before upload, create if missing
- [ ] **Order selection:** Often missing deduplication --- verify the same order cannot be selected for video production twice (once manually, once by agent)
- [ ] **Multi-brand batch:** Often missing per-brand error isolation --- verify that a failure in TurnedWizard processing does not halt TurnedYellow production
- [ ] **Social copy:** Often missing platform character limits --- verify TikTok (2200), Instagram (2200), X (280), YouTube (5000) limits are respected per platform
- [ ] **Consent tracking:** Often missing "already featured" flag --- verify that once a video is produced and uploaded for an order, the order is marked as completed so it is not re-processed

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Brand config leakage (wrong logo on video) | LOW | Re-run video build with correct config. If already uploaded, replace file on Drive. If already posted to social, delete and repost with apology |
| Consent violation (video produced without approval) | HIGH | Immediately remove video from Drive and any social platforms. Document the incident. Contact customer to apologize. Audit consent system for the gap that allowed it. Legal review if content was published |
| Agent error compounding (bad batch produced) | MEDIUM | Identify the error point via decision logs. Re-run from that checkpoint with corrected inputs. Implement the missing validation that would have caught it |
| PopSmiths asset retrieval failure | LOW | Fall back to manual asset download for PopSmiths orders. Fix adapter. Does not affect other four brands |
| Gemini staging failure (batch) | LOW | Use cached staging results for affected product types, or flag for manual staging. Remaining orders proceed normally |
| Disk full from temp files | MEDIUM | Clear temp directories. Implement cleanup in pipeline. May need to re-run interrupted orders |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Brand config leakage | Brand Config System | Schema validation test: load each brand config, assert all required fields present and distinct. Render test frame per brand, assert visual identity matches |
| Consent state machine gaps | Customer Consent System | State machine test: attempt every transition, verify only valid ones succeed. Test revocation path end-to-end |
| Agent error compounding | Autonomous Agent Pipeline | Integration test: inject a bad asset at each pipeline stage, verify the error is caught and does not propagate |
| Hardcoded paths | Brand Config System | Run pipeline in a clean environment (different user, different paths). If it fails, paths are not properly abstracted |
| PopSmiths architecture mismatch | PopSmiths Integration | Produce one complete PopSmiths video end-to-end using only the automated pipeline (no manual steps) |
| Gemini non-determinism at scale | Multi-brand Pipeline | Run a 10-order batch across 3+ brands. Measure failure rate. Verify retry/fallback logic handles all failures without human intervention |
| Email deliverability | Customer Consent System | Send test consent emails to multiple providers (Gmail, Outlook, Yahoo). Verify inbox delivery (not spam), SPF/DKIM pass, unsubscribe works |
| Printful rate limiting | Multi-brand Pipeline | Run a batch of 50+ mockup requests. Verify rate limiter keeps requests under 100/min and all requests eventually succeed |

## Sources

- [dotCMS: What Multi-Brand Companies Need to Avoid Content Chaos](https://www.dotcms.com/blog/what-multi-brand-companies-need-to-do-to-avoid-content-chaos)
- [HBR: Why Agentic AI Projects Fail](https://hbr.org/2025/10/why-agentic-ai-projects-fail-and-how-to-set-yours-up-for-success)
- [Beam.ai: Why 95% of Agentic AI Fails](https://beam.ai/agentic-insights/agentic-ai-in-2025-why-90-of-implementations-fail-(and-how-to-be-the-10-))
- [Sendbird: 10 Major Agentic AI Challenges](https://sendbird.com/blog/agentic-ai-challenges)
- [Google Cloud: Lessons from 2025 on Agents and Trust](https://cloud.google.com/transform/ai-grew-up-and-got-a-job-lessons-from-2025-on-agents-and-trust)
- [Printful API Documentation](https://developers.printful.com/docs/)
- [Drupal.org: Printful API Rate Limiting](https://www.drupal.org/project/commerce_printful/issues/3191614)
- [Google Drive API: Manage Uploads](https://developers.google.com/drive/api/guides/manage-uploads)
- [Google Drive API: Improve Performance](https://developers.google.com/workspace/drive/api/guides/performance)
- [MailDiver: GDPR Email Marketing Compliance Guide](https://maildiver.com/blog/gdpr-email-marketing-compliance-guide/)
- [LeadOrigin: Email Marketing Compliance Under GDPR and CAN-SPAM](https://leadorigin.com/email-marketing-compliance/)
- [IMG.LY: Building Production-Ready Batch Video Processing with FFmpeg](https://img.ly/blog/building-a-production-ready-batch-video-processing-server-with-ffmpeg/)
- [Hoop.dev: Auto-Remediation Workflows with FFmpeg](https://hoop.dev/blog/auto-remediation-workflows-with-ffmpeg-building-self-healing-video-pipelines/)
- Existing project codebase: `orders/133627/exports/build-ugc-v11.sh`, `.planning/PROJECT.md`

---
*Pitfalls research for: Multi-brand automated video production pipeline*
*Researched: 2026-02-26*
