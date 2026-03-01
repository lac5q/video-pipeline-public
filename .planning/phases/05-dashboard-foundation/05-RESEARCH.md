# Phase 5: Dashboard Foundation - Research

**Researched:** 2026-03-01
**Domain:** Vanilla JS SPA, Express.js server-side HTML, Kanban board UI, slide-over panels
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Board layout:**
- 5-lane horizontal Kanban: Candidates → Consent Pending → Consent Approved → Video Built → Uploaded to Drive
- Lanes scroll vertically within fixed-height columns; the board itself does not paginate
- Each lane shows an order count badge in the column header
- Empty lanes show a subtle empty state ("No orders here yet") — never collapse or hide

**Card design:**
- Cards show: order ID, brand logo/name, customer first name, consent status badge (color-coded), date, and ranking score
- Cards in the "Candidates" lane also show the illustration thumbnail (small, 60px) so Luis can spot quality issues at a glance on the board itself
- Cards in "Video Built" and "Uploaded" lanes show a play icon indicator
- Card click opens the detail panel — no inline actions on the card in this phase

**Filter UX:**
- Brand filter: one-click pill presets above the board (All Brands + one per brand, 6 total)
- Status filter: secondary pill row below brand filters (All Statuses + one per stage)
- Filters are additive: brand + status both apply simultaneously
- Default view: All Brands, All Statuses
- Active filter pill is visually highlighted; clicking it again resets to "All"

**Detail panel:**
- Slide-over from the right (does not navigate away from board)
- Panel sections: Order Info (ID, brand, date, customer name, order total), Consent Status (current state + timestamps), Ranking Signals (reaction video available, people count, body framing, illustration quality proxy), Drive Links (folder URL + upload status per video file)
- Panel has a close button (X) and closes on outside click
- No action buttons in Phase 5 — read-only detail view only

**Navigation and page structure:**
- Dashboard Foundation replaces/enhances the existing dashboard.js HTML
- Single-page app: board is the primary view; detail panel slides in/out
- No separate routes for the board — all on the existing `/` or `/dashboard` path
- Top nav bar: title, current brand filter indicator, last pipeline run time

### Claude's Discretion
- Exact color palette per lane (should be distinct but not garish — muted/pastel works well for status lanes)
- CSS framework choice (Tailwind CDN, vanilla CSS, or minimal utility classes — pick what's already in dashboard.js or lightest to add)
- Exact card shadow/border treatment
- How ranking signals are displayed in the detail panel (simple label+value table is fine)
- Polling interval for live data refresh (30s is reasonable for board data)

### Deferred Ideas (OUT OF SCOPE)
- **Drag-and-drop to move orders between lanes** — would change pipeline state, high risk, different phase
- **Board sort controls** (by score, by date, by brand) — nice-to-have, separate phase or addition
- **Bulk selection checkboxes on cards** — needed for Phase 6 batch approve, but action buttons aren't in this phase

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | User can view all orders organized by pipeline stage in a 5-lane stage-gate board | Lane classification by `production_status` + `consent_status` fields; existing `/api/orders` supports all needed filters |
| DASH-02 | User can filter the board by brand using a one-click preset | Existing `/api/orders?brand=X` works; brands loaded from `brands/*.json` files via `loadBrands()` helper |
| DASH-03 | User can filter the board by consent status using a one-click preset | Existing `/api/orders?consent_status=X` works; consent values: `pre_approved`, `pending`, `approved`, `rejected` |
| DASH-04 | User can see order count badges per lane so pipeline bottlenecks are immediately visible | Client-side count from fetched orders, or add `/api/board-summary` endpoint returning lane counts; client-side preferred to avoid extra API |
| DASH-05 | User can open a slide-over detail panel for any order to see full metadata without leaving the board view | Existing `/api/orders/:orderId/:brand` returns full detail including consent_log, production_runs, exports; panel needs CSS transform slide animation |
| APPR-05 | User can see per-order ranking signals (reaction video available, people count, body framing, illustration quality) | `scoreOrder()` returns `breakdown` with `reaction`, `clearProduct`, `layout`, `illustrationQuality`, `peopleCount`, `bodyFraming`; already included in `/api/orders` response as `score_breakdown` |
| DRIV-01 | User can see the Google Drive folder link for each uploaded order and open it directly from the dashboard | `drive_url` field in orders table; show in detail panel as direct link; open in new tab |
| DRIV-02 | User can see upload verification status (uploaded / pending / failed) per order | `production_status` field: `pending`, `approved`, `built`, `uploaded`, `failed`; map to UI badges in detail panel |

</phase_requirements>

## Summary

Phase 5 is a pure frontend enhancement to `scripts/dashboard.js`. The existing server already has all the API routes needed (GET /api/orders with brand/consent_status filters, GET /api/orders/:orderId/:brand for detail). The entire frontend lives as a template literal `const HTML = \`...\`` inside dashboard.js — no build step, no bundler, no separate HTML files.

The implementation strategy is: **replace the `HTML` template literal** in dashboard.js with a new Kanban board UI while keeping all existing API routes and server logic unchanged. The new UI is vanilla JS + inline CSS using the existing dark theme CSS variables already established.

For the slide-over panel, CSS `transform: translateX(100%)` → `translateX(0)` with `transition: transform 0.25s ease` is the standard no-dependency approach. For polling, `setInterval(fetchBoard, 30000)` with an AbortController pattern handles the refresh.

**Primary recommendation:** Keep the existing vanilla JS + inline CSS approach. No new npm packages needed. The existing API already supports all required filters. The implementation is a ~400-600 line HTML+CSS+JS replacement of the template literal section.

## Standard Stack

### Core (no changes needed)
| Component | Current | Purpose | Why Keep |
|-----------|---------|---------|----------|
| Express 5.x | ✓ installed | HTTP server, API routes | All APIs already exist |
| better-sqlite3 | ✓ installed | Database access | Schema already has all needed fields |
| Vanilla JS (ES2020+) | ✓ in use | Frontend logic | No build step = fast iteration |
| Inline CSS w/ CSS variables | ✓ in use | Styling | Existing dark theme, just extend |

### Supporting (Claude's discretion areas)
| Component | Option A | Option B | Recommendation |
|-----------|----------|----------|----------------|
| CSS framework | Tailwind CDN | Vanilla CSS (extend existing) | **Vanilla CSS** — existing file already has 600+ lines of well-structured CSS, adding Tailwind CDN would conflict with existing variable system |
| Icons | Unicode symbols | SVG inline | **Unicode + simple SVG inline** — ▶ for play, ✕ for close; no icon library needed |
| Polling | setInterval | EventSource/SSE | **setInterval(30s)** — simplest, existing API is REST not streaming |

### No New Dependencies
The dashboard.js already imports: `path`, `fs`, `express` — all that's needed. No `npm install` required.

## Architecture Patterns

### Project Structure (no changes)
```
scripts/
└── dashboard.js          # Replace HTML template literal; keep all server code
lib/
├── db.js                 # No changes needed
└── scorer.js             # No changes needed
```

### Pattern 1: Inline SPA Template Replacement
**What:** The entire frontend is `const HTML = \`...\`` (around line 302). Replace this with the new Kanban board HTML/CSS/JS. Everything else in dashboard.js stays identical.
**When to use:** Always in this project (no build tooling exists)

**Approach:**
```javascript
// Keep: all server code above line 302 (unchanged)
// Replace: const HTML = `...` with the new Kanban board template
// Keep: all app.get/app.post routes below (unchanged)
```

### Pattern 2: Lane Classification Logic
**What:** Map `(consent_status, production_status)` to one of 5 lanes

```javascript
function classifyOrderToLane(order) {
  const cs = order.consent_status;
  const ps = order.production_status;

  if (ps === 'uploaded') return 'uploaded';
  if (ps === 'built') return 'video_built';
  if (cs === 'approved') return 'consent_approved';
  if (cs === 'pending') return 'consent_pending';
  return 'candidates'; // pre_approved, rejected, or any other
}
```

**Lane definitions:**
| Lane ID | Display Name | Criteria |
|---------|-------------|----------|
| `candidates` | Candidates | consent_status = pre_approved (or default) |
| `consent_pending` | Consent Pending | consent_status = pending |
| `consent_approved` | Consent Approved | consent_status = approved AND production_status != built/uploaded |
| `video_built` | Video Built | production_status = built |
| `uploaded` | Uploaded to Drive | production_status = uploaded |

### Pattern 3: Slide-Over Panel (CSS only, no library)
**What:** Right-side panel that slides in without page navigation

```css
.slide-over {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 200;
  overflow-y: auto;
}
.slide-over.open {
  transform: translateX(0);
}
.slide-over-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 199;
  display: none;
}
.slide-over-backdrop.open {
  display: block;
}
```

```javascript
function openPanel(orderId, brand) {
  fetch(`/api/orders/${orderId}/${brand}`)
    .then(r => r.json())
    .then(data => {
      renderPanelContent(data);
      document.querySelector('.slide-over').classList.add('open');
      document.querySelector('.slide-over-backdrop').classList.add('open');
    });
}
function closePanel() {
  document.querySelector('.slide-over').classList.remove('open');
  document.querySelector('.slide-over-backdrop').classList.remove('open');
}
// Close on backdrop click
document.querySelector('.slide-over-backdrop').addEventListener('click', closePanel);
```

### Pattern 4: Client-Side Filter State
**What:** Track active brand/status filters, re-fetch on change

```javascript
const state = {
  brandFilter: null,    // null = All Brands
  statusFilter: null,   // null = All Statuses
  orders: [],
  lastUpdated: null,
};

function fetchBoard() {
  const params = new URLSearchParams({ limit: 500 });
  if (state.brandFilter) params.set('brand', state.brandFilter);
  // Note: status filter is client-side from the full dataset
  // Fetch all orders for active brand, then client-classify into lanes
  fetch(`/api/orders?${params}`)
    .then(r => r.json())
    .then(data => {
      state.orders = data.orders;
      state.lastUpdated = new Date();
      renderBoard();
    });
}
```

**Why client-side lane classification?** The API's `status` filter maps to `production_status`, but lane assignment uses both `consent_status` and `production_status`. Client-side classification avoids multiple API calls and enables instant filter switching.

### Pattern 5: Filter Pills
**What:** One-click pill buttons for brand and consent status presets

```javascript
function renderFilterPills() {
  const brands = ['All Brands', 'TurnedYellow', 'MakeMeJedi', 'TurnedWizard', 'TurnedComics', 'PopSmiths'];
  // Render as <button> elements with active state
  // Clicking active pill resets to null (All)
  // Clicking different pill sets filter and re-renders
}
```

### Anti-Patterns to Avoid
- **Don't fetch orders per-lane:** One fetch for all orders, then classify client-side
- **Don't use a JS framework CDN (React/Vue):** Existing code is vanilla JS, framework adds complexity with no benefit at this scale
- **Don't paginate within lanes:** Context says lanes scroll vertically — fetch up to 500 orders total, display all
- **Don't use `innerHTML` for XSS-sensitive content:** Use `textContent` for user-supplied strings (order IDs, customer names)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slide-over animation | Custom JS animation | CSS `transform` + `transition` | Browser-native, 60fps, no jank |
| Date formatting | Custom date parser | `new Date(str).toLocaleDateString()` | Enough for this use case |
| Debouncing filter | Custom timer | `clearTimeout` / `setTimeout` pattern | Simple, no library needed |
| Loading states | Custom spinner | CSS `@keyframes` spin + opacity | 3 lines of CSS |

**Key insight:** At this scale (single user, local tool), vanilla JS with CSS variables is faster to write, easier to debug, and has zero dependency risk.

## Common Pitfalls

### Pitfall 1: Lane Classification Edge Cases
**What goes wrong:** Orders with `rejected` consent status or unusual `production_status` values don't render anywhere.
**Why it happens:** Lane logic assumes specific status values, but DB may have historical variants.
**How to avoid:** Always have a fallback lane (Candidates is the catch-all). Log unclassified orders to console for debugging.
**Warning signs:** Order count in API doesn't match sum of lane counts.

### Pitfall 2: Fetching All Orders Without Limit
**What goes wrong:** `/api/orders` defaults to `limit=25`. Board only shows 25 orders.
**Why it happens:** The existing API has pagination built in.
**How to avoid:** Always set `limit=500` (or a high value) in the board fetch. Add a note in code that this assumes < 500 active orders.
**Warning signs:** Board looks empty or truncated; total in API response > items shown.

### Pitfall 3: Illustration Thumbnail 404s
**What goes wrong:** Candidates lane shows broken image icons for illustration thumbnails.
**Why it happens:** `illustration_id` or `photos_url` may not point to a locally-served image.
**How to avoid:** Check what `photos_url` contains (it may be an external URL). For the 60px thumbnail, use `photos_url` directly if it's an absolute URL. Add `onerror="this.style.display='none'"` as fallback.
**Warning signs:** Broken image icons in Candidates lane.

### Pitfall 4: Drive URL Missing for Non-Uploaded Orders
**What goes wrong:** Detail panel shows broken link for orders not yet uploaded.
**Why it happens:** `drive_url` is null until upload completes.
**How to avoid:** Conditionally render Drive link only when `drive_url` is not null. Show upload status badge regardless.
**Warning signs:** Empty/broken href in detail panel.

### Pitfall 5: CSS Specificity Conflicts
**What goes wrong:** New Kanban CSS conflicts with existing dashboard styles.
**Why it happens:** The existing `HTML` template already has 600+ lines of CSS using generic selectors.
**How to avoid:** Scope new Kanban styles under `.kanban-board` prefix. Reuse existing CSS variables (--bg, --bg-card, --border, --text, etc.).
**Warning signs:** Nav or existing elements change appearance after HTML replacement.

## Code Examples

### Lane Color Palette (Claude's Discretion — muted/pastel for dark theme)
```css
.lane[data-lane="candidates"]        { --lane-accent: #6366f1; }  /* indigo */
.lane[data-lane="consent_pending"]   { --lane-accent: #f59e0b; }  /* amber */
.lane[data-lane="consent_approved"]  { --lane-accent: #10b981; }  /* emerald */
.lane[data-lane="video_built"]       { --lane-accent: #3b82f6; }  /* blue */
.lane[data-lane="uploaded"]          { --lane-accent: #8b5cf6; }  /* violet */
```

### Polling with Visibility API (prevent wasteful fetches when tab hidden)
```javascript
let pollTimer = null;
function startPolling() {
  pollTimer = setInterval(() => {
    if (!document.hidden) fetchBoard();
  }, 30000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchBoard(); // fetch immediately when tab regains focus
});
```

### Ranking Signals Display in Detail Panel
```javascript
function renderRankingSignals(order) {
  const b = order.score_breakdown || {};
  const signals = [
    { label: 'Reaction Video', value: order.has_reaction_video ? 'Yes' : 'No', score: b.reaction },
    { label: 'Illustration Quality', value: b.illustrationQuality > 0 ? 'Good' : 'Low', score: b.illustrationQuality },
    { label: 'People Count', value: '—', score: b.peopleCount },
    { label: 'Body Framing', value: '—', score: b.bodyFraming },
    { label: 'Clear Product', value: order.clear_product ? 'Yes' : 'No', score: b.clearProduct },
  ];
  return signals.map(s => `
    <tr>
      <td>${s.label}</td>
      <td>${s.value}</td>
      <td>${s.score ?? 0}pts</td>
    </tr>
  `).join('');
}
```

### Drive Status Badge Logic
```javascript
function driveStatusBadge(order) {
  if (order.production_status === 'uploaded' && order.drive_url) {
    return '<span class="badge badge-success">Uploaded</span>';
  }
  if (order.production_status === 'failed') {
    return '<span class="badge badge-danger">Failed</span>';
  }
  return '<span class="badge badge-pending">Pending</span>';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jQuery DOM manipulation | Vanilla JS DOM APIs | ~2018+ | Full native support, no library |
| CSS animations via JS | CSS `transition` + `transform` | ~2015+ | GPU-accelerated, 60fps |
| Multiple API calls per view | Single fetch + client classify | Always best | Fewer round trips |

## Open Questions

1. **What does `photos_url` contain?**
   - What we know: It's a column in the orders table, populated during import
   - What's unclear: Is it a local file path, an external URL, or a Google Drive URL?
   - Recommendation: Read a few rows from the DB during implementation. If external URL, use directly as `<img src>`. If local path, add an Express route to serve it (`/api/orders/:orderId/:brand/photo`).

2. **What does "customer first name" map to in the DB schema?**
   - What we know: The `description` field exists; no explicit `customer_name` column seen in schema
   - What's unclear: Is customer name embedded in `description` or `tags` JSON, or is it in a separate OMS field?
   - Recommendation: Query a real order row during implementation. If not directly available, display `order_id` as the identifier on cards.

3. **Are there existing illustration thumbnail files served locally?**
   - What we know: `mockupsDir` is checked in the API at `orders/{brand}/{orderId}/mockups/`
   - What's unclear: Whether these files exist for current orders
   - Recommendation: Use `photos_url` as the card thumbnail; fall back to a placeholder SVG if not available.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `scripts/dashboard.js` (1198 lines) — complete understanding of existing API, HTML structure, CSS variables
- Direct codebase analysis: `lib/db.js` — verified schema columns
- Direct codebase analysis: `lib/scorer.js` — verified `score_breakdown` fields and their meaning
- MDN Web Docs (training) — CSS `transform`, `transition`, `setInterval`, `fetch` API — standard browser APIs with HIGH confidence

### Secondary (MEDIUM confidence)
- Express 5.x behavior (training) — template literal HTML serving pattern confirmed by codebase
- CSS Kanban layout patterns (training) — flexbox horizontal layout with vertical scroll per column is standard

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — confirmed by reading actual package.json and dashboard.js
- Architecture: HIGH — existing pattern is clear; we're extending not replacing
- Pitfalls: MEDIUM — identified from codebase analysis, some edge cases (photos_url) need runtime verification

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable stack, no fast-moving dependencies)
