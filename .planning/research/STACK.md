# Stack Research

**Domain:** Multi-brand automated video production pipeline with customer consent, email automation, and AI agent orchestration
**Researched:** 2026-02-26
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | >=22.x LTS | Runtime for all pipeline tooling | Already in use (generate-mockups.js). LTS through April 2027. Native `fetch`, native test runner, performance improvements over 20.x. |
| Bash/zsh | System | Shell orchestration scripts | Already proven (produce-video.sh, build-brand-video.sh). Keep bash for ffmpeg orchestration -- no reason to rewrite working scripts. |
| ffmpeg | >=6.x | Video encoding/composition | Already proven. CRF 18, h264, 1080x1920 portrait pipeline is locked in. No change needed. |
| Zod | 4.3.x | Brand config schema validation | 14x faster parsing than v3, 57% smaller bundle. Validates brand configs at load time -- catches misconfiguration before pipeline runs. TypeScript-first with static type inference. |
| better-sqlite3 | 12.6.x | Consent tracking database | Synchronous API is ideal for CLI/agent workflows (no async ceremony for simple reads/writes). Zero-config file-based DB. Perfect for consent state machine (pending/approved/denied). |
| Resend | 6.9.x (SDK) | Transactional consent emails | Best DX of any email API. Built by ex-Vercel team. Clean Node.js SDK. $20/mo covers consent volume easily. Pairs natively with React Email for templates. |
| @react-email/components | 1.0.x | Branded email templates | Build consent request emails as React components -- one template per brand with brand colors/logos injected as props. Renders to standards-compliant HTML. |
| croner | 10.0.x | Daily pipeline scheduling | Zero dependencies, timezone-aware cron expressions. Lightweight -- no Redis required (unlike BullMQ). Perfect for "run daily at 9am CT" use case. |

**Confidence: HIGH** -- Resend version verified via npm (6.9.2 published Feb 2026). Zod 4.3.6 verified via npm/GitHub. better-sqlite3 12.6.2 verified. croner 10.0.1 verified.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod-config | 1.0.x | Load brand configs from JSON/env with Zod validation | Brand config loading -- validates against schema, rejects invalid configs at startup |
| nanoid | 5.x | Generate consent tokens / tracking IDs | Consent request URLs, order tracking IDs. URL-safe, no UUID bloat. |
| date-fns | 4.x | Date formatting for consent expiry, scheduling | Consent expiration windows, schedule display. Tree-shakeable, no Moment.js bloat. |
| pino | 9.x | Structured JSON logging | Pipeline run logs, consent audit trail, error tracking. Fastest Node.js logger by benchmark. |
| commander | 13.x | CLI argument parsing | All pipeline entry points (`select-orders`, `send-consent`, `run-pipeline`). Already the standard for Node.js CLIs. |
| dotenv | 16.x | Environment variable loading | API keys (Resend, Shopify, OMS). Simple, universal. |
| @inquirer/prompts | 7.x | Interactive CLI prompts | Batch approval workflow -- Luis reviews suggested orders and approves/rejects interactively. |

**Confidence: HIGH** -- All libraries are established, well-maintained, with clear npm activity in 2025-2026.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript 5.7.x | Type safety for brand configs, consent state, pipeline orchestration | Use `.ts` for new modules, keep `.sh` for proven shell scripts. `noEmit` + `tsx` for execution. |
| tsx | 4.x | Run TypeScript directly without build step | `tsx src/select-orders.ts` -- no tsc compile step needed for CLI tools. |
| Vitest | 3.x | Unit/integration tests | Faster than Jest, native TypeScript support, same API. Test consent state machine, config validation, order selection logic. |
| @types/better-sqlite3 | Latest | TypeScript types for SQLite | Required for better-sqlite3 type safety. |

## Installation

```bash
# Core
npm install zod zod-config better-sqlite3 resend @react-email/components @react-email/render croner nanoid date-fns pino commander dotenv @inquirer/prompts

# Dev dependencies
npm install -D typescript tsx vitest @types/better-sqlite3 @types/node
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| better-sqlite3 | PostgreSQL (via Heroku) | If consent data needs multi-machine access or you exceed ~100K orders. Current scale (5 brands, daily batches) doesn't justify a DB server. |
| better-sqlite3 | node:sqlite (built-in) | When Node.js stabilizes the module (still experimental/`--experimental-sqlite` flag required as of Node 25.x). Revisit in late 2026. |
| Resend | SendGrid | If you need marketing email alongside transactional. But consent emails are purely transactional -- Resend's focused API is cleaner and cheaper. |
| Resend | Nodemailer + SMTP | If you want zero vendor lock-in and already have SMTP infrastructure. But Resend's delivery reliability and templating integration justify the $20/mo. |
| croner | BullMQ + Redis | If pipeline grows to need job persistence, retry queues, priority scheduling, or distributed workers. Current use case is single-machine daily cron -- Redis is overkill. |
| croner | node-cron | Never -- croner is strictly better (timezone support, zero deps, actively maintained). node-cron lacks persistence and timezone handling. |
| React Email | MJML | If email templates need to be edited by non-developers. But brand templates are developer-maintained -- React components are more natural in this stack. |
| Zod | JSON Schema + Ajv | If brand configs need to be validated outside Node.js (e.g., in a web form). But all validation happens in the pipeline -- Zod's TypeScript integration is far superior. |
| pino | winston | Never for this use case -- winston is slower and heavier. pino's JSON output is ideal for structured pipeline logs. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| MongoDB/Mongoose | Massive overkill for consent tracking. Adds operational burden (server, connection management) for what is fundamentally a small state machine. | better-sqlite3 -- zero ops, file-based, synchronous. |
| Express/Fastify web server | No web UI needed (explicit out-of-scope). Adding an HTTP server creates attack surface and maintenance burden for a CLI/agent pipeline. | Commander CLI + Gwen agent interface. |
| Bull (v3) | Deprecated predecessor to BullMQ. Still gets downloads but no active development. | BullMQ if you need queues, croner if you just need scheduling. |
| Handlebars/EJS for email | String-template email is fragile, hard to test, and produces inconsistent HTML across email clients. | React Email -- component-based, type-safe, renders to tested HTML. |
| Prisma ORM | Massive dependency tree, code generation step, migration system -- all for a 3-table SQLite database. Absurd overhead. | Raw better-sqlite3 with Zod validation on read/write. |
| node-cron | No timezone support, no persistence, stale maintenance. croner does everything it does plus more, with zero dependencies. | croner. |
| Moment.js | Deprecated by its own maintainers since 2020. Massive bundle. | date-fns -- tree-shakeable, actively maintained. |
| SendGrid for consent emails only | Complex pricing, bloated SDK, overkill features (marketing automation, A/B testing) you'll never use. $180/mo vs $20/mo for same volume. | Resend -- purpose-built for transactional email. |

## Stack Patterns by Variant

**If pipeline stays single-machine (current plan):**
- Use croner for scheduling, better-sqlite3 for state, filesystem for logs
- Gwen (OpenClaw + MiniMax M2.5) orchestrates via CLI commands
- No Redis, no message queue, no server processes

**If pipeline needs distributed processing later:**
- Swap croner for BullMQ + Redis (add `npm install bullmq ioredis`)
- Move better-sqlite3 to PostgreSQL on Heroku (already have Heroku infra)
- Add health check endpoint via Fastify (minimal server)
- This is a future milestone concern, not current scope

**If email volume exceeds Resend free/starter tier:**
- Resend Pro ($80/mo) covers 50K emails/month -- far beyond consent email volume
- Only switch to SendGrid/SES if doing bulk marketing (explicitly out of scope)

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| zod@4.3.x | zod-config@1.0.x | zod-config supports both Zod 3 and Zod 4 out of the box |
| resend@6.9.x | @react-email/render@2.0.x | Resend renders React Email components natively via `render()` |
| better-sqlite3@12.6.x | Node.js >=22.x | Prebuilt binaries available for Node 22 LTS |
| croner@10.0.x | Node.js >=18.x | Also works in Deno/Bun if you ever migrate |
| tsx@4.x | TypeScript 5.7.x | Handles `.ts` execution without tsc build step |
| vitest@3.x | TypeScript 5.7.x | Native TS support, no jest transform config needed |

## Agent Orchestration Notes

**Gwen (OpenClaw + MiniMax M2.5) is already the chosen agent platform.** This stack research does NOT recommend changing the agent framework. Instead, the stack decisions above ensure Gwen can interact with the pipeline cleanly:

- **CLI-first design**: Every pipeline action is a CLI command Gwen can invoke (`select-orders`, `send-consent-emails`, `check-consent-status`, `produce-videos`, `upload-to-drive`)
- **Structured output**: pino JSON logs and commander's exit codes give Gwen parseable feedback
- **SQLite state**: Gwen queries consent status via CLI wrappers around better-sqlite3 -- no API server needed
- **MCP compatibility**: If Gwen later adopts MCP (Model Context Protocol), CLI tools can be wrapped as MCP tool servers trivially. MCP SDK for TypeScript is at @modelcontextprotocol/sdk@1.12.x.

**Confidence: MEDIUM** -- OpenClaw is rapidly evolving (founder joined OpenAI Feb 2026, project moving to foundation). MiniMax M2.5 integration is stable but monitor for breaking changes.

## Sources

- [npm: resend@6.9.2](https://www.npmjs.com/package/resend) -- version verified Feb 2026 (HIGH confidence)
- [npm: better-sqlite3@12.6.2](https://www.npmjs.com/package/better-sqlite3) -- version verified Feb 2026 (HIGH confidence)
- [npm: bullmq@5.70.1](https://www.npmjs.com/package/bullmq) -- version verified, considered and deferred (HIGH confidence)
- [npm: croner@10.0.1](https://www.npmjs.com/package/croner) -- version verified Feb 2026 (HIGH confidence)
- [npm: zod@4.3.6](https://www.npmjs.com/package/zod) -- version verified, Zod 4 released Jul 2025 (HIGH confidence)
- [npm: @react-email/components@1.0.8](https://www.npmjs.com/package/@react-email/components) -- version verified Feb 2026 (HIGH confidence)
- [Zod v4 release notes](https://zod.dev/v4) -- 14x faster parsing benchmark (HIGH confidence)
- [Node.js SQLite docs](https://nodejs.org/api/sqlite.html) -- still experimental as of Node 25.x (HIGH confidence)
- [BullMQ docs](https://docs.bullmq.io/) -- job scheduler capabilities (HIGH confidence)
- [Resend vs SendGrid comparison](https://nextbuild.co/blog/resend-vs-sendgrid-vs-ses-email) -- pricing/feature comparison (MEDIUM confidence)
- [Better Stack: Node.js schedulers comparison](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/) -- croner vs node-cron vs BullMQ (MEDIUM confidence)
- [OpenClaw Wikipedia](https://en.wikipedia.org/wiki/OpenClaw) -- agent framework context (MEDIUM confidence)
- [Anthropic MCP announcement](https://www.anthropic.com/news/model-context-protocol) -- protocol standard (HIGH confidence)
- [MCP donated to Linux Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) -- governance context (HIGH confidence)

---
*Stack research for: Multi-brand video production pipeline (Milestone 2)*
*Researched: 2026-02-26*
