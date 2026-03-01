#!/usr/bin/env node
// enrich-orders.js -- Populate customer_email and customer_name from Shopify Admin API
// Usage: node scripts/enrich-orders.js [--brand SLUG] [--dry-run] [--limit N]
//
// For each order in DB where customer_email IS NULL, fetches customer data
// from Shopify Admin API and writes it back to the orders table.
'use strict';

require('dotenv').config();
const https = require('https');
const path = require('path');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// === Parse arguments ===
const args = process.argv.slice(2);
let brandFilter = null;
let dryRun = false;
let limit = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--brand':   brandFilter = args[++i]; break;
    case '--dry-run': dryRun = true; break;
    case '--limit':   limit = parseInt(args[++i], 10); break;
    case '--help':
      console.log(`
Usage: node scripts/enrich-orders.js [OPTIONS]

Populates customer_email and customer_name from Shopify Admin API for orders
where that data is missing in the database.

Options:
  --brand SLUG   Only enrich orders for this brand
  --dry-run      Show what would be fetched without making API calls or DB updates
  --limit N      Maximum number of orders to process
  --help         Show this help

Requirements:
  Each brand config (brands/{slug}.json) must have:
    shopify.store              e.g. "turnedyellow.myshopify.com"
    shopify.access_token_env   e.g. "SHOPIFY_TOKEN_TURNEDYELLOW"

  The env var named by access_token_env must be set with the Shopify Admin API token.
`);
      process.exit(0);
  }
}

// === Load database ===
let db;
try {
  db = require('../lib/db').getDatabase();
} catch (err) {
  console.error('ERROR: Cannot load database:', err.message);
  console.error('Run import-tracking-sheets.js first to create the database.');
  process.exit(1);
}

// === Load brand config ===
function loadBrandConfig(brandSlug) {
  const configPath = path.join(PIPELINE_ROOT, 'brands', `${brandSlug}.json`);
  try {
    return require(configPath);
  } catch (_) {
    return null;
  }
}

// === Fetch order from Shopify ===
function fetchShopifyOrder(store, token, orderId) {
  return new Promise((resolve, reject) => {
    const url = `https://${store}/admin/api/2026-01/orders/${orderId}.json`;
    const options = {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    };

    https.get(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve(null); // Order not found in Shopify
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Shopify API returned ${res.statusCode}: ${body.substring(0, 200)}`));
          return;
        }
        try {
          const data = JSON.parse(body);
          resolve(data.order || null);
        } catch (e) {
          reject(new Error(`Failed to parse Shopify response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// === Extract customer info from Shopify order ===
function extractCustomerInfo(shopifyOrder) {
  if (!shopifyOrder) return { email: null, name: null };

  const email = shopifyOrder.email || null;

  let name = null;
  if (shopifyOrder.customer) {
    const first = (shopifyOrder.customer.first_name || '').trim();
    const last = (shopifyOrder.customer.last_name || '').trim();
    if (first || last) {
      name = [first, last].filter(Boolean).join(' ');
    }
  }

  // Fallback: billing_address.name
  if (!name && shopifyOrder.billing_address && shopifyOrder.billing_address.name) {
    name = shopifyOrder.billing_address.name.trim() || null;
  }

  // Fallback: shipping_address.name
  if (!name && shopifyOrder.shipping_address && shopifyOrder.shipping_address.name) {
    name = shopifyOrder.shipping_address.name.trim() || null;
  }

  return { email, name };
}

// === Sleep helper ===
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Main ===
async function main() {
  // Fetch orders missing customer_email
  let sql = "SELECT order_id, brand FROM orders WHERE customer_email IS NULL";
  const params = [];

  if (brandFilter) {
    sql += ' AND brand = ?';
    params.push(brandFilter);
  }

  sql += ' ORDER BY brand, created_at ASC';

  if (limit !== null) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const orders = db.prepare(sql).all(...params);

  if (orders.length === 0) {
    console.log('No orders found with missing customer_email.');
    if (brandFilter) console.log(`  Brand filter: ${brandFilter}`);
    return;
  }

  console.log(`Found ${orders.length} order(s) with missing customer data.`);
  if (dryRun) console.log('DRY RUN mode -- no API calls or DB updates will be made.\n');

  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;

  // Cache brand configs to avoid reloading
  const brandCache = {};

  for (const order of orders) {
    const { order_id, brand } = order;

    // Load brand config (cached)
    if (!brandCache[brand]) {
      brandCache[brand] = loadBrandConfig(brand);
    }
    const brandConfig = brandCache[brand];

    // Validate Shopify config
    if (!brandConfig || !brandConfig.shopify) {
      console.log(`SKIP ${order_id} (${brand}) -- no shopify section in brand config`);
      skipped++;
      continue;
    }

    const { store, access_token_env } = brandConfig.shopify;

    if (!store) {
      console.log(`SKIP ${order_id} (${brand}) -- shopify.store is empty (set in brands/${brand}.json)`);
      skipped++;
      continue;
    }

    if (!access_token_env) {
      console.log(`SKIP ${order_id} (${brand}) -- shopify.access_token_env is not set in brand config`);
      skipped++;
      continue;
    }

    const token = process.env[access_token_env];
    if (!token) {
      console.log(`SKIP ${order_id} (${brand}) -- env var ${access_token_env} not set`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`DRY RUN ${order_id} (${brand}) -- would fetch GET https://${store}/admin/api/2026-01/orders/${order_id}.json`);
      continue;
    }

    // Fetch from Shopify with rate limit delay
    try {
      const shopifyOrder = await fetchShopifyOrder(store, token, order_id);

      if (shopifyOrder === null) {
        console.log(`NOT FOUND ${order_id} (${brand}) -- order not in Shopify (404)`);
        notFound++;
      } else {
        const { email, name } = extractCustomerInfo(shopifyOrder);

        if (!email) {
          console.log(`SKIP ${order_id} (${brand}) -- Shopify order has no email`);
          skipped++;
        } else {
          // Update the database
          db.prepare(
            "UPDATE orders SET customer_email = ?, customer_name = ?, updated_at = datetime('now') WHERE order_id = ? AND brand = ?"
          ).run(email, name || null, order_id, brand);

          console.log(`ENRICHED ${order_id} (${brand}) -> ${email}${name ? ` (${name})` : ''}`);
          enriched++;
        }
      }
    } catch (err) {
      console.error(`ERROR ${order_id} (${brand}) -- ${err.message}`);
      failed++;
    }

    // 500ms delay between API calls to respect Shopify rate limits
    await sleep(500);
  }

  console.log('');
  console.log('=== Enrichment Complete ===');
  if (dryRun) {
    console.log('  DRY RUN -- no changes made');
  } else {
    console.log(`  Enriched: ${enriched}`);
    console.log(`  Not found in Shopify: ${notFound}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors: ${failed}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
