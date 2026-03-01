'use strict';

const path = require('path');
const fs = require('fs');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
const { generateCopy, formatAsMarkdown } = require(path.join(PIPELINE_ROOT, 'lib', 'social-copy'));

// === Usage ===
function usage() {
  console.log(`Usage: node ${path.basename(__filename)} --brand SLUG --order ORDER_ID [OPTIONS]

Generate social media copy for a produced video.

Required:
  --brand SLUG        Brand slug (e.g., turnedyellow, makemejedi)
  --order ORDER_ID    Order ID (e.g., 133627)

Options:
  --output PATH       Output file path (default: orders/{brand}/{order_id}/exports/{order_id}_social.md)
  --json              Output as JSON instead of markdown
  --stdout            Print to stdout instead of writing to file
  --help              Show this help message

Examples:
  node ${path.basename(__filename)} --brand turnedyellow --order 133627
  node ${path.basename(__filename)} --brand makemejedi --order 7460 --json
  node ${path.basename(__filename)} --brand turnedyellow --order 133627 --stdout`);
  process.exit(0);
}

// === Parse arguments ===
const args = process.argv.slice(2);
let brand = null;
let orderId = null;
let outputPath = null;
let jsonOutput = false;
let stdoutOnly = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--brand':
      brand = args[++i];
      break;
    case '--order':
      orderId = args[++i];
      break;
    case '--output':
      outputPath = args[++i];
      break;
    case '--json':
      jsonOutput = true;
      break;
    case '--stdout':
      stdoutOnly = true;
      break;
    case '--help':
    case '-h':
      usage();
      break;
    default:
      console.error(`ERROR: Unknown argument: ${args[i]}`);
      process.exit(1);
  }
}

if (!brand) {
  console.error('ERROR: --brand is required');
  console.error(`Run 'node ${path.basename(__filename)} --help' for usage.`);
  process.exit(1);
}
if (!orderId) {
  console.error('ERROR: --order is required');
  console.error(`Run 'node ${path.basename(__filename)} --help' for usage.`);
  process.exit(1);
}

// === Load brand config ===
const configPath = path.join(PIPELINE_ROOT, 'brands', `${brand}.json`);
if (!fs.existsSync(configPath)) {
  console.error(`ERROR: Brand config not found: ${configPath}`);
  process.exit(1);
}
const brandConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// === Query order from database ===
const db = getDatabase();
const order = db.prepare('SELECT * FROM orders WHERE order_id = ? AND brand = ?').get(orderId, brand);
db.close();

if (!order) {
  console.error(`ERROR: Order ${orderId} not found for brand ${brand}`);
  process.exit(1);
}

// === Generate copy ===
console.log('=== Generating Social Copy ===');
console.log(`  Brand: ${brandConfig.name} (${brand})`);
console.log(`  Order: ${orderId}`);

const copy = generateCopy(order, brandConfig);

// === Output ===
if (stdoutOnly) {
  if (jsonOutput) {
    console.log(JSON.stringify(copy, null, 2));
  } else {
    console.log(formatAsMarkdown(copy, order, brandConfig));
  }
} else {
  // Determine output path
  if (!outputPath) {
    outputPath = path.join(
      PIPELINE_ROOT, 'orders', brand, orderId, 'exports', `${orderId}_social.md`
    );
  }

  // Ensure directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (jsonOutput) {
    outputPath = outputPath.replace(/\.md$/, '.json');
    fs.writeFileSync(outputPath, JSON.stringify(copy, null, 2), 'utf8');
  } else {
    const markdown = formatAsMarkdown(copy, order, brandConfig);
    fs.writeFileSync(outputPath, markdown, 'utf8');
  }

  console.log(`  Output: ${outputPath}`);
  console.log('=== Social copy generated ===');
}
