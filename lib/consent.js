'use strict';

const crypto = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// Resolve pipeline root the same way other modules do
// ---------------------------------------------------------------------------
const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const DB_PATH =
  process.env.DB_PATH || path.join(PIPELINE_ROOT, 'data', 'pipeline.db');

// ---------------------------------------------------------------------------
// Lazy-loaded database handle
// ---------------------------------------------------------------------------
let _db = null;

function getDb() {
  if (_db) return _db;

  const Database = require('better-sqlite3');
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Ensure the consent_tokens table exists (orders & consent_log are managed
  // by the DB migration agent, but we own the tokens table).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS consent_tokens (
      token       TEXT PRIMARY KEY,
      order_id    TEXT NOT NULL,
      brand       TEXT NOT NULL,
      action      TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      used_at     TEXT,
      expires_at  TEXT
    );
  `);

  // Ensure the consent_log table exists. The existing schema (created by the
  // DB migration agent) uses: id, order_id, brand, action, details, timestamp.
  // We adapt to that schema and add columns we need if missing.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS consent_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    TEXT NOT NULL,
      brand       TEXT NOT NULL,
      action      TEXT NOT NULL,
      details     TEXT,
      timestamp   TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add columns to consent_log if missing (old_status for richer logging)
  const logColumnsToAdd = [
    { name: 'old_status', def: 'TEXT' },
    { name: 'new_status', def: 'TEXT' },
  ];
  for (const col of logColumnsToAdd) {
    try {
      _db.exec(`ALTER TABLE consent_log ADD COLUMN ${col.name} ${col.def};`);
    } catch (_e) {
      // Column already exists -- ignore
    }
  }

  // Ensure the orders table has at minimum the columns we query.
  // If the table doesn't exist yet, create a minimal version. The full
  // migration will add remaining columns later.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id        TEXT NOT NULL,
      brand           TEXT NOT NULL,
      consent_status  TEXT DEFAULT 'pending',
      score           REAL DEFAULT 0,
      customer_email  TEXT,
      customer_name   TEXT,
      order_description TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (order_id, brand)
    );
  `);

  // If the orders table already existed (created by another agent), ensure
  // the columns we depend on are present. ALTER TABLE ADD COLUMN is a no-op
  // if the column already exists in SQLite 3.35+, but for safety we catch.
  const columnsToAdd = [
    { name: 'consent_status', def: "TEXT DEFAULT 'pending'" },
    { name: 'customer_email', def: 'TEXT' },
    { name: 'customer_name', def: 'TEXT' },
    { name: 'order_description', def: 'TEXT' },
    { name: 'updated_at', def: "TEXT DEFAULT (datetime('now'))" },
  ];
  for (const col of columnsToAdd) {
    try {
      _db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.def};`);
    } catch (_e) {
      // Column already exists -- ignore
    }
  }

  return _db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current consent status for an order.
 *
 * @param {string} orderId
 * @param {string} brand - brand slug
 * @returns {{ order_id: string, brand: string, consent_status: string } | null}
 */
function getConsentStatus(orderId, brand) {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT order_id, brand, consent_status, score, customer_email, customer_name FROM orders WHERE order_id = ? AND brand = ?'
    )
    .get(orderId, brand);
  return row || null;
}

/**
 * Update consent status for an order and append to the consent_log.
 *
 * @param {string} orderId
 * @param {string} brand
 * @param {string} newStatus - one of: pre_approved, pending, approved, denied, revoked
 * @param {string} [details] - optional human-readable details
 * @returns {{ changes: number }}
 */
function updateConsent(orderId, brand, newStatus, details) {
  const db = getDb();
  const current = getConsentStatus(orderId, brand);
  const oldStatus = current ? current.consent_status : null;

  const updateResult = db
    .prepare(
      "UPDATE orders SET consent_status = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?"
    )
    .run(newStatus, orderId, brand);

  db.prepare(
    'INSERT INTO consent_log (order_id, brand, action, old_status, new_status, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(orderId, brand, `consent_${newStatus}`, oldStatus, newStatus, details || null);

  return { changes: updateResult.changes };
}

/**
 * List orders with consent_status = 'pending'.
 *
 * @param {string} [brand] - optional brand filter
 * @returns {Array<Object>}
 */
function listPendingConsent(brand) {
  const db = getDb();
  if (brand) {
    return db
      .prepare(
        "SELECT * FROM orders WHERE consent_status = 'pending' AND brand = ? ORDER BY created_at ASC"
      )
      .all(brand);
  }
  return db
    .prepare(
      "SELECT * FROM orders WHERE consent_status = 'pending' ORDER BY created_at ASC"
    )
    .all();
}

/**
 * List orders that have been approved and meet an optional minimum score.
 *
 * @param {string} [brand]
 * @param {number} [minScore=0]
 * @returns {Array<Object>}
 */
function listApprovedOrders(brand, minScore) {
  const db = getDb();
  const score = typeof minScore === 'number' ? minScore : 0;

  if (brand) {
    return db
      .prepare(
        "SELECT * FROM orders WHERE consent_status = 'approved' AND brand = ? AND score >= ? ORDER BY score DESC"
      )
      .all(brand, score);
  }
  return db
    .prepare(
      "SELECT * FROM orders WHERE consent_status = 'approved' AND score >= ? ORDER BY score DESC"
    )
    .all(score);
}

/**
 * Revoke consent for an order.
 *
 * @param {string} orderId
 * @param {string} brand
 * @param {string} reason
 * @returns {{ changes: number }}
 */
function revokeConsent(orderId, brand, reason) {
  return updateConsent(orderId, brand, 'revoked', reason);
}

/**
 * Generate a pair of tokens (approve + deny) for an order.
 * Each token expires in 30 days.
 *
 * @param {string} orderId
 * @param {string} brand
 * @returns {{ approveToken: string, denyToken: string }}
 */
function generateConsentToken(orderId, brand) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');

  const approveToken = crypto.randomBytes(32).toString('hex');
  const denyToken = crypto.randomBytes(32).toString('hex');

  const insert = db.prepare(
    'INSERT INTO consent_tokens (token, order_id, brand, action, expires_at) VALUES (?, ?, ?, ?, ?)'
  );

  insert.run(approveToken, orderId, brand, 'approve', expiresAt);
  insert.run(denyToken, orderId, brand, 'deny', expiresAt);

  return { approveToken, denyToken };
}

/**
 * Validate a consent token.
 *
 * @param {string} token
 * @returns {{ orderId: string, brand: string, action: string } | null}
 */
function validateConsentToken(token) {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM consent_tokens WHERE token = ? AND used_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
    )
    .get(token);

  if (!row) return null;

  return {
    orderId: row.order_id,
    brand: row.brand,
    action: row.action,
  };
}

/**
 * Mark a consent token as used.
 *
 * @param {string} token
 */
function markTokenUsed(token) {
  const db = getDb();
  db.prepare("UPDATE consent_tokens SET used_at = datetime('now') WHERE token = ?").run(
    token
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getConsentStatus,
  updateConsent,
  listPendingConsent,
  listApprovedOrders,
  revokeConsent,
  generateConsentToken,
  validateConsentToken,
  markTokenUsed,
  // Expose for testing / advanced usage
  getDb,
};
