'use strict';

const { getDatabase } = require('../lib/db');

// === Usage ===
function usage() {
  console.log(`Usage: node scripts/list-orders.js [OPTIONS]

List orders from the pipeline database.

Options:
  --brand SLUG        Filter by brand (e.g., turnedyellow, makemejedi)
  --status STATUS     Filter by consent status (pre_approved, pending, approved, denied, revoked)
  --min-score N       Minimum reaction score (1-5)
  --production STATUS Filter by production status (pending, downloading, staging, building, uploading, complete, failed)
  --limit N           Max rows to display (default: 20)
  --json              Output as JSON instead of table
  --help              Show this help message

Examples:
  node scripts/list-orders.js --brand turnedyellow --min-score 4
  node scripts/list-orders.js --status pre_approved --limit 50
  node scripts/list-orders.js --production complete --json`);
  process.exit(0);
}

// === Parse arguments ===
function parseArgs(argv) {
  const args = {
    brand: null,
    status: null,
    minScore: null,
    production: null,
    limit: 20,
    json: false,
  };

  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--help':
      case '-h':
        usage();
        break;
      case '--brand':
        args.brand = raw[++i];
        break;
      case '--status':
        args.status = raw[++i];
        break;
      case '--min-score':
        args.minScore = parseInt(raw[++i], 10);
        if (isNaN(args.minScore)) {
          console.error('ERROR: --min-score requires a number');
          process.exit(1);
        }
        break;
      case '--production':
        args.production = raw[++i];
        break;
      case '--limit':
        args.limit = parseInt(raw[++i], 10);
        if (isNaN(args.limit)) {
          console.error('ERROR: --limit requires a number');
          process.exit(1);
        }
        break;
      case '--json':
        args.json = true;
        break;
      default:
        console.error(`ERROR: Unknown argument: ${raw[i]}`);
        console.error("Run 'node scripts/list-orders.js --help' for usage.");
        process.exit(1);
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const db = getDatabase();

  try {
    // Build dynamic query
    const conditions = [];
    const params = {};

    if (args.brand) {
      conditions.push('brand = @brand');
      params.brand = args.brand;
    }
    if (args.status) {
      conditions.push('consent_status = @status');
      params.status = args.status;
    }
    if (args.minScore !== null) {
      conditions.push('score >= @minScore');
      params.minScore = args.minScore;
    }
    if (args.production) {
      conditions.push('production_status = @production');
      params.production = args.production;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT @limit`;
    params.limit = args.limit;

    const rows = db.prepare(sql).all(params);

    // Count total matching (without limit)
    const countSql = `SELECT COUNT(*) as total FROM orders ${where}`;
    const countParams = { ...params };
    delete countParams.limit;
    const total = db.prepare(countSql).get(countParams).total;

    if (args.json) {
      console.log(JSON.stringify({ total, showing: rows.length, orders: rows }, null, 2));
    } else {
      console.log(`=== Orders (${rows.length} of ${total}) ===`);
      console.log('');

      if (rows.length === 0) {
        console.log('  No orders found matching the given filters.');
        console.log('');
        console.log('  Tip: Run "node scripts/import-tracking-sheets.js" to import orders.');
      } else {
        // Table header
        const header = [
          padRight('ORDER_ID', 14),
          padRight('BRAND', 14),
          padRight('SCORE', 5),
          padRight('CONSENT', 12),
          padRight('PRODUCTION', 12),
          padRight('LAYOUT', 10),
          'DESCRIPTION',
        ].join('  ');

        console.log(header);
        console.log('-'.repeat(header.length));

        for (const row of rows) {
          const desc = row.description
            ? row.description.substring(0, 40) + (row.description.length > 40 ? '...' : '')
            : '';
          console.log(
            [
              padRight(row.order_id, 14),
              padRight(row.brand, 14),
              padRight(row.score !== null ? String(row.score) : '-', 5),
              padRight(row.consent_status, 12),
              padRight(row.production_status, 12),
              padRight(row.layout || '-', 10),
              desc,
            ].join('  ')
          );
        }
      }

      console.log('');
    }
  } finally {
    db.close();
  }
}

function padRight(str, len) {
  str = String(str || '');
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

main();
