# Plan 03-01 Summary: OMS Adapter, Rate Limiter, Enhanced Scorer

## Status: COMPLETE

## What was built

1. **lib/oms-adapter.js** - Unified OMS adapter with strategy pattern
   - `OmsAdapter.create(brandConfig)` factory routes to SharedOmsAdapter or PopSmithsAdapter
   - SharedOmsAdapter: fetches illustrations, photos, reaction videos from shared OMS
   - PopSmithsAdapter: fetches art from Heroku, generates AI lifestyle imagery via Gemini

2. **lib/rate-limiter.js** - Rate limiting utility
   - `withRateLimit(fn, opts)` wraps async calls with 429 detection and exponential backoff
   - Configurable maxRetries (default 3), baseDelay (default 1000ms)

3. **lib/scorer.js** - Enhanced scoring (100pt -> 130pt max)
   - New signal: `illustrationQuality` (up to 10pts) - inferred from wall-art mentions, field completeness, reaction presence
   - New signal: `peopleCount` (up to 10pts) - family=10, couple=7, single=5, unknown=3
   - New signal: `bodyFraming` (up to 10pts) - full-body=10, half-body=7, headshot=4, unknown=3

4. **brands/popsmiths.json** - Added `heroku_app` and `heroku_api_url` fields

5. **scripts/download-order-assets.sh** - Refactored to use OMS adapter instead of inline curl

6. **scripts/generate-mockups.js** - Wrapped Printful/Gooten API calls in `withRateLimit()`

## Requirements covered
- BRAND-03: PopSmiths OMS integration
- BRAND-04: Multi-brand asset retrieval
- PROD-03: Rate limiting for external APIs
- PROD-07: Enhanced scoring signals

## Commit
`75bc760` feat(03-01): add OMS adapter, rate limiter, and enhanced scorer
`d7657cc` feat(03-01): wire OMS adapter and rate limiter into scripts
