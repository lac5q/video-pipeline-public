# Phase 5: Dashboard Foundation - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a live stage-gate board on top of the existing `scripts/dashboard.js` (Express server, port 3001). The board shows all orders organized into 5 lanes by pipeline stage, filterable by brand and consent status, with per-lane order count badges and a slide-over detail panel per order. Also shows Drive folder links, upload status, and candidate ranking signals per order. No approval actions in this phase — this is the view layer only.

</domain>

<decisions>
## Implementation Decisions

### Board layout
- 5-lane horizontal Kanban: Candidates → Consent Pending → Consent Approved → Video Built → Uploaded to Drive
- Lanes scroll vertically within fixed-height columns; the board itself does not paginate
- Each lane shows an order count badge in the column header
- Empty lanes show a subtle empty state ("No orders here yet") — never collapse or hide

### Card design
- Cards show: order ID, brand logo/name, customer first name, consent status badge (color-coded), date, and ranking score
- Cards in the "Candidates" lane also show the illustration thumbnail (small, 60px) so Luis can spot quality issues at a glance on the board itself
- Cards in "Video Built" and "Uploaded" lanes show a play icon indicator
- Card click opens the detail panel — no inline actions on the card in this phase

### Filter UX
- Brand filter: one-click pill presets above the board (All Brands + one per brand, 6 total)
- Status filter: secondary pill row below brand filters (All Statuses + one per stage)
- Filters are additive: brand + status both apply simultaneously
- Default view: All Brands, All Statuses
- Active filter pill is visually highlighted; clicking it again resets to "All"

### Detail panel
- Slide-over from the right (does not navigate away from board)
- Panel sections: Order Info (ID, brand, date, customer name, order total), Consent Status (current state + timestamps), Ranking Signals (reaction video available, people count, body framing, illustration quality proxy), Drive Links (folder URL + upload status per video file)
- Panel has a close button (X) and closes on outside click
- No action buttons in Phase 5 — read-only detail view only

### Navigation and page structure
- Dashboard Foundation replaces/enhances the existing dashboard.js HTML
- Single-page app: board is the primary view; detail panel slides in/out
- No separate routes for the board — all on the existing `/` or `/dashboard` path
- Top nav bar: title, current brand filter indicator, last pipeline run time

### Claude's Discretion
- Exact color palette per lane (should be distinct but not garish — muted/pastel works well for status lanes)
- CSS framework choice (Tailwind CDN, vanilla CSS, or minimal utility classes — pick what's already in dashboard.js or lightest to add)
- Exact card shadow/border treatment
- How ranking signals are displayed in the detail panel (simple label+value table is fine)
- Polling interval for live data refresh (30s is reasonable for board data)

</decisions>

<specifics>
## Specific Ideas

- The board should feel like a simple project management tool (Linear, Trello) — clean columns, no clutter
- Illustration thumbnail on the Candidates card is the single highest-value element for quick visual scanning
- Drive link in the detail panel should open directly in a new tab — no copy-paste

</specifics>

<deferred>
## Deferred Ideas

- **Drag-and-drop to move orders between lanes** — would change pipeline state, high risk, different phase
- **Board sort controls** (by score, by date, by brand) — nice-to-have, separate phase or addition
- **Bulk selection checkboxes on cards** — needed for Phase 6 batch approve, but action buttons aren't in this phase

</deferred>

---

*Phase: 05-dashboard-foundation*
*Context gathered: 2026-03-01*
