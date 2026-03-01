# Phase 4: Autonomous Daily Pipeline - Research

**Researched:** 2026-03-01
**Status:** Complete

## Executive Summary

Phase 4 builds on a nearly-complete foundation. The `daily-pipeline.sh` script already exists with multi-brand processing, circuit breaker skeleton, checkpoint stages, and argument parsing. The gaps are: Discord webhook notifications, consecutive-failure circuit breaker logic, formal checkpoint validation with file-level checks, failed order DB tracking for re-queue, and run-level state persistence.

## Existing Codebase Analysis

### What Already Exists

1. **`scripts/daily-pipeline.sh`** (309 lines) - Full pipeline orchestrator with:
   - Multi-brand iteration with configurable `BRANDS` list
   - `rank-candidates.js` integration for order selection (`--ready-only --json`)
   - 6-stage checkpoint flow: download assets -> generate mockups -> stage with Gemini -> build video -> verify video -> generate social copy -> upload to Drive
   - Circuit breaker function (checks `error_count >= MAX_ERRORS`)
   - Dry-run mode, skip-import, single-brand, configurable limits
   - Log file rotation to `logs/daily-{timestamp}.log`
   - Final report with success/fail/skip counts
   - Production status update in DB after completion

2. **`scripts/batch-produce.sh`** (295 lines) - Per-brand batch producer with:
   - Dual video build (standard reel always + UGC if reaction video exists)
   - Skip-upload and skip-staging flags
   - Idempotent asset/mockup/staging checks

3. **`lib/db.js`** - SQLite database with:
   - `orders` table: order_id, brand, consent_status, production_status, video_path, drive_url
   - `consent_log` table: action tracking
   - `production_runs` table: order_id, brand, video_type, status, error, output_path, drive_url

4. **`scripts/verify-video.sh`** - Quality gate checking 1080x1920, h264, ~30fps, file size > 0

5. **`scripts/upload-to-drive.js`** - Google Drive upload with folder hierarchy and multi-file support

### What's Missing (Gaps)

1. **Discord webhook integration** - No Discord code exists. Need: webhook HTTP POST, message formatting, .env variable `DISCORD_WEBHOOK_URL`
2. **Consecutive failure tracking** - Current `daily-pipeline.sh` increments `error_count` globally but doesn't track consecutive failures. Circuit breaker should trip on 3 *consecutive* failures, not 3 total
3. **Failed order re-queue** - Orders that fail are logged but not tracked in DB with a `failed` production_status that allows re-queuing
4. **Formal checkpoint validation** - Current checkpoints check file existence loosely; need explicit non-zero file size checks after each stage
5. **Run-level state** - No `pipeline_runs` record is created for each daily run (the table exists but `daily-pipeline.sh` doesn't use it)
6. **Dual video build** - `daily-pipeline.sh` calls `produce-video.sh` once per order; `batch-produce.sh` builds both reel and UGC. The daily pipeline should build both video types like batch-produce does

## Technical Approach

### Discord Webhook Integration

Discord webhooks accept a simple POST with JSON body:
```bash
curl -H "Content-Type: application/json" \
  -d '{"content": "message", "embeds": [{"title": "title", "description": "desc", "color": 3066993}]}' \
  "$DISCORD_WEBHOOK_URL"
```

Implementation: Add a `send_discord()` function to `daily-pipeline.sh` that POSTs formatted messages. Use embeds for structured run summaries (green for success, red for circuit breaker). No external dependency needed -- just `curl`.

### Consecutive Failure Circuit Breaker

Replace `error_count` with `consecutive_errors`. Reset to 0 on each success. Trip at 3 consecutive.

```bash
consecutive_errors=0

# On success:
consecutive_errors=0

# On failure:
((consecutive_errors++))
if [[ $consecutive_errors -ge $MAX_CONSECUTIVE_ERRORS ]]; then
    send_discord "Circuit breaker tripped: ${consecutive_errors} consecutive failures"
    exit 1
fi
```

### Failed Order Tracking

On failure, update `orders.production_status = 'failed'` with error reason. On success, update to `'complete'`. A re-queue command can reset `failed` orders back to `pending`.

### Checkpoint Validation Enhancement

Each checkpoint should verify:
- **Assets**: Photos directory non-empty, each file > 0 bytes
- **Mockups**: v11_*.png files exist, count > 0, each > 0 bytes
- **Staging**: .raw backup files exist (indicates staging ran)
- **Video**: Delegate to `verify-video.sh` (already comprehensive)
- **Upload**: Drive URL returned (already checked)

### Run State Persistence

Create a `daily_runs` table:
```sql
CREATE TABLE IF NOT EXISTS daily_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT UNIQUE NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT DEFAULT 'running',
  brands_processed TEXT,
  orders_attempted INTEGER DEFAULT 0,
  orders_succeeded INTEGER DEFAULT 0,
  orders_failed INTEGER DEFAULT 0,
  orders_skipped INTEGER DEFAULT 0,
  error_log TEXT,
  discord_notified INTEGER DEFAULT 0
);
```

## Dependencies

- **Node.js modules**: None new -- `curl` for Discord, `better-sqlite3` already in use
- **Environment variables**: Add `DISCORD_WEBHOOK_URL` to `.env.example`
- **External services**: Discord webhook (free, no rate limit concerns at daily-run volume)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Discord webhook URL misconfigured | Low -- pipeline runs fine, just no notification | Validate URL format on startup; warn but don't fail |
| Consecutive error threshold too aggressive | Medium -- could halt on unrelated failures | Allow per-brand consecutive tracking, not global |
| OpenClaw instability | Low -- pipeline is a standalone script | Already designed for manual execution fallback |

## Recommendations

1. **Single plan** - This phase is a focused enhancement to an existing script. One plan covering: Discord notifications, circuit breaker fix, checkpoint validation, failed order tracking, and run state. No architectural changes needed.
2. **Minimal new files** - Add `lib/discord.js` for webhook helper, update `daily-pipeline.sh`, update `lib/db.js` schema, update `.env.example`
3. **Test with `--dry-run`** - The existing dry-run flag should be extended to test Discord notification formatting without sending

## RESEARCH COMPLETE

Research completed successfully. Ready for planning.

---

*Phase: 04-autonomous-daily-pipeline*
*Research completed: 2026-03-01*
