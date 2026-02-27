# Project Research Summary

**Project:** Multi-brand automated video production pipeline
**Domain:** Internal tooling -- automated UGC/reels video production with customer consent, multi-brand config, and autonomous agent orchestration
**Researched:** 2026-02-26
**Confidence:** MEDIUM-HIGH

## Executive Summary

This project extends a proven single-brand video pipeline (TurnedYellow) to serve five brands (TurnedYellow, MakeMeJedi, TurnedWizard, TurnedComics, PopSmiths) with automated customer consent, order selection, and autonomous daily production via the Gwen agent. The core video production pipeline (ffmpeg + ImageMagick + Gemini staging) is already battle-tested. The primary engineering challenge is not video production itself -- it is parameterizing the pipeline to be brand-driven, building a legally sound consent system, and wrapping everything in guardrails robust enough for autonomous agent execution.

The recommended approach is to build from the foundation up: brand config system first, then pipeline parameterization (proving multi-brand works with the existing recipe), then consent management, then order selection and batch approval, and finally autonomous agent orchestration. Four of the five brands share the same OMS, so they can be grouped together; PopSmiths has fundamentally different infrastructure and must be integrated separately. The stack is lightweight and CLI-first: Node.js + TypeScript for new modules, bash for proven ffmpeg scripts, SQLite for consent tracking, Resend for transactional emails, and Zod for config validation.

The top risks are: (1) brand config leakage causing wrong logos/colors on videos -- mitigated by immutable config loading and schema validation; (2) consent state machine gaps leading to legal violations -- mitigated by building revocation and expiration paths before the happy path; (3) autonomous agent error compounding -- mitigated by checkpoint validation between every pipeline stage and maintaining human batch approval as a hard gate. The consent violation risk is the most severe because recovery cost is high (video takedowns, customer apologies, potential legal exposure).

## Key Findings

### Recommended Stack

The stack leverages the existing codebase (bash/ffmpeg/ImageMagick) for proven video production and adds TypeScript tooling for new orchestration, consent, and config management modules. No web server, no heavy ORM, no message queue -- the architecture stays CLI-first because there is one operator (Luis) and one agent (Gwen).

**Core technologies:**
- **Node.js 22.x LTS + TypeScript 5.7.x:** Runtime for all new modules (order selection, consent management, config validation). tsx for direct execution, no build step.
- **Bash + ffmpeg 6.x + ImageMagick:** Proven video production pipeline. Keep as-is, parameterize to read brand config via `jq`.
- **Zod 4.3.x:** Brand config schema validation at load time. 14x faster than v3, catches misconfiguration before pipeline runs.
- **better-sqlite3 12.6.x:** Consent state tracking. Synchronous API ideal for CLI workflows, zero-config file-based DB.
- **Resend 6.9.x + React Email:** Branded transactional consent emails. Clean SDK, $20/mo, renders brand templates as React components.
- **croner 10.0.x:** Daily pipeline scheduling. Zero dependencies, timezone-aware. No Redis needed.
- **pino 9.x:** Structured JSON logging for pipeline audit trail and agent decision logging.

**Critical version note:** OpenClaw (Gwen's agent framework) is in flux -- founder joined OpenAI Feb 2026, project moving to foundation. Monitor for breaking changes.

### Expected Features

**Must have (table stakes -- pipeline does not function without these):**
- Brand config system (JSON configs with schema validation for all 5 brands)
- Brand-aware video build (parameterized ffmpeg scripts reading brand config)
- Customer consent request emails (branded templates per brand)
- Consent tracking with state machine (pending/approved/denied/bounced/expired/revoked)
- OMS integration for shared-OMS brands (TY/MMJ/TW/TC)
- Batch approval CLI (Luis reviews suggested orders, approves/rejects)
- UGC + standard reels for all brands
- Google Drive upload with brand folder structure
- Retry logic for Gemini staging and Printful rate limits

**Should have (multiplies value after core is stable):**
- Order candidate auto-selection with scoring algorithm
- Gwen autonomous daily pipeline with scheduling and health checks
- Music rotation per brand
- Social copy with brand voice
- Production audit trail
- Cross-brand content calendar awareness

**Defer to v2+:**
- PopSmiths integration (fundamentally different infrastructure)
- Consent email auto-tracking via link clicks
- Illustration quality scoring via vision AI
- Web dashboard, auto-posting to social, real-time editing UI (anti-features -- do not build)

### Architecture Approach

The architecture is a five-layer stack: Orchestration (Gwen agent, order selector, batch approver) sits on top of Consent (email sender, tracker, gate), which sits on top of Brand Config (registry of all brand-specific data), which feeds into Production (the existing proven pipeline: asset download, mockup generation, Gemini staging, video build), which outputs to Publish (Drive upload, social copy, video tracker). External systems split into two groups: shared OMS (4 brands) and PopSmiths Heroku server (1 brand).

**Major components:**
1. **Brand Registry** -- Central JSON config per brand driving all brand-specific behavior. Foundation for everything.
2. **Consent Gate** -- Mandatory pre-production checkpoint. No order enters production without explicit customer consent.
3. **Pipeline Parameterization** -- Existing build scripts refactored to read brand config via `jq` instead of hardcoded values. Same ffmpeg logic, different data.
4. **Order Selector** -- Queries OMS per brand, scores candidates by quality signals, presents ranked list.
5. **Batch Approver** -- CLI interface for human-in-the-loop quality gate. Shows visual previews, not just order numbers.
6. **Gwen Orchestration** -- Capstone: connects all components into autonomous daily execution.

### Critical Pitfalls

1. **Brand config leakage between brands** -- Use immutable configs loaded fresh per order, validate completeness with schema at load time, assert logo file matches expected brand before any export. Build this prevention into the first phase.
2. **Consent state machine gaps** -- Define complete states upfront (NOT_REQUESTED/REQUESTED/APPROVED/DENIED/BOUNCED/EXPIRED/REVOKED). Build revocation path first. Consent is per-order AND per-brand. Include audit trail with timestamps on every transition.
3. **Autonomous agent error compounding** -- Implement checkpoint validation between every pipeline stage. Never auto-upload without approval gate. Circuit breakers halt batch on N errors. Log every agent decision with reasoning.
4. **Hardcoded paths and machine-specific dependencies** -- Extract all paths to environment variables. Bundle fonts. Create preflight-check script. Test in clean environment.
5. **PopSmiths architecture mismatch** -- Use adapter pattern for data access. Shared OMS adapter for 4 brands, separate PopSmiths adapter. Do not force into unified abstraction.
6. **Gemini non-determinism at scale** -- Exponential backoff with jitter, cache successful staging results, stagger calls across brands, validate output dimensions before proceeding.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Brand Config System and Path Abstraction
**Rationale:** Everything depends on this. Cannot build multi-brand anything without a validated, immutable brand config system. Combines config extraction with path abstraction because both address the same root problem (hardcoded values).
**Delivers:** JSON config files for all 5 brands with Zod schema validation. Environment-based path resolution. Preflight check script.
**Addresses:** Brand config system (P1), brand-aware video build foundation
**Avoids:** Brand config leakage (Pitfall 1), hardcoded paths (Pitfall 4)
**Uses:** Zod 4.3.x, jq, TypeScript

### Phase 2: Pipeline Parameterization
**Rationale:** Highest-risk refactoring -- touches the proven recipe. Must be validated early by producing TY videos from parameterized scripts and comparing to known-good output. De-risks everything downstream.
**Delivers:** Parameterized build scripts that accept brand config as input. Both UGC and standard reels variants. Verified by producing identical TY output from new parameterized pipeline.
**Addresses:** Brand-aware video build (P1), UGC + standard reels all brands (P1)
**Avoids:** Per-brand build script duplication (Anti-Pattern 1)
**Uses:** Bash, ffmpeg, ImageMagick, jq

### Phase 3: Customer Consent System
**Rationale:** Legal hard requirement. No video can be produced without consent. Must be complete (including revocation and expiration) before any batch processing begins. Building this before order selection ensures the selection system respects consent state.
**Delivers:** Full consent state machine (SQLite-backed), branded email templates via React Email + Resend, consent gate that blocks unconsented orders, audit trail.
**Addresses:** Consent tracking (P1), consent email templates (P1)
**Avoids:** Consent state machine gaps (Pitfall 2)
**Uses:** better-sqlite3, Resend, React Email, Zod

### Phase 4: Order Selection and Batch Approval
**Rationale:** Depends on both brand config (to know which OMS to query) and consent tracking (to filter already-pending/denied orders). This is the hardest table-stakes feature -- order scoring algorithm with quality signals.
**Delivers:** OMS integration for shared-OMS brands, order scoring/ranking, CLI batch approval with visual previews, human-in-the-loop quality gate.
**Addresses:** Order candidate auto-selection (P2), batch approval CLI (P1), OMS integration (P1)
**Avoids:** Agent error compounding (Pitfall 3) by establishing human checkpoint
**Uses:** Commander, @inquirer/prompts, pino

### Phase 5: Multi-Brand Production Pipeline
**Rationale:** With config, parameterized build, consent, and order selection in place, this phase connects them into an end-to-end multi-brand pipeline for the 3 shared-OMS brands beyond TY (MMJ, TW, TC). Hardens Gemini resilience for batch processing.
**Delivers:** End-to-end video production for 4 brands (TY/MMJ/TW/TC). Gemini retry with exponential backoff and caching. Printful rate limiting. Google Drive upload with brand folders. Social copy generation. Music rotation per brand.
**Addresses:** Google Drive upload (P1), social copy brand voice (P2), music rotation (P2), production audit trail (P2), Printful/Gooten rate handling (P1)
**Avoids:** Gemini non-determinism at scale (Pitfall 6), Printful rate limiting

### Phase 6: Autonomous Agent Orchestration
**Rationale:** Capstone -- requires all previous phases working reliably. Gwen orchestrates the full daily pipeline with scheduling, health checks, checkpoint validation, circuit breakers, and daily production reports for approval.
**Delivers:** Gwen autonomous daily pipeline, croner scheduling, checkpoint validation between stages, circuit breakers, daily summary report, error recovery.
**Addresses:** Gwen autonomous daily pipeline (P2)
**Avoids:** Agent error compounding (Pitfall 3)
**Uses:** croner, pino, commander

### Phase 7: PopSmiths Integration
**Rationale:** PopSmiths has fundamentally different infrastructure (headless Shopify, own Heroku art server, AI-generated art). Must be a separate phase, not lumped with shared-OMS brands. Gets its own asset retrieval adapter.
**Delivers:** PopSmiths asset retrieval adapter, PopSmiths-specific video template (artist credit overlays), end-to-end PopSmiths video production.
**Addresses:** PopSmiths integration (P3)
**Avoids:** PopSmiths architecture mismatch (Pitfall 5)

### Phase Ordering Rationale

- **Foundation first (Phases 1-2):** Brand config and pipeline parameterization are pure infrastructure with no external dependencies. They de-risk the highest-risk refactoring (touching proven ffmpeg scripts) before adding complexity.
- **Legal requirement before production (Phase 3):** Consent must be in place before any multi-brand video production. Building it before order selection ensures selection respects consent state from day one.
- **Human checkpoint before automation (Phase 4 before 6):** Batch approval establishes the human-in-the-loop pattern that the autonomous agent preserves. Never automate what has not been manually validated.
- **Prove with 4 brands, then add the outlier (Phases 5 before 7):** Four brands share infrastructure. Get them working together. PopSmiths is architecturally different and should not block or complicate the shared-OMS brands.
- **Agent orchestration last (Phase 6):** The agent is only as reliable as the components it orchestrates. Every stage must have validation and error handling before the agent ties them together.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Consent System):** Needs research on email deliverability (SPF/DKIM/DMARC setup per brand domain), CAN-SPAM compliance requirements, and consent expiration legal standards. Sparse documentation for this specific use case (UGC consent for product art).
- **Phase 4 (Order Selection):** Needs research on illustration quality heuristics -- what makes a "good" illustration for video? Resolution and file size are proxies but not sufficient. May need Gemini vision scoring exploration.
- **Phase 7 (PopSmiths):** Needs research on PopSmiths Heroku API for art retrieval, headless Shopify order schema differences, and AI art credit attribution requirements.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Brand Config):** Well-documented pattern. Zod schema validation is straightforward.
- **Phase 2 (Pipeline Parameterization):** Existing scripts are the reference implementation. Refactoring is mechanical.
- **Phase 5 (Multi-Brand Production):** Connecting proven components. Standard integration work.
- **Phase 6 (Agent Orchestration):** croner scheduling and checkpoint patterns are well-documented. The novelty is in Gwen-specific integration, but the architecture patterns are standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified on npm Feb 2026. Established libraries with clear maintenance. Only uncertainty: OpenClaw agent framework stability. |
| Features | MEDIUM | Feature set well-defined by PROJECT.md requirements. Table stakes are clear. Order scoring algorithm complexity is uncertain -- may need iteration. |
| Architecture | HIGH | Grounded in existing working codebase. Layered architecture follows proven patterns. Component boundaries are clean. |
| Pitfalls | HIGH | Domain-specific analysis backed by codebase review and external sources. Consent and brand leakage pitfalls are well-characterized. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Consent email deliverability:** No research on per-brand domain DNS setup (SPF/DKIM/DMARC). Resend handles delivery, but sender domains must be configured. Address during Phase 3 planning.
- **Order scoring algorithm:** "Illustration quality" is subjective. Research identified resolution + file size as starting heuristics but acknowledged these are proxies. Need to define scoring criteria empirically during Phase 4 implementation.
- **OpenClaw/Gwen stability:** Agent framework is in transition (founder left for OpenAI). Monitor for breaking changes. Have a fallback plan (direct cron + shell scripts) if Gwen integration becomes unstable.
- **Consent legal standards:** Research identified CAN-SPAM unsubscribe requirement but did not deeply analyze UGC consent duration, revocation obligations, or state-specific requirements. Consult legal guidance during Phase 3.
- **TurnedComics-specific constraints:** Hand-drawn art and printed add-ons create unique video composition needs. Not deeply researched. Address during Phase 5 when extending to TC.
- **Gemini API cost at scale:** 5x brand scaling means 5x API costs. No cost modeling done. Track per-brand costs from Phase 5 onward.

## Sources

### Primary (HIGH confidence)
- npm registry: Verified versions for Resend 6.9.2, better-sqlite3 12.6.2, Zod 4.3.6, croner 10.0.1, React Email 1.0.8
- Existing codebase: build-ugc-v11.sh, generate-mockups.js, produce-video.sh, PROJECT.md
- Existing brand configs: 3 of 5 brands already configured in ~/clawd/agents/gwen/workspace/brand-configs/
- Printful API documentation
- Google Drive API documentation

### Secondary (MEDIUM confidence)
- UGC rights management guides (Influee, Flowbox, Enzuzo) -- consent best practices
- Multi-brand content management analysis (dotCMS) -- brand leakage patterns
- Agentic AI failure analysis (HBR, Beam.ai, Google Cloud) -- agent orchestration pitfalls
- Node.js scheduler comparisons (Better Stack) -- croner vs alternatives
- Resend vs SendGrid pricing comparison (NextBuild)

### Tertiary (LOW confidence)
- OpenClaw Wikipedia -- agent framework governance (rapidly changing)
- Autonomous AI agent scheduling patterns (Unwind AI, Arxiv) -- general patterns, not project-specific

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
