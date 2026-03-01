# Phase 2: Customer Consent System - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a consent pipeline where: (1) Luis reviews and batch-approves order candidates via CLI, (2) selected customers receive a branded opt-in email, (3) customers click a link to approve/decline, and (4) consent state is tracked per order in a local SQLite database. No order enters video production without approved consent.

</domain>

<decisions>
## Implementation Decisions

### Email content & tone
- Warm and personal — brief, complimentary about their specific art ("we loved what came out")
- Encourage opt-in without being pushy or heavy; avoid corporate "featuring" language
- Include a small preview of the customer's illustration (not a full product mockup) — this is the single highest-impact element for opt-in rate
- CTA: "Yes, share my art!" (casual, light, positive)
- Do NOT detail exactly where/how the content will be used (TikTok, Instagram, etc.) — keep it simple
- Each email sent FROM the brand's address (e.g., hello@turnedyellow.com, hello@makemejedi.com)
- Single transactional email service (Sendgrid or Postmark) under the hood — not per-brand accounts

### Batch approval CLI UX
- Two modes: (1) list view to scan all candidates at once, (2) drill into individual orders for details
- Per candidate, show: illustration preview (image/URL), customer name + order ID, brand + product type, whether reaction video is available, number of people in the illustration, order price, number of items, date of order
- Luis approves or rejects each order before any consent email is sent

### Consent state storage
- Local SQLite database — NOT synced to the shared OMS
- Fields to track: order ID, customer name, customer email, brand, consent status (pending / approved / denied / revoked), timestamps for each state transition
- Queryable via CLI (list by brand, list by status, look up single order)
- Keep everything local — no OMS modifications unless completely isolated

### Opt-in web flow (server)
- Hosted on the OMS server infrastructure (shares the server, not the app)
- Completely isolated: separate URL path (e.g., /consent/*), separate route file, NOT connected to the main OMS dashboard
- Same auth mechanism as OMS but a different entry point — customer-facing, no login required
- On click: customer lands on a simple branded thank-you page (branded to their order's brand), shows their illustration, displays the coupon code immediately
- Page design: prominent "Yes, share my art!" button + subtle "No thanks" text link below (not equal weight — this maximizes opt-in rate while maintaining good practice)
- Coupon is delivered/shown immediately upon opt-in click — no batching delay
- Coupon generated via Shopify API at the moment of consent

### Claude's Discretion
- Exact SQLite schema field names and indexes
- Email HTML template design details (spacing, layout, exact copy)
- Whether consent link has an expiry (recommended: 30-day expiry for security)
- Sendgrid vs Postmark selection
- SPF/DKIM/DMARC setup per brand domain (flag as prerequisite to test email delivery)
- Error handling for Shopify coupon generation failures

</decisions>

<specifics>
## Specific Ideas

- "Tell them we specifically loved their art and would like to share it with others" — make it feel personal, not like a mass marketing request
- The opt-in page should not feel connected to the OMS admin system at all — it's a customer-facing branded experience
- The OMS server isolation is critical — Luis is risk-averse about the OMS system. Any server-side additions must be completely separated (different routes, different files, no shared state with existing dashboard)

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-customer-consent-system*
*Context gathered: 2026-02-28*
