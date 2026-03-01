---
phase: "06"
plan: "01"
status: complete
commit: 80fec50
---

# Plan 06-01 Summary: POST /api/consent/send-batch route

## What Was Done

Added one new API route to `scripts/dashboard.js`:

**`POST /api/consent/send-batch`**

- Queries orders with `production_status='approved'` AND `consent_status='pre_approved'` AND `customer_email` present
- Accepts optional `{ brand }` body to filter to a single brand
- Calls `lib/email.js` `sendConsentRequest()` for each eligible order
- On success per order: updates `consent_status='pending'`
- Returns `{ success: true, sent: N, failed: N, errors: string[], total: N }`

Also added `POST /api/consent/send-batch` to the startup console log listing.

## Verification Results

- `node --check scripts/dashboard.js` — SYNTAX OK
- Route returns `{"success":true,"sent":0,"failed":0,"errors":[],"total":0}` with HTTP 200 when no eligible orders exist
- Existing `POST /api/orders/:orderId/:brand/status` — UNCHANGED
- Existing `POST /api/batch/status` — UNCHANGED
- `/api/board` still returns lanes JSON — UNCHANGED

## Success Criteria

- [x] node --check passes
- [x] POST /api/consent/send-batch route added before GET /api/production-runs
- [x] Route queries production_status='approved' AND consent_status='pre_approved'
- [x] Route calls email.sendConsentRequest() for each eligible order
- [x] Route updates consent_status='pending' on successful send
- [x] Route returns { success, sent, failed, errors, total }
- [x] Existing POST /api/orders/:orderId/:brand/status UNCHANGED
- [x] Existing POST /api/batch/status UNCHANGED
- [x] Git commit created (80fec50)
