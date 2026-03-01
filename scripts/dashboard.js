'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
const { scoreOrder, rankOrders } = require(path.join(PIPELINE_ROOT, 'lib', 'scorer'));

const app = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3001;

app.use(express.json());

// Basic auth for production (set DASHBOARD_USER and DASHBOARD_PASS env vars)
if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Video Pipeline"');
      return res.status(401).send('Authentication required');
    }
    const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (user === process.env.DASHBOARD_USER && pass === process.env.DASHBOARD_PASS) {
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Video Pipeline"');
    return res.status(401).send('Invalid credentials');
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDb() {
  return getDatabase();
}

/** Load brand slugs from the brands/ directory. */
function loadBrands() {
  const brandsDir = path.join(PIPELINE_ROOT, 'brands');
  if (!fs.existsSync(brandsDir)) return [];
  return fs.readdirSync(brandsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(brandsDir, f), 'utf8'));
        return { slug: data.slug || f.replace('.json', ''), name: data.name || f.replace('.json', '') };
      } catch (_) {
        return { slug: f.replace('.json', ''), name: f.replace('.json', '') };
      }
    });
}

/**
 * Classify an order row into one of the 5 Kanban board lanes.
 * Lane priority: uploaded > video_built > consent_approved > consent_pending > candidates
 * @param {object} order - A row from the orders table
 * @returns {string} Lane ID: 'uploaded' | 'video_built' | 'consent_approved' | 'consent_pending' | 'candidates'
 */
function classifyOrderToLane(order) {
  const ps = (order.production_status || '').toLowerCase();
  const cs = (order.consent_status || '').toLowerCase();

  if (ps === 'uploaded') return 'uploaded';
  if (ps === 'built') return 'video_built';
  if (cs === 'approved') return 'consent_approved';
  if (cs === 'pending') return 'consent_pending';
  return 'candidates';
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// GET /api/board
// Returns all orders classified into 5 lanes with per-lane counts.
// Supports ?brand= and ?consent_status= filters.
// Used by the Kanban board frontend.
app.get('/api/board', (req, res) => {
  const db = getDb();
  try {
    const { brand, consent_status } = req.query;

    const conditions = [];
    const params = {};

    if (brand) {
      conditions.push('brand = @brand');
      params.brand = brand;
    }
    if (consent_status) {
      conditions.push('consent_status = @consent_status');
      params.consent_status = consent_status;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch all matching orders (no pagination — board shows everything)
    const sql = `SELECT * FROM orders ${where} ORDER BY updated_at DESC LIMIT 1000`;
    const rows = db.prepare(sql).all(params);

    // Classify each order into a lane and attach computed score
    const LANE_IDS = ['candidates', 'consent_pending', 'consent_approved', 'video_built', 'uploaded'];
    const lanes = {};
    for (const laneId of LANE_IDS) {
      lanes[laneId] = { orders: [], count: 0 };
    }

    for (const row of rows) {
      const scoring = scoreOrder(row);
      const enriched = {
        ...row,
        computed_score: scoring.total,
        score_breakdown: scoring.breakdown,
      };
      const laneId = classifyOrderToLane(row);
      lanes[laneId].orders.push(enriched);
      lanes[laneId].count++;
    }

    res.json({
      lanes,
      total: rows.length,
      filters: { brand: brand || null, consent_status: consent_status || null },
      fetched_at: new Date().toISOString(),
    });
  } finally {
    db.close();
  }
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const db = getDb();
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const byBrand = db.prepare('SELECT brand, COUNT(*) as count FROM orders GROUP BY brand').all();
    const byProductionStatus = db.prepare('SELECT production_status, COUNT(*) as count FROM orders GROUP BY production_status').all();
    const byConsentStatus = db.prepare('SELECT consent_status, COUNT(*) as count FROM orders GROUP BY consent_status').all();

    // Top 10 candidates by score
    const allOrders = db.prepare("SELECT * FROM orders WHERE consent_status IN ('approved', 'pre_approved')").all();
    const ranked = rankOrders(allOrders).slice(0, 10).map((o, i) => ({
      rank: i + 1,
      order_id: o.order_id,
      brand: o.brand,
      score: o._score,
      breakdown: o._breakdown,
      layout: o.layout,
      consent_status: o.consent_status,
      production_status: o.production_status,
    }));

    res.json({
      totalOrders,
      byBrand,
      byProductionStatus,
      byConsentStatus,
      topCandidates: ranked,
      brands: loadBrands(),
    });
  } finally {
    db.close();
  }
});

// GET /api/orders
app.get('/api/orders', (req, res) => {
  const db = getDb();
  try {
    const {
      brand, status, consent_status, min_score, search,
      page = 1, limit = 25, sort = 'updated_at', dir = 'DESC'
    } = req.query;

    const conditions = [];
    const params = {};

    if (brand) {
      conditions.push('brand = @brand');
      params.brand = brand;
    }
    if (status) {
      conditions.push('production_status = @status');
      params.status = status;
    }
    if (consent_status) {
      conditions.push('consent_status = @consent_status');
      params.consent_status = consent_status;
    }
    if (min_score) {
      conditions.push('score >= @min_score');
      params.min_score = Number(min_score);
    }
    if (search) {
      conditions.push("(order_id LIKE @search OR description LIKE @search OR tags LIKE @search)");
      params.search = `%${search}%`;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Whitelist sortable columns
    const allowedSorts = ['order_id', 'brand', 'score', 'layout', 'consent_status', 'production_status', 'updated_at', 'created_at'];
    const sortCol = allowedSorts.includes(sort) ? sort : 'updated_at';
    const sortDir = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * lim;

    const countSql = `SELECT COUNT(*) as total FROM orders ${where}`;
    const total = db.prepare(countSql).get(params).total;

    const sql = `SELECT * FROM orders ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ${lim} OFFSET ${offset}`;
    const rows = db.prepare(sql).all(params);

    // Attach computed scores
    const withScores = rows.map(r => {
      const scoring = scoreOrder(r);
      return { ...r, computed_score: scoring.total, score_breakdown: scoring.breakdown };
    });

    res.json({
      orders: withScores,
      total,
      page: pageNum,
      limit: lim,
      pages: Math.ceil(total / lim),
    });
  } finally {
    db.close();
  }
});

// GET /api/orders/:orderId/:brand
app.get('/api/orders/:orderId/:brand', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const scoring = scoreOrder(order);
    order.computed_score = scoring.total;
    order.score_breakdown = scoring.breakdown;

    // Consent log
    const consentLog = db.prepare('SELECT * FROM consent_log WHERE order_id = ? AND brand = ? ORDER BY timestamp DESC').all(orderId, brand);

    // Production runs
    const productionRuns = db.prepare('SELECT * FROM production_runs WHERE order_id = ? AND brand = ? ORDER BY started_at DESC').all(orderId, brand);

    // Check for export files
    const exportsDir = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'exports');
    let exports = [];
    if (fs.existsSync(exportsDir)) {
      exports = fs.readdirSync(exportsDir).filter(f => /\.(mp4|mov|webm|avi)$/i.test(f));
    }

    // Check for mockups
    const mockupsDir = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'mockups');
    let mockupCount = 0;
    if (fs.existsSync(mockupsDir)) {
      mockupCount = fs.readdirSync(mockupsDir).length;
    }

    res.json({
      order,
      consentLog,
      productionRuns,
      exports,
      mockupCount,
    });
  } finally {
    db.close();
  }
});

// POST /api/orders/:orderId/:brand/status
app.post('/api/orders/:orderId/:brand/status', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const { production_status, consent_status } = req.body;

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (production_status) {
      const allowed = ['pending', 'approved', 'producing', 'complete', 'rejected', 'downloading', 'staging', 'building', 'uploading', 'failed'];
      if (!allowed.includes(production_status)) {
        return res.status(400).json({ error: `Invalid production_status: ${production_status}` });
      }
      db.prepare("UPDATE orders SET production_status = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?")
        .run(production_status, orderId, brand);

      db.prepare('INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)')
        .run(orderId, brand, `production_${production_status}`, `Production status changed to ${production_status} via dashboard`);
    }

    if (consent_status) {
      const allowed = ['pre_approved', 'pending', 'approved', 'denied', 'revoked'];
      if (!allowed.includes(consent_status)) {
        return res.status(400).json({ error: `Invalid consent_status: ${consent_status}` });
      }
      db.prepare("UPDATE orders SET consent_status = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?")
        .run(consent_status, orderId, brand);

      db.prepare('INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)')
        .run(orderId, brand, `consent_${consent_status}`, `Consent status changed to ${consent_status} via dashboard`);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    res.json({ success: true, order: updated });
  } finally {
    db.close();
  }
});

// POST /api/batch/status
app.post('/api/batch/status', (req, res) => {
  const db = getDb();
  try {
    const { orders, production_status, consent_status } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'orders array required' });
    }

    let updated = 0;
    for (const { order_id, brand } of orders) {
      if (!order_id || !brand) continue;
      const row = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(order_id, brand);
      if (!row) continue;

      if (production_status) {
        db.prepare("UPDATE orders SET production_status = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?")
          .run(production_status, order_id, brand);
        db.prepare('INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)')
          .run(order_id, brand, `production_${production_status}`, `Batch: production status changed to ${production_status} via dashboard`);
      }
      if (consent_status) {
        db.prepare("UPDATE orders SET consent_status = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?")
          .run(consent_status, order_id, brand);
        db.prepare('INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)')
          .run(order_id, brand, `consent_${consent_status}`, `Batch: consent status changed to ${consent_status} via dashboard`);
      }
      updated++;
    }

    res.json({ success: true, updated });
  } finally {
    db.close();
  }
});

// POST /api/consent/send-batch
// Sends consent request emails to all approved-but-not-yet-emailed orders.
// Eligible orders: production_status='approved' AND consent_status='pre_approved' AND customer_email present.
// On success: updates consent_status to 'pending' for each order sent.
// Returns: { success: true, sent: N, failed: N, errors: string[], total: N }
app.post('/api/consent/send-batch', async (req, res) => {
  const db = getDb();
  try {
    const { brand } = req.body || {};
    const emailLib = require(path.join(PIPELINE_ROOT, 'lib', 'email'));

    const conditions = [
      "production_status = 'approved'",
      "consent_status = 'pre_approved'",
      "customer_email IS NOT NULL",
      "customer_email != ''",
    ];
    const params = {};
    if (brand) {
      conditions.push('brand = @brand');
      params.brand = brand;
    }

    const orders = db.prepare(
      `SELECT * FROM orders WHERE ${conditions.join(' AND ')}`
    ).all(params);

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const order of orders) {
      try {
        await emailLib.sendConsentRequest(
          order.order_id,
          order.brand,
          order.customer_email,
          order.customer_name || 'Valued Customer',
          order.order_description || `Order ${order.order_id}`
        );
        db.prepare(
          "UPDATE orders SET consent_status = 'pending', updated_at = datetime('now') WHERE order_id = ? AND brand = ?"
        ).run(order.order_id, order.brand);
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

// GET /api/production-runs
app.get('/api/production-runs', (req, res) => {
  const db = getDb();
  try {
    const runs = db.prepare('SELECT * FROM production_runs ORDER BY started_at DESC LIMIT 50').all();
    res.json({ runs });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// HTML Dashboard (Single-Page App)
// ---------------------------------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Video Pipeline Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #111827;
    --bg-card: #1f2937;
    --bg-card-hover: #374151;
    --bg-input: #374151;
    --border: #4b5563;
    --text: #f9fafb;
    --text-dim: #9ca3af;
    --accent: #4f46e5;
    --accent-hover: #6366f1;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --info: #3b82f6;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    min-height: 100vh;
    overflow-x: hidden;
  }
  a { color: var(--accent-hover); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Nav */
  nav {
    background: #0d1117;
    border-bottom: 1px solid var(--border);
    padding: 0 1.5rem;
    display: flex;
    align-items: center;
    height: 56px;
    position: sticky;
    top: 0;
    z-index: 100;
    gap: 1rem;
  }
  .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--text); white-space: nowrap; }
  .nav-brand-indicator { color: var(--text-dim); font-size: 0.85rem; }
  .nav-spacer { flex: 1; }
  .nav-last-updated { color: var(--text-dim); font-size: 0.8rem; white-space: nowrap; }

  /* Filters */
  .filters {
    padding: 0.75rem 1.5rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .filter-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .filter-label { font-size: 0.75rem; color: var(--text-dim); min-width: 80px; }
  .pill {
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .pill:hover { border-color: var(--accent); color: var(--text); }
  .pill.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  /* Board */
  .board-wrapper {
    padding: 1rem 1.5rem;
    overflow-x: auto;
    min-height: calc(100vh - 56px - 100px);
  }
  .kanban-board {
    display: flex;
    gap: 1rem;
    min-width: max-content;
    align-items: flex-start;
  }

  /* Lane */
  .lane {
    width: 280px;
    min-width: 280px;
    background: var(--bg-card);
    border-radius: 8px;
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 160px);
  }
  .lane-header {
    padding: 0.75rem 1rem;
    border-bottom: 2px solid var(--lane-accent, var(--border));
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .lane-title { font-weight: 600; font-size: 0.9rem; }
  .lane-badge {
    background: var(--lane-accent, var(--border));
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    min-width: 24px;
    text-align: center;
  }
  .lane-body {
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }
  .lane-empty {
    color: var(--text-dim);
    font-size: 0.85rem;
    text-align: center;
    padding: 2rem 1rem;
    font-style: italic;
  }

  /* Cards */
  .order-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .order-card:hover { border-color: var(--accent); background: var(--bg-card-hover); }
  .card-top { display: flex; align-items: flex-start; gap: 0.5rem; }
  .card-thumbnail {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
    background: var(--bg-input);
    flex-shrink: 0;
  }
  .card-thumb-placeholder {
    width: 60px;
    height: 60px;
    border-radius: 4px;
    background: var(--bg-input);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 1.2rem;
    flex-shrink: 0;
  }
  .card-meta { flex: 1; min-width: 0; }
  .card-order-id { font-size: 0.72rem; color: var(--text-dim); font-family: monospace; }
  .card-brand { font-weight: 600; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-customer { font-size: 0.82rem; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.25rem; }
  .card-footer { display: flex; align-items: center; justify-content: space-between; }
  .card-date { font-size: 0.72rem; color: var(--text-dim); }
  .card-score { font-size: 0.72rem; font-weight: 600; color: var(--warning); }
  .card-play { font-size: 0.9rem; color: var(--info); }

  /* Consent status badges */
  .badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-pre_approved { background: rgba(156,163,175,0.2); color: #9ca3af; }
  .badge-pending      { background: rgba(245,158,11,0.2);  color: #f59e0b; }
  .badge-approved     { background: rgba(16,185,129,0.2);  color: #10b981; }
  .badge-rejected     { background: rgba(239,68,68,0.2);   color: #ef4444; }
  .badge-uploaded     { background: rgba(139,92,246,0.2);  color: #8b5cf6; }
  .badge-built        { background: rgba(59,130,246,0.2);  color: #3b82f6; }
  .badge-pending-upload { background: rgba(156,163,175,0.2); color: #9ca3af; }
  .badge-failed       { background: rgba(239,68,68,0.2);   color: #ef4444; }

  /* Slide-over panel */
  .slide-over-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 199;
    display: none;
  }
  .slide-over-backdrop.open { display: block; }
  .slide-over {
    position: fixed;
    top: 0;
    right: 0;
    width: 440px;
    max-width: 100vw;
    height: 100vh;
    background: var(--bg-card);
    border-left: 1px solid var(--border);
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 200;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .slide-over.open { transform: translateX(0); }
  .panel-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    background: var(--bg-card);
    z-index: 1;
  }
  .panel-title { font-weight: 600; font-size: 1rem; }
  .panel-close {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .panel-close:hover { background: var(--bg-card-hover); }
  .panel-body { padding: 1.25rem; flex: 1; display: flex; flex-direction: column; gap: 1.25rem; }
  .panel-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .panel-section-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.35rem;
  }
  .detail-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .detail-table td { padding: 0.3rem 0; vertical-align: top; }
  .detail-table td:first-child { color: var(--text-dim); width: 45%; padding-right: 0.5rem; }
  .panel-loading { color: var(--text-dim); padding: 2rem; text-align: center; }
  .drive-link { word-break: break-all; font-size: 0.82rem; }

  /* Loading/error states */
  .board-loading { padding: 3rem; text-align: center; color: var(--text-dim); font-size: 0.9rem; }
</style>
</head>
<body>

<!-- Nav -->
<nav>
  <span class="nav-logo">Video Pipeline</span>
  <span class="nav-brand-indicator" id="nav-brand-indicator"></span>
  <span class="nav-spacer"></span>
  <span class="nav-last-updated" id="nav-last-updated">Loading...</span>
</nav>

<!-- Filters -->
<div class="filters">
  <div class="filter-row">
    <span class="filter-label">Brand</span>
    <div id="brand-filters" class="filter-row" style="flex:1; flex-wrap:wrap;"></div>
  </div>
  <div class="filter-row">
    <span class="filter-label">Status</span>
    <div id="status-filters" class="filter-row" style="flex:1; flex-wrap:wrap;"></div>
  </div>
</div>

<!-- Board -->
<div class="board-wrapper">
  <div class="kanban-board" id="kanban-board">
    <div class="board-loading">Loading board...</div>
  </div>
</div>

<!-- Slide-over panel -->
<div class="slide-over-backdrop" id="slide-backdrop"></div>
<div class="slide-over" id="slide-over">
  <div class="panel-header">
    <span class="panel-title" id="panel-title">Order Detail</span>
    <button class="panel-close" id="panel-close" title="Close">x</button>
  </div>
  <div class="panel-body" id="panel-body">
    <div class="panel-loading">Select an order to view details.</div>
  </div>
</div>

<script>
// Constants
var LANES = [
  { id: 'candidates',       label: 'Candidates',        accent: '#6366f1' },
  { id: 'consent_pending',  label: 'Consent Pending',   accent: '#f59e0b' },
  { id: 'consent_approved', label: 'Consent Approved',  accent: '#10b981' },
  { id: 'video_built',      label: 'Video Built',       accent: '#3b82f6' },
  { id: 'uploaded',         label: 'Uploaded to Drive', accent: '#8b5cf6' },
];

var STATUS_PILLS = [
  { label: 'All Statuses', value: null },
  { label: 'Pre-Approved', value: 'pre_approved' },
  { label: 'Pending',      value: 'pending' },
  { label: 'Approved',     value: 'approved' },
  { label: 'Built',        value: 'built' },
  { label: 'Uploaded',     value: 'uploaded' },
];

// State
var state = {
  brandFilter: null,
  consentFilter: null,
  brands: [],
  pollTimer: null,
};

// Utilities
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(str) {
  if (!str) return '-';
  try {
    return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return str; }
}

function consentBadge(status) {
  var s = (status || 'unknown').toLowerCase().replace(/ /g, '_');
  var labels = {
    pre_approved: 'Pre-Approved',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return '<span class="badge badge-' + esc(s) + '">' + esc(labels[s] || status) + '</span>';
}

function uploadStatusBadge(order) {
  var ps = (order.production_status || '').toLowerCase();
  if (ps === 'uploaded' && order.drive_url) {
    return '<span class="badge badge-uploaded">Uploaded</span>';
  }
  if (ps === 'failed') {
    return '<span class="badge badge-failed">Failed</span>';
  }
  if (ps === 'built') {
    return '<span class="badge badge-built">Built</span>';
  }
  return '<span class="badge badge-pending-upload">Pending</span>';
}

// Filter pills
function renderBrandPills() {
  var container = document.getElementById('brand-filters');
  var brands = ['All Brands'].concat(state.brands.map(function(b) { return b.slug || b.name; }));
  container.innerHTML = brands.map(function(brand) {
    var isAll = brand === 'All Brands';
    var active = isAll ? state.brandFilter === null : state.brandFilter === brand;
    return '<button class="pill' + (active ? ' active' : '') + '" data-brand="' + (isAll ? '' : esc(brand)) + '">' + esc(brand) + '</button>';
  }).join('');
}

function renderStatusPills() {
  var container = document.getElementById('status-filters');
  container.innerHTML = STATUS_PILLS.map(function(pill) {
    var active = state.consentFilter === pill.value;
    return '<button class="pill' + (active ? ' active' : '') + '" data-status="' + esc(pill.value || '') + '">' + esc(pill.label) + '</button>';
  }).join('');
}

// Board rendering
function renderCard(order, laneId) {
  var showThumb = laneId === 'candidates';
  var showPlay = laneId === 'video_built' || laneId === 'uploaded';
  var score = order.computed_score || order.score || 0;

  var thumbHtml = '';
  if (showThumb) {
    if (order.photos_url) {
      thumbHtml = '<img class="card-thumbnail" src="' + esc(order.photos_url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
    } else {
      thumbHtml = '<div class="card-thumb-placeholder">[img]</div>';
    }
  }

  var brandDisplay = esc(order.brand || '-');
  var customerDisplay = esc(order.description ? order.description.split(' ')[0] : '-');
  var dateDisplay = esc(fmtDate(order.updated_at || order.created_at));
  var playIcon = showPlay ? '<span class="card-play">[play]</span>' : '';

  return '<div class="order-card" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '">' +
    '<div class="card-top">' +
    (showThumb ? thumbHtml : '') +
    '<div class="card-meta">' +
    '<div class="card-order-id">#' + esc(order.order_id) + '</div>' +
    '<div class="card-brand">' + brandDisplay + '</div>' +
    '<div class="card-customer">' + customerDisplay + '</div>' +
    consentBadge(order.consent_status) +
    '</div>' +
    '</div>' +
    '<div class="card-footer">' +
    '<span class="card-date">' + dateDisplay + '</span>' +
    '<span class="card-score">' + score + 'pts</span>' +
    playIcon +
    '</div>' +
    '</div>';
}

function renderBoard(data) {
  var board = document.getElementById('kanban-board');
  board.innerHTML = LANES.map(function(lane) {
    var laneData = (data.lanes && data.lanes[lane.id]) ? data.lanes[lane.id] : { orders: [], count: 0 };
    var cards = laneData.orders.length > 0
      ? laneData.orders.map(function(o) { return renderCard(o, lane.id); }).join('')
      : '<div class="lane-empty">No orders here yet</div>';
    return '<div class="lane" data-lane="' + lane.id + '" style="--lane-accent:' + lane.accent + '">' +
      '<div class="lane-header">' +
      '<span class="lane-title">' + esc(lane.label) + '</span>' +
      '<span class="lane-badge">' + laneData.count + '</span>' +
      '</div>' +
      '<div class="lane-body">' + cards + '</div>' +
      '</div>';
  }).join('');

  // Re-attach card click handlers
  board.querySelectorAll('.order-card').forEach(function(card) {
    card.addEventListener('click', function() {
      openPanel(card.dataset.orderId, card.dataset.brand);
    });
  });

  // Update nav
  var lastUpdated = document.getElementById('nav-last-updated');
  if (data.fetched_at) {
    lastUpdated.textContent = 'Updated ' + fmtDate(data.fetched_at);
  }
}

// Board fetch
function fetchBoard() {
  var params = new URLSearchParams();
  if (state.brandFilter) params.set('brand', state.brandFilter);
  if (state.consentFilter) params.set('consent_status', state.consentFilter);

  fetch('/api/board?' + params.toString())
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      renderBoard(data);
      var indicator = document.getElementById('nav-brand-indicator');
      indicator.textContent = state.brandFilter ? '- ' + state.brandFilter : '';
    })
    .catch(function(err) {
      console.error('Board fetch failed:', err);
      document.getElementById('kanban-board').innerHTML =
        '<div class="board-loading">Failed to load board. Check console.</div>';
    });
}

// Brands fetch
function fetchBrands() {
  return fetch('/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      state.brands = data.brands || [];
      renderBrandPills();
    })
    .catch(function() {
      state.brands = ['TurnedYellow','MakeMeJedi','TurnedWizard','TurnedComics','PopSmiths'].map(function(s) { return { slug: s, name: s }; });
      renderBrandPills();
    });
}

// Slide-over panel
function openPanel(orderId, brand) {
  var panel = document.getElementById('slide-over');
  var backdrop = document.getElementById('slide-backdrop');
  var body = document.getElementById('panel-body');
  var title = document.getElementById('panel-title');

  title.textContent = 'Order #' + orderId;
  body.innerHTML = '<div class="panel-loading">Loading...</div>';
  panel.classList.add('open');
  backdrop.classList.add('open');

  fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand))
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) { renderPanelContent(data); })
    .catch(function(err) {
      body.innerHTML = '<div class="panel-loading">Failed to load order: ' + esc(err.message) + '</div>';
    });
}

function closePanel() {
  document.getElementById('slide-over').classList.remove('open');
  document.getElementById('slide-backdrop').classList.remove('open');
}

function renderPanelContent(data) {
  var order = data.order || {};
  var consentLog = data.consentLog || [];
  var b = order.score_breakdown || {};

  var orderInfoRows = [
    ['Order ID', '#' + esc(order.order_id)],
    ['Brand', esc(order.brand)],
    ['Date', fmtDate(order.updated_at || order.created_at)],
    ['Description', esc(order.description || '-')],
    ['Layout', esc(order.layout || '-')],
    ['Consent', consentBadge(order.consent_status)],
    ['Pipeline Stage', esc(order.production_status || '-')],
  ];

  var rankingRows = [
    ['Reaction Video', order.has_reaction_video ? 'Yes' : 'No', b.reaction || 0],
    ['Illus. Quality', b.illustrationQuality > 0 ? 'Good' : 'Low', b.illustrationQuality || 0],
    ['Clear Product', order.clear_product ? 'Yes' : 'No', b.clearProduct || 0],
    ['Layout Bonus', esc(order.layout || '-'), b.layout || 0],
    ['People Count', '-', b.peopleCount || 0],
    ['Body Framing', '-', b.bodyFraming || 0],
    ['Total Score', '', order.computed_score || order.score || 0],
  ];

  var latestConsent = consentLog[0];
  var consentSection = latestConsent
    ? '<table class="detail-table"><tr><td>Status</td><td>' + consentBadge(order.consent_status) + '</td></tr>' +
      '<tr><td>Last Action</td><td>' + esc(latestConsent.action) + '</td></tr>' +
      '<tr><td>When</td><td>' + fmtDate(latestConsent.timestamp) + '</td></tr>' +
      (latestConsent.details ? '<tr><td>Details</td><td>' + esc(latestConsent.details) + '</td></tr>' : '') +
      '</table>'
    : '<table class="detail-table"><tr><td>Status</td><td>' + consentBadge(order.consent_status) + '</td></tr></table>';

  var driveSection = order.drive_url
    ? '<p>' + uploadStatusBadge(order) + '</p>' +
      '<a class="drive-link" href="' + esc(order.drive_url) + '" target="_blank" rel="noopener noreferrer">Open in Drive</a>'
    : '<p>' + uploadStatusBadge(order) + '</p><p style="color:var(--text-dim);font-size:0.82rem">No Drive folder yet</p>';

  document.getElementById('panel-title').textContent = 'Order #' + (order.order_id || '');
  document.getElementById('panel-body').innerHTML =
    '<div class="panel-section">' +
    '<div class="panel-section-title">Order Info</div>' +
    '<table class="detail-table">' +
    orderInfoRows.map(function(row) { return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>'; }).join('') +
    '</table>' +
    '</div>' +

    '<div class="panel-section">' +
    '<div class="panel-section-title">Consent Status</div>' +
    consentSection +
    '</div>' +

    '<div class="panel-section">' +
    '<div class="panel-section-title">Ranking Signals</div>' +
    '<table class="detail-table"><tr><td><strong>Signal</strong></td><td><strong>Value</strong></td><td><strong>Pts</strong></td></tr>' +
    rankingRows.map(function(row) { return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td></tr>'; }).join('') +
    '</table>' +
    '</div>' +

    '<div class="panel-section">' +
    '<div class="panel-section-title">Drive Upload</div>' +
    driveSection +
    '</div>';
}

// Event listeners
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('slide-backdrop').addEventListener('click', closePanel);

document.getElementById('brand-filters').addEventListener('click', function(e) {
  var btn = e.target.closest('.pill');
  if (!btn) return;
  var val = btn.dataset.brand || null;
  state.brandFilter = (state.brandFilter === val) ? null : val;
  renderBrandPills();
  fetchBoard();
});

document.getElementById('status-filters').addEventListener('click', function(e) {
  var btn = e.target.closest('.pill');
  if (!btn) return;
  var val = btn.dataset.status || null;
  state.consentFilter = (state.consentFilter === val) ? null : val;
  renderStatusPills();
  fetchBoard();
});

// Init
renderStatusPills();
fetchBrands().then(function() { return fetchBoard(); });

// Polling every 30s (skip if tab hidden)
state.pollTimer = setInterval(function() {
  if (!document.hidden) fetchBoard();
}, 30000);
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) fetchBoard();
});
</script>
</body>
</html>
`;


// Serve HTML for all non-API routes
app.get('/', (req, res) => res.type('html').send(HTML));
app.get('/orders', (req, res) => res.type('html').send(HTML));
app.get('/orders/:id', (req, res) => res.type('html').send(HTML));
app.get('/batch', (req, res) => res.type('html').send(HTML));
app.get('/pipeline', (req, res) => res.type('html').send(HTML));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Video Pipeline Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  API endpoints:`);
  console.log(`    GET  /api/stats`);
  console.log(`    GET  /api/orders`);
  console.log(`    GET  /api/orders/:orderId/:brand`);
  console.log(`    POST /api/orders/:orderId/:brand/status`);
  console.log(`    POST /api/batch/status`);
  console.log(`    POST /api/consent/send-batch`);
  console.log(`    GET  /api/production-runs\n`);
});
