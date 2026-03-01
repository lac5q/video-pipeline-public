# Roadmap: Video Pipeline -- Multi-Brand Content Production System

## Milestones

- ✅ **v1.0 Core Pipeline** - Phases 1-4 (shipped 2026-03-01)
- 🚧 **v2.0 Web Dashboard** - Phases 5-8 (in progress)

## Phases

<details>
<summary>✅ v1.0 Core Pipeline (Phases 1-4) - SHIPPED 2026-03-01</summary>

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Brand Config and Pipeline Foundation** - Brand config system, path abstraction, and quality safeguards that all downstream work depends on
- [x] **Phase 2: Customer Consent System** - Branded consent emails, state tracking, batch approval, and link-based opt-in with thank-you coupons (completed 2026-03-01)
- [x] **Phase 3: Multi-Brand Production Pipeline** - OMS and PopSmiths integration, UGC and standard reels for all brands, Drive upload, and API resilience
- [x] **Phase 4: Autonomous Daily Pipeline** - Gwen orchestrates the full daily pipeline with scheduling, checkpoints, and circuit breakers (completed 2026-03-01)

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
- [x] 01-01-PLAN.md -- Brand JSON configs (5 brands) and shared product catalog with OMS-correct parameters
- [x] 01-02-PLAN.md -- Parameterized pipeline scripts (produce-video.sh, build-video.sh, verify-video.sh)
- [x] 01-03-PLAN.md -- Regression test and visual verification against TY-133627 baseline

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
**Plans**: 3 plans in 2 waves

Plans:
- [x] 02-01-PLAN.md -- Data foundation: install nodemailer, per-brand Shopify config, customer enrichment script, consent batch approval CLI
- [x] 02-02-PLAN.md -- Email template fixes (CTA, illustration, tone), Shopify GraphQL coupon upgrade, consent server landing page updates
- [x] 02-03-PLAN.md -- End-to-end smoke test and visual verification checkpoint

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
**Plans**: 3 plans in 3 waves

Plans:
- [x] 03-01: TBD
- [x] 03-02: TBD
- [x] 03-03: TBD

### Phase 4: Autonomous Daily Pipeline
**Goal**: Gwen runs the full production pipeline daily with minimal human oversight -- picking up approved orders, producing videos, and uploading results
**Depends on**: Phase 3
**Requirements**: PROD-04
**Success Criteria** (what must be TRUE):
  1. Gwen executes the daily pipeline on schedule -- selecting consented orders, producing videos for all brands with pending approved orders, and uploading to Drive
  2. Pipeline halts the batch and alerts Luis when errors exceed a threshold (circuit breaker) rather than compounding failures
  3. Every pipeline stage validates its output before the next stage begins (checkpoint validation) -- no half-built videos reach Drive
**Plans**: 1 plan in 1 wave

Plans:
- [x] 04-01-PLAN.md -- Discord notifications, consecutive circuit breaker, checkpoint validation, dual video build, failed order tracking, run state persistence

## v1.0 Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Brand Config and Pipeline Foundation | 3/3 | Complete | 2026-02-27 |
| 2. Customer Consent System | 3/3 | Complete | 2026-03-01 |
| 3. Multi-Brand Production Pipeline | 3/3 | Complete | 2026-03-01 |
| 4. Autonomous Daily Pipeline | 1/1 | Complete | 2026-03-01 |

</details>

---

## 🚧 v2.0 Web Dashboard (In Progress)

**Milestone Goal:** Give Luis a visual control surface to browse illustrations, approve candidates, preview videos, and manage the full pipeline without touching the terminal.

**Phase Numbering continues from v1.0 (last phase was 4).**

- [ ] **Phase 5: Dashboard Foundation** - Stage-gate board shell, brand/status filter presets, per-lane order count badges, order slide-over detail panel, Drive links and upload status, and per-order ranking signals
- [ ] **Phase 6: Illustration Approval and Consent Dispatch** - Illustration thumbnail grid with zoom, per-order approve/reject and batch-approve, consent candidate list with preview, and consent batch send from dashboard
- [ ] **Phase 7: Consent Tracking and Pipeline Control** - Real-time consent status per order, resend consent, pipeline trigger button, live progress stream, run summary, and run history
- [ ] **Phase 8: Video Review and Social Copy** - In-browser video player with approve/reject controls, dual UGC/standard reel review, social copy panel per platform, and clipboard copy

## v2.0 Phase Details

### Phase 5: Dashboard Foundation
**Goal**: Luis can open the dashboard, see all orders organized by pipeline stage across all brands, and instantly understand where every order sits and why
**Depends on**: Phase 4 (extends existing dashboard.js Express server)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, APPR-05, DRIV-01, DRIV-02
**Success Criteria** (what must be TRUE):
  1. User can open the dashboard and see all orders arranged in five lanes (Candidates, Consent Pending, Consent Approved, Video Built, Uploaded to Drive) with accurate order counts per lane
  2. User can click a brand preset button (TurnedYellow, MakeMeJedi, TurnedWizard, TurnedComics, PopSmiths) and the board immediately filters to show only that brand's orders
  3. User can click a consent status filter preset and the board narrows to only orders matching that consent state
  4. User can click any order card to open a slide-over detail panel showing full order metadata (brand, customer, products, dates, ranking signals) without navigating away from the board
  5. User can see the Google Drive folder link for each uploaded order in the detail panel and open it directly, and can see whether each order is uploaded, pending, or failed
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Illustration Approval and Consent Dispatch
**Goal**: Luis can visually inspect illustration quality for all candidate orders and approve or reject them, then send the consent batch to approved candidates -- all without touching the terminal
**Depends on**: Phase 5
**Requirements**: APPR-01, APPR-02, APPR-03, APPR-04, UCONS-01, UCONS-02
**Success Criteria** (what must be TRUE):
  1. User can navigate to an illustration view and see a thumbnail grid of candidate orders, each showing the customer's illustration image
  2. User can click an illustration thumbnail to zoom in and inspect image quality before making an approval decision
  3. User can approve or reject a candidate order individually with a single click from the thumbnail grid
  4. User can batch-approve all visible candidates in one action after confirming a prompt
  5. User can see all consent candidates (approved by Luis but not yet emailed) in a list with illustration previews, select them, and send the consent email batch from the dashboard without using the CLI
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Consent Tracking and Pipeline Control
**Goal**: Luis can monitor live consent responses and trigger the full production pipeline from the dashboard, watching it run in real time
**Depends on**: Phase 6
**Requirements**: UCONS-03, UCONS-04, PIPE-01, PIPE-02, PIPE-03, PIPE-04
**Success Criteria** (what must be TRUE):
  1. User can see real-time consent status per order (pending sent, email opened, approved, declined) that updates without a page refresh
  2. User can resend the consent email to a specific order that declined or did not respond, with one click from the dashboard
  3. User can trigger the daily pipeline run from the dashboard with one button and see stage-by-stage progress stream live as the pipeline runs (no page refresh)
  4. User can see the current run summary (orders attempted, videos uploaded, failures) after a run completes
  5. User can see a history of recent pipeline runs with outcome summaries to diagnose patterns or failures
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Video Review and Social Copy
**Goal**: Luis can play, review, approve, or reject built videos directly in the browser and read social copy for any completed order without opening Drive
**Depends on**: Phase 7
**Requirements**: VID-01, VID-02, VID-03, VID-04, COPY-01, COPY-02
**Success Criteria** (what must be TRUE):
  1. User can play a built video directly in the browser without downloading it, using a native video player embedded in the dashboard
  2. User can approve a reviewed video for Drive upload with one click from the video player, and can reject it (marking it failed, skipping Drive upload, keeping the record for audit)
  3. User can review both the UGC reel and the standard reel for the same order independently -- switching between them in the same player view
  4. User can open a social copy panel for any completed order and read the generated copy for all four platforms (YouTube, TikTok, Instagram, X)
  5. User can copy any platform's social copy to clipboard with one click
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## v2.0 Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Dashboard Foundation | v2.0 | 0/2 | Not started | - |
| 6. Illustration Approval and Consent Dispatch | v2.0 | 0/2 | Not started | - |
| 7. Consent Tracking and Pipeline Control | v2.0 | 0/2 | Not started | - |
| 8. Video Review and Social Copy | v2.0 | 0/2 | Not started | - |
