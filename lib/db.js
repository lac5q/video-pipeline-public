'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const DB_PATH =
  process.env.DB_PATH || path.join(PIPELINE_ROOT, 'data', 'pipeline.db');

/**
 * Ensure the data directory exists, then open (or create) the SQLite database.
 */
function openDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Run all CREATE TABLE statements. Safe to call multiple times (IF NOT EXISTS).
 */
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      consent_status TEXT DEFAULT 'pre_approved',
      score INTEGER,
      layout TEXT,
      has_reaction_video INTEGER DEFAULT 0,
      reaction_video_url TEXT,
      reaction_start TEXT,
      reaction_end TEXT,
      reaction_start2 TEXT,
      reaction_end2 TEXT,
      photos_url TEXT,
      oms_url TEXT,
      illustration_id TEXT,
      tags TEXT,
      description TEXT,
      clear_product INTEGER DEFAULT 0,
      source TEXT,
      holiday TEXT,
      production_status TEXT DEFAULT 'pending',
      video_path TEXT,
      drive_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(order_id, brand)
    );

    CREATE TABLE IF NOT EXISTS consent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      video_type TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT DEFAULT 'running',
      error TEXT,
      output_path TEXT,
      drive_url TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT DEFAULT 'running',
      brands_processed TEXT,
      orders_attempted INTEGER DEFAULT 0,
      orders_succeeded INTEGER DEFAULT 0,
      orders_failed INTEGER DEFAULT 0,
      orders_skipped INTEGER DEFAULT 0,
      error_log TEXT,
      discord_notified INTEGER DEFAULT 0
    );
  `);
}

/**
 * Get a ready-to-use database instance with schema initialized.
 */
function getDatabase() {
  const db = openDatabase();
  initSchema(db);
  return db;
}

module.exports = { getDatabase, openDatabase, initSchema, DB_PATH };

// When run directly, create/verify the schema
if (require.main === module) {
  console.log('=== Initializing pipeline database ===');
  console.log(`  Path: ${DB_PATH}`);
  const db = getDatabase();

  // Verify tables exist
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

  console.log(`  Tables: ${tables.join(', ')}`);
  console.log('=== Database ready ===');
  db.close();
}
