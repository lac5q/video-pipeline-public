#!/usr/bin/env node
/**
 * Clean up non-URL values in URL fields of the orders table.
 * Nulls out any value that doesn't start with http:// or https://
 * in: photos_url, oms_url, illustration_url
 *
 * Usage:
 *   node scripts/clean-bad-urls.js [--db /path/to/pipeline.db] [--dry-run]
 */

const Database = require('better-sqlite3');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex !== -1 ? args[dbIndex + 1] : (process.env.DB_PATH || path.join(__dirname, '../data/pipeline.db'));

console.log(`Database: ${dbPath}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update)'}\n`);

const db = new Database(dbPath);

// Get actual columns in orders table
const tableInfo = db.prepare(`PRAGMA table_info(orders)`).all();
const existingColumns = new Set(tableInfo.map(c => c.name));

// Delete header rows imported as data (order_id looks like a spreadsheet column header)
const HEADER_MARKERS = ['File Name', 'Order ID', 'order_id', 'OrderID'];
const headerRows = db.prepare(`SELECT order_id, brand FROM orders WHERE order_id IN (${HEADER_MARKERS.map(() => '?').join(',')})`).all(...HEADER_MARKERS);
if (headerRows.length > 0) {
  console.log(`Found ${headerRows.length} header row(s) imported as data:`);
  for (const r of headerRows) console.log(`  order_id="${r.order_id}" brand="${r.brand}"`);
  if (!dryRun) {
    const res = db.prepare(`DELETE FROM orders WHERE order_id IN (${HEADER_MARKERS.map(() => '?').join(',')})`).run(...HEADER_MARKERS);
    console.log(`  → Deleted ${res.changes} row(s)\n`);
  } else {
    console.log(`  → (dry run, skipping delete)\n`);
  }
} else {
  console.log('✓ No header rows found\n');
}

// Clean non-URL values from URL fields
const URL_FIELDS = ['photos_url', 'oms_url', 'illustration_url'];

for (const field of URL_FIELDS) {
  if (!existingColumns.has(field)) {
    console.log(`⚠ ${field}: column not found in this DB, skipping`);
    continue;
  }

  const bad = db.prepare(`
    SELECT order_id, brand, ${field} AS val
    FROM orders
    WHERE ${field} IS NOT NULL
      AND ${field} != ''
      AND ${field} NOT LIKE 'http://%'
      AND ${field} NOT LIKE 'https://%'
  `).all();

  if (bad.length === 0) {
    console.log(`✓ ${field}: no bad values`);
    continue;
  }

  console.log(`✗ ${field}: ${bad.length} bad value(s) found`);
  for (const row of bad) {
    console.log(`  order_id=${row.order_id} brand=${row.brand} value="${row.val}"`);
  }

  if (!dryRun) {
    const result = db.prepare(`
      UPDATE orders
      SET ${field} = NULL
      WHERE ${field} IS NOT NULL
        AND ${field} != ''
        AND ${field} NOT LIKE 'http://%'
        AND ${field} NOT LIKE 'https://%'
    `).run();
    console.log(`  → Cleared ${result.changes} row(s)\n`);
  } else {
    console.log(`  → (dry run, skipping update)\n`);
  }
}

db.close();
console.log('Done.');
