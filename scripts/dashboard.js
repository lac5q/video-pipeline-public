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
  }
  nav .logo {
    font-weight: 700;
    font-size: 1.1rem;
    margin-right: 2rem;
    color: var(--text);
    cursor: pointer;
  }
  nav .nav-links { display: flex; gap: 0.25rem; }
  nav .nav-links a {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s;
  }
  nav .nav-links a:hover,
  nav .nav-links a.active {
    background: var(--bg-card);
    color: var(--text);
    text-decoration: none;
  }

  /* Main content */
  .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }
  .page { display: none; }
  .page.active { display: block; }

  /* Cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem;
  }
  .card h3 { font-size: 0.8rem; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  .card .value { font-size: 2rem; font-weight: 700; }
  .card .subtitle { font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem; }

  /* Status badges */
  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .badge-pending { background: #78350f; color: #fbbf24; }
  .badge-approved, .badge-pre_approved, .badge-complete { background: #064e3b; color: #6ee7b7; }
  .badge-producing, .badge-building, .badge-downloading, .badge-staging, .badge-uploading { background: #1e3a5f; color: #93c5fd; }
  .badge-rejected, .badge-denied, .badge-revoked, .badge-failed { background: #7f1d1d; color: #fca5a5; }

  /* Tables */
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  thead th {
    background: #0d1117;
    padding: 0.75rem 0.75rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }
  thead th:hover { color: var(--text); }
  thead th.sorted-asc::after { content: ' \\25B2'; font-size: 0.65rem; }
  thead th.sorted-desc::after { content: ' \\25BC'; font-size: 0.65rem; }
  tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
  tbody tr:hover { background: var(--bg-card-hover); }
  tbody td { padding: 0.6rem 0.75rem; white-space: nowrap; }
  tbody td.wrap { white-space: normal; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

  /* Forms */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
    align-items: center;
  }
  select, input[type="text"], input[type="number"], input[type="range"] {
    background: var(--bg-input);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
    outline: none;
  }
  select:focus, input:focus { border-color: var(--accent); }
  label { font-size: 0.8rem; color: var(--text-dim); display: block; margin-bottom: 0.2rem; }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
    color: #fff;
  }
  .btn-primary { background: var(--accent); }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-success { background: var(--success); }
  .btn-success:hover { background: #059669; }
  .btn-warning { background: var(--warning); color: #000; }
  .btn-warning:hover { background: #d97706; }
  .btn-danger { background: var(--danger); }
  .btn-danger:hover { background: #dc2626; }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Pagination */
  .pagination {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    justify-content: center;
  }
  .pagination button {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .pagination button:hover:not(:disabled) { background: var(--bg-card-hover); }
  .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
  .pagination span { font-size: 0.85rem; color: var(--text-dim); }

  /* Detail page */
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .detail-section { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
  .detail-section h2 { font-size: 1rem; margin-bottom: 0.75rem; color: var(--accent-hover); }
  .detail-row { display: flex; padding: 0.35rem 0; border-bottom: 1px solid rgba(75,85,99,0.3); }
  .detail-label { width: 160px; flex-shrink: 0; color: var(--text-dim); font-size: 0.85rem; }
  .detail-value { font-size: 0.85rem; word-break: break-all; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }

  /* Score bar */
  .score-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--bg-input); width: 100%; max-width: 200px; }
  .score-bar > div { height: 100%; }
  .score-bar .seg-reaction { background: #8b5cf6; }
  .score-bar .seg-product { background: #10b981; }
  .score-bar .seg-layout { background: #3b82f6; }
  .score-bar .seg-recency { background: #f59e0b; }
  .score-bar .seg-tags { background: #ec4899; }
  .score-bar .seg-hook { background: #ef4444; }

  /* Toast notifications */
  .toast-container { position: fixed; top: 70px; right: 1.5rem; z-index: 200; display: flex; flex-direction: column; gap: 0.5rem; }
  .toast {
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    animation: slideIn 0.3s ease;
    min-width: 250px;
  }
  .toast-success { background: #064e3b; border: 1px solid #10b981; color: #6ee7b7; }
  .toast-error { background: #7f1d1d; border: 1px solid #ef4444; color: #fca5a5; }
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

  /* Status distribution */
  .status-list { list-style: none; }
  .status-list li { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid rgba(75,85,99,0.3); }
  .status-list li:last-child { border-bottom: none; }
  .status-bar-bg { flex: 1; margin: 0 0.75rem; height: 6px; background: var(--bg-input); border-radius: 3px; overflow: hidden; }
  .status-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

  /* Checkbox column */
  .cb-col { width: 30px; text-align: center; }
  input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }

  /* Loading */
  .loading { text-align: center; padding: 3rem; color: var(--text-dim); }

  /* Responsive */
  @media (max-width: 768px) {
    .cards { grid-template-columns: 1fr 1fr; }
    .detail-grid { grid-template-columns: 1fr; }
    .filters { flex-direction: column; }
    nav { flex-wrap: wrap; height: auto; padding: 0.75rem; }
    nav .nav-links { flex-wrap: wrap; }
  }

  /* Back link */
  .back-link { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--text-dim); margin-bottom: 1rem; font-size: 0.85rem; cursor: pointer; }
  .back-link:hover { color: var(--text); text-decoration: none; }

  /* Batch bar */
  .batch-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #0d1117;
    border-top: 1px solid var(--accent);
    padding: 0.75rem 1.5rem;
    display: none;
    align-items: center;
    justify-content: space-between;
    z-index: 100;
  }
  .batch-bar.visible { display: flex; }
  .batch-bar .info { font-size: 0.85rem; color: var(--text-dim); }
  .batch-bar .info strong { color: var(--text); }
</style>
</head>
<body>

<nav>
  <span class="logo" onclick="navigate('overview')">Video Pipeline</span>
  <div class="nav-links">
    <a href="#" data-page="overview" class="active" onclick="navigate('overview'); return false;">Overview</a>
    <a href="#" data-page="orders" onclick="navigate('orders'); return false;">Orders</a>
    <a href="#" data-page="pipeline" onclick="navigate('pipeline'); return false;">Pipeline</a>
  </div>
</nav>

<div class="toast-container" id="toasts"></div>

<div class="container">
  <!-- ============ OVERVIEW PAGE ============ -->
  <div class="page active" id="page-overview">
    <h1 style="margin-bottom:1.5rem; font-size:1.5rem;">Dashboard Overview</h1>
    <div class="cards" id="overview-cards"></div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1.5rem;" id="overview-grid">
      <div class="detail-section">
        <h2>Orders by Brand</h2>
        <ul class="status-list" id="brand-list"></ul>
      </div>
      <div class="detail-section">
        <h2>Production Status</h2>
        <ul class="status-list" id="prod-status-list"></ul>
      </div>
      <div class="detail-section">
        <h2>Consent Status</h2>
        <ul class="status-list" id="consent-status-list"></ul>
      </div>
      <div class="detail-section">
        <h2>Top 10 Candidates</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Order ID</th><th>Brand</th><th>Score</th><th>Breakdown</th><th>Status</th></tr>
            </thead>
            <tbody id="top-candidates"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- ============ ORDERS PAGE ============ -->
  <div class="page" id="page-orders">
    <h1 style="margin-bottom:1rem; font-size:1.5rem;">Orders</h1>
    <div class="filters" id="order-filters">
      <div>
        <label>Brand</label>
        <select id="f-brand"><option value="">All Brands</option></select>
      </div>
      <div>
        <label>Production Status</label>
        <select id="f-status">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="producing">Producing</option>
          <option value="complete">Complete</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div>
        <label>Consent Status</label>
        <select id="f-consent">
          <option value="">All</option>
          <option value="pre_approved">Pre-approved</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>
      <div>
        <label>Min Score: <span id="f-score-val">0</span></label>
        <input type="range" id="f-score" min="0" max="5" step="1" value="0" oninput="document.getElementById('f-score-val').textContent=this.value">
      </div>
      <div>
        <label>Search</label>
        <input type="text" id="f-search" placeholder="Order ID, tags..." style="width:180px">
      </div>
      <div style="align-self:flex-end">
        <button class="btn btn-primary" onclick="loadOrders(1)">Apply</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="cb-col"><input type="checkbox" id="select-all" onchange="toggleSelectAll(this)"></th>
            <th data-sort="order_id">Order ID</th>
            <th data-sort="brand">Brand</th>
            <th data-sort="score">Score</th>
            <th>Computed</th>
            <th data-sort="layout">Layout</th>
            <th>Consent</th>
            <th data-sort="production_status">Production</th>
            <th>Video</th>
            <th>Tags</th>
            <th data-sort="updated_at">Updated</th>
          </tr>
        </thead>
        <tbody id="orders-tbody"></tbody>
      </table>
    </div>
    <div class="pagination" id="orders-pagination"></div>
  </div>

  <!-- ============ ORDER DETAIL PAGE ============ -->
  <div class="page" id="page-detail">
    <a class="back-link" onclick="navigate('orders'); return false;">&larr; Back to Orders</a>
    <div id="detail-content"></div>
  </div>

  <!-- ============ PIPELINE PAGE ============ -->
  <div class="page" id="page-pipeline">
    <h1 style="margin-bottom:1.5rem; font-size:1.5rem;">Pipeline Runs</h1>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>ID</th><th>Order ID</th><th>Brand</th><th>Type</th><th>Status</th><th>Started</th><th>Completed</th><th>Error</th></tr>
        </thead>
        <tbody id="pipeline-tbody"></tbody>
      </table>
    </div>
    <p id="pipeline-empty" class="loading" style="display:none">No production runs found.</p>
  </div>
</div>

<!-- Batch action bar -->
<div class="batch-bar" id="batch-bar">
  <div class="info"><strong id="batch-count">0</strong> orders selected</div>
  <div style="display:flex; gap:0.5rem;">
    <button class="btn btn-success btn-sm" onclick="batchAction('approved')">Approve</button>
    <button class="btn btn-warning btn-sm" onclick="batchAction('producing')">Mark Producing</button>
    <button class="btn btn-primary btn-sm" onclick="batchAction('complete')">Mark Complete</button>
    <button class="btn btn-danger btn-sm" onclick="batchAction('rejected')">Reject</button>
  </div>
</div>

<script>
// =========================================================================
// State
// =========================================================================
let currentPage = 'overview';
let ordersState = { page: 1, sort: 'updated_at', dir: 'DESC', data: null };
let selectedOrders = new Set(); // "orderId|brand" keys
let statsCache = null;

// =========================================================================
// Navigation
// =========================================================================
function navigate(page, params) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');
  const navLink = document.querySelector('.nav-links a[data-page="' + page + '"]');
  if (navLink) navLink.classList.add('active');

  currentPage = page;

  if (page === 'overview') loadOverview();
  else if (page === 'orders') loadOrders();
  else if (page === 'detail' && params) loadOrderDetail(params.orderId, params.brand);
  else if (page === 'pipeline') loadPipeline();
}

// =========================================================================
// Toast
// =========================================================================
function toast(msg, type) {
  type = type || 'success';
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// =========================================================================
// Overview
// =========================================================================
async function loadOverview() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    statsCache = data;

    // Cards
    const cardsHtml = '<div class="card"><h3>Total Orders</h3><div class="value">' + data.totalOrders + '</div></div>' +
      data.byBrand.map(b =>
        '<div class="card"><h3>' + esc(b.brand) + '</h3><div class="value">' + b.count + '</div><div class="subtitle">orders</div></div>'
      ).join('');
    document.getElementById('overview-cards').innerHTML = cardsHtml;

    // Brand distribution
    renderStatusList('brand-list', data.byBrand.map(b => ({ label: b.brand, count: b.count })), data.totalOrders, '#4f46e5');

    // Production status
    const prodColors = { pending: '#f59e0b', approved: '#10b981', producing: '#3b82f6', complete: '#6ee7b7', rejected: '#ef4444', failed: '#ef4444', downloading: '#93c5fd', staging: '#93c5fd', building: '#93c5fd', uploading: '#93c5fd' };
    renderStatusList('prod-status-list', data.byProductionStatus.map(s => ({ label: s.production_status || 'null', count: s.count, color: prodColors[s.production_status] })), data.totalOrders);

    // Consent status
    const conColors = { pre_approved: '#6ee7b7', pending: '#f59e0b', approved: '#10b981', denied: '#ef4444', revoked: '#ef4444' };
    renderStatusList('consent-status-list', data.byConsentStatus.map(s => ({ label: s.consent_status || 'null', count: s.count, color: conColors[s.consent_status] })), data.totalOrders);

    // Top candidates
    const tbody = document.getElementById('top-candidates');
    if (data.topCandidates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:1rem;">No scored candidates found</td></tr>';
    } else {
      tbody.innerHTML = data.topCandidates.map(c =>
        '<tr style="cursor:pointer" onclick="navigate(\\'detail\\', {orderId:\\'' + esc(c.order_id) + '\\', brand:\\'' + esc(c.brand) + '\\'})"><td>' + c.rank + '</td><td>' + esc(c.order_id) + '</td><td>' + esc(c.brand) + '</td><td><strong>' + c.score + '</strong></td><td>' + scoreBar(c.breakdown) + '</td><td>' + badge(c.production_status) + '</td></tr>'
      ).join('');
    }

    // Populate brand filter
    const sel = document.getElementById('f-brand');
    const existing = sel.querySelectorAll('option:not(:first-child)');
    existing.forEach(o => o.remove());
    data.brands.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.slug;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load overview', e);
  }
}

function renderStatusList(elId, items, total, defaultColor) {
  const el = document.getElementById(elId);
  if (!items.length) { el.innerHTML = '<li style="color:var(--text-dim)">No data</li>'; return; }
  el.innerHTML = items.map(s => {
    const pct = total > 0 ? (s.count / total * 100) : 0;
    const color = s.color || defaultColor || '#4f46e5';
    return '<li><span style="min-width:100px">' + badge(s.label) + '</span><div class="status-bar-bg"><div class="status-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div><span style="min-width:40px;text-align:right;font-weight:600">' + s.count + '</span></li>';
  }).join('');
}

// =========================================================================
// Orders Table
// =========================================================================
async function loadOrders(page) {
  if (page) ordersState.page = page;
  const brand = document.getElementById('f-brand').value;
  const status = document.getElementById('f-status').value;
  const consent = document.getElementById('f-consent').value;
  const minScore = document.getElementById('f-score').value;
  const search = document.getElementById('f-search').value;

  const params = new URLSearchParams({
    page: ordersState.page,
    limit: 25,
    sort: ordersState.sort,
    dir: ordersState.dir,
  });
  if (brand) params.set('brand', brand);
  if (status) params.set('status', status);
  if (consent) params.set('consent_status', consent);
  if (minScore && minScore !== '0') params.set('min_score', minScore);
  if (search) params.set('search', search);

  try {
    const res = await fetch('/api/orders?' + params);
    const data = await res.json();
    ordersState.data = data;

    const tbody = document.getElementById('orders-tbody');
    if (data.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-dim);padding:2rem;">No orders found</td></tr>';
    } else {
      tbody.innerHTML = data.orders.map(o => {
        const key = o.order_id + '|' + o.brand;
        const checked = selectedOrders.has(key) ? 'checked' : '';
        let tagsStr = '';
        try { const t = JSON.parse(o.tags || '[]'); tagsStr = Array.isArray(t) ? t.slice(0,3).join(', ') : String(o.tags||''); } catch(_) { tagsStr = String(o.tags||'').slice(0,30); }
        const hasVideo = o.video_path ? 'Yes' : 'No';
        const updated = o.updated_at ? o.updated_at.slice(0,16).replace('T',' ') : '-';

        return '<tr>' +
          '<td class="cb-col"><input type="checkbox" ' + checked + ' onchange="toggleSelect(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\', this.checked)"></td>' +
          '<td><a href="#" onclick="navigate(\\'detail\\',{orderId:\\'' + esc(o.order_id) + '\\',brand:\\'' + esc(o.brand) + '\\'});return false;">' + esc(o.order_id) + '</a></td>' +
          '<td>' + esc(o.brand) + '</td>' +
          '<td>' + (o.score !== null ? o.score : '-') + '</td>' +
          '<td><span title="' + o.computed_score + '">' + o.computed_score + '</span> ' + scoreBar(o.score_breakdown) + '</td>' +
          '<td>' + esc(o.layout || '-') + '</td>' +
          '<td>' + badge(o.consent_status) + '</td>' +
          '<td>' + badge(o.production_status) + '</td>' +
          '<td>' + hasVideo + '</td>' +
          '<td class="wrap" title="' + esc(tagsStr) + '">' + esc(tagsStr.slice(0,40)) + '</td>' +
          '<td>' + updated + '</td></tr>';
      }).join('');
    }

    // Update sort indicators
    document.querySelectorAll('#page-orders thead th[data-sort]').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === ordersState.sort) {
        th.classList.add(ordersState.dir === 'ASC' ? 'sorted-asc' : 'sorted-desc');
      }
    });

    // Pagination
    renderPagination(data);
    updateBatchBar();
  } catch (e) {
    console.error('Failed to load orders', e);
  }
}

function renderPagination(data) {
  const el = document.getElementById('orders-pagination');
  const prevDisabled = data.page <= 1 ? 'disabled' : '';
  const nextDisabled = data.page >= data.pages ? 'disabled' : '';
  el.innerHTML =
    '<button ' + prevDisabled + ' onclick="loadOrders(' + (data.page - 1) + ')">Previous</button>' +
    '<span>Page ' + data.page + ' of ' + data.pages + ' (' + data.total + ' total)</span>' +
    '<button ' + nextDisabled + ' onclick="loadOrders(' + (data.page + 1) + ')">Next</button>';
}

// Sorting
document.addEventListener('click', function(e) {
  if (e.target.tagName === 'TH' && e.target.dataset.sort) {
    const col = e.target.dataset.sort;
    if (ordersState.sort === col) {
      ordersState.dir = ordersState.dir === 'ASC' ? 'DESC' : 'ASC';
    } else {
      ordersState.sort = col;
      ordersState.dir = 'DESC';
    }
    loadOrders(1);
  }
});

// Enter key in search
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('f-search').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loadOrders(1);
  });
});

// =========================================================================
// Selection / Batch
// =========================================================================
function toggleSelect(orderId, brand, checked) {
  const key = orderId + '|' + brand;
  if (checked) selectedOrders.add(key); else selectedOrders.delete(key);
  updateBatchBar();
}

function toggleSelectAll(cb) {
  if (!ordersState.data) return;
  ordersState.data.orders.forEach(o => {
    const key = o.order_id + '|' + o.brand;
    if (cb.checked) selectedOrders.add(key); else selectedOrders.delete(key);
  });
  loadOrders(ordersState.page); // re-render
}

function updateBatchBar() {
  const bar = document.getElementById('batch-bar');
  const count = selectedOrders.size;
  document.getElementById('batch-count').textContent = count;
  if (count > 0) bar.classList.add('visible'); else bar.classList.remove('visible');
}

async function batchAction(productionStatus) {
  if (selectedOrders.size === 0) return;
  const orders = Array.from(selectedOrders).map(k => {
    const [order_id, brand] = k.split('|');
    return { order_id, brand };
  });

  try {
    const res = await fetch('/api/batch/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, production_status: productionStatus }),
    });
    const data = await res.json();
    if (data.success) {
      toast(data.updated + ' orders updated to ' + productionStatus);
      selectedOrders.clear();
      updateBatchBar();
      loadOrders(ordersState.page);
    } else {
      toast(data.error || 'Batch update failed', 'error');
    }
  } catch (e) {
    toast('Batch update failed: ' + e.message, 'error');
  }
}

// =========================================================================
// Order Detail
// =========================================================================
async function loadOrderDetail(orderId, brand) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

  const el = document.getElementById('detail-content');
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand));
    if (!res.ok) { el.innerHTML = '<p>Order not found.</p>'; return; }
    const data = await res.json();
    const o = data.order;

    let tagsStr = '';
    try { const t = JSON.parse(o.tags || '[]'); tagsStr = Array.isArray(t) ? t.join(', ') : String(o.tags||''); } catch(_) { tagsStr = String(o.tags||''); }

    const fields = [
      ['Order ID', o.order_id],
      ['Brand', o.brand],
      ['Consent Status', badge(o.consent_status)],
      ['Production Status', badge(o.production_status)],
      ['Raw Score', o.score !== null ? o.score + '/5' : '-'],
      ['Computed Score', '<strong>' + o.computed_score + '</strong>/100 ' + scoreBar(o.score_breakdown, true)],
      ['Layout', o.layout || '-'],
      ['Has Reaction Video', o.has_reaction_video ? 'Yes' : 'No'],
      ['Reaction Video URL', o.reaction_video_url ? '<a href="' + esc(o.reaction_video_url) + '" target="_blank">' + esc(o.reaction_video_url).slice(0,60) + '</a>' : '-'],
      ['Reaction Clips', [o.reaction_start, o.reaction_end, o.reaction_start2, o.reaction_end2].filter(Boolean).join(' / ') || '-'],
      ['Photos URL', o.photos_url ? '<a href="' + esc(o.photos_url) + '" target="_blank">Link</a>' : '-'],
      ['OMS URL', o.oms_url ? '<a href="' + esc(o.oms_url) + '" target="_blank">Link</a>' : '-'],
      ['Illustration ID', o.illustration_id || '-'],
      ['Tags', tagsStr || '-'],
      ['Description', o.description || '-'],
      ['Clear Product', o.clear_product ? 'Yes' : 'No'],
      ['Source', o.source || '-'],
      ['Holiday', o.holiday || '-'],
      ['Video Path', o.video_path || '-'],
      ['Drive URL', o.drive_url ? '<a href="' + esc(o.drive_url) + '" target="_blank">Link</a>' : '-'],
      ['Created', o.created_at || '-'],
      ['Updated', o.updated_at || '-'],
    ];

    let html = '<h1 style="margin-bottom:1rem;font-size:1.25rem;">Order: ' + esc(o.order_id) + ' <span style="color:var(--text-dim);font-weight:400;font-size:0.9rem;">' + esc(o.brand) + '</span></h1>';

    html += '<div class="detail-grid"><div>';
    html += '<div class="detail-section"><h2>Order Details</h2>';
    fields.forEach(f => {
      html += '<div class="detail-row"><div class="detail-label">' + f[0] + '</div><div class="detail-value">' + (f[1] || '-') + '</div></div>';
    });
    html += '</div>';

    // Actions
    html += '<div class="detail-section"><h2>Actions</h2><div class="actions">';
    html += '<button class="btn btn-success btn-sm" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',\\'approved\\',null)">Approve</button>';
    html += '<button class="btn btn-danger btn-sm" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',\\'rejected\\',null)">Reject</button>';
    html += '<button class="btn btn-warning btn-sm" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',\\'producing\\',null)">Mark Producing</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',\\'complete\\',null)">Mark Complete</button>';
    html += '</div>';
    html += '<div class="actions" style="margin-top:0.5rem;">';
    html += '<button class="btn btn-sm" style="background:var(--bg-input)" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',null,\\'approved\\')">Consent: Approve</button>';
    html += '<button class="btn btn-sm" style="background:var(--bg-input)" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',null,\\'denied\\')">Consent: Deny</button>';
    html += '<button class="btn btn-sm" style="background:var(--bg-input)" onclick="updateOrderStatus(\\'' + esc(o.order_id) + '\\',\\'' + esc(o.brand) + '\\',null,\\'revoked\\')">Consent: Revoke</button>';
    html += '</div></div>';
    html += '</div><div>';

    // Exports
    html += '<div class="detail-section"><h2>Exports (' + data.exports.length + ')</h2>';
    if (data.exports.length > 0) {
      html += '<ul style="list-style:none;">';
      data.exports.forEach(f => { html += '<li style="padding:0.3rem 0;font-size:0.85rem;color:var(--text-dim)">' + esc(f) + '</li>'; });
      html += '</ul>';
    } else {
      html += '<p style="color:var(--text-dim);font-size:0.85rem;">No exported videos found.</p>';
    }
    html += '</div>';

    // Mockups
    html += '<div class="detail-section"><h2>Mockups</h2>';
    html += '<p style="font-size:0.85rem;color:var(--text-dim);">' + data.mockupCount + ' mockup file(s)</p></div>';

    // Consent log
    html += '<div class="detail-section"><h2>Consent Log</h2>';
    if (data.consentLog.length > 0) {
      html += '<div class="table-wrap"><table><thead><tr><th>Action</th><th>Details</th><th>Time</th></tr></thead><tbody>';
      data.consentLog.forEach(l => {
        html += '<tr><td>' + badge(l.action) + '</td><td style="white-space:normal;max-width:250px;">' + esc(l.details || '-') + '</td><td>' + (l.timestamp || '-') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<p style="color:var(--text-dim);font-size:0.85rem;">No consent log entries.</p>';
    }
    html += '</div>';

    // Production runs
    html += '<div class="detail-section"><h2>Production Runs</h2>';
    if (data.productionRuns.length > 0) {
      html += '<div class="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Started</th><th>Completed</th><th>Error</th></tr></thead><tbody>';
      data.productionRuns.forEach(r => {
        html += '<tr><td>' + esc(r.video_type || '-') + '</td><td>' + badge(r.status) + '</td><td>' + (r.started_at || '-') + '</td><td>' + (r.completed_at || '-') + '</td><td style="white-space:normal;max-width:200px;color:var(--danger)">' + esc(r.error || '') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<p style="color:var(--text-dim);font-size:0.85rem;">No production runs.</p>';
    }
    html += '</div>';

    html += '</div></div>'; // close detail-grid

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<p style="color:var(--danger)">Failed to load order: ' + esc(e.message) + '</p>';
  }
}

async function updateOrderStatus(orderId, brand, productionStatus, consentStatus) {
  const body = {};
  if (productionStatus) body.production_status = productionStatus;
  if (consentStatus) body.consent_status = consentStatus;

  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      toast('Status updated successfully');
      loadOrderDetail(orderId, brand);
    } else {
      toast(data.error || 'Update failed', 'error');
    }
  } catch (e) {
    toast('Update failed: ' + e.message, 'error');
  }
}

// =========================================================================
// Pipeline
// =========================================================================
async function loadPipeline() {
  try {
    const res = await fetch('/api/production-runs');
    const data = await res.json();
    const tbody = document.getElementById('pipeline-tbody');
    const emptyMsg = document.getElementById('pipeline-empty');

    if (data.runs.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.style.display = 'block';
    } else {
      emptyMsg.style.display = 'none';
      tbody.innerHTML = data.runs.map(r =>
        '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td><a href="#" onclick="navigate(\\'detail\\',{orderId:\\'' + esc(r.order_id) + '\\',brand:\\'' + esc(r.brand) + '\\'});return false;">' + esc(r.order_id) + '</a></td>' +
        '<td>' + esc(r.brand) + '</td>' +
        '<td>' + esc(r.video_type || '-') + '</td>' +
        '<td>' + badge(r.status) + '</td>' +
        '<td>' + (r.started_at || '-') + '</td>' +
        '<td>' + (r.completed_at || '-') + '</td>' +
        '<td style="color:var(--danger);white-space:normal;max-width:300px;">' + esc(r.error || '') + '</td>' +
        '</tr>'
      ).join('');
    }
  } catch (e) {
    console.error('Failed to load pipeline', e);
  }
}

// =========================================================================
// Helpers
// =========================================================================
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function badge(status) {
  if (!status) return '<span class="badge">-</span>';
  const cls = 'badge-' + String(status).toLowerCase().replace(/[^a-z_]/g, '');
  return '<span class="badge ' + cls + '">' + esc(status) + '</span>';
}

function scoreBar(breakdown, wide) {
  if (!breakdown) return '';
  const max = 100;
  const w = wide ? 'width:300px' : 'width:120px';
  return '<div class="score-bar" style="display:inline-flex;vertical-align:middle;' + w + '" title="Reaction:' + breakdown.reaction + ' Product:' + breakdown.clearProduct + ' Layout:' + breakdown.layout + ' Recency:' + breakdown.recency + ' Tags:' + breakdown.tags + ' Hook:' + breakdown.hook + '">' +
    '<div class="seg-reaction" style="width:' + (breakdown.reaction/max*100) + '%"></div>' +
    '<div class="seg-product" style="width:' + (breakdown.clearProduct/max*100) + '%"></div>' +
    '<div class="seg-layout" style="width:' + (breakdown.layout/max*100) + '%"></div>' +
    '<div class="seg-recency" style="width:' + (breakdown.recency/max*100) + '%"></div>' +
    '<div class="seg-tags" style="width:' + (breakdown.tags/max*100) + '%"></div>' +
    '<div class="seg-hook" style="width:' + (breakdown.hook/max*100) + '%"></div>' +
    '</div>';
}

// =========================================================================
// Init
// =========================================================================
loadOverview();
</script>
</body>
</html>`;

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
  console.log(`    GET  /api/production-runs\n`);
});
