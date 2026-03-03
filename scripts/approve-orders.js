#!/usr/bin/env node
// approve-orders.js -- Interactive batch approval CLI for order candidates
// Usage: node scripts/approve-orders.js [OPTIONS]
//
// Reviews top-ranked order candidates and lets Luis approve/reject
// Approved orders move to production queue; rejected orders are skipped
const path = require('path');
const readline = require('readline');

const PIPELINE_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(PIPELINE_ROOT, 'data', 'pipeline.db');

// === Parse arguments ===
const args = process.argv.slice(2);
let brand = null;
let limit = 10;
let minScore = 30;
let autoApproveAbove = null;

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--brand': brand = args[++i]; break;
        case '--limit': limit = parseInt(args[++i]); break;
        case '--min-score': minScore = parseInt(args[++i]); break;
        case '--auto-approve-above': autoApproveAbove = parseInt(args[++i]); break;
        case '--help':
            console.log(`
Usage: node scripts/approve-orders.js [OPTIONS]

Interactive batch approval for video production candidates.

Options:
  --brand SLUG              Filter by brand
  --limit N                 Max candidates to review (default: 10)
  --min-score N             Minimum score threshold (default: 30)
  --auto-approve-above N    Auto-approve orders scoring above N
  --help                    Show this help

During review, for each order you can:
  [a] Approve — move to production queue
  [s] Skip — leave for later
  [r] Reject — mark as rejected (won't appear again)
  [v] View details — show full order info
  [q] Quit — stop reviewing
`);
            process.exit(0);
    }
}

// === Database setup ===
let Database;
try {
    Database = require('better-sqlite3');
} catch {
    console.error('ERROR: better-sqlite3 not installed. Run: npm install better-sqlite3');
    process.exit(1);
}

let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
} catch (err) {
    console.error(`ERROR: Cannot open database at ${DB_PATH}`);
    console.error('Run import-tracking-sheets.js first to create the database.');
    process.exit(1);
}

// === Load scorer ===
let scorer;
try {
    scorer = require(path.join(PIPELINE_ROOT, 'lib', 'scorer.js'));
} catch {
    // Fallback: use DB score directly
    scorer = null;
}

// === Fetch candidates ===
function getCandidates() {
    let sql = `
        SELECT * FROM orders
        WHERE consent_status IN ('pre_approved', 'approved')
        AND production_status = 'pending'
    `;
    const params = [];

    if (brand) {
        sql += ' AND brand = ?';
        params.push(brand);
    }

    sql += ' AND (score IS NULL OR score >= ?)';
    params.push(minScore);

    sql += ' ORDER BY score DESC, created_at ASC LIMIT ?';
    params.push(limit);

    return db.prepare(sql).all(...params);
}

// === Display functions ===
function displayOrder(order, rank, total) {
    const tags = order.tags ? JSON.parse(order.tags).join(', ') : '-';
    const score = order.score || '?';
    const layout = order.layout || '?';
    const reaction = order.has_reaction_video ? 'Yes' : 'No';
    const product = order.clear_product ? 'Clear' : 'Unclear';

    console.log('');
    console.log('━'.repeat(60));
    console.log(`  Candidate ${rank}/${total}`);
    console.log('━'.repeat(60));
    console.log(`  Order:     ${order.order_id}`);
    console.log(`  Brand:     ${order.brand}`);
    console.log(`  Score:     ${score}/5`);
    console.log(`  Layout:    ${layout}`);
    console.log(`  Reaction:  ${reaction}`);
    console.log(`  Product:   ${product}`);
    console.log(`  Tags:      ${tags}`);
    console.log(`  Source:    ${order.source || '-'}`);
    console.log(`  Holiday:   ${order.holiday || '-'}`);
    if (order.description) {
        console.log(`  Desc:      ${order.description.substring(0, 80)}${order.description.length > 80 ? '...' : ''}`);
    }
    if (order.oms_url) {
        console.log(`  OMS:       ${order.oms_url}`);
    }
    if (order.photos_url) {
        console.log(`  Photos:    ${order.photos_url}`);
    }
    if (order.reaction_video_url) {
        console.log(`  Video:     ${order.reaction_video_url}`);
    }
    console.log('━'.repeat(60));
}

function displayDetails(order) {
    console.log('');
    console.log('=== Full Order Details ===');
    console.log(JSON.stringify(order, null, 2));
}

// === Interactive review ===
async function review() {
    const candidates = getCandidates();

    if (candidates.length === 0) {
        console.log('No candidates found matching criteria.');
        console.log(`  Brand: ${brand || 'all'}`);
        console.log(`  Min score: ${minScore}`);
        console.log(`  Status: pre_approved or approved, production pending`);
        process.exit(0);
    }

    console.log(`\n=== Batch Approval — ${candidates.length} candidates ===\n`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    let approved = 0;
    let rejected = 0;
    let skipped = 0;

    for (let i = 0; i < candidates.length; i++) {
        const order = candidates[i];
        const rank = i + 1;

        // Auto-approve if above threshold
        if (autoApproveAbove && order.score && order.score >= autoApproveAbove) {
            db.prepare(`
                UPDATE orders SET production_status = 'queued', updated_at = datetime('now')
                WHERE order_id = ? AND brand = ?
            `).run(order.order_id, order.brand);
            console.log(`  [AUTO] ${order.brand}/${order.order_id} (score ${order.score}) → approved`);
            approved++;
            continue;
        }

        displayOrder(order, rank, candidates.length);

        let decided = false;
        while (!decided) {
            const answer = await ask('  [a]pprove  [s]kip  [r]eject  [v]iew details  [q]uit → ');

            switch (answer.toLowerCase().trim()) {
                case 'a':
                case 'approve':
                    db.prepare(`
                        UPDATE orders SET production_status = 'queued', updated_at = datetime('now')
                        WHERE order_id = ? AND brand = ?
                    `).run(order.order_id, order.brand);
                    console.log('  → Approved for production');
                    approved++;
                    decided = true;
                    break;

                case 's':
                case 'skip':
                    console.log('  → Skipped (will appear next time)');
                    skipped++;
                    decided = true;
                    break;

                case 'r':
                case 'reject':
                    db.prepare(`
                        UPDATE orders SET production_status = 'rejected', updated_at = datetime('now')
                        WHERE order_id = ? AND brand = ?
                    `).run(order.order_id, order.brand);
                    console.log('  → Rejected (won\'t appear again)');
                    rejected++;
                    decided = true;
                    break;

                case 'v':
                case 'view':
                    displayDetails(order);
                    break;

                case 'q':
                case 'quit':
                    console.log('\n=== Review stopped ===');
                    console.log(`  Approved: ${approved}`);
                    console.log(`  Rejected: ${rejected}`);
                    console.log(`  Skipped: ${skipped}`);
                    console.log(`  Remaining: ${candidates.length - i}`);
                    rl.close();
                    db.close();
                    process.exit(0);

                default:
                    console.log('  Invalid choice. Use [a], [s], [r], [v], or [q]');
            }
        }
    }

    console.log('\n=== Review Complete ===');
    console.log(`  Approved: ${approved}`);
    console.log(`  Rejected: ${rejected}`);
    console.log(`  Skipped: ${skipped}`);

    rl.close();
    db.close();
}

review().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
});
