# Requirements: Video Pipeline -- Multi-Brand Content Production System

**Defined:** 2026-02-26
**Core Value:** Any approved customer order from any brand becomes a publishable video without manual intervention

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Brand System

- [x] **BRAND-01**: Brand config system with JSON configs (logo, accent color, CTA text, product catalog, music pool, tone) for all 5 brands (TY, MMJ, TW, TC, PopSmiths)
- [x] **BRAND-02**: Brand-aware video build -- parameterized ffmpeg scripts read brand config instead of hardcoded TY values
- [x] **BRAND-03**: OMS integration for shared-OMS brands (TY, MMJ, TW, TC) -- pull photos, illustrations, reaction videos per brand
- [x] **BRAND-04**: PopSmiths integration -- retrieve art from Heroku server, handle headless Shopify, stronger frame/product focus in video composition
- [x] **BRAND-05**: Path abstraction -- eliminate hardcoded `/Users/lcalderon/` paths; use config-driven workspace locations so Gwen can execute independently

### Consent & Permissions

- [x] **CONS-01**: Customer consent request emails -- branded templates per brand with clear opt-in language and brand identity
- [x] **CONS-02**: Consent state tracking -- pending/approved/denied/revoked per order per brand, persists across restarts (SQLite or JSON)
- [x] **CONS-03**: Batch approval workflow -- system suggests order candidates, Luis approves/rejects batch via CLI
- [x] **CONS-04**: Link-based opt-in -- customer clicks approval link in email, consent status auto-updates to approved
- [x] **CONS-05**: Thank-you coupon on consent -- generate or assign Shopify discount code when customer opts in (single shared code or per-customer unique code)

### Production Pipeline

- [x] **PROD-01**: UGC video build for all brands (reaction clip + product showcase + branded end card)
- [x] **PROD-02**: Standard reels video build for all brands (no reaction clip, product showcase only)
- [x] **PROD-03**: Order candidate auto-selection -- scoring algorithm based on illustration quality, reaction video availability, product diversity, recency
- [x] **PROD-04**: Gwen autonomous daily pipeline -- picks up approved orders, produces videos, uploads to Drive with social copy docs
- [x] **PROD-05**: Google Drive upload with per-brand folder structure (`/{Brand}/videos/{date}/`) and platform-specific social copy docs (YouTube, TikTok, Instagram, X)
- [x] **PROD-06**: Gemini staging retry logic -- up to 3x with exponential backoff on FinishReason.OTHER failures
- [x] **PROD-07**: Printful/Gooten rate limit handling -- queue with backoff for multi-brand batch processing

### Quality Safeguards

- [x] **QUAL-01**: Zero distortions -- every product uses OMS-correct position parameters (450x450 for apparel, orientation-aware for wall art, rotated for phone cases, front view for mug). Each product renders differently.
- [x] **QUAL-02**: All products must be Gemini-staged into lifestyle scenes -- no raw Printful mockups in final video
- [x] **QUAL-03**: Maximum product showcase -- show as many of the order's products as possible in each video (currently 12-16)
- [x] **QUAL-04**: Preserve existing TY pipeline -- keep current working build scripts (build-ugc-v11.sh, build-ugc-v1.sh) intact as backup. New pipeline builds alongside, does not replace until proven.
- [x] **QUAL-05**: Video specs enforced -- 1080x1920 portrait, CRF 18, h264, 30fps, blurred background fill (no black bars, no stretching)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Content Calendar

- **CAL-01**: Cross-brand content calendar -- spread publications across the week to avoid audience fatigue
- **CAL-02**: Platform-optimal posting times per brand

### Advanced Consent

- **ACONS-01**: Consent email reply auto-detection (parse email replies for approval/denial)
- **ACONS-02**: Consent expiration windows and renewal

### Enhancement

- **ENH-01**: Illustration quality scoring via Gemini Vision (automated visual quality ranking)
- **ENH-02**: AI-generated thumbnails from video frames
- **ENH-03**: Music rotation per brand with mood matching

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web dashboard | CLI/agent-driven is sufficient for 1 operator at current scale |
| Auto-posting to social platforms | Loses quality control on captions, timing, audience targeting |
| Real-time video editing UI | Undermines batch automation model; fix templates not individual videos |
| Customer-facing video delivery | Videos are marketing assets, not customer deliverables |
| Multi-language support | All 5 brands are English-market |
| Per-video AI music selection | Music pools per brand sufficient; marginal benefit for high complexity |
| Fully automated order selection (no human) | Quality catastrophe risk; human batch approval is 2 min/day |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRAND-01 | Phase 1 | Complete |
| BRAND-02 | Phase 1 | Complete |
| BRAND-03 | Phase 3 | Complete |
| BRAND-04 | Phase 3 | Complete |
| BRAND-05 | Phase 1 | Complete |
| CONS-01 | Phase 2 | Complete |
| CONS-02 | Phase 2 | Complete |
| CONS-03 | Phase 2 | Complete |
| CONS-04 | Phase 2 | Complete |
| CONS-05 | Phase 2 | Complete |
| PROD-01 | Phase 3 | Complete |
| PROD-02 | Phase 3 | Complete |
| PROD-03 | Phase 3 | Complete |
| PROD-04 | Phase 4 | Complete |
| PROD-05 | Phase 3 | Complete |
| PROD-06 | Phase 3 | Complete |
| PROD-07 | Phase 3 | Complete |
| QUAL-01 | Phase 1 | Complete |
| QUAL-02 | Phase 1 | Complete |
| QUAL-03 | Phase 1 | Complete |
| QUAL-04 | Phase 1 | Complete |
| QUAL-05 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap creation*
