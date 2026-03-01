#!/usr/bin/env node
// approve-consent-candidates.js -- Batch consent approval CLI (Phase 2)
// Usage: node scripts/approve-consent-candidates.js [OPTIONS]
//
// Reviews top-ranked consent candidates and lets Luis approve/reject them
// for consent email sending. Sets consent_status (NOT production_status).
//
// Key difference from approve-orders.js: this script gates consent emails,
// not production queue. Approve sets consent_status='pending', reject sets
// consent_status='denied'.
'use strict';

require('dotenv').config();
const readline = require('readline');
const path = require('path');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// === Parse arguments ===
const args = process.argv.slice(2);
let brandFilter = null;
let limit = 20;
let minScore = 30;
let listMode = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--brand':     brandFilter = args[++i]; break;
    case '--limit':     limit = parseInt(args[++i], 10); break;
    case '--min-score': minScore = parseInt(args[++i], 10); break;
    case '--list':      listMode = true; break;
    case '--help':
      console.log(`
Usage: node scripts/approve-consent-candidates.js [OPTIONS]

Batch consent approval CLI for Phase 2. Reviews top-ranked pre-approved orders
and marks them ready to receive consent emails (consent_status='pending').

This script does NOT touch production_status. Use approve-orders.js for that.

Options:
  --brand SLUG    Filter by brand slug
  --limit N       Max candidates to review (default: 20)
  --min-score N   Minimum score threshold (default: 30)
  --list          Show all candidates in a ranked table first
  --help          Show this help

During review, for each order you can:
  [a] Approve   -- sets consent_status='pending' (ready for consent email)
  [s] Skip      -- leave for later review
  [r] Reject    -- sets consent_status='denied' (won't receive email)
  [v] View      -- show full order JSON details
  [q] Quit      -- stop reviewing

Candidate display includes:
  - Customer name + order ID
  - Brand + illustration URL (OMS link)
  - Score (ranked)
  - Reaction video availability
  - Number of people (from description)
  - Order date
  - Price and item count (if available)
`);
      process.exit(0);
  }
}

// === Load lib modules ===
let consent, scorer;
try {
  consent = require('../lib/consent');
} catch (err) {
  console.error('ERROR: Cannot load lib/consent:', err.message);
  process.exit(1);
}

try {
  scorer = require('../lib/scorer');
} catch (err) {
  console.error('ERROR: Cannot load lib/scorer:', err.message);
  process.exit(1);
}

// === Fetch candidates ===
function getCandidates() {
  const db = consent.getDb();

  let sql = `
    SELECT * FROM orders
    WHERE consent_status = 'pre_approved'
    AND production_status = 'pending'
  `;
  const params = [];

  if (brandFilter) {
    sql += ' AND brand = ?';
    params.push(brandFilter);
  }

  sql += ' ORDER BY score DESC, created_at ASC';

  return db.prepare(sql).all(...params);
}

// === Helper: truncate string ===
function trunc(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len - 1) + '…' : str;
}

// === Helper: pad string for table display ===
function pad(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length);
}

// === Helper: extract people count from description ===
function extractPeopleCount(order) {
  const desc = order.description || '';
  const match = desc.match(/(\d+)\s*(?:person|people|adult|kid|child|pet|dog|cat)/i);
  if (match) return match[1];
  return '?';
}

// === Display: ranked table (list mode) ===
function displayTable(ranked) {
  console.log('');
  console.log('=== Consent Candidates (Ranked by Score) ===');
  console.log('');

  const header = [
    pad('Rank', 5),
    pad('Order ID', 10),
    pad('Brand', 14),
    pad('Score', 6),
    pad('Reaction', 9),
    pad('Customer', 20),
    pad('Tags/Type', 18),
    'OMS URL',
  ].join('  ');

  const divider = '─'.repeat(100);
  console.log(header);
  console.log(divider);

  ranked.forEach((order, idx) => {
    const reaction = order.has_reaction_video ? 'Yes' : 'No';
    const customer = order.customer_name || '?';
    let tags = '';
    if (order.tags) {
      try {
        const parsed = JSON.parse(order.tags);
        tags = Array.isArray(parsed) ? parsed.slice(0, 2).join(', ') : String(parsed);
      } catch (_) {
        tags = String(order.tags).split(',').slice(0, 2).join(', ');
      }
    }

    const row = [
      pad(idx + 1, 5),
      pad(order.order_id, 10),
      pad(order.brand, 14),
      pad(order._score, 6),
      pad(reaction, 9),
      pad(trunc(customer, 20), 20),
      pad(trunc(tags, 18), 18),
      trunc(order.oms_url || '-', 50),
    ].join('  ');

    console.log(row);
  });

  console.log(divider);
  console.log(`Total: ${ranked.length} candidate(s)`);
  console.log('');
}

// === Display: single order detail view ===
function displayOrder(order, rank, total) {
  let tags = [];
  if (order.tags) {
    try {
      const parsed = JSON.parse(order.tags);
      tags = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch (_) {
      tags = String(order.tags).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
    }
  }

  const reaction = order.has_reaction_video ? 'Yes' : 'No';
  const score = typeof order._score === 'number' ? order._score : (order.score || '?');
  const customer = order.customer_name || '?';
  const email = order.customer_email || '?';
  const people = extractPeopleCount(order);
  const dateStr = order.created_at ? order.created_at.split('T')[0].split(' ')[0] : '?';

  console.log('');
  console.log('━'.repeat(70));
  console.log(`  Candidate ${rank}/${total}  [Score: ${score}]`);
  console.log('━'.repeat(70));
  console.log(`  Order ID:     ${order.order_id}`);
  console.log(`  Brand:        ${order.brand}`);
  console.log(`  Customer:     ${customer}  <${email}>`);
  console.log(`  Order date:   ${dateStr}`);
  console.log(`  Reaction:     ${reaction}`);
  if (order.has_reaction_video && order.reaction_video_url) {
    console.log(`  Video URL:    ${order.reaction_video_url}`);
  }
  console.log(`  People:       ${people}`);
  console.log(`  Layout:       ${order.layout || '?'}`);
  console.log(`  Tags:         ${tags.join(', ') || '-'}`);
  if (order.description) {
    console.log(`  Description:  ${trunc(order.description, 80)}`);
  }
  if (order.oms_url) {
    console.log(`  Illustration: ${order.oms_url}`);
  }
  if (order.photos_url) {
    console.log(`  Photos:       ${order.photos_url}`);
  }
  // Price and items -- try from description or tags
  const priceMatch = order.description ? order.description.match(/\$[\d,]+(?:\.\d{2})?/) : null;
  console.log(`  Price:        ${priceMatch ? priceMatch[0] : '-'}`);
  const itemsMatch = order.description ? order.description.match(/(\d+)\s*item/i) : null;
  console.log(`  Items:        ${itemsMatch ? itemsMatch[1] : '-'}`);
  console.log('━'.repeat(70));
}

// === Display: full JSON details ===
function displayDetails(order) {
  console.log('');
  console.log('=== Full Order Details ===');
  console.log(JSON.stringify(order, null, 2));
}

// === Main interactive review ===
async function review() {
  const allCandidates = getCandidates();

  if (allCandidates.length === 0) {
    console.log('No consent candidates found.');
    console.log(`  Brand filter: ${brandFilter || 'all brands'}`);
    console.log(`  Looking for: consent_status=pre_approved AND production_status=pending`);
    process.exit(0);
  }

  // Rank using scorer
  const ranked = scorer.rankOrders(allCandidates)
    .filter(o => o._score >= minScore)
    .slice(0, limit);

  if (ranked.length === 0) {
    console.log(`No candidates with score >= ${minScore} (found ${allCandidates.length} total, all below threshold).`);
    process.exit(0);
  }

  // Show list mode table if requested
  if (listMode) {
    displayTable(ranked);
  }

  console.log(`\n=== Consent Batch Approval -- ${ranked.length} candidate(s) ===`);
  console.log('Approve sets consent_status=pending (ready for consent email).\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  let approved = 0;
  let rejected = 0;
  let skipped = 0;

  for (let i = 0; i < ranked.length; i++) {
    const order = ranked[i];
    const rank = i + 1;

    displayOrder(order, rank, ranked.length);

    let decided = false;
    while (!decided) {
      const answer = await ask('  [a]pprove  [s]kip  [r]eject  [v]iew details  [q]uit --> ');

      switch (answer.toLowerCase().trim()) {
        case 'a':
        case 'approve': {
          const result = consent.updateConsent(
            order.order_id,
            order.brand,
            'pending',
            'Luis approved for consent email'
          );
          if (result.changes > 0) {
            console.log('  -> Approved for consent email (consent_status=pending)');
            approved++;
          } else {
            console.log('  -> No changes (order may have been updated already)');
          }
          decided = true;
          break;
        }

        case 's':
        case 'skip':
          console.log('  -> Skipped (will appear next time)');
          skipped++;
          decided = true;
          break;

        case 'r':
        case 'reject': {
          const result = consent.updateConsent(
            order.order_id,
            order.brand,
            'denied',
            'Luis rejected for consent'
          );
          if (result.changes > 0) {
            console.log('  -> Rejected (consent_status=denied, won\'t appear again)');
            rejected++;
          } else {
            console.log('  -> No changes (order may have been updated already)');
          }
          decided = true;
          break;
        }

        case 'v':
        case 'view':
          displayDetails(order);
          break;

        case 'q':
        case 'quit':
          console.log('\n=== Review Stopped ===');
          console.log(`  Approved: ${approved}`);
          console.log(`  Rejected: ${rejected}`);
          console.log(`  Skipped:  ${skipped}`);
          console.log(`  Remaining: ${ranked.length - i}`);
          rl.close();
          process.exit(0);

        default:
          console.log('  Invalid choice. Use [a], [s], [r], [v], or [q]');
      }
    }
  }

  console.log('\n=== Review Complete ===');
  console.log(`  Approved: ${approved}`);
  console.log(`  Rejected: ${rejected}`);
  console.log(`  Skipped:  ${skipped}`);

  rl.close();
}

review().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
