'use strict';

const path = require('path');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
const { scoreOrder, rankOrders } = require(path.join(PIPELINE_ROOT, 'lib', 'scorer'));

// === Usage ===
function usage() {
  console.log(`Usage: node ${path.basename(__filename)} [OPTIONS]

Rank order candidates by production score.

Options:
  --brand SLUG        Filter by brand slug
  --limit N           Show top N results (default 10)
  --min-score N       Minimum total score (default 40)
  --ready-only        Only show orders ready for production (approved/pre_approved)
  --json              Output as JSON instead of table
  --help              Show this help message

Examples:
  node ${path.basename(__filename)} --brand turnedyellow --limit 5
  node ${path.basename(__filename)} --ready-only --min-score 60
  node ${path.basename(__filename)} --json`);
  process.exit(0);
}

// === Parse arguments ===
const args = process.argv.slice(2);
let brand = null;
let limit = 10;
let minScore = 40;
let readyOnly = false;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--brand':
      brand = args[++i];
      break;
    case '--limit':
      limit = parseInt(args[++i], 10);
      break;
    case '--min-score':
      minScore = parseInt(args[++i], 10);
      break;
    case '--ready-only':
      readyOnly = true;
      break;
    case '--json':
      jsonOutput = true;
      break;
    case '--help':
    case '-h':
      usage();
      break;
    default:
      console.error(`ERROR: Unknown argument: ${args[i]}`);
      console.error(`Run 'node ${path.basename(__filename)} --help' for usage.`);
      process.exit(1);
  }
}

// === Query database ===
const db = getDatabase();

let query = 'SELECT * FROM orders WHERE 1=1';
const params = [];

if (brand) {
  query += ' AND brand = ?';
  params.push(brand);
}

if (readyOnly) {
  query += " AND consent_status IN ('approved', 'pre_approved')";
}

const orders = db.prepare(query).all(...params);
db.close();

if (orders.length === 0) {
  console.log('No orders found matching criteria.');
  process.exit(0);
}

// === Score and rank ===
const ranked = rankOrders(orders)
  .filter(o => o._score >= minScore)
  .slice(0, limit);

if (ranked.length === 0) {
  console.log(`No orders meet minimum score of ${minScore}.`);
  process.exit(0);
}

// === Output ===
if (jsonOutput) {
  const output = ranked.map((o, idx) => ({
    rank: idx + 1,
    order_id: o.order_id,
    brand: o.brand,
    score: o._score,
    breakdown: o._breakdown,
    layout: o.layout || '',
    consent_status: o.consent_status,
    production_status: o.production_status,
  }));
  console.log(JSON.stringify(output, null, 2));
} else {
  // Table output
  console.log('=== Order Candidate Rankings ===');
  if (brand) console.log(`  Brand: ${brand}`);
  console.log(`  Min score: ${minScore} | Limit: ${limit} | Ready only: ${readyOnly}`);
  console.log('');

  const header = 'Rank | Order ID   | Brand          | Score | Reaction | Layout | Tags       | Status';
  const divider = '-----|------------|----------------|-------|----------|--------|------------|---------------';
  console.log(header);
  console.log(divider);

  ranked.forEach((o, idx) => {
    const rank = String(idx + 1).padStart(4);
    const orderId = String(o.order_id).padEnd(10);
    const brandCol = String(o.brand || '').padEnd(14);
    const score = String(o._score).padStart(5);
    const reaction = `${Math.min(Number(o.score) || 0, 5)}/5`.padStart(8);
    const layout = (o.layout || '').slice(0, 6).padEnd(6);

    let tagsStr = '';
    try {
      const parsed = JSON.parse(o.tags || '[]');
      tagsStr = (Array.isArray(parsed) ? parsed.slice(0, 2).join(', ') : '');
    } catch (_) {
      tagsStr = String(o.tags || '').slice(0, 10);
    }
    tagsStr = tagsStr.padEnd(10);

    const status = (o.consent_status || '').padEnd(13);

    console.log(`${rank} | ${orderId} | ${brandCol} | ${score} | ${reaction} | ${layout} | ${tagsStr} | ${status}`);
  });

  console.log('');
  console.log(`Showing ${ranked.length} of ${orders.length} total orders.`);
}
