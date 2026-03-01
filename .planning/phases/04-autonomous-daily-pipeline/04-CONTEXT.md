# Phase 4: Autonomous Daily Pipeline - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a daily pipeline orchestrator that Gwen can run (or that runs itself via cron) to: select consented orders, produce videos for all brands with pending approved orders, and upload results to Drive. Includes circuit breaker, stage checkpoint validation, and Discord run summaries. The pipeline starts as manually-triggered and is designed to be automated once validated.

</domain>

<decisions>
## Implementation Decisions

### Trigger model — manual-first, cron-ready
- Phase 4 ships as a manually-triggered pipeline: Luis runs a single command (`daily-pipeline.sh` or similar) each day during the validation period (~1 week)
- The system is built to be cron-ready from day one: idempotent, state-tracked, no interactive prompts
- After validation, cron can be enabled with a single config change (crontab entry or a `--schedule` flag) — no architecture change needed
- Gwen (via OpenClaw) can invoke the same command as Luis does manually

### Human gate — manual batch approval during validation
- Luis approves the candidate batch before consent emails go out (existing Phase 2 gate)
- The system is designed so this gate can be bypassed later: consented + pre-approved orders can auto-proceed without Luis review
- Gate removal is a config flag, not a code change — implemented in Phase 4 but left OFF by default

### Notifications — Discord #social channel
- Gwen posts a run summary to the #social Discord channel after each daily run
- Summary includes: brands processed, orders attempted, videos uploaded to Drive, failures (order ID + reason)
- Also posts on circuit breaker trip: "Pipeline stopped — 3 consecutive failures. Review needed."
- No email, no Slack — Discord #social is the single notification channel

### Error handling — skip and continue, circuit breaker at 3
- A single order failure (Gemini error, Printful timeout, bad assets): skip that order, log it, continue the batch
- No automatic retry — failures are logged for Luis to review and re-queue manually
- Circuit breaker: if 3 consecutive orders fail, halt the entire batch and post a Discord alert
- Failed orders are tracked in the pipeline DB so they can be re-queued without redoing successful orders

### Checkpoint validation between stages
- Each pipeline stage validates its output before the next stage begins
- Checkpoints: assets downloaded (files exist + non-zero size) → mockups generated (image files valid) → staging complete (staged images exist) → video built (file exists, passes spec check: 1080x1920, h264, 30fps) → uploaded (Drive URL returned)
- If a checkpoint fails for an order, that order is marked failed and skipped — same as error handling above

### OpenClaw dependency — design for fallback
- OpenClaw (Gwen's agent framework) is in transition — founder joined OpenAI Feb 2026
- Pipeline must work as a standalone shell script that Gwen can call OR Luis can run directly
- Do NOT make OpenClaw a hard dependency: the pipeline is a script, Gwen is the caller
- If OpenClaw breaks, Luis can run `daily-pipeline.sh` manually with no code changes

### Claude's Discretion
- Discord webhook integration details (webhook URL stored in .env)
- Exact crontab syntax and time (suggest 6am daily in Luis's timezone)
- State file format for tracking run progress and failed order re-queue
- Log file rotation and retention

</decisions>

<specifics>
## Specific Ideas

- "I'll run it daily for a week and then automate it" — the validation period is intentional. Build the manual path first, make automation a one-line addition.
- The Discord #social channel already exists — webhook URL will need to be added to .env
- The pipeline should print clear progress to stdout for Luis to follow during manual runs, in addition to the Discord summary at the end

</specifics>

<deferred>
## Deferred Ideas

- **Full Gwen autonomy with OpenClaw** — once OpenClaw stabilizes post-transition, integrate deeper (Gwen schedules, monitors, re-queues automatically). For now: Gwen calls the script, script does the work.
- **Auto-retry with backoff** — retrying failed orders automatically. Deferred: for now Luis reviews and re-queues manually, keeping the validation loop tight.
- **Multi-day queue** — processing a backlog of multiple days' approved orders in one run. Out of scope: daily batch only.

</deferred>

---

*Phase: 04-autonomous-daily-pipeline*
*Context gathered: 2026-03-01*
