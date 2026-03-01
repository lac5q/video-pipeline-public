---
phase: 02-customer-consent-system
plan: "03"
subsystem: testing
tags: [consent, smoke-test, express, sqlite, email-template, token-validation]

# Dependency graph
requires:
  - phase: 02-customer-consent-system
    provides: "lib/consent.js (generateConsentToken, validateConsentToken, updateConsent, listPendingConsent, getDb), lib/email.js (renderTemplate), scripts/consent-server.js (Express app exported as module.exports), templates/consent-email.html"

provides:
  - "End-to-end smoke test validating all consent pipeline components together (scripts/test-consent-flow.js)"
  - "Visual inspection artifact: /tmp/test-consent-email.html (rendered branded email)"
  - "25-assertion coverage across 5 test sections: state transitions, token lifecycle, email rendering, server routes, batch filter"

affects: [03-video-production, 04-automation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test isolation via DB_PATH env override set before requiring lib modules"
    - "app.listen(0) for random port assignment in server tests (no port conflicts)"
    - "Native http.get() for HTTP assertions (no test framework dependencies)"

key-files:
  created:
    - scripts/test-consent-flow.js
  modified: []

key-decisions:
  - "DB_PATH must be set before requiring lib/consent.js (lazy-loaded _db cached on first getDb() call)"
  - "oms_url column added via ALTER TABLE in test setup (not in lib/consent.js minimal schema)"
  - "Shopify discount creation and SMTP failures are non-fatal in test environment (expected behavior)"

patterns-established:
  - "Consent smoke test pattern: isolated /tmp DB + teardown, no external APIs, server on random port"

requirements-completed:
  - CONS-01
  - CONS-02
  - CONS-03
  - CONS-04
  - CONS-05

# Metrics
duration: 3min
completed: "2026-03-01"
---

# Phase 02 Plan 03: Consent Flow Smoke Test Summary

**25-assertion smoke test validating the full consent pipeline: state transitions, token lifecycle, email template rendering with illustration URL, Express server routes, and batch sender email filtering**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-01T06:20:10Z
- **Completed:** 2026-03-01T06:23:00Z
- **Tasks:** 1 of 2 (Task 2 is checkpoint:human-verify -- awaiting visual confirmation)
- **Files modified:** 1

## Accomplishments
- Created `scripts/test-consent-flow.js` with 454 lines, 25 assertions across 5 test sections
- All 25 tests pass: consent state transitions, token generation/validation/expiry, email template rendering, Express consent server routes (landing, confirm, decline, health check), and batch sender null-email filter
- Rendered email HTML saved to `/tmp/test-consent-email.html` for visual inspection

## Task Commits

Each task was committed atomically:

1. **Task 1: Create end-to-end consent flow smoke test** - `cdf79ee` (feat)

## Files Created/Modified
- `scripts/test-consent-flow.js` - 5-section smoke test: state transitions (CONS-02), token lifecycle (CONS-04), email template rendering (CONS-01), consent server routes (CONS-04), batch sender filter (CONS-01). Uses isolated /tmp DB, native http module for HTTP assertions, cleans up after itself.

## Decisions Made
- `DB_PATH` env var must be set before `require('lib/consent')` because the DB handle is cached on first `getDb()` call. The test script sets `process.env.DB_PATH` before any require calls.
- Added `ALTER TABLE orders ADD COLUMN oms_url TEXT` in test setup since lib/consent.js creates a minimal schema without this column. The production DB already has it (created by full migration agent).
- Shopify discount creation logs a warning but does not fail the test when credentials are missing -- this is the correct non-blocking behavior from consent-server.js.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SQLite double-quote column name error**
- **Found during:** Task 1 verification run
- **Issue:** SQLite interpreted `"TEST-%"` (double quotes) as a column name in LIKE clause, not a string literal
- **Fix:** Changed to single quotes `'TEST-%'` in the SQL query
- **Files modified:** scripts/test-consent-flow.js
- **Verification:** Test ran successfully after fix
- **Committed in:** cdf79ee (Task 1 commit)

**2. [Rule 1 - Bug] Missing oms_url column in test DB**
- **Found during:** Task 1 first run
- **Issue:** lib/consent.js creates a minimal orders schema without the `oms_url` column (production DB has it from migration agent)
- **Fix:** Added `ALTER TABLE orders ADD COLUMN oms_url TEXT` in test setup with try/catch for idempotency
- **Files modified:** scripts/test-consent-flow.js
- **Verification:** Setup completed and all 3 test orders inserted successfully
- **Committed in:** cdf79ee (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 - bugs found during first test run)
**Impact on plan:** Both were test infrastructure fixes, no scope creep. Test script matched plan spec exactly.

## Issues Encountered
- `Failed to send thank-you email: connect ECONNREFUSED ::1:587` -- expected, no SMTP configured in test environment. This is non-fatal output from consent-server.js confirm route, correctly handled.

## User Setup Required
None for the smoke test -- it runs fully isolated with a temporary DB.

For visual verification (Task 2 checkpoint):
1. Open `/tmp/test-consent-email.html` in a browser (run smoke test first to generate it)
2. Start consent server: `DB_PATH=/tmp/test-consent-flow.db node scripts/consent-server.js`
3. Check approval CLI: `node scripts/approve-consent-candidates.js --list --brand turnedyellow --limit 5`

## Next Phase Readiness
- Full consent pipeline validated end-to-end: pre_approved -> pending -> email -> token click -> approved -> coupon shown
- All 5 CONS requirements validated by smoke test assertions
- Awaiting Luis visual confirmation (Task 2 checkpoint) before marking phase complete
- Phase 3 (video production) can begin once consent system is confirmed working

---
*Phase: 02-customer-consent-system*
*Completed: 2026-03-01*

## Self-Check: PASSED

- FOUND: scripts/test-consent-flow.js
- FOUND: .planning/phases/02-customer-consent-system/02-03-SUMMARY.md
- FOUND commit cdf79ee: feat(02-03): create end-to-end consent flow smoke test
- VERIFIED: DB_PATH=/tmp/test-consent-flow.db node scripts/test-consent-flow.js -- 25/25 tests passed
- VERIFIED: /tmp/test-consent-email.html exists and contains rendered HTML
- VERIFIED: node scripts/approve-consent-candidates.js --help -- runs without error
- VERIFIED: grep price_rules scripts/consent-server.js -- no matches (good)
