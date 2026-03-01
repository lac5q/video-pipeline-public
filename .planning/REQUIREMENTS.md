# Requirements: Video Pipeline — Multi-Brand Content Production System

**Defined:** 2026-02-26
**Core Value:** Any approved customer order from any brand becomes a publishable video without manual intervention

## v1 Requirements (Shipped — v1.0)

### Brand System

- [x] **BRAND-01**: Brand config system with JSON configs (logo, accent color, CTA text, product catalog, music pool, tone) for all 5 brands (TY, MMJ, TW, TC, PopSmiths)
- [x] **BRAND-02**: Brand-aware video build -- parameterized ffmpeg scripts read brand config instead of hardcoded TY values
- [x] **BRAND-03**: OMS integration for shared-OMS brands (TY, MMJ, TW, TC) -- pull photos, illustrations, reaction videos per brand
- [x] **BRAND-04**: PopSmiths integration -- retrieve art from Heroku server, handle headless Shopify, stronger frame/product focus in video composition
- [x] **BRAND-05**: Path abstraction -- eliminate hardcoded `/Users/lcalderon/` paths; use config-driven workspace locations so Gwen can execute independently

### Consent & Permissions

- [x] **CONS-01**: Customer consent request emails -- branded templates per brand with clear opt-in language and brand identity
- [x] **CONS-02**: Consent state tracking -- pending/approved/denied/revoked per order per brand, persists across restarts (SQLite)
- [x] **CONS-03**: Batch approval workflow -- system suggests order candidates, Luis approves/rejects batch via CLI
- [x] **CONS-04**: Link-based opt-in -- customer clicks approval link in email, consent status auto-updates to approved
- [x] **CONS-05**: Thank-you coupon on consent -- generate Shopify discount code when customer opts in

### Production Pipeline

- [x] **PROD-01**: UGC video build for all brands (reaction clip + product showcase + branded end card)
- [x] **PROD-02**: Standard reels video build for all brands (no reaction clip, product showcase only)
- [x] **PROD-03**: Order candidate auto-selection -- scoring algorithm based on illustration quality, reaction video availability, product diversity, recency
- [x] **PROD-04**: Gwen autonomous daily pipeline -- picks up approved orders, produces videos, uploads to Drive with social copy docs
- [x] **PROD-05**: Google Drive upload with per-brand folder structure (`/{Brand}/videos/{date}/`) and platform-specific social copy docs (YouTube, TikTok, Instagram, X)
- [x] **PROD-06**: Gemini staging retry logic -- up to 3x with exponential backoff on FinishReason.OTHER failures
- [x] **PROD-07**: Printful/Gooten rate limit handling -- queue with backoff for multi-brand batch processing

### Quality Safeguards

- [x] **QUAL-01**: Zero distortions -- every product uses OMS-correct position parameters (450x450 for apparel, orientation-aware for wall art, rotated for phone cases, front view for mug)
- [x] **QUAL-02**: All products must be Gemini-staged into lifestyle scenes -- no raw Printful mockups in final video
- [x] **QUAL-03**: Maximum product showcase -- show as many of the order's products as possible in each video
- [x] **QUAL-04**: Preserve existing TY pipeline -- keep current working build scripts intact as backup
- [x] **QUAL-05**: Video specs enforced -- 1080x1920 portrait, CRF 18, h264, 30fps, blurred background fill

## v2.0 Requirements (Active — Web Dashboard)

### Dashboard Views

- [ ] **DASH-01**: User can view all orders organized by pipeline stage in a 5-lane stage-gate board (Candidates, Consent Pending, Consent Approved, Video Built, Uploaded to Drive)
- [ ] **DASH-02**: User can filter the board by brand using a one-click preset
- [ ] **DASH-03**: User can filter the board by consent status using a one-click preset
- [ ] **DASH-04**: User can see order count badges per lane so pipeline bottlenecks are immediately visible
- [ ] **DASH-05**: User can open a slide-over detail panel for any order to see full metadata without leaving the board view

### Illustration Approval

- [ ] **APPR-01**: User can see a thumbnail grid of candidate orders showing the customer illustration image before approving
- [ ] **APPR-02**: User can zoom in on an illustration thumbnail to inspect quality before making an approval decision
- [ ] **APPR-03**: User can approve or reject a candidate order individually from the thumbnail view with a single click
- [ ] **APPR-04**: User can batch-approve all visible candidates in one action (with confirmation prompt)
- [ ] **APPR-05**: User can see per-order ranking signals (reaction video available, people count, body framing, illustration quality)

### Video Review

- [ ] **VID-01**: User can play a built video directly in the browser (no download required) to review before approving for Drive upload
- [ ] **VID-02**: User can approve a reviewed video for Drive upload with one click from the video player
- [ ] **VID-03**: User can reject a reviewed video (mark it failed, skip Drive upload, keep in DB for audit)
- [ ] **VID-04**: User can see and review both UGC reel and standard reel for the same order independently

### Consent Management (UI)

- [ ] **UCONS-01**: User can see all consent candidates (approved by Luis, not yet emailed) in a list with illustration preview
- [ ] **UCONS-02**: User can send the consent email batch to selected candidates from the dashboard (replaces CLI `send-consent-batch.js`)
- [ ] **UCONS-03**: User can see real-time consent status per order (pending sent, opened, approved, declined)
- [ ] **UCONS-04**: User can resend a consent email to a specific order that declined or did not respond

### Pipeline Control

- [ ] **PIPE-01**: User can trigger the daily pipeline run from the dashboard with one button
- [ ] **PIPE-02**: User can see live pipeline progress as it runs (stage-by-stage status stream, no page refresh)
- [ ] **PIPE-03**: User can see the current pipeline run summary (orders attempted, videos uploaded, failures) after a run completes
- [ ] **PIPE-04**: User can see the history of recent pipeline runs with outcome summaries

### Social Copy

- [ ] **COPY-01**: User can view the generated social copy for any completed order, organized by platform (YouTube, TikTok, Instagram, X)
- [ ] **COPY-02**: User can copy any platform's social copy to clipboard with one click

### Drive Integration

- [ ] **DRIV-01**: User can see the Google Drive folder link for each uploaded order and open it directly from the dashboard
- [ ] **DRIV-02**: User can see upload verification status (uploaded / pending / failed) per order

## v3.0 Requirements (Deferred)

### Scheduling

- **SCHED-01**: User can configure the daily pipeline to run automatically at a set time via the dashboard (cron-ready system already built; this adds UI config)
- **SCHED-02**: User can see next scheduled run time and toggle automation on/off from the dashboard

### Publishing

- **PUB-01**: User can schedule a social post for publishing from the dashboard (requires platform API integrations)
- **PUB-02**: User can see post performance metrics per video

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
| Auto-posting to social platforms | Loses quality control on captions, timing, audience targeting |
| Real-time video editing UI | Undermines batch automation model; fix templates not individual videos |
| Customer-facing video delivery | Videos are marketing assets, not customer deliverables |
| Mobile app | Desktop browser sufficient for Luis's workflow |
| Multi-user / team accounts | Single-user tool (Luis + Gwen as caller) |
| Multi-language support | All 5 brands are English-market |
| Thumbnail generation for social | Deferred to future milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

### v1.0 (Complete)

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

### v2.0 (Active)

| Requirement | Phase | Status |
|-------------|-------|--------|
| DASH-01 | Phase 5 | Pending |
| DASH-02 | Phase 5 | Pending |
| DASH-03 | Phase 5 | Pending |
| DASH-04 | Phase 5 | Pending |
| DASH-05 | Phase 5 | Pending |
| APPR-01 | Phase 6 | Pending |
| APPR-02 | Phase 6 | Pending |
| APPR-03 | Phase 6 | Pending |
| APPR-04 | Phase 6 | Pending |
| APPR-05 | Phase 5 | Pending |
| VID-01 | Phase 8 | Pending |
| VID-02 | Phase 8 | Pending |
| VID-03 | Phase 8 | Pending |
| VID-04 | Phase 8 | Pending |
| UCONS-01 | Phase 6 | Pending |
| UCONS-02 | Phase 6 | Pending |
| UCONS-03 | Phase 7 | Pending |
| UCONS-04 | Phase 7 | Pending |
| PIPE-01 | Phase 7 | Pending |
| PIPE-02 | Phase 7 | Pending |
| PIPE-03 | Phase 7 | Pending |
| PIPE-04 | Phase 7 | Pending |
| COPY-01 | Phase 8 | Pending |
| COPY-02 | Phase 8 | Pending |
| DRIV-01 | Phase 5 | Pending |
| DRIV-02 | Phase 5 | Pending |

**v2.0 Coverage:**
- v2.0 requirements: 26 total
- Mapped to phases: 26 (roadmap complete)
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-03-01 — v2.0 roadmap created, all 26 requirements mapped to phases 5-8*
