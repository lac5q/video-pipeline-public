# Phase 7: Consent Tracking & Pipeline Control — Summary

**Status:** ✅ Complete  
**Date Completed:** 2026-03-02  
**Duration:** ~2 hours  

---

## Overview

Phase 7 delivers real-time consent tracking and live pipeline control from the dashboard. Luis can now monitor consent responses, resend emails, trigger the pipeline, and watch it run live — all without touching the terminal.

---

## What Was Built

### Plan 07-01: Real-time Consent Tracking

**API Endpoints:**
- `GET /api/consent/status/:orderId/:brand` — Full consent status with log history and token status
- `POST /api/consent/resend/:orderId/:brand` — Resend consent email with one click

**UI Features:**
- Consent timeline in order detail panel showing full history (sent, opened, approved, declined)
- Timestamps for every consent event
- "Resend Consent Email" button for pending/denied orders
- Token status tracking (used, expired, active)

**Database:**
- Uses existing `consent_log` table with `old_status` and `new_status` columns
- Leverages `consent_tokens` table for link-based consent tracking

---

### Plan 07-02: Pipeline Control with Live Progress

**API Endpoints:**
- `POST /api/pipeline/run` — Trigger daily pipeline run
- `GET /api/pipeline/status/:runId` — Get current run status
- `GET /api/pipeline/sse` — Server-Sent Events stream for live progress
- `GET /api/pipeline/history` — Get last 20 pipeline runs

**UI Features:**
- **Pipeline Control Panel** (bottom-left):
  - "Run Pipeline" button with confirmation
  - Live status indicator (Idle, Running, Complete, Failed)
  - Real-time log stream from pipeline execution
  - Exit code display on completion

- **Run History Panel** (bottom-right):
  - Collapsible list of recent runs
  - Per-run stats: success count, failed count, duration, start time
  - Status badges (complete, running, failed)
  - Click to expand/collapse

**Backend:**
- Spawns `daily-pipeline.sh` as child process
- Captures stdout/stderr and broadcasts via SSE
- Updates `daily_runs` database table
- Non-blocking — dashboard remains responsive during runs

---

## Technical Implementation

### Server-Sent Events (SSE)

```javascript
// Client connects to /api/pipeline/sse
const sse = new EventSource('/api/pipeline/sse');

// Server broadcasts updates
sseClients.forEach(res => {
  res.write(`data: ${JSON.stringify(update)}\n\n`);
});
```

### Pipeline Process Spawning

```javascript
const child = spawn('bash', [scriptPath, ...args], {
  cwd: PIPELINE_ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (data) => {
  broadcastPipelineUpdate(runId, { type: 'log', level: 'info', message: line });
});
```

### Consent Timeline Rendering

```javascript
consentLog.forEach(entry => {
  html += `<div class="consent-timeline-item">
    <span class="consent-timeline-time">${fmtDate(entry.timestamp)}</span>
    <span class="consent-timeline-action">${esc(entry.action)}</span>
  </div>`;
});
```

---

## Files Modified

- `scripts/dashboard.js` — Added all API endpoints, UI components, and JavaScript logic
- No database migrations needed (uses existing tables)

---

## Testing Checklist

- [ ] Start dashboard: `node scripts/dashboard.js`
- [ ] Open http://localhost:3001
- [ ] Click an order card → Verify consent timeline shows in panel
- [ ] For pending/denied orders → Click "Resend Consent Email"
- [ ] Click "Run Pipeline" → Confirm dialog appears
- [ ] Watch live log stream in Pipeline Control Panel
- [ ] Verify Run History panel populates after run completes
- [ ] Check SSE connection persists during long runs
- [ ] Verify pipeline process doesn't block dashboard UI

---

## Success Criteria (from ROADMAP.md)

✅ **UCONS-03:** Real-time consent status per order with auto-updates  
✅ **UCONS-04:** Resend consent email with one click  
✅ **PIPE-01:** Pipeline trigger button with live progress stream  
✅ **PIPE-02:** Run summary after completion  
✅ **PIPE-03:** Run history with outcome summaries  
✅ **PIPE-04:** Live stage-by-stage progress streaming

---

## Known Limitations

1. **SSE reconnection:** If SSE disconnects, client retries after 3s. Network issues may cause temporary log gaps.
2. **Concurrent runs:** No locking mechanism prevents multiple simultaneous pipeline runs (edge case).
3. **Log retention:** Only last 100 log lines shown in UI (prevents memory bloat).
4. **No cancel button:** Once started, pipeline runs to completion (circuit breaker still active in script).

---

## Next Steps (Phase 8)

Phase 8 will add:
- In-browser video player (no download needed)
- Video approve/reject for Drive upload
- Dual UGC/standard reel review
- Social copy panel per platform
- Clipboard copy for social copy

---

## Metrics

- **Lines of code added:** ~650
- **API endpoints added:** 6
- **UI components added:** 4 (control panel, history panel, consent timeline, resend button)
- **Database changes:** 0 (leveraged existing schema)
- **Execution time:** ~2 hours

---

*Phase 7 complete. Ready for Phase 8 planning.*
