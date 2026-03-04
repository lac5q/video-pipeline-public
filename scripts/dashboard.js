'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
const { scoreOrder, rankOrders } = require(path.join(PIPELINE_ROOT, 'lib', 'scorer'));
const consentApp = require(path.join(PIPELINE_ROOT, 'scripts', 'consent-server'));

const app = express();
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3001;

app.use(express.json());

// Trust Railway's proxy
app.set('trust proxy', 1);

// Basic security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Health check -- unauthenticated, used by Railway
// POST /api/admin/clean-urls — one-time cleanup of non-URL values in orders table
app.post('/api/admin/clean-urls', (req, res) => {
  const db = getDb();
  try {
    const tableInfo = db.prepare('PRAGMA table_info(orders)').all();
    const existingColumns = new Set(tableInfo.map(c => c.name));

    const report = [];

    // Delete header rows
    const HEADER_MARKERS = ['File Name', 'Order ID', 'order_id', 'OrderID'];
    const placeholders = HEADER_MARKERS.map(() => '?').join(',');
    const deleted = db.prepare(`DELETE FROM orders WHERE order_id IN (${placeholders})`).run(...HEADER_MARKERS);
    report.push({ action: 'delete_header_rows', changes: deleted.changes });

    // Null out non-URL values
    for (const field of ['photos_url', 'oms_url', 'illustration_url']) {
      if (!existingColumns.has(field)) {
        report.push({ field, skipped: 'column not found' });
        continue;
      }
      const result = db.prepare(`
        UPDATE orders SET ${field} = NULL
        WHERE ${field} IS NOT NULL AND ${field} != ''
          AND ${field} NOT LIKE 'http://%' AND ${field} NOT LIKE 'https://%'
      `).run();
      report.push({ field, cleared: result.changes });
    }

    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

app.get('/healthz', (_req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    db.close();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

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

// GET /api/consent/status/:orderId/:brand
// Returns detailed consent status with full log history
app.get('/api/consent/status/:orderId/:brand', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const consentLog = db.prepare(
      'SELECT * FROM consent_log WHERE order_id = ? AND brand = ? ORDER BY timestamp DESC'
    ).all(orderId, brand);

    // Get token status if exists
    const tokens = db.prepare(
      "SELECT * FROM consent_tokens WHERE order_id = ? AND brand = ? ORDER BY created_at DESC LIMIT 2"
    ).all(orderId, brand);

    const tokenStatus = tokens.map(t => ({
      action: t.action,
      created_at: t.created_at,
      expires_at: t.expires_at,
      used_at: t.used_at,
      is_expired: t.expires_at && new Date(t.expires_at) < new Date(),
      is_used: !!t.used_at,
    }));

    res.json({
      order_id: order.order_id,
      brand: order.brand,
      consent_status: order.consent_status,
      customer_email: order.customer_email,
      consent_log: consentLog,
      tokens: tokenStatus,
      last_updated: order.updated_at,
    });
  } finally {
    db.close();
  }
});

// POST /api/consent/resend/:orderId/:brand
// Resend consent email to a specific order
app.post('/api/consent/resend/:orderId/:brand', async (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.customer_email) return res.status(400).json({ error: 'No customer email on file' });

    const emailLib = require(path.join(PIPELINE_ROOT, 'lib', 'email'));
    await emailLib.sendConsentRequest(
      order.order_id,
      order.brand,
      order.customer_email,
      order.customer_name || 'Valued Customer',
      order.order_description || `Order ${order.order_id}`
    );

    // Log the resend
    db.prepare(
      'INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)'
    ).run(orderId, brand, 'consent_resent', 'Consent email resent from dashboard');

    res.json({ success: true, message: 'Consent email resent' });
  } catch (err) {
    console.error('Resend consent error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// POST /api/pipeline/run
// Trigger the daily pipeline run
app.post('/api/pipeline/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const { brand, limit } = req.body || {};
    
    const runId = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_');
    
    // Build command
    const scriptPath = path.join(PIPELINE_ROOT, 'scripts', 'daily-pipeline.sh');
    const args = [];
    if (brand) args.push('--brand', brand);
    if (limit) args.push('--limit', String(limit));
    
    // Spawn the pipeline process
    const child = spawn('bash', [scriptPath, ...args], {
      cwd: PIPELINE_ROOT,
      env: { ...process.env, PIPELINE_RUN_ID: runId },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = [];
    let errors = [];

    child.stdout.on('data', (data) => {
      const line = data.toString();
      output.push(line);
      // Broadcast to connected SSE clients
      broadcastPipelineUpdate(runId, { type: 'log', level: 'info', message: line.trim(), timestamp: new Date().toISOString() });
    });

    child.stderr.on('data', (data) => {
      const line = data.toString();
      errors.push(line);
      broadcastPipelineUpdate(runId, { type: 'log', level: 'error', message: line.trim(), timestamp: new Date().toISOString() });
    });

    child.on('close', (code) => {
      broadcastPipelineUpdate(runId, { 
        type: 'complete', 
        exit_code: code, 
        timestamp: new Date().toISOString(),
        output_lines: output.length,
        error_lines: errors.length
      });
    });

    child.on('error', (err) => {
      broadcastPipelineUpdate(runId, { type: 'error', message: err.message, timestamp: new Date().toISOString() });
    });

    res.json({ 
      success: true, 
      run_id: runId, 
      message: 'Pipeline started',
      status_url: `/api/pipeline/status/${runId}`
    });
  } catch (err) {
    console.error('Pipeline trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pipeline/status/:runId
// Get current pipeline run status
app.get('/api/pipeline/status/:runId', (req, res) => {
  const { runId } = req.params;
  const db = getDb();
  try {
    const run = db.prepare('SELECT * FROM daily_runs WHERE run_id = ?').get(runId);
    if (!run) {
      return res.json({
        run_id: runId,
        status: 'not_started',
        message: 'Run not found in database yet'
      });
    }

    res.json({
      run_id: run.run_id,
      status: run.status || 'running',
      brands_processed: run.brands_processed,
      orders_attempted: run.orders_attempted || 0,
      orders_succeeded: run.orders_succeeded || 0,
      orders_failed: run.orders_failed || 0,
      orders_skipped: run.orders_skipped || 0,
      started_at: run.started_at,
      completed_at: run.completed_at,
    });
  } finally {
    db.close();
  }
});

// GET /api/pipeline/sse
// Server-Sent Events endpoint for live pipeline progress
app.get('/api/pipeline/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const clientId = Date.now();
  sseClients.set(clientId, res);

  // Keepalive every 15s to prevent Railway proxy timeout
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(clientId);
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', client_id: clientId, timestamp: new Date().toISOString() })}\n\n`);
});

// GET /api/pipeline/history
// Get pipeline run history
app.get('/api/pipeline/history', (req, res) => {
  const db = getDb();
  try {
    const { limit = 20 } = req.query;
    const runs = db.prepare(
      'SELECT * FROM daily_runs ORDER BY started_at DESC LIMIT ?'
    ).all(parseInt(limit, 10) || 20);

    res.json({ runs });
  } finally {
    db.close();
  }
});

// GET /api/video/:orderId/:brand
// Get video files and metadata for an order
app.get('/api/video/:orderId/:brand', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const exportsDir = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'exports');
    let videos = [];
    
    if (fs.existsSync(exportsDir)) {
      const files = fs.readdirSync(exportsDir);
      videos = files.filter(f => /\.(mp4|mov|webm|avi)$/i.test(f)).map(filename => {
        const filePath = path.join(exportsDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          path: `/api/video/file/${brand}/${orderId}/${encodeURIComponent(filename)}`,
          size: stats.size,
          created_at: stats.mtime.toISOString(),
          type: filename.includes('ugc') ? 'ugc' : 'reel',
        };
      });
    }

    // Check Drive upload status
    const isUploaded = order.production_status === 'uploaded' && order.drive_url;

    res.json({
      order_id: orderId,
      brand,
      videos,
      drive_uploaded: isUploaded,
      drive_url: order.drive_url || null,
    });
  } finally {
    db.close();
  }
});

// GET /api/video/file/:brand/:orderId/:filename
// Stream video file
app.get('/api/video/file/:brand/:orderId/:filename', (req, res) => {
  const { brand, orderId, filename } = req.params;
  const filePath = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'exports', decodeURIComponent(filename));
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Length', stat.size);
  
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// POST /api/video/:orderId/:brand/approve
// Approve video for Drive upload
app.post('/api/video/:orderId/:brand/approve', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const { video_type } = req.body; // 'ugc' or 'reel'
    
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Update production status to trigger upload
    db.prepare(
      "UPDATE orders SET production_status = 'pending_upload', updated_at = datetime('now') WHERE order_id = ? AND brand = ?"
    ).run(orderId, brand);

    // Log the approval
    db.prepare(
      'INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)'
    ).run(orderId, brand, 'video_approved', `Approved ${video_type || 'video'} for Drive upload`);

    res.json({ 
      success: true, 
      message: 'Video approved for Drive upload',
      next_step: 'Run pipeline or manually upload to Drive'
    });
  } finally {
    db.close();
  }
});

// POST /api/video/:orderId/:brand/reject
// Reject video (mark as failed, skip Drive upload)
app.post('/api/video/:orderId/:brand/reject', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const { reason } = req.body;
    
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Update production status to failed
    db.prepare(
      "UPDATE orders SET production_status = 'failed', updated_at = datetime('now') WHERE order_id = ? AND brand = ?"
    ).run(orderId, brand);

    // Log the rejection
    db.prepare(
      'INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)'
    ).run(orderId, brand, 'video_rejected', reason || 'Video rejected from dashboard');

    res.json({ 
      success: true, 
      message: 'Video rejected',
      status: 'Order marked as failed - will not be uploaded to Drive'
    });
  } finally {
    db.close();
  }
});

// GET /api/social-copy/:orderId/:brand
// Get generated social copy for all platforms
app.get('/api/social-copy/:orderId/:brand', (req, res) => {
  const db = getDb();
  try {
    const { orderId, brand } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Load brand config
    const brandConfigPath = path.join(PIPELINE_ROOT, 'brands', `${brand}.json`);
    if (!fs.existsSync(brandConfigPath)) {
      return res.status(400).json({ error: `Brand config not found: ${brand}` });
    }
    
    const brandConfig = JSON.parse(fs.readFileSync(brandConfigPath, 'utf8'));
    
    // Generate copy
    const socialCopyLib = require(path.join(PIPELINE_ROOT, 'lib', 'social-copy'));
    const copy = socialCopyLib.generateCopy(order, brandConfig);
    
    // Check for existing copy files
    const exportsDir = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'exports');
    let existingFiles = [];
    if (fs.existsSync(exportsDir)) {
      existingFiles = fs.readdirSync(exportsDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    }

    res.json({
      order_id: orderId,
      brand,
      copy,
      existing_files: existingFiles,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Social copy generation error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    db.close();
  }
});

// SSE client management for live updates
const sseClients = new Map();

function broadcastPipelineUpdate(runId, data) {
  const payload = JSON.stringify({ run_id: runId, ...data });
  sseClients.forEach((res, clientId) => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(clientId);
    }
  });
}

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
  .panel-illustration-wrap { display: flex; flex-direction: column; gap: 0.5rem; }
  .panel-illustration-img {
    width: 100%;
    max-height: 260px;
    object-fit: contain;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: zoom-in;
  }
  .panel-illustration-fallback {
    display: none;
    color: var(--text-dim);
    font-size: 0.82rem;
  }

  /* ── Phase 6: Card action buttons ── */
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
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-approve { background: rgba(16,185,129,0.2); color: #10b981; }
  .btn-approve:hover { background: rgba(16,185,129,0.35); }
  .btn-reject  { background: rgba(239,68,68,0.2);  color: #ef4444; }
  .btn-reject:hover  { background: rgba(239,68,68,0.35); }

  /* ── Phase 6: Lane header CTA buttons ── */
  .btn-batch-approve {
    padding: 0.2rem 0.6rem;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgba(99,102,241,0.2);
    color: #a5b4fc;
    border: 1px solid rgba(99,102,241,0.4);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-batch-approve:hover { background: rgba(99,102,241,0.35); }
  .btn-send-consent {
    padding: 0.2rem 0.6rem;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgba(245,158,11,0.2);
    color: #fbbf24;
    border: 1px solid rgba(245,158,11,0.4);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-send-consent:hover { background: rgba(245,158,11,0.35); }
  .btn-send-consent:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Phase 6: Lightbox overlay ── */
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 300;
    display: none;
    cursor: pointer;
  }
  .lightbox-backdrop.open { display: block; }
  .lightbox {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 301;
    display: none;
  }
  .lightbox.open { display: block; }
  .lightbox-img {
    max-width: 90vw;
    max-height: 85vh;
    object-fit: contain;
    border-radius: 4px;
    display: block;
  }
  .lightbox-close {
    position: absolute;
    top: -2.25rem;
    right: 0;
    background: none;
    border: none;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.25rem;
  }

  /* ── Phase 6: Toast notifications ── */
  #toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 400;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }
  .toast {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.65rem 1rem;
    font-size: 0.85rem;
    color: var(--text);
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    max-width: 300px;
    animation: toastIn 0.2s ease;
    pointer-events: auto;
  }
  .toast-success { border-left: 3px solid var(--success); }
  .toast-error   { border-left: 3px solid var(--danger); }
  @keyframes toastIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Loading/error states */
  .board-loading { padding: 3rem; text-align: center; color: var(--text-dim); font-size: 0.9rem; }

  /* ── Phase 7: Pipeline control panel ── */
  .pipeline-control-panel {
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    z-index: 150;
    min-width: 280px;
    max-width: 400px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .pipeline-control-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .pipeline-control-title {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text);
  }
  .btn-run-pipeline {
    background: rgba(16,185,129,0.2);
    color: #10b981;
    border: 1px solid rgba(16,185,129,0.4);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .btn-run-pipeline:hover { background: rgba(16,185,129,0.35); }
  .btn-run-pipeline:disabled { opacity: 0.5; cursor: not-allowed; }
  .pipeline-status {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin-bottom: 0.5rem;
  }
  .pipeline-status.running { color: var(--warning); }
  .pipeline-status.complete { color: var(--success); }
  .pipeline-status.failed { color: var(--danger); }
  .pipeline-log {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
    font-family: 'Monaco', 'Consolas', monospace;
    font-size: 0.7rem;
    line-height: 1.4;
  }
  .pipeline-log-line { margin: 0.15rem 0; }
  .pipeline-log-line.error { color: var(--danger); }
  .pipeline-log-line.info { color: var(--text-dim); }
  .pipeline-log-line.success { color: var(--success); }

  /* ── Phase 7: Run history panel ── */
  .run-history-panel {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    z-index: 150;
    min-width: 320px;
    max-width: 450px;
    max-height: 400px;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .run-history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .run-history-title {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text);
  }
  .btn-toggle-history {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn-toggle-history:hover { background: var(--bg-card-hover); color: var(--text); }
  .run-history-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .run-history-item {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .run-history-item:hover { border-color: var(--accent); }
  .run-history-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  .run-history-id {
    font-family: monospace;
    font-weight: 600;
    color: var(--accent-hover);
  }
  .run-history-status {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .run-history-status.complete { background: rgba(16,185,129,0.2); color: #10b981; }
  .run-history-status.running { background: rgba(245,158,11,0.2); color: #f59e0b; }
  .run-history-status.failed { background: rgba(239,68,68,0.2); color: #ef4444; }
  .run-history-stats {
    display: flex;
    gap: 0.75rem;
    color: var(--text-dim);
    font-size: 0.7rem;
  }
  .run-history-stat { display: flex; flex-direction: column; }
  .run-history-stat-value { font-weight: 600; color: var(--text); }

  /* ── Phase 7: Consent resend button in panel ── */
  .btn-resend-consent {
    background: rgba(59,130,246,0.2);
    color: #3b82f6;
    border: 1px solid rgba(59,130,246,0.4);
    border-radius: 4px;
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    margin-top: 0.5rem;
    width: 100%;
  }
  .btn-resend-consent:hover { background: rgba(59,130,246,0.35); }
  .btn-resend-consent:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Phase 7: Consent status detail in panel ── */
  .consent-timeline {
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    max-height: 150px;
    overflow-y: auto;
  }
  .consent-timeline-item {
    display: flex;
    gap: 0.5rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem;
  }
  .consent-timeline-item:last-child { border-bottom: none; }
  .consent-timeline-time {
    color: var(--text-dim);
    font-size: 0.7rem;
    min-width: 120px;
  }
  .consent-timeline-action {
    color: var(--text);
    font-weight: 500;
  }
  .consent-timeline-details {
    color: var(--text-dim);
    font-size: 0.7rem;
  }

  /* ── Phase 8: Video player ── */
  .video-player-container {
    margin-top: 1rem;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    width: 100%;
    max-width: 100%;
  }
  .video-player {
    width: 100%;
    max-height: 500px;
    display: block;
  }
  .video-placeholder {
    width: 100%;
    height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
    color: var(--text-dim);
    font-size: 0.9rem;
  }
  .video-type-selector {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .btn-video-type {
    flex: 1;
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    font-weight: 600;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-video-type:hover { border-color: var(--accent); color: var(--text); }
  .btn-video-type.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .video-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .btn-approve-video, .btn-reject-video {
    flex: 1;
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-approve-video {
    background: rgba(16,185,129,0.2);
    color: #10b981;
  }
  .btn-approve-video:hover { background: rgba(16,185,129,0.35); }
  .btn-approve-video:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-reject-video {
    background: rgba(239,68,68,0.2);
    color: #ef4444;
  }
  .btn-reject-video:hover { background: rgba(239,68,68,0.35); }
  .btn-reject-video:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Phase 8: Social copy panel ── */
  .social-copy-panel {
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .social-copy-tabs {
    display: flex;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .social-copy-tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s;
  }
  .social-copy-tab:hover { color: var(--text); background: var(--bg-card-hover); }
  .social-copy-tab.active {
    color: var(--accent-hover);
    border-bottom-color: var(--accent);
    background: var(--bg-card);
  }
  .social-copy-content {
    padding: 1rem;
    background: var(--bg-card);
    max-height: 400px;
    overflow-y: auto;
  }
  .social-copy-section {
    margin-bottom: 1rem;
  }
  .social-copy-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.35rem;
  }
  .social-copy-text {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.5rem;
    font-size: 0.8rem;
    font-family: 'Monaco', 'Consolas', monospace;
    line-height: 1.4;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .btn-copy-clipboard {
    margin-top: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgba(59,130,246,0.2);
    color: #3b82f6;
    border: 1px solid rgba(59,130,246,0.4);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-copy-clipboard:hover { background: rgba(59,130,246,0.35); }
  .hashtags {
    color: var(--info);
    font-size: 0.75rem;
    margin-top: 0.35rem;
  }
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

<!-- Phase 6: Lightbox overlay -->
<div class="lightbox-backdrop" id="lightbox-backdrop"></div>
<div class="lightbox" id="lightbox">
  <button class="lightbox-close" id="lightbox-close" title="Close (Esc)">&#x2715;</button>
  <img class="lightbox-img" id="lightbox-img" src="" alt="Illustration preview">
</div>

<!-- Phase 6: Toast container -->
<div id="toast-container"></div>

<!-- Phase 7: Pipeline control panel -->
<div class="pipeline-control-panel" id="pipeline-control-panel">
  <div class="pipeline-control-header">
    <span class="pipeline-control-title">Pipeline Control</span>
    <button class="btn-run-pipeline" id="btn-run-pipeline">Run Pipeline</button>
  </div>
  <div class="pipeline-status" id="pipeline-status">Status: Idle</div>
  <div class="pipeline-log" id="pipeline-log"></div>
</div>

<!-- Phase 7: Run history panel -->
<div class="run-history-panel" id="run-history-panel">
  <div class="run-history-header">
    <span class="run-history-title">Run History</span>
    <button class="btn-toggle-history" id="btn-toggle-history" title="Toggle history">−</button>
  </div>
  <div class="run-history-list" id="run-history-list">
    <div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:1rem;">Loading...</div>
  </div>
</div>

<script>
// Pipeline control
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
  var showPlay = laneId === 'video_built' || laneId === 'uploaded';
  var score = order.computed_score || order.score || 0;

  var rawUrl = order.oms_url || order.illustration_url || order.photos_url || '';
  var illustrationUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
  var thumbHtml = illustrationUrl
    ? '<img class="card-thumbnail" src="' + esc(illustrationUrl) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
    : '<div class="card-thumb-placeholder">&#128444;</div>';

  var brandDisplay = esc(order.brand || '-');
  var customerDisplay = esc(order.description ? order.description.split(' ')[0] : '-');
  var dateDisplay = esc(fmtDate(order.updated_at || order.created_at));
  var playIcon = showPlay ? '<span class="card-play">[play]</span>' : '';
  var actionsHtml = laneId === 'candidates'
    ? '<div class="card-actions">' +
      '<button class="btn-approve" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '">&#x2713; Approve</button>' +
      '<button class="btn-reject" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '">&#x2715; Reject</button>' +
      '</div>'
    : '';

  return '<div class="order-card" data-order-id="' + esc(order.order_id) + '" data-brand="' + esc(order.brand) + '">' +
    '<div class="card-top">' +
    thumbHtml +
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
    actionsHtml +
    '</div>';
}

function renderBoard(data) {
  var board = document.getElementById('kanban-board');
  board.innerHTML = LANES.map(function(lane) {
    var laneData = (data.lanes && data.lanes[lane.id]) ? data.lanes[lane.id] : { orders: [], count: 0 };
    var cards = laneData.orders.length > 0
      ? laneData.orders.map(function(o) { return renderCard(o, lane.id); }).join('')
      : '<div class="lane-empty">No orders here yet</div>';
    // Phase 6: Lane-specific CTA buttons
    var laneHeaderCta = '';
    if (lane.id === 'candidates' && laneData.count > 0) {
      var candidateRefs = JSON.stringify(laneData.orders.map(function(o) {
        return { order_id: o.order_id, brand: o.brand };
      })).replace(/'/g, '&#39;');
      laneHeaderCta = '<button class="btn-batch-approve" data-refs=\\'' + candidateRefs + '\\' data-count="' + laneData.count + '">Approve All (' + laneData.count + ')</button>';
    }
    if (lane.id === 'consent_pending' && laneData.count > 0) {
      laneHeaderCta = '<button class="btn-send-consent" data-count="' + laneData.count + '">Send Consent Emails</button>';
    }

    return '<div class="lane" data-lane="' + lane.id + '" style="--lane-accent:' + lane.accent + '">' +
      '<div class="lane-header">' +
      '<span class="lane-title">' + esc(lane.label) + '</span>' +
      '<span class="lane-badge">' + laneData.count + '</span>' +
      (laneHeaderCta ? '<div style="display:flex;justify-content:flex-end;flex:1;padding-left:0.4rem">' + laneHeaderCta + '</div>' : '') +
      '</div>' +
      '<div class="lane-body">' + cards + '</div>' +
      '</div>';
  }).join('');

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

// ── Phase 6: Toast notifications ──
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

// ── Phase 6: Lightbox ──
function openLightbox(src) {
  if (!src) return;
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
  document.getElementById('lightbox-backdrop').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-backdrop').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
}

// ── Phase 6: Approve single order ──
function approveOrder(orderId, brand) {
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ production_status: 'approved' })
  })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.success) {
        showToast('Approved \u2014 moving to Consent Pending', 'success');
        fetchBoard();
      } else {
        showToast('Error approving order', 'error');
      }
    })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

// ── Phase 6: Reject single order ──
function rejectOrder(orderId, brand) {
  fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ production_status: 'rejected' })
  })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.success) {
        showToast('Rejected and removed from candidates', 'success');
        fetchBoard();
      } else {
        showToast('Error rejecting order', 'error');
      }
    })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

// ── Phase 6: Batch approve all candidates ──
function batchApproveAll(orders, count) {
  if (!confirm('Approve ' + count + ' candidates? This will queue them for consent emails.')) return;
  fetch('/api/batch/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders: orders, production_status: 'approved' })
  })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.success) {
        showToast(data.updated + ' orders approved', 'success');
        fetchBoard();
      } else {
        showToast('Error in batch approve', 'error');
      }
    })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

// ── Phase 6: Send consent email batch ──
function sendConsentBatch(btn, count) {
  if (!confirm('Send consent emails to ' + count + ' customers? This cannot be undone.')) return;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  fetch('/api/consent/send-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.success) {
        var msg = data.sent > 0
          ? 'Consent emails sent to ' + data.sent + ' customers'
          : 'No eligible orders found (check consent/production status)';
        showToast(msg, 'success');
        if (data.failed > 0) showToast(data.failed + ' emails failed to send', 'error');
        fetchBoard();
      } else {
        showToast('Error sending consent emails', 'error');
      }
    })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); })
    .finally(function() {
      btn.disabled = false;
      btn.textContent = 'Send Consent Emails';
    });
}

// Event listeners
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('slide-backdrop').addEventListener('click', closePanel);

// Phase 6: Lightbox event listeners
document.getElementById('lightbox-backdrop').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeLightbox();
    closePanel();
  }
});

// Phase 6: Unified board event delegation
// Handles: approve buttons, reject buttons, thumbnail lightbox, batch approve, send consent, card open
document.getElementById('kanban-board').addEventListener('click', function(e) {
  // Approve button — must check before card-click fallthrough
  var approveBtn = e.target.closest('.btn-approve');
  if (approveBtn) {
    e.stopPropagation();
    approveOrder(approveBtn.dataset.orderId, approveBtn.dataset.brand);
    return;
  }
  // Reject button
  var rejectBtn = e.target.closest('.btn-reject');
  if (rejectBtn) {
    e.stopPropagation();
    rejectOrder(rejectBtn.dataset.orderId, rejectBtn.dataset.brand);
    return;
  }
  // Thumbnail click → lightbox (not panel open)
  var thumb = e.target.closest('.card-thumbnail');
  if (thumb && thumb.src && thumb.src.indexOf('http') === 0) {
    e.stopPropagation();
    openLightbox(thumb.src);
    return;
  }
  // Batch approve button in Candidates lane header
  var batchBtn = e.target.closest('.btn-batch-approve');
  if (batchBtn) {
    try {
      var refs = JSON.parse(batchBtn.dataset.refs || '[]');
      var count = parseInt(batchBtn.dataset.count, 10) || 0;
      batchApproveAll(refs, count);
    } catch(_) { showToast('Error reading candidate list', 'error'); }
    return;
  }
  // Send consent emails button in Consent Pending lane header
  var sendBtn = e.target.closest('.btn-send-consent');
  if (sendBtn) {
    var sendCount = parseInt(sendBtn.dataset.count, 10) || 0;
    sendConsentBatch(sendBtn, sendCount);
    return;
  }
  // Card click → open detail panel (fallback)
  var card = e.target.closest('.order-card');
  if (card) {
    openPanel(card.dataset.orderId, card.dataset.brand);
  }
});

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
fetchBrands();
fetchBoard();
fetchRunHistory();

// Polling every 30s (skip if tab hidden)
state.pollTimer = setInterval(function() {
  if (!document.hidden) fetchBoard();
}, 30000);
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) fetchBoard();
});

// =============================================================================
// Phase 7: Pipeline Control & Consent Tracking
// =============================================================================

// Pipeline SSE connection
var pipelineSse = null;
var pipelineState = {
  running: false,
  currentRunId: null,
  logLines: [],
};

// Connect to SSE stream for live updates
function connectPipelineSSE() {
  if (pipelineSse) return;

  pipelineSse = new EventSource('/api/pipeline/sse');
  
  pipelineSse.addEventListener('message', function(e) {
    try {
      var data = JSON.parse(e.data);
      handlePipelineUpdate(data);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  });
  
  pipelineSse.addEventListener('error', function(e) {
    console.log('SSE connection error, reconnecting...');
    pipelineSse.close();
    pipelineSse = null;
    setTimeout(connectPipelineSSE, 3000);
  });
  
  console.log('Connected to pipeline SSE stream');
}

function handlePipelineUpdate(data) {
  if (data.type === 'connected') {
    console.log('SSE connected, client ID:', data.client_id);
    return;
  }
  
  if (data.run_id !== pipelineState.currentRunId) return;
  
  // Add log line
  if (data.type === 'log') {
    addPipelineLog(data.level, data.message);
  }
  
  // Update status
  if (data.type === 'complete') {
    pipelineState.running = false;
    updatePipelineStatus('Complete (Exit: ' + data.exit_code + ')', 'complete');
    document.getElementById('btn-run-pipeline').disabled = false;
    fetchRunHistory(); // Refresh history
  }
  
  if (data.type === 'error') {
    addPipelineLog('error', data.message);
  }
}

function addPipelineLog(level, message) {
  var log = document.getElementById('pipeline-log');
  if (!log) return;
  
  var line = document.createElement('div');
  line.className = 'pipeline-log-line ' + (level === 'error' ? 'error' : 'info');
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  
  // Keep only last 100 lines
  while (log.children.length > 100) {
    log.removeChild(log.firstChild);
  }
}

function updatePipelineStatus(text, statusClass) {
  var status = document.getElementById('pipeline-status');
  if (!status) return;
  
  status.textContent = 'Status: ' + text;
  status.className = 'pipeline-status ' + (statusClass || '');
}

// Run pipeline
function runPipeline() {
  var btn = document.getElementById('btn-run-pipeline');
  if (!btn || btn.disabled) return;
  
  if (!confirm('Start the daily pipeline run? This will process all consent-approved orders.')) return;
  
  btn.disabled = true;
  btn.textContent = 'Running...';
  
  // Clear previous log
  var log = document.getElementById('pipeline-log');
  if (log) log.innerHTML = '';
  
  fetch('/api/pipeline/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function(data) {
    if (data.success) {
      pipelineState.running = true;
      pipelineState.currentRunId = data.run_id;
      updatePipelineStatus('Running...', 'running');
      addPipelineLog('info', 'Pipeline started with run ID: ' + data.run_id);
      connectPipelineSSE();
    } else {
      throw new Error(data.error || 'Failed to start pipeline');
    }
  })
  .catch(function(err) {
    console.error('Pipeline start error:', err);
    addPipelineLog('error', 'Failed to start: ' + err.message);
    updatePipelineStatus('Failed to start', 'failed');
    btn.disabled = false;
    btn.textContent = 'Run Pipeline';
  });
}

// Fetch run history
function fetchRunHistory() {
  fetch('/api/pipeline/history')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      renderRunHistory(data.runs || []);
    })
    .catch(function(err) {
      console.error('Run history fetch error:', err);
    });
}

function renderRunHistory(runs) {
  var list = document.getElementById('run-history-list');
  if (!list) return;
  
  if (runs.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:1rem;">No runs yet</div>';
    return;
  }
  
  list.innerHTML = runs.map(function(run) {
    var statusClass = (run.status || 'complete').toLowerCase();
    var started = run.started_at ? fmtDate(run.started_at) : '-';
    var duration = run.completed_at && run.started_at
      ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000) + 's'
      : '-';
    
    return '<div class="run-history-item" data-run-id="' + esc(run.run_id) + '">' +
      '<div class="run-history-item-header">' +
        '<span class="run-history-id">' + esc(run.run_id) + '</span>' +
        '<span class="run-history-status ' + esc(statusClass) + '">' + esc(statusClass) + '</span>' +
      '</div>' +
      '<div class="run-history-stats">' +
        '<span class="run-history-stat">' +
          '<span class="run-history-stat-value">' + (run.orders_succeeded || 0) + '</span>' +
          '<span>Success</span>' +
        '</span>' +
        '<span class="run-history-stat">' +
          '<span class="run-history-stat-value">' + (run.orders_failed || 0) + '</span>' +
          '<span>Failed</span>' +
        '</span>' +
        '<span class="run-history-stat">' +
          '<span class="run-history-stat-value">' + duration + '</span>' +
          '<span>Duration</span>' +
        '</span>' +
        '<span class="run-history-stat">' +
          '<span class="run-history-stat-value">' + started + '</span>' +
          '<span>Started</span>' +
        '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

// Toggle run history panel
function toggleRunHistory() {
  var panel = document.getElementById('run-history-panel');
  var list = document.getElementById('run-history-list');
  var btn = document.getElementById('btn-toggle-history');
  
  if (!panel || !list || !btn) return;
  
  if (list.style.display === 'none') {
    list.style.display = 'flex';
    btn.textContent = '−';
  } else {
    list.style.display = 'none';
    btn.textContent = '+';
  }
}

// Resend consent email from panel
function resendConsentEmail(orderId, brand) {
  if (!confirm('Resend consent email to order #' + orderId + '?')) return;
  
  fetch('/api/consent/resend/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand), {
    method: 'POST'
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function(data) {
    if (data.success) {
      showToast('Consent email resent', 'success');
    } else {
      throw new Error(data.error || 'Failed to resend');
    }
  })
  .catch(function(err) {
    showToast('Error: ' + err.message, 'error');
  });
}

// Enhanced panel rendering with consent timeline (Phase 7)
function renderPanelContent(data) {
  var order = data.order || {};
  var consentLog = data.consentLog || [];
  var b = order.score_breakdown || {};
  var illustrationUrl = order.oms_url || order.illustration_url || '';

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

  // Phase 7: Enhanced consent section with timeline
  var consentSection = '<table class="detail-table"><tr><td>Status</td><td>' + consentBadge(order.consent_status) + '</td></tr>';
  if (consentLog && consentLog.length > 0) {
    consentSection += '<tr><td>Last Action</td><td>' + esc(consentLog[0].action) + '</td></tr>' +
      '<tr><td>When</td><td>' + fmtDate(consentLog[0].timestamp) + '</td></tr>';
    if (consentLog[0].details) {
      consentSection += '<tr><td>Details</td><td>' + esc(consentLog[0].details) + '</td></tr>';
    }
  }
  consentSection += '</table>';
  
  // Phase 7: Consent timeline
  if (consentLog && consentLog.length > 0) {
    consentSection += '<div class="consent-timeline">';
    consentSection += '<div style="font-size:0.7rem;font-weight:600;color:var(--text-dim);margin-bottom:0.35rem;">CONSENT HISTORY</div>';
    consentLog.forEach(function(entry) {
      consentSection += '<div class="consent-timeline-item">' +
        '<span class="consent-timeline-time">' + fmtDate(entry.timestamp) + '</span>' +
        '<span class="consent-timeline-action">' + esc(entry.action) + '</span>' +
        (entry.details ? '<span class="consent-timeline-details"> — ' + esc(entry.details) + '</span>' : '') +
        '</div>';
    });
    consentSection += '</div>';
  }
  
  // Phase 7: Resend button for pending/declined
  var resendButton = '';
  if ((order.consent_status === 'pending' || order.consent_status === 'denied') && order.customer_email) {
    resendButton = '<button class="btn-resend-consent" onclick="resendConsentEmail(&#39;' +
      esc(order.order_id) + '&#39;,&#39;' + esc(order.brand) + '&#39;)">Resend Consent Email</button>';
  }

  var driveSection = order.drive_url
    ? '<p>' + uploadStatusBadge(order) + '</p>' +
      '<a class="drive-link" href="' + esc(order.drive_url) + '" target="_blank" rel="noopener noreferrer">Open in Drive</a>'
    : '<p>' + uploadStatusBadge(order) + '</p><p style="color:var(--text-dim);font-size:0.82rem">No Drive folder yet</p>';
  var illustrationSection = illustrationUrl
    ? '<div class="panel-illustration-wrap">' +
      '<img class="panel-illustration-img" src="' + esc(illustrationUrl) + '" alt="Illustration for order ' + esc(order.order_id || '') + '" loading="lazy" onclick="openLightbox(this.src)" onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'block\\';">' +
      '<div class="panel-illustration-fallback">Preview unavailable for this URL.</div>' +
      '<a class="drive-link" href="' + esc(illustrationUrl) + '" target="_blank" rel="noopener noreferrer">Open Illustration URL</a>' +
      '</div>'
    : '<p style="color:var(--text-dim);font-size:0.82rem">No illustration URL found for this order.</p>';

  // Phase 8: Video player section placeholder (populated asynchronously)
  var videoSection = '<div id="video-player-section">' +
    '<div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:2rem;">Loading video...</div>' +
    '</div>';

  // Phase 8: Social copy section placeholder (populated asynchronously)
  var socialCopySection = '<div id="social-copy-section">' +
    '<div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:2rem;">Loading social copy...</div>' +
    '</div>';

  document.getElementById('panel-title').textContent = 'Order #' + (order.order_id || '');
  document.getElementById('panel-body').innerHTML =
    '<div class="panel-section">' +
    '<div class="panel-section-title">Order Info</div>' +
    '<table class="detail-table">' +
    orderInfoRows.map(function(row) { return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>'; }).join('') +
    '</table>' +
    resendButton +
    '</div>' +

    '<div class="panel-section">' +
    '<div class="panel-section-title">Illustration</div>' +
    illustrationSection +
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
    '</div>' +

    // Phase 8: Video player section
    '<div class="panel-section" id="video-section">' +
    '<div class="panel-section-title">Video Preview</div>' +
    videoSection +
    '</div>' +

    // Phase 8: Social copy section
    '<div class="panel-section" id="social-copy-section-wrapper">' +
    '<div class="panel-section-title">Social Copy</div>' +
    socialCopySection +
    '</div>';

  // Phase 8: Load video and social copy asynchronously
  loadVideoPlayer(order.order_id, order.brand);
  loadSocialCopy(order.order_id, order.brand);
}

// =============================================================================
// Phase 8: Video Player & Social Copy Functions
// =============================================================================

// Video player state
var videoState = {
  currentOrderId: null,
  currentBrand: null,
  videos: [],
  currentType: null, // 'ugc' or 'reel'
};

// Load video player
function loadVideoPlayer(orderId, brand) {
  videoState.currentOrderId = orderId;
  videoState.currentBrand = brand;
  
  fetch('/api/video/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      videoState.videos = data.videos || [];
      renderVideoPlayer(data);
    })
    .catch(function(err) {
      console.error('Video fetch error:', err);
      document.getElementById('video-player-section').innerHTML =
        '<div style="color:var(--danger);font-size:0.75rem;text-align:center;padding:2rem;">Failed to load videos</div>';
    });
}

// Render video player UI
function renderVideoPlayer(data) {
  var container = document.getElementById('video-player-section');
  if (!container) return;
  
  var videos = data.videos || [];
  var isUploaded = data.drive_uploaded;
  var driveUrl = data.drive_url;
  
  if (videos.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:2rem;">' +
      '<p>No videos available yet</p>' +
      '<p style="margin-top:0.5rem">Videos will appear after pipeline run completes</p>' +
      '</div>';
    return;
  }
  
  // Determine initial video type
  var hasUgc = videos.some(function(v) { return v.type === 'ugc'; });
  var hasReel = videos.some(function(v) { return v.type === 'reel'; });
  videoState.currentType = hasUgc ? 'ugc' : (hasReel ? 'reel' : null);
  
  // Build video type selector
  var typeSelector = '';
  if (hasUgc || hasReel) {
    typeSelector = '<div class="video-type-selector">';
    if (hasUgc) {
      typeSelector += '<button class="btn-video-type' + (videoState.currentType === 'ugc' ? ' active' : '') + '" data-type="ugc">UGC Reel</button>';
    }
    if (hasReel) {
      typeSelector += '<button class="btn-video-type' + (videoState.currentType === 'reel' ? ' active' : '') + '" data-type="reel">Standard Reel</button>';
    }
    typeSelector += '</div>';
  }
  
  // Find current video
  var currentVideo = videos.find(function(v) { return v.type === videoState.currentType; });
  
  // Video player
  var playerHtml = '<div class="video-player-container">';
  if (currentVideo) {
    playerHtml += '<video class="video-player" controls preload="metadata">' +
      '<source src="' + esc(currentVideo.path) + '" type="video/mp4">' +
      'Your browser does not support the video tag.' +
      '</video>';
  } else {
    playerHtml += '<div class="video-placeholder">No video available</div>';
  }
  playerHtml += '</div>';
  
  // Video metadata
  var metaHtml = '';
  if (currentVideo) {
    var sizeKb = Math.round(currentVideo.size / 1024);
    var created = fmtDate(currentVideo.created_at);
    metaHtml = '<div style="margin-top:0.5rem;font-size:0.7rem;color:var(--text-dim);">' +
      '<strong>File:</strong> ' + esc(currentVideo.filename) + ' | ' +
      '<strong>Size:</strong> ' + sizeKb + ' KB | ' +
      '<strong>Created:</strong> ' + created +
      '</div>';
  }
  
  // Upload status and actions
  var actionsHtml = '';
  if (isUploaded) {
    actionsHtml = '<div style="margin-top:0.75rem;padding:0.5rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:4px;">' +
      '<span style="color:var(--success);font-size:0.75rem;font-weight:600;">✓ Uploaded to Drive</span>' +
      (driveUrl ? '<br><a href="' + esc(driveUrl) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-size:0.7rem;">Open in Drive</a>' : '') +
      '</div>';
  } else {
    actionsHtml = '<div class="video-actions">' +
      '<button class="btn-approve-video" onclick="approveVideo(&#39;' + esc(orderId) + '&#39;,&#39;' + esc(brand) + '&#39;)">&#x2713; Approve for Drive Upload</button>' +
      '<button class="btn-reject-video" onclick="rejectVideo(&#39;' + esc(orderId) + '&#39;,&#39;' + esc(brand) + '&#39;)">&#x2715; Reject Video</button>' +
      '</div>';
  }
  
  container.innerHTML = typeSelector + playerHtml + metaHtml + actionsHtml;
  
  // Add event listeners for type selector
  var typeBtns = container.querySelectorAll('.btn-video-type');
  typeBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var newType = btn.dataset.type;
      if (newType !== videoState.currentType) {
        videoState.currentType = newType;
        renderVideoPlayer(data); // Re-render with new type
      }
    });
  });
}

// Approve video for Drive upload
function approveVideo(orderId, brand) {
  if (!confirm('Approve this video for Drive upload? This will mark it as ready for upload.')) return;
  
  fetch('/api/video/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_type: videoState.currentType })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      showToast('Video approved for Drive upload', 'success');
      // Reload panel to show updated status
      openPanel(orderId, brand);
    } else {
      throw new Error(data.error || 'Failed to approve video');
    }
  })
  .catch(function(err) {
    showToast('Error: ' + err.message, 'error');
  });
}

// Reject video
function rejectVideo(orderId, brand) {
  var reason = prompt('Please provide a reason for rejecting this video (optional):');
  if (reason === null) return; // User cancelled
  
  fetch('/api/video/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand) + '/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || 'No reason provided' })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) {
      showToast('Video rejected - order marked as failed', 'success');
      // Reload panel to show updated status
      openPanel(orderId, brand);
    } else {
      throw new Error(data.error || 'Failed to reject video');
    }
  })
  .catch(function(err) {
    showToast('Error: ' + err.message, 'error');
  });
}

// Social copy state
var socialCopyState = {
  currentOrderId: null,
  currentBrand: null,
  copy: null,
  currentPlatform: null,
};

// Load social copy
function loadSocialCopy(orderId, brand) {
  socialCopyState.currentOrderId = orderId;
  socialCopyState.currentBrand = brand;
  
  fetch('/api/social-copy/' + encodeURIComponent(orderId) + '/' + encodeURIComponent(brand))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      socialCopyState.copy = data.copy;
      renderSocialCopy(data);
    })
    .catch(function(err) {
      console.error('Social copy fetch error:', err);
      document.getElementById('social-copy-section').innerHTML =
        '<div style="color:var(--danger);font-size:0.75rem;text-align:center;padding:2rem;">Failed to load social copy</div>';
    });
}

// Render social copy panel
function renderSocialCopy(data) {
  var container = document.getElementById('social-copy-section');
  if (!container) return;
  
  var copy = data.copy;
  if (!copy) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;text-align:center;padding:2rem;">No social copy available</div>';
    return;
  }
  
  // Set initial platform
  socialCopyState.currentPlatform = 'youtube';
  
  // Build tabs
  var tabs = '<div class="social-copy-tabs">' +
    '<button class="social-copy-tab active" data-platform="youtube">YouTube</button>' +
    '<button class="social-copy-tab" data-platform="tiktok">TikTok</button>' +
    '<button class="social-copy-tab" data-platform="instagram">Instagram</button>' +
    '<button class="social-copy-tab" data-platform="x">X / Twitter</button>' +
    '</div>';
  
  // Build content
  var content = '<div class="social-copy-content" id="social-copy-content">' +
    renderPlatformCopy('youtube', copy) +
    '</div>';
  
  container.innerHTML = tabs + content;
  
  // Add event listeners for tabs
  var tabBtns = container.querySelectorAll('.social-copy-tab');
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var platform = btn.dataset.platform;
      socialCopyState.currentPlatform = platform;
      
      // Update active tab
      tabBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      
      // Render content
      var contentContainer = document.getElementById('social-copy-content');
      if (contentContainer) {
        contentContainer.innerHTML = renderPlatformCopy(platform, copy);
      }
    });
  });
}

// Render copy for a specific platform
function renderPlatformCopy(platform, copy) {
  var platformCopy = copy[platform];
  if (!platformCopy) return '<div style="color:var(--text-dim);padding:1rem;">No copy for this platform</div>';
  
  var html = '';
  
  if (platform === 'youtube') {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Title</div>' +
      '<div class="social-copy-text">' + esc(platformCopy.title) + '</div>' +
      '</div>';
    
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Description</div>' +
      '<div class="social-copy-text">' + esc(platformCopy.description) + '</div>' +
      '<button class="btn-copy-clipboard" onclick="copyToClipboard(&#39;youtube&#39;, &#39;description&#39;)">Copy to Clipboard</button>' +
      '</div>';
    
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Tags</div>' +
      '<div class="hashtags">' + esc(platformCopy.tags.join(', ')) + '</div>' +
      '</div>';
  }
  
  if (platform === 'tiktok') {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Caption</div>' +
      '<div class="social-copy-text">' + esc(platformCopy.caption) + '</div>' +
      '<button class="btn-copy-clipboard" onclick="copyToClipboard(&#39;tiktok&#39;, &#39;caption&#39;)">Copy to Clipboard</button>' +
      '</div>';
    
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Hashtags</div>' +
      '<div class="hashtags">' + esc(platformCopy.hashtags.join(' ')) + '</div>' +
      '</div>';
  }
  
  if (platform === 'instagram') {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Caption</div>' +
      '<div class="social-copy-text">' + esc(platformCopy.caption) + '</div>' +
      '<button class="btn-copy-clipboard" onclick="copyToClipboard(&#39;instagram&#39;, &#39;caption&#39;)">Copy to Clipboard</button>' +
      '</div>';
    
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Hashtags</div>' +
      '<div class="hashtags">' + esc(platformCopy.hashtags.join(' ')) + '</div>' +
      '</div>';
    
    if (platformCopy.alt_text) {
      html += '<div class="social-copy-section">' +
        '<div class="social-copy-label">Alt Text</div>' +
        '<div class="social-copy-text">' + esc(platformCopy.alt_text) + '</div>' +
        '</div>';
    }
  }
  
  if (platform === 'x') {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Tweet</div>' +
      '<div class="social-copy-text">' + esc(platformCopy.tweet) + '</div>' +
      '<button class="btn-copy-clipboard" onclick="copyToClipboard(&#39;x&#39;, &#39;tweet&#39;)">Copy to Clipboard</button>' +
      '</div>';
    
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Hashtags</div>' +
      '<div class="hashtags">' + esc(platformCopy.hashtags.join(' ')) + '</div>' +
      '</div>';
  }
  
  // Audio suggestion and posting notes for all platforms
  if (platformCopy.audio_suggestion) {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Audio Suggestion</div>' +
      '<div class="social-copy-text" style="font-size:0.75rem;">' + esc(platformCopy.audio_suggestion) + '</div>' +
      '</div>';
  }
  
  if (platformCopy.posting_notes) {
    html += '<div class="social-copy-section">' +
      '<div class="social-copy-label">Posting Notes</div>' +
      '<div class="social-copy-text" style="font-size:0.75rem;">' + esc(platformCopy.posting_notes) + '</div>' +
      '</div>';
  }
  
  return html;
}

// Copy to clipboard
function copyToClipboard(platform, field) {
  var copy = socialCopyState.copy;
  if (!copy || !copy[platform]) return;
  
  var textToCopy = '';
  
  if (platform === 'youtube') {
    textToCopy = copy.youtube.description + '\\n\\nTags: ' + copy.youtube.tags.join(', ');
  } else if (platform === 'tiktok') {
    textToCopy = copy.tiktok.caption + '\\n\\n' + copy.tiktok.hashtags.join(' ');
  } else if (platform === 'instagram') {
    textToCopy = copy.instagram.caption + '\\n\\n' + copy.instagram.hashtags.join(' ');
  } else if (platform === 'x') {
    textToCopy = copy.x.tweet + '\\n\\n' + copy.x.hashtags.join(' ');
  }
  
  // Use Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(function() {
      showToast('Copied to clipboard!', 'success');
    }).catch(function(err) {
      console.error('Clipboard error:', err);
      fallbackCopyToClipboard(textToCopy);
    });
  } else {
    fallbackCopyToClipboard(textToCopy);
  }
}

// Fallback clipboard copy for older browsers
function fallbackCopyToClipboard(text) {
  var textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    var successful = document.execCommand('copy');
    if (successful) {
      showToast('Copied to clipboard!', 'success');
    } else {
      showToast('Failed to copy', 'error');
    }
  } catch (err) {
    console.error('Fallback clipboard error:', err);
    showToast('Failed to copy', 'error');
  }
  
  document.body.removeChild(textArea);
}
</script>
</body>
</html>
`;


// Serve HTML for all non-API routes
app.get('/', (req, res) => {
  // Check if it's a direct navigation (not API call)
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) {
    res.type('html').send(HTML);
  } else {
    res.json({ error: 'Use browser to access dashboard' });
  }
});
app.get('/orders', (req, res) => res.type('html').send(HTML));
app.get('/orders/:id', (req, res) => res.type('html').send(HTML));
app.get('/batch', (req, res) => res.type('html').send(HTML));
app.get('/pipeline', (req, res) => res.type('html').send(HTML));

// Debug endpoint to check database status
app.get('/debug/db-status', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.DB_PATH || '/data/pipeline.db';
  
  const status = {
    dbPath: dbPath,
    dbExists: fs.existsSync(dbPath),
    fileSize: null,
    ordersCount: null
  };
  
  if (status.dbExists) {
    try {
      status.fileSize = fs.statSync(dbPath).size;
      const db = require('better-sqlite3')(dbPath);
      status.ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
      db.close();
    } catch (e) {
      status.error = e.message;
    }
  }
  
  res.json(status);
});

// Admin endpoint to add orders manually
app.post('/admin/add-order', (req, res) => {
  const { order_id, brand, customer_email, customer_name, illustration_url, photo_urls } = req.body;
  
  if (!order_id || !brand) {
    return res.status(400).json({ error: 'order_id and brand are required' });
  }

  try {
    const db = require('better-sqlite3')(process.env.DB_PATH || require(path.join(PIPELINE_ROOT, 'lib', 'db')).DB_PATH);
    
    // Insert or update the order
    const stmt = db.prepare(`
      INSERT INTO orders (
        order_id, brand, customer_email, customer_name, illustration_url, photo_urls,
        order_date, production_status, consent_status, computed_score, priority, notes
      ) VALUES (
        @order_id, @brand, @customer_email, @customer_name, @illustration_url, @photo_urls,
        datetime('now'), 'pending', 'pre_approved', 50, 10, 'Added via admin UI'
      )
      ON CONFLICT(order_id, brand) DO UPDATE SET
        customer_email = @customer_email,
        customer_name = @customer_name,
        illustration_url = @illustration_url,
        photo_urls = @photo_urls,
        updated_at = datetime('now')
    `);
    
    stmt.run({
      order_id,
      brand,
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      illustration_url: illustration_url || '',
      photo_urls: photo_urls ? (typeof photo_urls === 'string' ? photo_urls : JSON.stringify(photo_urls)) : '[]'
    });
    
    res.json({ success: true, message: 'Order added successfully' });
    db.close();
  } catch (err) {
    console.error('Error adding order:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to add orders manually
app.post('/admin/add-order', (req, res) => {
  const { order_id, brand, customer_email, customer_name, illustration_url, photo_urls } = req.body;
  
  if (!order_id || !brand) {
    return res.status(400).json({ error: 'order_id and brand are required' });
  }

  try {
    const db = require('better-sqlite3')(process.env.DB_PATH || require(path.join(PIPELINE_ROOT, 'lib', 'db')).DB_PATH);
    
    // Insert or update the order
    const stmt = db.prepare(`
      INSERT INTO orders (
        order_id, brand, customer_email, customer_name, illustration_url, photo_urls,
        order_date, production_status, consent_status, computed_score, priority, notes
      ) VALUES (
        @order_id, @brand, @customer_email, @customer_name, @illustration_url, @photo_urls,
        datetime('now'), 'pending', 'pre_approved', 50, 10, 'Added via admin UI'
      )
      ON CONFLICT(order_id, brand) DO UPDATE SET
        customer_email = @customer_email,
        customer_name = @customer_name,
        illustration_url = @illustration_url,
        photo_urls = @photo_urls,
        updated_at = datetime('now')
    `);
    
    stmt.run({
      order_id,
      brand,
      customer_email: customer_email || '',
      customer_name: customer_name || '',
      illustration_url: illustration_url || '',
      photo_urls: photo_urls ? (typeof photo_urls === 'string' ? photo_urls : JSON.stringify(photo_urls)) : '[]'
    });
    
    res.json({ success: true, message: 'Order added successfully' });
    db.close();
  } catch (err) {
    console.error('Error adding order:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve admin page for adding orders
app.get('/admin', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Add Order - Video Pipeline</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input, textarea, select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    button { background: #4f46e5; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #6366f1; }
    .message { padding: 10px; margin: 10px 0; border-radius: 4px; }
    .success { background: #d1fae5; color: #065f46; }
    .error { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>Add New Order</h1>
  <p><a href="https://docs.google.com/spreadsheets/d/1KFToq2s9Pul4e1qQ5UcGP9XR0IIavSaraJbyf-4mJgI/edit?gid=0#gid=0" target="_blank">View TurnedYellow Tracking Spreadsheet</a></p>
  <form id="addOrderForm">
    <div class="form-group">
      <label for="orderId">Order ID *</label>
      <input type="text" id="orderId" required placeholder="e.g., TY-12345">
    </div>
    
    <div class="form-group">
      <label for="brand">Brand *</label>
      <select id="brand" required>
        <option value="turnedyellow">TurnedYellow</option>
        <option value="makemejedi">MakeMeJedi</option>
        <option value="turnedwizard">TurnedWizard</option>
        <option value="turnedcomics">TurnedComics</option>
        <option value="popsmiths">PopSmiths</option>
      </select>
    </div>
    
    <div class="form-group">
      <label for="customerEmail">Customer Email</label>
      <input type="email" id="customerEmail" placeholder="customer@example.com">
    </div>
    
    <div class="form-group">
      <label for="customerName">Customer Name</label>
      <input type="text" id="customerName" placeholder="John Doe">
    </div>
    
    <div class="form-group">
      <label for="illustrationUrl">Illustration URL</label>
      <input type="url" id="illustrationUrl" placeholder="https://example.com/illustration.jpg">
    </div>
    
    <div class="form-group">
      <label for="photoUrls">Photo URLs (one per line)</label>
      <textarea id="photoUrls" rows="3" placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"></textarea>
    </div>
    
    <button type="submit">Add Order</button>
  </form>
  
  <div id="message"></div>
  
  <script>
    document.getElementById('addOrderForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const formData = {
        order_id: document.getElementById('orderId').value,
        brand: document.getElementById('brand').value,
        customer_email: document.getElementById('customerEmail').value,
        customer_name: document.getElementById('customerName').value,
        illustration_url: document.getElementById('illustrationUrl').value,
        photo_urls: document.getElementById('photoUrls').value
          ? document.getElementById('photoUrls').value.split('\\n').filter(url => url.trim())
          : []
      };
      
      try {
        const response = await fetch('/admin/add-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        const messageEl = document.getElementById('message');
        
        if (response.ok) {
          messageEl.innerHTML = '<div class="message success">Order added successfully!</div>';
          document.getElementById('addOrderForm').reset();
        } else {
          messageEl.innerHTML = '<div class="message error">Error: ' + (result.error || 'Unknown error') + '</div>';
        }
      } catch (err) {
        document.getElementById('message').innerHTML = '<div class="message error">Network error: ' + err.message + '</div>';
      }
    });
  </script>
</body>
</html>`;
  res.send(html);
});

// Mount consent public routes (token-based consent flow)
app.use(consentApp);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled route error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

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
  console.log(`    GET  /api/consent/status/:orderId/:brand`);
  console.log(`    POST /api/consent/resend/:orderId/:brand`);
  console.log(`    GET  /api/production-runs`);
  console.log(`    POST /api/pipeline/run`);
  console.log(`    GET  /api/pipeline/status/:runId`);
  console.log(`    GET  /api/pipeline/sse`);
  console.log(`    GET  /api/pipeline/history`);
  console.log(`    GET  /api/video/:orderId/:brand`);
  console.log(`    GET  /api/video/file/:brand/:orderId/:filename`);
  console.log(`    POST /api/video/:orderId/:brand/approve`);
  console.log(`    POST /api/video/:orderId/:brand/reject`);
  console.log(`    GET  /api/social-copy/:orderId/:brand\n`);
});
