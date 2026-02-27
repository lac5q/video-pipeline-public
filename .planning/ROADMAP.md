# Roadmap: Video Pipeline -- Multi-Brand Content Production System

## Overview

This roadmap takes a proven single-brand video pipeline (TurnedYellow) and extends it to serve all five brands with automated customer consent, multi-brand production, and autonomous daily execution via Gwen. The path is: establish brand config and quality foundations, build the consent system (legal hard gate), connect all brands into end-to-end production, then hand the keys to Gwen for autonomous daily operation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Brand Config and Pipeline Foundation** - Brand config system, path abstraction, and quality safeguards that all downstream work depends on
- [ ] **Phase 2: Customer Consent System** - Branded consent emails, state tracking, batch approval, and link-based opt-in with thank-you coupons
- [ ] **Phase 3: Multi-Brand Production Pipeline** - OMS and PopSmiths integration, UGC and standard reels for all brands, Drive upload, and API resilience
- [ ] **Phase 4: Autonomous Daily Pipeline** - Gwen orchestrates the full daily pipeline with scheduling, checkpoints, and circuit breakers

## Phase Details

### Phase 1: Brand Config and Pipeline Foundation
**Goal**: Any brand's config can drive a correct, quality-validated video build without hardcoded values
**Depends on**: Nothing (first phase)
**Requirements**: BRAND-01, BRAND-02, BRAND-05, QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05
**Success Criteria** (what must be TRUE):
  1. Running the pipeline with a brand name produces a video using that brand's logo, accent color, CTA text, and music -- not TurnedYellow defaults
  2. No hardcoded `/Users/lcalderon/` paths remain in any script -- all paths resolve from config or environment variables
  3. Every product in the video uses OMS-correct position parameters (450x450 apparel, orientation-aware wall art, rotated phone cases, front-view mugs) with no distortions
  4. All products in the video are Gemini-staged into lifestyle scenes -- no raw Printful mockups appear
  5. Video output meets spec (1080x1920 portrait, CRF 18, h264, 30fps, blurred background fill) and existing TY build scripts remain intact as backup
**Plans**: 3 plans in 3 waves

Plans:
- [ ] 01-01-PLAN.md -- Brand JSON configs (5 brands) and shared product catalog with OMS-correct parameters
- [ ] 01-02-PLAN.md -- Parameterized pipeline scripts (produce-video.sh, build-video.sh, verify-video.sh)
- [ ] 01-03-PLAN.md -- Regression test and visual verification against TY-133627 baseline

### Phase 2: Customer Consent System
**Goal**: Customers receive branded consent requests and their approval status is tracked before any order enters video production
**Depends on**: Phase 1
**Requirements**: CONS-01, CONS-02, CONS-03, CONS-04, CONS-05
**Success Criteria** (what must be TRUE):
  1. Customer receives a branded email (matching their order's brand) requesting permission to feature their order in marketing content
  2. Consent state (pending/approved/denied/revoked) persists per order per brand across restarts and is queryable via CLI
  3. Luis can review a batch of suggested order candidates and approve or reject each one via CLI before any consent emails are sent
  4. Customer can click a link in the consent email to approve, and the system auto-updates their consent status without manual intervention
  5. Customer receives a thank-you discount code (Shopify coupon) upon opting in
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Multi-Brand Production Pipeline
**Goal**: All five brands produce publishable UGC and standard reel videos end-to-end -- from order assets to Google Drive upload with social copy
**Depends on**: Phase 1, Phase 2
**Requirements**: BRAND-03, BRAND-04, PROD-01, PROD-02, PROD-03, PROD-05, PROD-06, PROD-07
**Success Criteria** (what must be TRUE):
  1. A shared-OMS brand order (TY, MMJ, TW, or TC) produces both a UGC reel and a standard reel from the same order assets without manual steps
  2. A PopSmiths order retrieves art from its Heroku server (not the shared OMS) and produces a video with appropriate framed-product focus
  3. Order candidates are auto-ranked by a scoring algorithm (illustration quality, reaction video availability, product diversity, recency) and presented for selection
  4. Completed videos land in the correct brand folder on Google Drive (`/{Brand}/videos/{date}/`) with platform-specific social copy docs for YouTube, TikTok, Instagram, and X
  5. Gemini staging retries up to 3x with exponential backoff on failure, and Printful API calls respect rate limits during batch processing
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Autonomous Daily Pipeline
**Goal**: Gwen runs the full production pipeline daily with minimal human oversight -- picking up approved orders, producing videos, and uploading results
**Depends on**: Phase 3
**Requirements**: PROD-04
**Success Criteria** (what must be TRUE):
  1. Gwen executes the daily pipeline on schedule -- selecting consented orders, producing videos for all brands with pending approved orders, and uploading to Drive
  2. Pipeline halts the batch and alerts Luis when errors exceed a threshold (circuit breaker) rather than compounding failures
  3. Every pipeline stage validates its output before the next stage begins (checkpoint validation) -- no half-built videos reach Drive
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Brand Config and Pipeline Foundation | 0/3 | Not started | - |
| 2. Customer Consent System | 0/3 | Not started | - |
| 3. Multi-Brand Production Pipeline | 0/3 | Not started | - |
| 4. Autonomous Daily Pipeline | 0/1 | Not started | - |
