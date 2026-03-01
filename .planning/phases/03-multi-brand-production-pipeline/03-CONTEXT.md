# Phase 3: Multi-Brand Production Pipeline - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

All five brands produce publishable UGC and standard reel videos end-to-end — from order assets (OMS photos/illustrations, reaction videos) to Google Drive upload with social copy docs. PopSmiths uses AI-generated lifestyle imagery instead of customer photos. Order candidate selection is semi-automated: system ranks, Luis adjusts and approves. No order enters production without approved consent (Phase 2 gate).

</domain>

<decisions>
## Implementation Decisions

### Order candidate ranking
- System auto-ranks candidates by signals: illustration quality proxy (inferred from product category, order completeness, OMS flags), reaction video availability, number of people in illustration, body framing (full-body outranks shoulder-up)
- Luis reviews the ranked list in the approval CLI and can reorder or skip candidates before approving the batch
- Reaction video availability is a strong positive signal but not a hard requirement — orders without reaction video still qualify (produce standard reel only if no reaction footage)

### Video output modes
- Always produce BOTH UGC reel and standard reel for each approved order
- Exception: if no reaction video available, skip the UGC reel and produce standard reel only
- This applies to all 5 brands including PopSmiths

### PopSmiths asset retrieval and video style
- PopSmiths has no real customer orders yet — use AI-generated lifestyle imagery as the visual source
- AI generates styled room/interior scenes featuring the PopSmiths art (framed, on walls, in decorated home contexts)
- Video aesthetic: home decoration / art inspiration — the art is the star, not the person. Minimal or no person in frame.
- Art retrieved from PopSmiths' own Heroku server (not shared OMS) — adapter pattern, same pipeline downstream
- TurnedComics note (from STATE.md): hand-drawn art creates unique composition needs — address per-brand config during implementation

### Drive folder structure
- Output lands in `/{Brand}/videos/{YYYY-MM-DD}/` per brand
- File naming: `{order_id}_{type}.mp4` where type is `ugc` or `reel`
- Social copy doc alongside: `{order_id}_social.md` in same folder

### Social copy doc (one doc per video)
- Single Markdown doc per order covering all four platforms: YouTube, TikTok, Instagram, X
- Each platform section includes: caption, hashtags (platform-appropriate sets), CTA line, audio suggestion (TikTok/Reels), posting notes (best time, platform tips)
- X (Twitter) gets its own section — short-form copy, different hashtag density than Instagram
- Doc is human-readable and copy-paste ready — Gwen or Luis can grab the right section per platform

### API resilience
- Gemini staging: retry up to 3x with exponential backoff on FinishReason.OTHER
- Printful API: respect rate limits during batch processing (existing pattern from Phase 1)
- Failures are logged and flagged but do not halt the entire batch — skip the failed order, continue others

### Claude's Discretion
- Exact ranking algorithm weights (illustration quality proxy formula)
- AI image generation service for PopSmiths lifestyle scenes (Midjourney, DALL-E, Gemini — whichever produces best home-decor aesthetic)
- Exact hashtag sets per platform per brand (can be seeded and refined over time)
- Social copy tone per brand (should match brand voice from brand configs)

</decisions>

<specifics>
## Specific Ideas

- PopSmiths video concept: "art inspiration / home decoration" — styled room with framed PopSmiths art prominently displayed, decoration-focused b-roll, feels like an interior design post rather than a product ad
- The ranking CLI already exists from Phase 2 (`approve-consent-candidates.js`) — Phase 3 extends it with production-readiness signals, not a new tool
- TurnedComics has hand-drawn fan art — may need unique composition handling (noted as a carried concern from Phase 1)

</specifics>

<deferred>
## Deferred Ideas

- **Review and distribution platform** — a tool for reviewing, scheduling, and publishing social posts across platforms. Significant capability, own phase or milestone. Noted for roadmap backlog.
- **PopSmiths with real customer orders** — once orders exist, swap AI-generated lifestyle footage for real customer photos using the same OMS adapter pattern. No code change needed, just data.

</deferred>

---

*Phase: 03-multi-brand-production-pipeline*
*Context gathered: 2026-03-01*
