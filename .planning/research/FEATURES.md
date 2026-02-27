# Feature Research

**Domain:** Multi-brand automated video content production pipeline
**Researched:** 2026-02-26
**Confidence:** MEDIUM — domain is niche (internal tooling for 5-brand family), so "table stakes" is defined against the PROJECT.md requirements and industry UGC/content-production norms, not a broad SaaS market.

## Feature Landscape

### Table Stakes (Users Expect These)

"Users" here means Luis (operator) and Gwen (autonomous agent). Missing these means the pipeline cannot fulfill its core value: any approved order from any brand becomes a publishable video without manual intervention.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Multi-brand config system** | 5 brands exist today; single-brand hardcoding is already a blocker | MEDIUM | Logo, accent color, CTA text, product catalog, tone per brand. JSON/YAML config files. TY config exists as reference. |
| **Brand-aware video build** | Videos must carry correct logo, colors, CTA for each brand | MEDIUM | Parameterize existing ffmpeg build scripts to read brand config instead of hardcoded TY values. |
| **Customer consent request emails** | Legal requirement — cannot feature customer orders without explicit permission | MEDIUM | Branded email templates per brand. Must include opt-in link, clear language, brand identity. |
| **Consent tracking (pending/approved/denied)** | Pipeline must know which orders are cleared for production | LOW | Simple state machine per order. JSON/SQLite store. Must survive restarts. |
| **Order candidate auto-selection** | Manual order picking does not scale across 5 brands daily | HIGH | Scoring algorithm: illustration quality (resolution, completeness), reaction video availability, product diversity, recency. This is the hardest table-stakes feature. |
| **Batch approval workflow** | Human-in-the-loop quality gate before consent emails go out | LOW | System suggests N orders, Luis approves/rejects batch. CLI interface sufficient. |
| **UGC + standard reels for all brands** | Both video types proven valuable for TY; other brands need parity | LOW | Existing ffmpeg templates generalize well; main work is parameterization. |
| **Google Drive upload with brand folder structure** | Existing for TY, must extend to per-brand folder hierarchy | LOW | `/{Brand}/videos/{date}/` structure. Social copy docs per brand tone. |
| **OMS integration for all shared-OMS brands** | TY/MMJ/TW/TC share the OMS; pipeline must pull from it for any brand | MEDIUM | API already proven for TY. Extend to brand-specific product catalogs and position parameters. |
| **Retry logic for Gemini staging** | Gemini is non-deterministic (FinishReason.OTHER); production cannot fail silently | LOW | Up to 3 retries with exponential backoff. Already known constraint. |
| **Printful/Gooten rate limit handling** | Batch processing across 5 brands will hit limits faster | LOW | Queue with backoff. Existing for single-brand; needs to be brand-aware. |

### Differentiators (Competitive Advantage)

These are not required for the pipeline to function, but they multiply its value significantly.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Gwen autonomous daily pipeline** | Zero-touch daily production. Gwen picks up approved orders, produces videos, uploads — Luis only approves batches. | HIGH | Requires all table stakes working first. Scheduling (cron/heartbeat), health checks, error recovery, daily summary report. The capstone feature. |
| **Illustration quality scoring** | Automatically rank order candidates by visual quality instead of manual review | HIGH | Could use image resolution heuristics, aspect ratio checks, face detection, or Gemini vision scoring. Start simple (resolution + file size), evolve later. |
| **Cross-brand content calendar awareness** | Avoid publishing 5 brand videos on the same day; spread content across the week | MEDIUM | Simple round-robin or calendar-aware scheduling. Prevents audience fatigue and maximizes reach. |
| **PopSmiths integration** | Different infrastructure (Heroku art server, headless Shopify) but same production pipeline | HIGH | Requires separate asset retrieval path. Stronger frame/product focus means different video composition templates. |
| **TurnedComics integration** | Hand-drawn art and printed add-ons create unique video content | MEDIUM | Different product catalog and staging approach. Hand-drawn art may need different Gemini prompts for staging. |
| **Consent email response tracking** | Auto-detect email replies (approved/denied) instead of manual status updates | HIGH | Email parsing is fragile. Could use simple link-based opt-in (click to approve) instead. Gmail API or webhook approach. |
| **Production audit trail** | Full log of what was produced, when, from which order, with which assets — per brand | LOW | Append-only JSON log per production run. Invaluable for debugging and compliance. |
| **Music rotation per brand** | Each brand gets a curated music pool matching its tone instead of shared tracks | LOW | Simple config: list of tracks per brand. Random selection from pool. Already have copyright-free library. |
| **Social copy brand voice** | Platform-specific copy (YT, TikTok, IG, X) tuned to each brand's tone | MEDIUM | LLM-generated copy with brand voice prompts. TY copy exists as template. Each brand needs distinct voice config. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Web dashboard** | Visual oversight feels professional | Massive engineering cost for 1 operator. CLI/agent is faster to build and iterate. Dashboard becomes maintenance burden. | CLI batch approval + Gwen daily summary in Slack/email. |
| **Auto-posting to social platforms** | Eliminates last manual step | Loses quality control on captions, timing, audience targeting. Platform API changes constantly. One bad auto-post can damage brand. | Videos to Drive, humans post. Maintain creative judgment on distribution. |
| **Real-time video editing UI** | Allows per-video tweaks | Undermines the batch automation model. Creates dependency on manual intervention. | Fix templates/configs, not individual videos. If a video is bad, fix the pipeline. |
| **Customer-facing video delivery** | Seems like a nice customer perk | Videos are marketing assets, not customer deliverables. Sharing draft marketing content with customers creates expectation management issues. | Keep videos internal for brand marketing use only. |
| **AI-generated thumbnails** | Thumbnails matter for social | Premature optimization. Thumbnail quality depends on platform-specific testing. Defer until video production is stable across all brands. | Manual thumbnail selection from video frames for now. Revisit after production is running. |
| **Fully automated order selection (no human approval)** | Maximum automation | Quality catastrophe risk. Bad illustration + bad mockup + wrong product = brand damage. Human batch approval is 2 minutes/day. | Auto-suggest with batch approve. Human stays in the loop for quality. |
| **Per-video music selection via AI** | Optimal audio-visual pairing | Over-engineering. Music pools per brand are sufficient. AI music matching adds complexity for marginal benefit. | Curated pools per brand with random rotation. |
| **Multi-language support** | Broader audience reach | All 5 brands are English-market. Localization is a separate project entirely. | Keep English-only. Revisit only if brands expand internationally. |

## Feature Dependencies

```
[Brand Config System]
    +--requires--> [OMS Integration per Brand]
    +--requires--> [Logo/Color/CTA Assets per Brand]
    |
    +--enables--> [Brand-Aware Video Build]
    |                 +--enables--> [UGC + Standard Reels All Brands]
    |                 +--enables--> [Social Copy Brand Voice]
    |
    +--enables--> [Consent Email Templates per Brand]
                      +--enables--> [Consent Tracking]
                                        +--enables--> [Batch Approval Workflow]

[Order Candidate Auto-Selection]
    +--requires--> [OMS Integration per Brand]
    +--requires--> [Consent Tracking] (must know what's already pending/denied)
    +--enables--> [Batch Approval Workflow]

[Batch Approval Workflow]
    +--requires--> [Order Candidate Auto-Selection]
    +--requires--> [Consent Tracking]
    +--enables--> [Gwen Autonomous Daily Pipeline]

[Gwen Autonomous Daily Pipeline]
    +--requires--> [ALL table stakes features]
    +--requires--> [Batch Approval Workflow]
    +--requires--> [Brand-Aware Video Build]
    +--requires--> [Retry Logic / Error Recovery]

[PopSmiths Integration]
    +--requires--> [Brand Config System]
    +--requires--> [Separate Asset Retrieval (Heroku art server)]
    +--conflicts--> [shared OMS assumptions] (needs its own asset path)

[TurnedComics Integration]
    +--requires--> [Brand Config System]
    +--requires--> [OMS Integration] (uses shared OMS)
```

### Dependency Notes

- **Brand Config System is the foundation:** Nearly everything depends on it. Build first.
- **OMS Integration unlocks candidate selection:** Cannot score orders without access to order data per brand.
- **Consent Tracking blocks production:** No video can be produced without consent state. Must be in place before any batch processing.
- **Gwen Autonomous Pipeline is the capstone:** Requires all other features working reliably. Build last.
- **PopSmiths conflicts with shared OMS assumptions:** Its Heroku art server and headless Shopify mean the asset retrieval path must be abstracted, not hardcoded to the shared OMS.

## MVP Definition

### Launch With (v1)

Minimum viable: extend the proven TY pipeline to one additional brand end-to-end.

- [ ] **Brand config system** — JSON configs for TY + MMJ (two brands proves the abstraction)
- [ ] **Brand-aware video build** — parameterized ffmpeg scripts reading brand config
- [ ] **OMS integration for MMJ** — pull MMJ orders from shared OMS
- [ ] **Consent tracking** — simple JSON store with pending/approved/denied states
- [ ] **Consent email templates** — branded emails for TY and MMJ
- [ ] **Batch approval CLI** — Luis reviews suggested orders, approves/rejects

### Add After Validation (v1.x)

Features to add once two-brand pipeline is running reliably.

- [ ] **Order candidate auto-selection** — scoring algorithm replaces manual picking
- [ ] **TurnedWizard + TurnedComics configs** — extend brand configs to 4 brands
- [ ] **Music rotation per brand** — curated pools instead of shared tracks
- [ ] **Social copy brand voice** — per-brand tone in generated copy
- [ ] **Production audit trail** — append-only logs per run

### Future Consideration (v2+)

Features to defer until multi-brand production is stable daily.

- [ ] **Gwen autonomous daily pipeline** — full autonomy with scheduling and health checks
- [ ] **PopSmiths integration** — separate asset retrieval, different video composition
- [ ] **Consent email auto-tracking** — link-based opt-in with auto-status update
- [ ] **Cross-brand content calendar** — spread publications across the week
- [ ] **Illustration quality scoring via vision AI** — automated quality ranking

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Brand config system | HIGH | MEDIUM | P1 |
| Brand-aware video build | HIGH | MEDIUM | P1 |
| Consent tracking | HIGH | LOW | P1 |
| Consent email templates | HIGH | MEDIUM | P1 |
| Batch approval CLI | HIGH | LOW | P1 |
| OMS integration (all shared-OMS brands) | HIGH | MEDIUM | P1 |
| UGC + standard reels all brands | HIGH | LOW | P1 |
| Order candidate auto-selection | HIGH | HIGH | P2 |
| Gwen autonomous daily pipeline | HIGH | HIGH | P2 |
| Music rotation per brand | MEDIUM | LOW | P2 |
| Social copy brand voice | MEDIUM | MEDIUM | P2 |
| Production audit trail | MEDIUM | LOW | P2 |
| PopSmiths integration | MEDIUM | HIGH | P3 |
| TurnedComics integration | MEDIUM | MEDIUM | P3 |
| Consent email auto-tracking | LOW | HIGH | P3 |
| Cross-brand content calendar | LOW | MEDIUM | P3 |
| Illustration quality scoring (vision AI) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — pipeline does not function without these
- P2: Should have, add when core pipeline is running — multiplies value
- P3: Nice to have, defer until daily production is stable

## Competitor Feature Analysis

This is internal tooling, not a SaaS product, so "competitors" are alternative approaches rather than competing products.

| Feature | Manual Approach (Status Quo) | SaaS Tools (Canva/Synthesia) | Our Pipeline |
|---------|------------------------------|------------------------------|--------------|
| Multi-brand video | Manually swap logos/colors per brand in editor | Brand kits with template switching | Config-driven, fully automated per brand |
| Consent management | Spreadsheet tracking, manual emails | UGC platforms (TINT, Flowbox) charge $500+/mo | Simple JSON store + branded email templates |
| Order selection | Luis reviews orders manually | N/A — no tool does this | Scoring algorithm with human batch approval |
| Daily production | Luis runs scripts manually | Hire a video editor ($3-5K/mo) | Gwen autonomous agent, zero marginal cost |
| Social copy | Write manually per platform per brand | AI copywriting tools (separate subscription) | Integrated LLM generation with brand voice |

## Sources

- [LTX Studio — AI Content Creation for Enterprises](https://ltx.studio/blog/best-ai-content-creation-tools-for-enterprises) — multi-brand creative automation features
- [Marq — Brand Management Platforms 2026](https://www.marq.com/blog/brand-management-software/) — brand consistency at scale
- [Influee — UGC Rights Management Guide](https://influee.co/blog/ugc-rights-management) — consent and rights management best practices
- [Flowbox — UGC Permission and Legal Issues](https://getflowbox.com/blog/user-generated-content-permission/) — legal framework for UGC consent
- [Enzuzo — Customer Consent for UGC](https://www.enzuzo.com/blog/consent-for-user-generated-content) — consent types (expressed vs implied)
- [The Unwind AI — Autonomous AI Agent Team 24/7](https://www.theunwindai.com/p/how-i-built-an-autonomous-ai-agent-team-that-runs-24-7) — cron/heartbeat scheduling patterns for autonomous agents
- [Arxiv — Production-Grade Agentic AI Workflows](https://arxiv.org/html/2512.08769v1) — architecture patterns for autonomous production pipelines
- Existing TY build scripts (`orders/133627/exports/build-ugc-v11.sh`) — reference implementation for video build parameterization

---
*Feature research for: Multi-brand automated video content production pipeline*
*Researched: 2026-02-26*
