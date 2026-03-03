#!/usr/bin/env node
'use strict';

/**
 * Send consent request emails in batch.
 *
 * Usage:
 *   node scripts/send-consent-batch.js [OPTIONS]
 *
 * Options:
 *   --brand SLUG   Send for a specific brand only
 *   --dry-run      Show what would be sent without actually sending
 *   --limit N      Maximum number of emails to send (default: 10)
 */

const path = require('path');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const consent = require(path.join(PIPELINE_ROOT, 'lib', 'consent'));
const email = require(path.join(PIPELINE_ROOT, 'lib', 'email'));

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { brand: null, dryRun: false, limit: 10 };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--brand':
        args.brand = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--limit':
        args.limit = parseInt(argv[++i], 10) || 10;
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        console.error('Usage: node scripts/send-consent-batch.js [--brand SLUG] [--dry-run] [--limit N]');
        process.exit(1);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);

  console.log('--- Consent Batch Sender ---');
  console.log(`  Brand filter: ${args.brand || 'all'}`);
  console.log(`  Dry run:      ${args.dryRun}`);
  console.log(`  Limit:        ${args.limit}`);
  console.log('');

  // Get pending orders
  const pending = consent.listPendingConsent(args.brand || undefined);

  if (pending.length === 0) {
    console.log('No pending consent requests found.');
    return;
  }

  console.log(`Found ${pending.length} pending order(s).`);

  const toSend = pending.slice(0, args.limit);
  console.log(`Will process ${toSend.length} order(s).\n`);

  let sent = 0;
  let failed = 0;

  for (const order of toSend) {
    const orderId = order.order_id;
    const brand = order.brand;
    const customerEmail = order.customer_email;
    const customerName = order.customer_name || 'Valued Customer';
    const orderDescription = order.order_description || `Order ${orderId}`;

    if (!customerEmail) {
      console.log(`  SKIP  ${orderId} (${brand}) -- no email address`);
      failed++;
      continue;
    }

    if (args.dryRun) {
      console.log(`  DRY   ${orderId} (${brand}) -> ${customerEmail} [${customerName}]`);
      sent++;
      continue;
    }

    try {
      await email.sendConsentRequest(
        orderId,
        brand,
        customerEmail,
        customerName,
        orderDescription
      );
      console.log(`  SENT  ${orderId} (${brand}) -> ${customerEmail}`);
      sent++;
    } catch (err) {
      console.error(`  FAIL  ${orderId} (${brand}) -> ${customerEmail}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log('--- Summary ---');
  console.log(`  Sent:    ${sent}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Total:   ${sent + failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
