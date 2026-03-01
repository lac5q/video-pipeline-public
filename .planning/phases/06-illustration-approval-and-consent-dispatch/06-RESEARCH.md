# Phase 6: Illustration Approval and Consent Dispatch - Research

**Researched:** 2026-03-01
**Domain:** Vanilla JS SPA, Express.js API extensions, lightbox overlay, toast notifications, approval/reject write actions
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Approval interaction:**
- Approve/Reject buttons appear on the card directly (always visible, not just on hover)
- Approve = green checkmark button, Reject = red X button; both small, placed at the bottom of the card
- No confirmation dialog for individual approve/reject — action is fast and reversible (can re-approve rejected candidates)
- After approval: card moves to "Consent Pending" lane immediately (optimistic UI update); after rejection: card disappears from Candidates lane
- Batch approve button sits above the Candidates column, only visible when Candidates lane is active/visible
- Batch approve requires a single confirmation dialog: "Approve [N] candidates? This will queue them for consent emails." with Cancel / Approve All

**Illustration zoom:**
- Click on the illustration thumbnail (on the card) opens a lightbox overlay
- Lightbox shows the full illustration image centered on screen with dark background overlay
- Lightbox has: close button (X top-right), click outside to close, keyboard Escape to close
- No carousel or next/prev in the lightbox — one image at a time
- Lightbox does NOT trigger approval — it's purely for visual inspection

**Consent dispatch flow:**
- Candidates that have been approved (production_status = 'approved', consent_status = 'pending') appear in "Consent Pending" lane
- "Send Consent Emails" button appears at the top of the Consent Pending lane when there are unsent candidates
- Clicking it shows a confirmation: "Send consent emails to [N] customers? This cannot be undone." with Cancel / Send
- On send: calls the existing consent send logic (same as send-consent-batch.js), shows a loading state on the button, then displays a success/error toast notification
- After send: consent_status updates to 'pending_sent', cards remain in Consent Pending lane (they move to Consent Approved only after customer clicks)
- No per-order selection needed — "Send Consent Emails" sends ALL unsent approved candidates in one batch

**Post-action feedback:**
- All actions (approve, reject, batch approve, send consent) show a brief toast notification (2-3 seconds) in the bottom-right corner
- Approve: "Approved — moving to Consent Pending"
- Reject: "Rejected and removed from candidates"
- Batch approve: "N orders approved"
- Send consent: "Consent emails sent to N customers" or "Error: [reason]"
- Board refreshes automatically after each action (no manual reload)

### Claude's Discretion
- Toast notification styling (position, animation, colors)
- Exact button sizing on cards (should be compact — cards are small)
- Whether reject requires a reason/note (default: no reason needed, keep it fast)
- API endpoint design for approve/reject/batch-approve actions
- How to handle partial batch-approve failures (some succeed, some fail)

### Deferred Ideas (OUT OF SCOPE)
- **Per-order consent email preview before sending** — defer to future phase
- **Rejection reason / notes on rejected candidates** — deferred
- **Undo/undo history for approval actions** — deferred

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| APPR-01 | User can see a thumbnail grid of candidate orders showing the customer illustration image before approving | Already implemented in Phase 5 — 60px thumbnail in Candidates lane using `photos_url`. Phase 6 adds approve/reject buttons to those existing cards. |
| APPR-02 | User can zoom in on an illustration thumbnail to inspect quality before making an approval decision | New: lightbox overlay triggered by clicking thumbnail. CSS fixed-position overlay with full-size `<img>`. Keyboard Escape + click-outside to close. No dependencies needed. |
| APPR-03 | User can approve or reject a candidate order individually from the thumbnail view with a single click | New: POST to `/api/orders/:orderId/:brand/approve` and `/api/orders/:orderId/:brand/reject`. These set `production_status = 'approved'` and `production_status = 'rejected'` respectively. Server-side route already exists at `/api/orders/:orderId/:brand/status` (generic). Phase 6 needs semantically named routes or reuse existing POST with body. |
| APPR-04 | User can batch-approve all visible candidates in one action (with confirmation prompt) | New: POST `/api/batch/approve` that sets production_status = 'approved' for all orders in the candidates lane. `POST /api/batch/status` already exists in dashboard.js and accepts `{orders: [...], production_status}`. Can reuse directly. |
| UCONS-01 | User can see all consent candidates (approved by Luis, not yet emailed) in a list with illustration preview | Requires identifying "approved but not yet emailed" orders. Current consent_status flow: `pre_approved` → `pending` (when consent email sent) → `approved` (when customer clicks). The "not yet emailed" state is production_status = 'approved' AND consent_status = 'pre_approved'. Need to verify this mapping. |
| UCONS-02 | User can send the consent email batch to selected candidates from the dashboard (replaces CLI send-consent-batch.js) | New: POST `/api/consent/send-batch` that calls `email.sendConsentRequest()` for each eligible order. The existing `lib/email.js` `sendConsentRequest(orderId, brand, customerEmail, customerName, orderDescription)` handles the sending and token generation. Need new API route that orchestrates this. |

</phase_requirements>

## Summary

Phase 6 adds write-action layers on top of the Phase 5 read-only Kanban board. The existing dashboard is a 1035-line `scripts/dashboard.js` with a `const HTML = \`...\`` template literal containing the SPA frontend. All Phase 5 API routes needed for Phase 6 already exist:

- `POST /api/orders/:orderId/:brand/status` — generic status update (reuse for approve/reject)
- `POST /api/batch/status` — batch status update (reuse for batch approve)

Phase 6 needs one **new** API route: `POST /api/consent/send-batch` to invoke the email sending logic. Everything else reuses existing infrastructure.

The frontend changes are additive: card action buttons, lightbox overlay, toast system, lane-header CTA buttons. No new npm packages required.

**Primary recommendation:** Reuse existing API routes for approve/reject/batch-approve. Add one new route for consent batch send. Add frontend-only features (lightbox, toast, action buttons) by extending the `const HTML` template. No build step, no new dependencies.

## Standard Stack

### Core (unchanged from Phase 5)
| Component | Current | Purpose |
|-----------|---------|---------|
| Express 5.x | installed | HTTP server + API routes |
| better-sqlite3 | installed | DB reads/writes |
| lib/email.js | exists | `sendConsentRequest()` for consent emails |
| lib/consent.js | exists | `listPendingConsent()`, token generation |
| Vanilla JS (ES2020+) | in use | Frontend logic, no framework |
| Inline CSS w/ CSS variables | in use | Existing dark theme |

### Supporting (Claude's Discretion)
| Component | Option | Recommendation |
|-----------|--------|----------------|
| Toast notifications | Custom CSS div | **Custom** — 10 lines of CSS + JS, no library needed |
| Lightbox | Custom CSS overlay | **Custom** — CSS fixed overlay + img tag, no library |
| Confirmation dialogs | browser `confirm()` | **Custom HTML dialog** — browser `confirm()` breaks SPA feel; use a simple `<div class="modal">` approach |
| Action button icons | Unicode symbols | **Unicode** — ✓ and ✗ work, or use text "Approve"/"Reject" |

### No New Dependencies
Zero new npm packages required. The email sending already uses nodemailer (installed), consent logic is in `lib/consent.js`.

## Architecture Patterns

### Project Structure (minimal additions)
```
scripts/
└── dashboard.js     # Add: new API routes, extend const HTML
lib/
├── email.js        # No changes — sendConsentRequest() already correct
└── consent.js      # No changes — listPendingConsent() already correct
```

### Pattern 1: Reuse Existing Status Update Routes

The existing `POST /api/orders/:orderId/:brand/status` route already handles:
```javascript
// Approve individual order: set production_status = 'approved'
fetch('/api/orders/' + orderId + '/' + brand + '/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ production_status: 'approved' })
})
```

```javascript
// Reject individual order: set production_status = 'rejected'
fetch('/api/orders/' + orderId + '/' + brand + '/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ production_status: 'rejected' })
})
```

The existing allowed `production_status` values include `'approved'` and `'rejected'`.

### Pattern 2: Reuse Existing Batch Status Route

The existing `POST /api/batch/status` route already accepts:
```javascript
fetch('/api/batch/status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orders: [{ order_id: '123', brand: 'TurnedYellow' }, ...],
    production_status: 'approved'
  })
})
```

This is exactly what batch-approve needs. **No new API route required for batch approve.**

### Pattern 3: New Consent Batch Send Route

This is the only new server-side addition needed:

```javascript
// POST /api/consent/send-batch
// Body: { brand?: string }  — optional brand filter
// Sends consent emails to all orders with:
//   production_status = 'approved'
//   consent_status = 'pre_approved'  (not yet emailed)
//   customer_email IS NOT NULL
app.post('/api/consent/send-batch', async (req, res) => {
  const db = getDb();
  try {
    const { brand } = req.body || {};
    const email = require('../lib/email');

    const conditions = ["production_status = 'approved'", "consent_status = 'pre_approved'", "customer_email IS NOT NULL AND customer_email != ''"];
    const params = {};
    if (brand) {
      conditions.push('brand = @brand');
      params.brand = brand;
    }
    const orders = db.prepare(`SELECT * FROM orders WHERE ${conditions.join(' AND ')}`).all(params);

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const order of orders) {
      try {
        await email.sendConsentRequest(
          order.order_id,
          order.brand,
          order.customer_email,
          order.customer_name || 'Valued Customer',
          order.order_description || `Order ${order.order_id}`
        );
        // Update consent_status to 'pending' after successful send
        db.prepare("UPDATE orders SET consent_status = 'pending', updated_at = datetime('now') WHERE order_id = ? AND brand = ?")
          .run(order.order_id, order.brand);
        sent++;
      } catch (err) {
        failed++;
        errors.push(`${order.order_id} (${order.brand}): ${err.message}`);
      }
    }

    res.json({ success: true, sent, failed, errors, total: orders.length });
  } finally {
    db.close();
  }
});
```

**Note on consent_status transition:** After sending, update `consent_status` from `'pre_approved'` to `'pending'` (matches the existing `listPendingConsent()` convention in `lib/consent.js`). The context says "pending_sent" but the existing consent flow uses `'pending'` as the post-send state. Use `'pending'` to match existing lib behavior.

### Pattern 4: Approve/Reject Action Buttons on Cards

Cards are currently 280px wide with 0.75rem padding. The card structure is:
```
card-top: [thumbnail 60px] | [card-meta: order-id, brand, customer, badge]
card-footer: [date] [score] [play-icon?]
```

Add a `card-actions` row below `card-footer`:
```javascript
// In renderCard(), add after card-footer:
var actionsHtml = '';
if (laneId === 'candidates') {
  actionsHtml = '<div class="card-actions">' +
    '<button class="btn-approve" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '" title="Approve for consent email">✓ Approve</button>' +
    '<button class="btn-reject" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '" title="Reject candidate">✗ Reject</button>' +
    '</div>';
}
```

```css
.card-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border);
}
.btn-approve, .btn-reject {
  flex: 1;
  padding: 0.25rem 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-approve { background: rgba(16,185,129,0.2); color: #10b981; }
.btn-approve:hover { background: rgba(16,185,129,0.35); }
.btn-reject  { background: rgba(239,68,68,0.2);  color: #ef4444; }
.btn-reject:hover  { background: rgba(239,68,68,0.35); }
```

### Pattern 5: Event Delegation for Card Buttons

Since the board is re-rendered on every fetch, attach action listeners to the board container via event delegation (not per-card):

```javascript
document.getElementById('kanban-board').addEventListener('click', function(e) {
  var approveBtn = e.target.closest('.btn-approve');
  var rejectBtn = e.target.closest('.btn-reject');

  if (approveBtn) {
    e.stopPropagation(); // Prevent card click (panel open)
    approveOrder(approveBtn.dataset.orderId, approveBtn.dataset.brand);
    return;
  }
  if (rejectBtn) {
    e.stopPropagation();
    rejectOrder(rejectBtn.dataset.orderId, rejectBtn.dataset.brand);
    return;
  }
  // existing card click → open panel
  var card = e.target.closest('.order-card');
  if (card) {
    openPanel(card.dataset.orderId, card.dataset.brand);
  }
});
```

**Critical:** `e.stopPropagation()` prevents the approve/reject button clicks from also triggering the panel open.

### Pattern 6: Lightbox Overlay

```html
<!-- Add to HTML body, after slide-over -->
<div class="lightbox-backdrop" id="lightbox-backdrop"></div>
<div class="lightbox" id="lightbox">
  <button class="lightbox-close" id="lightbox-close" title="Close">✕</button>
  <img class="lightbox-img" id="lightbox-img" src="" alt="">
</div>
```

```css
.lightbox-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  z-index: 300;
  display: none;
}
.lightbox-backdrop.open { display: block; }
.lightbox {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 301;
  display: none;
  max-width: 90vw;
  max-height: 90vh;
}
.lightbox.open { display: block; }
.lightbox-img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 4px;
}
.lightbox-close {
  position: absolute;
  top: -2rem;
  right: 0;
  background: none;
  border: none;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
}
```

```javascript
function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
  document.getElementById('lightbox-backdrop').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-backdrop').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
}
document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLightbox();
});
```

**Lightbox trigger on thumbnail click (separate from approve/reject):**
```javascript
// In event delegation on kanban-board, check for thumbnail click first
var thumb = e.target.closest('.card-thumbnail');
if (thumb && thumb.src) {
  e.stopPropagation();
  openLightbox(thumb.src);
  return;
}
```

### Pattern 7: Toast Notifications

```html
<!-- Add to HTML body -->
<div id="toast-container"></div>
```

```css
#toast-container {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 400;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.toast {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--text);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  animation: toastSlide 0.2s ease;
  max-width: 300px;
}
.toast.toast-success { border-left: 3px solid var(--success); }
.toast.toast-error   { border-left: 3px solid var(--danger); }
@keyframes toastSlide {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

```javascript
function showToast(msg, type) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'success');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2500);
}
```

### Pattern 8: Batch Approve Button in Lane Header

The lane header currently has `lane-title` + `lane-badge` only. Add a CTA button next to the badge for the Candidates lane:

```javascript
function renderBatchApproveBtn(count) {
  if (count === 0) return '';
  return '<button class="btn-batch-approve" id="batch-approve-btn" data-count="' + count + '">' +
    'Approve All (' + count + ')' +
    '</button>';
}
```

```css
.btn-batch-approve {
  padding: 0.2rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  background: rgba(99,102,241,0.2);
  color: #a5b4fc;
  border: 1px solid rgba(99,102,241,0.4);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-batch-approve:hover { background: rgba(99,102,241,0.35); }
```

### Pattern 9: Send Consent Emails Button in Lane Header

In the `consent_pending` lane header, add a "Send Consent Emails" button when count > 0:

```javascript
// In renderBoard():
// When building the consent_pending lane header, if count > 0 add:
'<button class="btn-send-consent" data-count="' + count + '">Send Consent Emails (' + count + ')</button>'
```

The button's click handler:
```javascript
document.getElementById('kanban-board').addEventListener('click', function(e) {
  var sendBtn = e.target.closest('.btn-send-consent');
  if (sendBtn) {
    var count = sendBtn.dataset.count;
    if (confirm('Send consent emails to ' + count + ' customers? This cannot be undone.')) {
      sendConsentBatch(sendBtn);
    }
    return;
  }
  // ...existing handlers
});

function sendConsentBatch(btn) {
  btn.disabled = true;
  btn.textContent = 'Sending...';
  fetch('/api/consent/send-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showToast('Consent emails sent to ' + data.sent + ' customers', 'success');
        fetchBoard(); // Refresh board to update lane counts
      } else {
        showToast('Error sending emails: ' + (data.error || 'unknown'), 'error');
      }
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = 'Send Consent Emails';
    });
}
```

### Anti-Patterns to Avoid

- **Don't add event listeners per-card:** The board re-renders frequently (30s poll + after each action). Always use event delegation on the board container.
- **Don't use `window.confirm()` for everything:** Browser confirm() works but looks inconsistent on some platforms. Use it for the consent send (high stakes) but it's acceptable for batch approve too given time constraints. If UX matters, use a custom modal div.
- **Don't close DB before async operations complete:** The `POST /api/consent/send-batch` route calls `email.sendConsentRequest()` which is async. The `finally { db.close() }` pattern is fine because the email function uses `lib/consent.js`'s own DB handle (separate lazy-loaded instance), not the dashboard's `getDb()`.
- **Don't prevent lightbox open if thumbnail src is empty:** Check `if (thumb.src && !thumb.src.endsWith('/'))` before opening lightbox.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Consent email sending | Custom email logic | `lib/email.sendConsentRequest()` | Already handles token generation, template rendering, SMTP |
| Token management | Custom tokens | `lib/consent.generateConsentToken()` | Called internally by sendConsentRequest |
| Batch status update | New route | `POST /api/batch/status` (existing) | Already exists, tested, handles logging |
| Individual status update | New route | `POST /api/orders/:id/:brand/status` (existing) | Already exists with validation |

## Common Pitfalls

### Pitfall 1: Event Propagation — Buttons Inside Clickable Cards
**What goes wrong:** Clicking Approve fires both the button's action AND opens the slide-over panel.
**Why it happens:** The card has a click handler; the button is inside the card.
**How to avoid:** Use `e.stopPropagation()` in the button's handler. With event delegation, check for button first before falling through to card check.
**Warning signs:** Clicking Approve both triggers the API call AND opens the detail panel.

### Pitfall 2: Lightbox Z-Index Conflict with Slide-Over
**What goes wrong:** Lightbox opens behind the slide-over panel when it's open.
**Why it happens:** Slide-over uses z-index: 200. Lightbox must be higher.
**How to avoid:** Lightbox backdrop z-index: 300, lightbox content z-index: 301 (both higher than slide-over's 200).
**Warning signs:** Lightbox appears but image is partially hidden behind the panel.

### Pitfall 3: Board Re-render Clears Event Listeners
**What goes wrong:** After fetchBoard() (which re-renders innerHTML), button clicks stop working.
**Why it happens:** innerHTML replacement destroys DOM nodes and their listeners.
**How to avoid:** Use event delegation — attach a single listener to `#kanban-board` (which persists through innerHTML re-renders of its children). Add `kanban-board` listener once on init, not in renderBoard().
**Warning signs:** First click works, subsequent clicks after board refresh don't.

### Pitfall 4: Consent Send Finds No Eligible Orders
**What goes wrong:** "Send Consent Emails" button appears to work but sends 0 emails.
**Why it happens:** The consent_status / production_status combination for "approved by Luis, not yet emailed" may differ from expectation. Need to verify:
  - Luis approves via dashboard → sets `production_status = 'approved'`
  - consent_status at that point is still `'pre_approved'`
  - Send batch should target: `production_status = 'approved' AND consent_status = 'pre_approved'`
**How to avoid:** Verify the DB state of a real order after approval. The `/api/consent/send-batch` response includes `total` count — show it in the toast so Luis can see if 0 were found.

### Pitfall 5: Optimistic UI Desync
**What goes wrong:** Card moves lanes immediately on approve (optimistic), but then board refresh puts it back because the DB write failed or the API response was slow.
**Why it happens:** Optimistic update happens before the API call resolves.
**How to avoid:** Wait for API success before updating UI, OR do the optimistic update and roll back on error. Given this is a single-user tool, waiting for API response is simpler and safer:
```javascript
function approveOrder(orderId, brand) {
  fetch(/* ... */)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        showToast('Approved — moving to Consent Pending', 'success');
        fetchBoard(); // Full board refresh for consistency
      }
    });
}
```

### Pitfall 6: DB Handle Leak in Async Route
**What goes wrong:** The new `/api/consent/send-batch` route uses `try/finally { db.close() }` but `email.sendConsentRequest()` also calls `consent.getDb()` internally — and that uses a different, cached `_db` handle in `lib/consent.js`. The dashboard's `getDb()` is a fresh open per request.
**Why it happens:** Two separate DB connection patterns: dashboard uses open/close per request; lib/consent.js caches `_db`.
**How to avoid:** Dashboard's `db.close()` in finally is fine — it only closes the dashboard handle. The consent lib's handle is independent. Just ensure you use `db` for the initial query and let email.js use its own handle.

## Code Examples

### Approve Order Action
```javascript
function approveOrder(orderId, brand) {
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ production_status: 'approved' })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      if (data.success) {
        showToast('Approved — moving to Consent Pending', 'success');
        fetchBoard();
      }
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}
```

### Reject Order Action
```javascript
function rejectOrder(orderId, brand) {
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ production_status: 'rejected' })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      if (data.success) {
        showToast('Rejected and removed from candidates', 'success');
        fetchBoard();
      }
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}
```

### Batch Approve Action
```javascript
function batchApproveAll(orders) {
  // orders = array of { order_id, brand } from candidates lane
  fetch('/api/batch/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders: orders, production_status: 'approved' })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      if (data.success) {
        showToast(data.updated + ' orders approved', 'success');
        fetchBoard();
      }
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| CLI approve-orders.js (interactive terminal) | Dashboard approve/reject buttons | No more terminal needed |
| CLI send-consent-batch.js | Dashboard "Send Consent Emails" button | No more terminal needed |
| No visual inspection of illustrations | Lightbox zoom overlay | Luis can inspect quality before approving |

## Open Questions

1. **What production_status value does "approved by Luis" use?**
   - Current code in `approve-orders.js` sets `production_status = 'queued'` (not 'approved')
   - `POST /api/orders/:id/:brand/status` allows `['pending', 'approved', 'producing', 'complete', 'rejected', 'downloading', 'staging', 'building', 'uploading', 'failed']`
   - **Recommendation:** Use `production_status = 'approved'` (already in allowed list) for dashboard approval. The CONTEXT.md says "approved" is the target. The old CLI used 'queued' but we should use the dashboard-standard 'approved'.

2. **What consent_status marks "not yet emailed"?**
   - The flow from CONTEXT.md: `pre_approved` → approved (production) → consent email sent → `pending` (consent status after send)
   - The `/api/consent/send-batch` should target: `production_status = 'approved' AND consent_status = 'pre_approved'`
   - After send: update `consent_status` to `'pending'`
   - This matches `lib/consent.js` `listPendingConsent()` which queries `consent_status = 'pending'`
   - **Recommendation:** Query target is `production_status='approved' AND consent_status='pre_approved'`. Post-send: set `consent_status='pending'`.

3. **Where does the Consent Pending lane CTA button appear relative to count badge?**
   - Currently lane-header has: `[lane-title] ... [lane-badge]`
   - Adding a button will make the header row wider — may need to allow lane-header to wrap or adjust button positioning
   - **Recommendation:** Place button below the title/badge row, as a full-width element in the lane-header, or add a `lane-header-cta` row.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `scripts/dashboard.js` (1035 lines) — verified all existing routes, CSS classes, JS functions, event handlers
- Direct codebase analysis: `lib/email.js` — verified `sendConsentRequest()` signature and behavior
- Direct codebase analysis: `lib/consent.js` — verified `listPendingConsent()`, DB schema, consent_status values
- Direct codebase analysis: `scripts/approve-orders.js` — verified approval flow and status values
- Direct codebase analysis: `scripts/send-consent-batch.js` — verified batch send flow
- Phase 5 RESEARCH.md + SUMMARY files — confirmed Phase 5 delivered all prerequisites

### Secondary (MEDIUM confidence)
- CSS event delegation pattern (training) — standard browser DOM pattern, well-established
- CSS z-index stacking (training) — confirmed by reading existing z-index values in dashboard.js

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — confirmed by reading actual package.json, dashboard.js, lib/*.js
- Architecture: HIGH — existing patterns are clear; Phase 6 is additive only
- API routes: HIGH — existing routes verified by code reading, new route is straightforward
- Pitfalls: HIGH — identified by code reading, not speculation

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable stack, no fast-moving dependencies)
