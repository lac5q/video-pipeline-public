# Phase 6: Illustration Approval and Consent Dispatch - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Add approval actions to the dashboard: Luis can inspect illustration thumbnails (with zoom), approve or reject individual candidates, batch-approve all visible candidates, and send the consent email batch from the dashboard — replacing the CLI `send-consent-batch.js` workflow. This phase adds write actions on top of the Phase 5 read-only board.

</domain>

<decisions>
## Implementation Decisions

### Approval interaction
- Approve/Reject buttons appear on the card directly (always visible, not just on hover — avoids discoverability issue)
- Approve = green checkmark button, Reject = red X button; both small, placed at the bottom of the card
- No confirmation dialog for individual approve/reject — action is fast and reversible (can re-approve rejected candidates)
- After approval: card moves to "Consent Pending" lane immediately (optimistic UI update); after rejection: card disappears from Candidates lane
- Batch approve button sits above the Candidates column, only visible when Candidates lane is active/visible
- Batch approve requires a single confirmation dialog: "Approve [N] candidates? This will queue them for consent emails." with Cancel / Approve All

### Illustration zoom
- Click on the illustration thumbnail (on the card) opens a lightbox overlay
- Lightbox shows the full illustration image centered on screen with dark background overlay
- Lightbox has: close button (X top-right), click outside to close, keyboard Escape to close
- No carousel or next/prev in the lightbox — one image at a time (multi-image browsing is Phase 5 detail panel scope)
- Lightbox does NOT trigger approval — it's purely for visual inspection

### Consent dispatch flow
- Candidates that have been approved (production_status = 'approved', consent_status = 'pending') appear in "Consent Pending" lane
- "Send Consent Emails" button appears at the top of the Consent Pending lane when there are unsent candidates
- Clicking it shows a confirmation: "Send consent emails to [N] customers? This cannot be undone." with Cancel / Send
- On send: calls the existing consent send logic (same as `send-consent-batch.js`), shows a loading state on the button, then displays a success/error toast notification
- After send: consent_status updates to 'pending_sent', cards remain in Consent Pending lane (they move to Consent Approved only after customer clicks)
- No per-order selection needed — "Send Consent Emails" sends ALL unsent approved candidates in one batch

### Post-action feedback
- All actions (approve, reject, batch approve, send consent) show a brief toast notification (2-3 seconds) in the bottom-right corner
- Approve: "Approved — moving to Consent Pending"
- Reject: "Rejected and removed from candidates"
- Batch approve: "N orders approved"
- Send consent: "Consent emails sent to N customers" or "Error: [reason]"
- Board refreshes automatically after each action (no manual reload)

### Claude's Discretion
- Toast notification styling (position, animation, colors)
- Exact button sizing on cards (should be compact — cards are small)
- Whether reject requires a reason/note (default: no reason needed, keep it fast)
- API endpoint design for approve/reject/batch-approve actions
- How to handle partial batch-approve failures (some succeed, some fail)

</decisions>

<specifics>
## Specific Ideas

- The approve/reject buttons should be compact enough that they don't dominate the card — icon buttons with tooltip labels work better than text buttons at this scale
- The consent send button in the lane header makes it feel like a natural "next step" in the workflow — column header CTA rather than a global action

</specifics>

<deferred>
## Deferred Ideas

- **Per-order consent email preview before sending** — see the email that will be sent to a specific customer. Useful but adds complexity; defer to future phase or enhancement.
- **Rejection reason / notes on rejected candidates** — Luis may want to annotate why he rejected an order. Deferred to future enhancement.
- **Undo/undo history for approval actions** — nice UX touch but complex state management. Deferred.

</deferred>

---

*Phase: 06-illustration-approval-and-consent-dispatch*
*Context gathered: 2026-03-01*
