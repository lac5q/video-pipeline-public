# Phase 2: Customer Consent System - Research

**Researched:** 2026-02-28
**Domain:** Node.js / SQLite / Email (SMTP via Nodemailer) / Express.js / Shopify Admin API
**Confidence:** HIGH (most infrastructure already exists in the codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Email content & tone**
- Warm and personal — brief, complimentary about their specific art ("we loved what came out")
- Encourage opt-in without being pushy or heavy; avoid corporate "featuring" language
- Include a small preview of the customer's illustration (not a full product mockup) — this is the single highest-impact element for opt-in rate
- CTA: "Yes, share my art!" (casual, light, positive)
- Do NOT detail exactly where/how the content will be used (TikTok, Instagram, etc.) — keep it simple
- Each email sent FROM the brand's address (e.g., hello@turnedyellow.com, hello@makemejedi.com)
- Single transactional email service (Sendgrid or Postmark) under the hood — not per-brand accounts

**Batch approval CLI UX**
- Two modes: (1) list view to scan all candidates at once, (2) drill into individual orders for details
- Per candidate, show: illustration preview (image/URL), customer name + order ID, brand + product type, whether reaction video is available, number of people in the illustration, order price, number of items, date of order
- Luis approves or rejects each order before any consent email is sent

**Consent state storage**
- Local SQLite database — NOT synced to the shared OMS
- Fields to track: order ID, customer name, customer email, brand, consent status (pending / approved / denied / revoked), timestamps for each state transition
- Queryable via CLI (list by brand, list by status, look up single order)
- Keep everything local — no OMS modifications unless completely isolated

**Opt-in web flow (server)**
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

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONS-01 | Customer consent request emails — branded templates per brand with clear opt-in language and brand identity | Email infrastructure already implemented in `lib/email.js` + `templates/consent-email.html`. Nodemailer (not yet installed) + SMTP config needed. |
| CONS-02 | Consent state tracking — pending/approved/denied/revoked per order per brand, persists across restarts (SQLite) | `lib/consent.js` + `lib/db.js` already implement schema and full CRUD. Database at `data/pipeline.db` exists with 396 orders. **Gap: customer_email and customer_name are NULL for all orders — OMS fetch script needed.** |
| CONS-03 | Batch approval workflow — system suggests order candidates, Luis approves/rejects batch via CLI | `scripts/approve-orders.js` exists and is functional. `scripts/rank-candidates.js` exists. Gap: list-mode is absent — the current script only does drill-down. Gap: batch approval currently operates on `production_status` not `consent_status`. |
| CONS-04 | Link-based opt-in — customer clicks approval link in email, consent status auto-updates to approved | `scripts/consent-server.js` + `lib/consent.js` implement token generation, validation, and status update fully. Express 5 is installed. Gap: server is standalone, not yet integrated into OMS server infrastructure. |
| CONS-05 | Thank-you coupon on consent — generate or assign Shopify discount code when customer opts in | `consent-server.js` already calls Shopify REST API (`price_rules.json`). Gap: Shopify REST PriceRule API is deprecated as of Oct 2024. **Must upgrade to GraphQL `discountCodeBasicCreate` mutation.** |
</phase_requirements>

---

## Summary

**Most of the Phase 2 infrastructure is already written.** The codebase contains: `lib/consent.js` (token generation, status updates, DB schema), `lib/email.js` (Nodemailer SMTP wrapper, template rendering), `lib/db.js` (SQLite via better-sqlite3), `scripts/consent-server.js` (Express routes for `/consent/:token`), `scripts/approve-orders.js` (interactive CLI), `scripts/rank-candidates.js` (scoring + ranking), `scripts/send-consent-batch.js` (batch email sender), `templates/consent-email.html` and `templates/consent-thankyou.html` (responsive HTML email templates). The database already exists at `data/pipeline.db` with 396 orders (226 TY + 170 MMJ), all `pre_approved`.

**Three critical gaps** must be closed before the phase is complete: (1) `customer_email` and `customer_name` are NULL for all 396 orders — a script to enrich orders from the OMS API or Shopify Admin API is needed; (2) the email transport library (`nodemailer`) is missing from `package.json` and must be installed; (3) the Shopify coupon generation in `consent-server.js` uses the deprecated REST `price_rules` API and must be updated to the GraphQL `discountCodeBasicCreate` mutation (API version 2026-01, REST deprecated April 1 2025 for new apps).

**The email template content needs updating** to match the locked CTA ("Yes, share my art!" not "Yes, feature my order!"), the illustration preview image block is missing from `consent-email.html`, and the batch approval CLI's `approve-orders.js` approves into `production_status = 'queued'` — but Phase 2 is about `consent_status` pre-approval, not production queuing. The flow separation needs clarification in the plan.

**Primary recommendation:** Wire up the existing components in sequence — install nodemailer, write the OMS customer-fetch enrichment script, fix the email template CTA and add illustration preview, upgrade Shopify to GraphQL, verify the consent server runs and handles all states, then validate end-to-end with a dry-run.

---

## Standard Stack

### Core (already installed in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 | Synchronous SQLite for consent state | Already installed; synchronous API is ideal for CLI scripts; WAL mode enabled |
| express | ^5.2.1 | HTTP server for `/consent/*` routes | Already installed; used for dashboard.js; Express 5 is current |
| dotenv | ^17.3.1 | Environment variable loading | Already installed; used across all scripts |
| googleapis | ^171.4.0 | Google Sheets/Drive API | Already installed; used by import-tracking-sheets.js |

### Must Install

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| nodemailer | ^6.9.x | SMTP email transport | Required by `lib/email.js` but NOT in package.json; referenced as optional dep with lazy require |

### No Additional Libraries Needed

The Shopify GraphQL call will use Node.js native `https` (already the pattern in consent-server.js). No `@shopify/shopify-api` SDK needed for a single mutation.

**Installation:**
```bash
npm install nodemailer
```

---

## Architecture Patterns

### Existing Project Structure (already established)

```
video-pipeline/
├── brands/                   # Brand configs (5 JSON files, all present)
│   ├── turnedyellow.json     # colors.background, colors.accent, url, name, oms_app
│   └── ...
├── data/
│   └── pipeline.db           # SQLite database (exists, 396 orders)
├── lib/
│   ├── consent.js            # Token generation, status CRUD (COMPLETE)
│   ├── db.js                 # DB init + schema (COMPLETE)
│   ├── email.js              # Nodemailer wrapper + template renderer (COMPLETE, missing nodemailer dep)
│   └── scorer.js             # Order scoring algorithm (COMPLETE)
├── scripts/
│   ├── approve-orders.js     # Interactive CLI (COMPLETE, needs behavior fix)
│   ├── consent-server.js     # Express server for /consent/* (COMPLETE, needs Shopify fix)
│   ├── import-tracking-sheets.js  # Google Sheets import (COMPLETE)
│   ├── list-orders.js        # CLI list view (COMPLETE)
│   ├── rank-candidates.js    # Ranking output (COMPLETE)
│   └── send-consent-batch.js # Batch email sender (COMPLETE, needs nodemailer + email data)
└── templates/
    ├── consent-email.html    # Consent request email (EXISTS, CTA text wrong, missing illustration block)
    └── consent-thankyou.html # Thank-you + coupon email (COMPLETE)
```

### Pattern 1: Consent State Machine

The consent flow follows a strict state machine. Orders in the DB have `consent_status` and `production_status` as separate fields. This is correct architecture — they are different concerns.

```
consent_status:   pre_approved → pending → approved
                                        → denied
                              approved → revoked

production_status: pending → queued → building → complete
                                    → rejected
```

**Critical clarification:** The batch approval CLI (`approve-orders.js`) in its current form sets `production_status = 'queued'` for approved orders. **For Phase 2, Luis's batch approval means approving orders to SEND consent emails** — this should set `consent_status = 'pending'` (enabling email send), NOT touch `production_status`. The `approve-orders.js` behavior needs to be updated or a separate `approve-consent-candidates.js` script is needed.

### Pattern 2: Token-Based Consent Links

```javascript
// Source: lib/consent.js
// 30-day expiry, one approve token + one deny token per order
const { approveToken, denyToken } = consent.generateConsentToken(orderId, brand);
const approveUrl = `${baseUrl}/consent/${approveToken}`;
const declineUrl = `${baseUrl}/consent/${denyToken}`;
```

Token stored in `consent_tokens` table with `used_at` and `expires_at`. When clicked, the token is marked used and both approve/deny tokens for the same order are invalidated (prevents double-action). This pattern is already fully implemented and correct.

### Pattern 3: Brand Config for Email

Brand config at `brands/{slug}.json` contains all email styling fields:
```json
{
  "name": "TurnedYellow",
  "url": "TurnedYellow.com",
  "colors": {
    "background": "#1a1a2e",
    "accent": "#FF8C00"
  },
  "oms_app": "turnedyellowordermanagement"
}
```

The `email.js` renderer does `{{BRAND_ACCENT}}`, `{{BRAND_BG}}`, `{{BRAND_LOGO_URL}}` substitution. Logo URL is inferred as `https://{brand.url}/logo.png`. **This needs verification** — the logos may not be at the root path of each brand's domain. A `logo_url` or `logo_cdn_url` field in brand config would be safer.

### Pattern 4: OMS Customer Data Enrichment

The orders table has `oms_url` (e.g., `https://doh.turnedyellow.com/customer/illustration/61b78a43c3a4dd4950526f0a`) and `illustration_id` populated for all orders. But `customer_email` and `customer_name` are NULL for all 396 orders.

The OMS URL pattern is `/customer/illustration/{id}`. The OMS system (Heroku app `turnedyellowordermanagement`) has a REST API. Customer data (name, email) must be fetched from the OMS API or from Shopify Admin API using the order_id, then written back to the local DB.

**Two fetch strategies:**
1. **OMS API**: `GET https://{oms_app}.com/api/orders/{order_id}` — if this endpoint exists and is accessible without user-session auth
2. **Shopify Admin API**: `GET /admin/api/2026-01/orders/{order_id}.json` — always available with Admin token, returns `email`, `first_name`, `last_name`

Shopify is safer (guaranteed to have customer email) and uses the same access token as the coupon creation. The order_id in the DB maps directly to the Shopify order number.

### Pattern 5: Shopify GraphQL Coupon Creation (Replaces Deprecated REST)

The current `consent-server.js` uses the deprecated REST `price_rules` API. Replace with:

```javascript
// Source: https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate
// API version: 2026-01
const mutation = `
  mutation CreateConsentDiscount($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const variables = {
  input: {
    title: `Thank you - Order ${orderId}`,
    code: `THANKYOU-${orderId.slice(-6).toUpperCase()}`,
    customerSelection: { all: true },
    customerGets: {
      value: { percentage: 0.15 },  // 15% — decimal, not integer
      items: { all: true }
    },
    usageLimit: 1
  }
};

// POST to https://{store}/admin/api/2026-01/graphql.json
// Headers: X-Shopify-Access-Token: {token}, Content-Type: application/json
```

Note: `percentage` is expressed as a decimal (`0.15` for 15%, not `15`). The `userErrors` array must be checked — an empty array means success.

### Pattern 6: Express Server Isolation

The consent server (`consent-server.js`) is already written as a standalone Express app. For OMS server deployment, it gets mounted as a sub-app or the routes get registered on the OMS Express instance at `/consent/*`. Current implementation:

```javascript
// consent-server.js exports the Express app — clean for mounting
module.exports = app;

// To mount on OMS server (add this to OMS server.js):
const consentApp = require('./consent-server');
app.use('/consent', consentApp);
```

The consent server uses NO auth (customer-facing). The OMS dashboard uses Basic Auth. These are already separate in the code.

### Anti-Patterns to Avoid

- **Don't skip the illustration image in consent emails.** The CONTEXT.md identifies the illustration preview as "the single highest-impact element for opt-in rate." The current `consent-email.html` template does NOT include an illustration image block — this must be added.
- **Don't use `approve-orders.js` as-is for consent batch approval.** It currently moves orders to production queue, not consent pending. The approval step for Phase 2 is different — it marks orders as candidates to receive consent emails.
- **Don't hardcode logo URLs as `https://{brand.url}/logo.png`.** The brand domains may not serve logos at root. Use a `logo_url` field in brand config or a CDN path.
- **Don't use the deprecated Shopify REST PriceRule API.** It works today but will break. Use the GraphQL mutation.
- **Don't send consent emails without customer_email populated.** The `send-consent-batch.js` script already handles this case (skips orders with no email), but the enrichment step must run first.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SMTP email transport | Custom TCP/SMTP implementation | nodemailer ^6.9.x | Already used in lib/email.js; handles auth, TLS, retries |
| Token generation | Custom random ID | `crypto.randomBytes(32).toString('hex')` (stdlib) | Already implemented in lib/consent.js; cryptographically secure |
| SQLite schema migrations | Custom ALTER TABLE scripts | The existing pattern in lib/consent.js | Already uses `IF NOT EXISTS` + catch-on-existing-column pattern |
| HTML email rendering | Template engine (Handlebars, EJS) | The existing `renderTemplate()` in lib/email.js | Simple `{{VAR}}` replacement already works and is tested by templates |
| Shopify coupon | Manual voucher database | Shopify GraphQL `discountCodeBasicCreate` | Single-use codes tracked in Shopify natively |
| Express routing | Custom HTTP server | Express 5 (already installed) | Routes already implemented in consent-server.js |

**Key insight:** The project has invested significant effort in building Phase 2 infrastructure ahead of the planning phase. The planning work is wiring, fixing, and validating — not building from scratch.

---

## Common Pitfalls

### Pitfall 1: customer_email is NULL for all orders
**What goes wrong:** `send-consent-batch.js` is called, finds 396 pending orders, skips all of them because `customer_email` is NULL.
**Why it happens:** `import-tracking-sheets.js` imports from Google Sheets tracking data, which does not include customer email or name — those live in Shopify/OMS.
**How to avoid:** Build `scripts/enrich-orders.js` that fetches customer data from Shopify Admin API (`GET /admin/api/2026-01/orders/{id}.json`) for each order and writes `customer_email`, `customer_name` back to the DB. Run before batch send.
**Warning signs:** If send-consent-batch reports 0 sent and all SKIP, check customer_email population.

### Pitfall 2: Shopify API uses different order_id format than DB
**What goes wrong:** Shopify API expects numeric order ID (e.g., `133627`) but the store may use different ID format for the GraphQL `gid://shopify/Order/` GID format.
**Why it happens:** Shopify REST orders API accepts numeric ID in URL; GraphQL requires GID (`gid://shopify/Order/133627`). The DB `order_id` field appears to be the numeric Shopify order number.
**How to avoid:** Use REST for order lookup (`GET /admin/api/2026-01/orders/{numeric_id}.json`) for enrichment. For discount creation, no order ID is needed — only the discount code itself.
**Warning signs:** 404 responses from Shopify order lookup.

### Pitfall 3: Shopify stores use different access tokens per brand
**What goes wrong:** The `.env.example` has a single `SHOPIFY_STORE` and `SHOPIFY_ACCESS_TOKEN`. But the consent system sends emails from 5 brands, each with their own Shopify store.
**Why it happens:** The current implementation is not brand-aware for Shopify credentials.
**How to avoid:** Add `shopify_store` and `shopify_access_token` fields to each brand config JSON, or use env vars per brand (`SHOPIFY_TOKEN_TURNEDYELLOW`, etc.). The brand config pattern is already established.
**Warning signs:** Discount codes created in the wrong store, or Shopify 403 errors.

### Pitfall 4: Email deliverability — FROM address domain not authenticated
**What goes wrong:** Emails from `hello@turnedyellow.com` go to spam because SPF/DKIM are not configured for the sending domain.
**Why it happens:** Transactional email services require DNS records (SPF TXT, DKIM CNAME) to be added for each FROM domain. With 5 brands and 5 domains, this is non-trivial.
**How to avoid:** Configure domain authentication in SendGrid/Postmark for each brand domain BEFORE sending live emails. Gmail and Yahoo require this for bulk senders as of 2025.
**Warning signs:** Emails delivered to spam folder, bounce reports.

### Pitfall 5: approve-orders.js approval flow is production-queue, not consent-queue
**What goes wrong:** If used as-is, Luis approves an order via CLI and it sets `production_status = 'queued'` — the order enters video production without the customer ever being asked for consent.
**Why it happens:** The script was built for a different workflow (or conflates the two approval steps).
**How to avoid:** For Phase 2, create `scripts/approve-consent-candidates.js` that: (1) shows candidates with pre_approved status, (2) sets `consent_status = 'pending'` for approved ones (enabling email send), (3) does NOT touch `production_status`. The Phase 3 production approval is a separate step.
**Warning signs:** Orders entering production pipeline without approved consent.

### Pitfall 6: Illustration image URL not publicly accessible
**What goes wrong:** Email template includes `{{ILLUSTRATION_URL}}` pointing to an OMS URL that requires a session cookie, so the image appears broken in the customer's email client.
**Why it happens:** OMS illustration URLs (`https://doh.turnedyellow.com/customer/illustration/{id}`) are customer-facing but may require auth.
**How to avoid:** Download the illustration during the enrichment step and serve it from a public CDN (Wasabi S3 / CloudFront is already configured in the project). Or check if the OMS `/customer/illustration/{id}` endpoint is public.
**Warning signs:** Broken image in test email.

### Pitfall 7: Token reuse attack
**What goes wrong:** Customer forwards consent email, someone else clicks the link and approves on their behalf.
**Why it happens:** Token links are single-use by default (consent.js marks used_at), but a token could be used before the customer clicks it if intercepted.
**How to avoid:** The 30-day expiry + single-use-on-click pattern in `lib/consent.js` is already correctly implemented. Do not change the expiry shorter than 30 days (users need time).
**Warning signs:** None needed — already implemented correctly.

---

## Code Examples

### Verified: Token generation and validation (lib/consent.js)
```javascript
// Source: lib/consent.js (existing, verified working)
// Generates approve + deny tokens, 30-day expiry
const tokens = consent.generateConsentToken(orderId, brand);
// Returns: { approveToken: 'hex64', denyToken: 'hex64' }

// Validate on server hit:
const tokenData = consent.validateConsentToken(req.params.token);
// Returns: { orderId, brand, action } | null (expired/used = null)
```

### Verified: SQLite database schema (lib/db.js)
```javascript
// Source: lib/db.js (existing, verified)
// Table: orders — PRIMARY KEY (order_id, brand)
// consent_status: pre_approved | pending | approved | denied | revoked
// production_status: pending | queued | building | complete | rejected | failed
// customer_email, customer_name: currently NULL for all 396 orders
```

### Required: Shopify GraphQL coupon (replace REST in consent-server.js)
```javascript
// Source: https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate
// API version: 2026-01 (verified Feb 2026)
async function createShopifyDiscountGraphQL(brandConfig, code, percentageDecimal) {
  const store = brandConfig.shopify_store;  // e.g., "turnedyellow.myshopify.com"
  const token = brandConfig.shopify_token;  // brand-specific token

  const body = JSON.stringify({
    query: `
      mutation CreateDiscount($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }
    `,
    variables: {
      input: {
        title: code,
        code: code,
        customerSelection: { all: true },
        customerGets: {
          value: { percentage: percentageDecimal },  // 0.15 for 15%
          items: { all: true }
        },
        usageLimit: 1
      }
    }
  });

  // Use native https (no extra deps)
  // POST to https://{store}/admin/api/2026-01/graphql.json
  // Check response.data.discountCodeBasicCreate.userErrors.length === 0
}
```

### Required: Customer enrichment from Shopify (new script)
```javascript
// scripts/enrich-orders.js (new — does not exist yet)
// For each order with customer_email IS NULL and brand in ['turnedyellow', 'makemejedi']:
//   GET https://{shopify_store}/admin/api/2026-01/orders/{order_id}.json
//   Extract: order.email, order.first_name + ' ' + order.last_name
//   UPDATE orders SET customer_email=?, customer_name=? WHERE order_id=? AND brand=?
```

### Required: Consent batch approval flow (new or modified script)
```javascript
// The Phase 2 batch approval: sets consent_status = 'pending' (NOT production_status)
// After Luis approves in CLI, run send-consent-batch.js to send emails
// approve-consent-candidates.js (new script OR modify approve-orders.js)
db.prepare(`
  UPDATE orders
  SET consent_status = 'pending', updated_at = datetime('now')
  WHERE order_id = ? AND brand = ?
`).run(orderId, brand);
// consent_log entry: action = 'luis_approved_for_consent'
```

### Verified: Email sending pattern (lib/email.js)
```javascript
// Source: lib/email.js (existing)
// SMTP config via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Template rendering: {{VAR}} style, templates/consent-email.html

await email.sendConsentRequest(
  orderId, brand, customerEmail, customerName, orderDescription
);
// Internally generates tokens, builds approve/decline URLs from CONSENT_BASE_URL,
// renders HTML template with brand colors, sends via nodemailer
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shopify REST PriceRule + DiscountCode API | Shopify GraphQL `discountCodeBasicCreate` | Deprecated Oct 1, 2024; mandatory for new apps Apr 1, 2025 | Must update consent-server.js before launch |
| Generic FROM address for all brands | Brand-specific FROM address (hello@turnedyellow.com) | Current best practice | Requires per-domain SPF/DKIM setup |

**Deprecated/outdated in this codebase:**
- `consent-server.js` Shopify coupon block: uses `/admin/api/2024-01/price_rules.json` — deprecated, use GraphQL mutation

---

## Open Questions

1. **How is customer email/name fetched from the OMS or Shopify?**
   - What we know: The DB has `order_id` (numeric Shopify order number) and `oms_url` for all orders. `customer_email` and `customer_name` are NULL.
   - What's unclear: Whether the OMS API has an unauthenticated endpoint for order customer data, or whether Shopify Admin API is the only reliable source. Each brand has its own Shopify store.
   - Recommendation: Use Shopify Admin API `GET /admin/api/2026-01/orders/{id}.json` per brand. Requires `shopify_store` + `shopify_access_token` per brand in brand config or env vars. Build `scripts/enrich-orders.js`.

2. **Where are the per-brand Shopify credentials stored?**
   - What we know: `.env.example` has single `SHOPIFY_STORE` and `SHOPIFY_ACCESS_TOKEN`. There are 5 brands.
   - What's unclear: Whether all brands share one Shopify store or each has its own.
   - Recommendation: Add `shopify_store` and `shopify_access_token` to each brand JSON config (already established as the config pattern). For PopSmiths (headless Shopify on Heroku), confirm the Shopify store handle.

3. **Is the illustration image publicly accessible without OMS auth?**
   - What we know: OMS URLs follow pattern `https://doh.turnedyellow.com/customer/illustration/{id}`. The download-order-assets.sh script attempts to fetch from OMS API.
   - What's unclear: Whether `/customer/illustration/{id}` serves the image publicly or requires session auth.
   - Recommendation: Test with `curl https://doh.turnedyellow.com/customer/illustration/61b78a43c3a4dd4950526f0a` to check. If public, use as `{{ILLUSTRATION_URL}}` in email template. If not, download and serve from CloudFront.

4. **Which SMTP provider: Sendgrid or Postmark?**
   - What we know: Both support per-brand FROM addresses. Both require per-domain DNS setup. Neither is installed yet.
   - Recommendation (Claude's Discretion): **Postmark** for transactional email. Postmark is purpose-built for transactional (not bulk marketing), has higher deliverability for single opt-in emails, simpler API, and the `postmark-nodemailer` transport adapter maintains the existing nodemailer abstraction. Sendgrid is better for bulk marketing sends. This is a 5-brand personal project with ~10-50 emails/day — Postmark's transactional focus is ideal.

5. **The consent server deployment on OMS server — what framework does the OMS use?**
   - What we know: The CONTEXT.md says "hosted on OMS server infrastructure." The local `consent-server.js` and `dashboard.js` both use Express. The OMS is a Heroku app (`turnedyellowordermanagement`).
   - What's unclear: Whether the OMS server codebase is accessible for mounting the consent routes, or if consent-server.js should run as a separate Heroku dyno.
   - Recommendation: Run `consent-server.js` as a standalone Express app on a separate port/dyno. This maintains the isolation requirement from CONTEXT.md. The `CONSENT_BASE_URL` env var already points to the public URL.

---

## Validation Architecture

> `nyquist_validation` key is absent from `.planning/config.json` — skipping Validation Architecture section per instructions. (Config keys present: mode, depth, parallelization, commit_docs, model_profile, workflow.research, workflow.plan_check, workflow.verifier.)

---

## Sources

### Primary (HIGH confidence)
- `lib/consent.js` — Token generation, status CRUD, DB schema (verified by direct read)
- `lib/email.js` — Nodemailer wrapper, template rendering pattern (verified by direct read)
- `lib/db.js` — SQLite schema, better-sqlite3 API usage (verified by direct read)
- `scripts/consent-server.js` — Express routes, Shopify REST call (verified by direct read)
- `scripts/approve-orders.js` — CLI approval interaction, DB update pattern (verified by direct read)
- `templates/consent-email.html` — Email template structure and variables (verified by direct read)
- `data/pipeline.db` — Live database queried: 396 orders, customer_email NULL (verified)
- `package.json` — Dependencies: better-sqlite3 12.6.2, express 5.2.1, dotenv 17.3.1 (verified)
- Shopify Admin GraphQL docs at https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountCodeBasicCreate — API version 2026-01, `discountCodeBasicCreate` mutation (HIGH confidence, official docs)
- Shopify PriceRule REST docs — confirmed deprecated Oct 2024, mandatory GraphQL for new apps Apr 2025 (HIGH confidence, official docs)

### Secondary (MEDIUM confidence)
- better-sqlite3 npm page — version 12.6.2 confirmed current, WAL pragma pattern confirmed (MEDIUM — verified against package.json)
- nodemailer.com — library exists, SMTP transport pattern confirmed (MEDIUM — official site)
- Postmark `postmark-nodemailer` GitHub — transport adapter maintains nodemailer interface (MEDIUM — official GitHub)

### Tertiary (LOW confidence)
- Email deliverability 2025 requirements (SPF/DKIM/DMARC mandatory per Gmail/Yahoo) — multiple sources agree but specific thresholds need verification per provider
- Postmark vs Sendgrid recommendation — based on use-case analysis, not direct benchmarking for this workload

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package.json verified, all libraries confirmed installed except nodemailer
- Architecture: HIGH — full codebase read, DB queried live, all existing patterns verified
- Pitfalls: HIGH (customer_email gap) / MEDIUM (Shopify credentials per brand, illustration URL auth)
- Shopify coupon: HIGH — official docs confirmed REST deprecated, GraphQL mutation syntax verified

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (Shopify API — stable; email provider recommendation — stable 30 days)
