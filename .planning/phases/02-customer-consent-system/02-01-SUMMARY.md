---
phase: 02-customer-consent-system
plan: 01
subsystem: database
tags: [shopify, nodemailer, consent, enrichment, sqlite, cli]

# Dependency graph
requires:
  - phase: 01-brand-config-pipeline-foundation
    provides: brand configs, database schema, lib/consent.js, lib/scorer.js

provides:
  - Shopify Admin API customer data enrichment script (enrich-orders.js)
  - Batch consent approval CLI with list + drill-down modes (approve-consent-candidates.js)
  - nodemailer installed and functional
  - Per-brand Shopify credentials structure in brand configs

affects:
  - 02-02 (consent email sending -- needs customer_email populated by enrich-orders.js)
  - 02-03 (consent server -- uses consent_status set by approve-consent-candidates.js)

# Tech tracking
tech-stack:
  added: [nodemailer@8.0.1]
  patterns:
    - Per-brand env vars for Shopify tokens (SHOPIFY_TOKEN_{BRAND})
    - Brand config shopify.store + shopify.access_token_env pattern
    - consent_status gate pattern (pre_approved -> pending -> approved/denied)

key-files:
  created:
    - scripts/enrich-orders.js
    - scripts/approve-consent-candidates.js
  modified:
    - package.json
    - package-lock.json
    - brands/turnedyellow.json
    - brands/makemejedi.json
    - brands/popsmiths.json
    - brands/turnedcomics.json
    - brands/turnedwizard.json
    - .env.example

key-decisions:
  - "Per-brand Shopify tokens via env vars (SHOPIFY_TOKEN_{BRAND}) rather than single shared token"
  - "shopify.access_token_env in brand config (not direct value) to keep secrets out of brand JSON"
  - "approve-consent-candidates.js queries production_status=pending to find unclaimed candidates (read only, never writes production_status)"
  - "enrich-orders.js uses native https module (not axios/node-fetch) to match existing codebase pattern"

patterns-established:
  - "Brand config shopify object: { store, access_token_env } -- store is placeholder, token via env var"
  - "Consent gate flow: pre_approved -> (approve-consent-candidates) -> pending -> (email sent) -> approved/denied"

requirements-completed: [CONS-02, CONS-03]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 02 Plan 01: Customer Data Enrichment and Consent Approval CLI Summary

**Shopify Admin API customer enrichment script and ranked consent approval CLI with nodemailer installed, enabling email population for 396 orders and staged consent gating**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T06:13:54Z
- **Completed:** 2026-03-01T06:17:10Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Installed nodemailer v8.0.1 as dependency (used by lib/email.js for SMTP transport)
- Added `shopify.store` and `shopify.access_token_env` fields to all 5 brand configs (turnedyellow, makemejedi, popsmiths, turnedcomics, turnedwizard)
- Created `scripts/enrich-orders.js` -- fetches customer email/name from Shopify Admin API for orders missing that data, with --dry-run, --brand, --limit flags and 500ms rate-limit delay
- Created `scripts/approve-consent-candidates.js` -- ranked list mode plus interactive drill-down, sets consent_status='pending' (not production_status), uses lib/scorer and lib/consent

## Task Commits

Each task was committed atomically:

1. **Task 1: Install nodemailer, add Shopify fields, create enrich-orders.js** - `900fee7` (feat)
2. **Task 2: Create approve-consent-candidates.js with list and drill-down modes** - `0a27618` (feat)

**Plan metadata:** (docs commit -- see below)

## Files Created/Modified
- `scripts/enrich-orders.js` - Shopify Admin API enrichment with dry-run, per-brand config lookup, native https, 500ms rate limiting
- `scripts/approve-consent-candidates.js` - Consent batch CLI: ranked table (--list), interactive review, approve/reject sets consent_status
- `package.json` - Added nodemailer@8.0.1 dependency
- `package-lock.json` - Updated lock file
- `brands/turnedyellow.json` - Added shopify.store + shopify.access_token_env fields
- `brands/makemejedi.json` - Added shopify.store + shopify.access_token_env fields
- `brands/popsmiths.json` - Added shopify.store + shopify.access_token_env fields
- `brands/turnedcomics.json` - Added shopify.store + shopify.access_token_env fields
- `brands/turnedwizard.json` - Added shopify.store + shopify.access_token_env fields
- `.env.example` - Replaced single SHOPIFY_STORE/SHOPIFY_ACCESS_TOKEN with per-brand SHOPIFY_TOKEN_* entries

## Decisions Made
- Per-brand Shopify tokens via env vars (SHOPIFY_TOKEN_TURNEDYELLOW, etc.) rather than a single shared token -- each brand has its own Shopify store
- The env var name is stored in brand config as `shopify.access_token_env` so the secret never appears in the JSON file
- approve-consent-candidates.js queries `production_status = 'pending'` in its WHERE clause to find unclaimed candidates, but it never writes to production_status (only reads it as a filter)
- Used native Node.js `https` module in enrich-orders.js to match existing codebase pattern (consent-server.js also uses native https)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Improved SKIP message clarity in enrich-orders.js**
- **Found during:** Task 1 verification run
- **Issue:** Initial version showed "no Shopify config in brand config" even when the shopify section existed but `store` was intentionally empty (placeholder)
- **Fix:** Split the validation into separate checks with distinct messages: missing shopify section vs. empty store vs. missing access_token_env
- **Files modified:** scripts/enrich-orders.js
- **Verification:** Dry-run output now shows "shopify.store is empty (set in brands/{brand}.json)" which accurately guides Luis to fill in the store value
- **Committed in:** 900fee7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug/clarity fix)
**Impact on plan:** Minor UX improvement to skip messages. No scope creep.

## Issues Encountered

None -- plan executed with only the one minor message clarity fix.

## User Setup Required

Luis must fill in Shopify store values and set env vars before enrich-orders.js can actually fetch data:

1. For each brand, edit `brands/{slug}.json` and set `shopify.store` to the actual store domain (e.g. `"turnedyellow.myshopify.com"`)
2. Add the corresponding env vars to `.env`:
   ```
   SHOPIFY_TOKEN_TURNEDYELLOW=shpat_...
   SHOPIFY_TOKEN_MAKEMEJEDI=shpat_...
   SHOPIFY_TOKEN_TURNEDWIZARD=shpat_...
   SHOPIFY_TOKEN_TURNEDCOMICS=shpat_...
   SHOPIFY_TOKEN_POPSMITHS=shpat_...
   ```
3. Run: `node scripts/enrich-orders.js --brand turnedyellow --dry-run` to verify config, then without --dry-run to populate customer data

## Next Phase Readiness
- enrich-orders.js is ready to populate customer data once Shopify credentials are added
- approve-consent-candidates.js is ready for Luis to review and approve consent candidates immediately (396 pre_approved orders in DB)
- nodemailer installed -- lib/email.js can send emails as soon as SMTP credentials and consent server are ready (Phase 02-02)
- Consent gate flow established: pre_approved -> pending -> email sent -> approved/denied

---
*Phase: 02-customer-consent-system*
*Completed: 2026-03-01*
