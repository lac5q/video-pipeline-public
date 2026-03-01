---
phase: 05-dashboard-foundation
plan: "01"
subsystem: api
tags: [express, sqlite, kanban, board]

requires: []
provides:
  - classifyOrderToLane() helper function in dashboard.js
  - GET /api/board endpoint with 5-lane classification and per-lane counts
  - Brand and consent_status filter support for board endpoint
affects:
  - 05-dashboard-foundation

tech-stack:
  added: []
  patterns:
    - Lane classification by production_status + consent_status priority chain
    - Board endpoint returns pre-classified data with computed scores

key-files:
  created:
    - scripts/dashboard.js (was untracked, now committed)
  modified:
    - scripts/dashboard.js
---

## Summary

Added the `/api/board` endpoint and `classifyOrderToLane()` helper to `scripts/dashboard.js`.

The endpoint returns all orders (up to 1000) classified into 5 Kanban lanes based on `production_status` and `consent_status`. Classification priority: uploaded > video_built > consent_approved > consent_pending > candidates (catch-all). Each lane has `orders[]` and `count` fields. Supports `?brand=` and `?consent_status=` query params for filtering.

Verified with 396 real orders: all 5 lanes present, brand filter works, existing routes (/api/stats, /api/orders) unchanged.

## Self-Check: PASSED

- [x] classifyOrderToLane() function added to Helpers section
- [x] GET /api/board route added before /api/stats
- [x] All 5 lane IDs present in response
- [x] Brand filter works
- [x] Existing routes unchanged
- [x] node --check passes
- [x] Committed: feat(05-01)

## Commits

- `c3f1610` feat(05-01): add classifyOrderToLane helper and GET /api/board endpoint
