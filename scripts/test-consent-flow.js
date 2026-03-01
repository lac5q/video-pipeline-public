#!/usr/bin/env node
'use strict';

// End-to-end smoke test for the consent flow pipeline.
// Validates: state transitions, token generation/validation, email template
// rendering, consent server routes, and batch sender filtering.
//
// Usage: DB_PATH=/tmp/test-consent-flow.db node scripts/test-consent-flow.js
//
// Does NOT send real emails or hit real Shopify/APIs.

// Must set DB_PATH BEFORE requiring any lib modules that cache it
const TEST_DB_PATH = process.env.DB_PATH || '/tmp/test-consent-flow.db';
process.env.DB_PATH = TEST_DB_PATH;

const path = require('path');
const fs = require('fs');
const http = require('http');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failedTests = [];

function pass(name) {
  passCount++;
  console.log(`  [PASS] ${name}`);
}

function fail(name, reason) {
  failCount++;
  failedTests.push({ name, reason });
  console.log(`  [FAIL] ${name}: ${reason}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

function assert(condition, name, reason) {
  if (condition) {
    pass(name);
  } else {
    fail(name, reason || 'Assertion failed');
  }
}

// ---------------------------------------------------------------------------
// HTTP helper (promise-based, no external deps)
// ---------------------------------------------------------------------------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Request timeout: ${url}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Setup: Initialize schema and insert test orders
// ---------------------------------------------------------------------------
function setup() {
  section('Setup: Initialize test DB and insert test orders');

  // Remove stale test DB if exists
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log(`  Removed existing test DB: ${TEST_DB_PATH}`);
  }

  // Require consent AFTER setting DB_PATH env
  const consent = require(path.join(PIPELINE_ROOT, 'lib', 'consent'));
  const db = consent.getDb();

  // Ensure oms_url column exists (not in minimal consent.js schema)
  try {
    db.exec('ALTER TABLE orders ADD COLUMN oms_url TEXT');
  } catch (_e) {
    // Already exists -- ignore
  }

  // Insert 3 test orders
  const insert = db.prepare(`
    INSERT OR REPLACE INTO orders
      (order_id, brand, consent_status, customer_email, customer_name, oms_url, order_description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    'TEST-001', 'turnedyellow', 'pre_approved',
    'test@example.com', 'Test User',
    'https://doh.turnedyellow.com/customer/illustration/test123',
    'Custom portrait illustration'
  );

  insert.run(
    'TEST-002', 'makemejedi', 'pre_approved',
    null, null,
    null,
    'Jedi portrait'
  );

  insert.run(
    'TEST-003', 'turnedyellow', 'pre_approved',
    'test2@example.com', 'Another User',
    null,
    'Custom family portrait'
  );

  // Verify inserts
  const count = db.prepare("SELECT COUNT(*) as c FROM orders WHERE order_id LIKE 'TEST-%'").get();
  assert(count.c === 3, 'All 3 test orders inserted', `Expected 3, got ${count.c}`);
  console.log(`  Test DB: ${TEST_DB_PATH}`);

  return consent;
}

// ---------------------------------------------------------------------------
// Test 1: Consent state transitions (CONS-02)
// ---------------------------------------------------------------------------
async function testStateTransitions(consent) {
  section('Test 1: Consent state transitions (CONS-02)');

  // Transition TEST-001 from pre_approved to pending
  const result = consent.updateConsent('TEST-001', 'turnedyellow', 'pending', 'test approval');
  assert(result.changes === 1, 'updateConsent returns 1 change', `Got ${result.changes} changes`);

  // Verify status updated
  const status = consent.getConsentStatus('TEST-001', 'turnedyellow');
  assert(
    status && status.consent_status === 'pending',
    'consent_status is now "pending"',
    `Got: ${status ? status.consent_status : 'null'}`
  );

  // Verify consent_log has entry with action='consent_pending'
  const db = consent.getDb();
  const logEntry = db
    .prepare("SELECT * FROM consent_log WHERE order_id = 'TEST-001' AND action = 'consent_pending' ORDER BY id DESC LIMIT 1")
    .get();
  assert(
    logEntry && logEntry.action === 'consent_pending',
    'consent_log has consent_pending entry',
    `Got: ${logEntry ? logEntry.action : 'null'}`
  );
}

// ---------------------------------------------------------------------------
// Test 2: Token generation and validation (CONS-04)
// ---------------------------------------------------------------------------
async function testTokens(consent) {
  section('Test 2: Token generation and validation (CONS-04)');

  const { approveToken, denyToken } = consent.generateConsentToken('TEST-001', 'turnedyellow');

  // Tokens should be 64-char hex strings (32 bytes = 64 hex chars)
  assert(
    typeof approveToken === 'string' && approveToken.length === 64 && /^[0-9a-f]+$/.test(approveToken),
    'approveToken is 64-char hex string',
    `Got: "${approveToken}" (len ${approveToken.length})`
  );
  assert(
    typeof denyToken === 'string' && denyToken.length === 64 && /^[0-9a-f]+$/.test(denyToken),
    'denyToken is 64-char hex string',
    `Got: "${denyToken}" (len ${denyToken.length})`
  );

  // Validate approve token
  const tokenData = consent.validateConsentToken(approveToken);
  assert(
    tokenData !== null,
    'validateConsentToken returns non-null for fresh token',
    'Got null'
  );
  assert(
    tokenData && tokenData.orderId === 'TEST-001',
    'Token orderId matches "TEST-001"',
    `Got: ${tokenData ? tokenData.orderId : 'null'}`
  );
  assert(
    tokenData && tokenData.brand === 'turnedyellow',
    'Token brand matches "turnedyellow"',
    `Got: ${tokenData ? tokenData.brand : 'null'}`
  );
  assert(
    tokenData && tokenData.action === 'approve',
    'Token action is "approve"',
    `Got: ${tokenData ? tokenData.action : 'null'}`
  );

  // Mark token as used
  consent.markTokenUsed(approveToken);

  // Validate again -- should return null (used)
  const tokenDataAfter = consent.validateConsentToken(approveToken);
  assert(
    tokenDataAfter === null,
    'validateConsentToken returns null after token is marked used',
    `Got: ${JSON.stringify(tokenDataAfter)}`
  );
}

// ---------------------------------------------------------------------------
// Test 3: Email template rendering (CONS-01)
// ---------------------------------------------------------------------------
async function testEmailTemplate() {
  section('Test 3: Email template rendering (CONS-01)');

  const email = require(path.join(PIPELINE_ROOT, 'lib', 'email'));
  const templatePath = path.join(PIPELINE_ROOT, 'templates', 'consent-email.html');

  const illustrationUrl = 'https://doh.turnedyellow.com/customer/illustration/test123';
  const testVars = {
    BRAND_NAME: 'TurnedYellow',
    BRAND_BG: '#1a1a2e',
    BRAND_ACCENT: '#FF8C00',
    BRAND_URL: 'TurnedYellow.com',
    BRAND_LOGO_URL: 'https://turnedyellow.com/logo.png',
    CUSTOMER_NAME: 'Test User',
    ORDER_DESCRIPTION: 'Custom portrait illustration',
    APPROVE_URL: 'http://localhost:9999/consent/approvetokenhere',
    DECLINE_URL: 'http://localhost:9999/consent/denytokenhere',
    ILLUSTRATION_URL: illustrationUrl,
  };

  const rendered = email.renderTemplate(templatePath, testVars);

  // Verify CTA
  assert(
    rendered.includes('Yes, share my art'),
    'Rendered HTML contains "Yes, share my art"',
    'CTA text not found'
  );

  // Verify illustration URL is present
  assert(
    rendered.includes(illustrationUrl),
    'Rendered HTML contains illustration URL',
    `URL not found in rendered output`
  );

  // Verify no corporate language
  assert(
    !rendered.toLowerCase().includes('social media'),
    'Rendered HTML does NOT contain "social media"',
    'Found "social media" in rendered output'
  );
  assert(
    !rendered.toLowerCase().includes('marketing materials'),
    'Rendered HTML does NOT contain "marketing materials"',
    'Found "marketing materials" in rendered output'
  );

  // Verify brand name substituted
  assert(
    rendered.includes('TurnedYellow'),
    'Rendered HTML contains "TurnedYellow"',
    'Brand name not found in output'
  );

  // Save rendered HTML for visual inspection
  const outputPath = '/tmp/test-consent-email.html';
  fs.writeFileSync(outputPath, rendered, 'utf8');
  console.log(`  Rendered email HTML saved to: ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Test 4: Consent server routes (CONS-04)
// ---------------------------------------------------------------------------
async function testConsentServer(consent) {
  section('Test 4: Consent server routes (CONS-04)');

  // Generate fresh tokens for TEST-003
  const { approveToken } = consent.generateConsentToken('TEST-003', 'turnedyellow');

  // Import the app (exported as module.exports = app)
  const app = require(path.join(PIPELINE_ROOT, 'scripts', 'consent-server'));

  // Start server on random port
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, (err) => {
      if (err) return reject(err);
      resolve(s);
    });
  });

  const port = server.address().port;
  console.log(`  Consent server started on port ${port}`);

  try {
    // Test GET /consent/:token (landing page)
    const landingRes = await httpGet(`http://localhost:${port}/consent/${approveToken}`);
    assert(
      landingRes.statusCode === 200,
      `GET /consent/:token returns 200 (got ${landingRes.statusCode})`,
      `Expected 200, got ${landingRes.statusCode}`
    );
    assert(
      landingRes.body.toLowerCase().includes('share my art'),
      'Landing page body contains "share my art"',
      'CTA text not found in landing page'
    );

    // Test GET /consent/:token/confirm (approval flow)
    // Note: this also marks the token used and sets consent_status to approved
    const confirmRes = await httpGet(`http://localhost:${port}/consent/${approveToken}/confirm`);
    assert(
      confirmRes.statusCode === 200,
      `GET /consent/:token/confirm returns 200 (got ${confirmRes.statusCode})`,
      `Expected 200, got ${confirmRes.statusCode}`
    );
    assert(
      confirmRes.body.toLowerCase().includes('thank'),
      'Confirm page body contains "Thank"',
      'Thank you text not found in confirm page'
    );

    // Verify TEST-003 consent_status is now 'approved' in DB
    const statusAfter = consent.getConsentStatus('TEST-003', 'turnedyellow');
    assert(
      statusAfter && statusAfter.consent_status === 'approved',
      'TEST-003 consent_status is "approved" after confirm',
      `Got: ${statusAfter ? statusAfter.consent_status : 'null'}`
    );

    // Test GET /status (health check)
    const statusRes = await httpGet(`http://localhost:${port}/status`);
    assert(
      statusRes.statusCode === 200,
      `GET /status returns 200 (got ${statusRes.statusCode})`,
      `Expected 200, got ${statusRes.statusCode}`
    );
    let statusJson;
    try {
      statusJson = JSON.parse(statusRes.body);
    } catch (_e) {
      statusJson = null;
    }
    assert(
      statusJson && statusJson.status === 'ok',
      'GET /status JSON contains "ok"',
      `Got: ${statusRes.body.substring(0, 100)}`
    );
  } finally {
    // Stop server
    await new Promise((resolve) => server.close(resolve));
    console.log('  Consent server stopped.');
  }
}

// ---------------------------------------------------------------------------
// Test 5: Batch sender skips orders with missing emails (CONS-01)
// ---------------------------------------------------------------------------
async function testBatchSenderFilter(consent) {
  section('Test 5: Batch sender skips orders with missing emails (CONS-01)');

  // Set TEST-002 to pending
  consent.updateConsent('TEST-002', 'makemejedi', 'pending', 'test batch filter');

  // listPendingConsent should return TEST-002
  const pending = consent.listPendingConsent('makemejedi');
  const test002 = pending.find((o) => o.order_id === 'TEST-002');

  assert(
    test002 !== undefined,
    'TEST-002 is returned by listPendingConsent("makemejedi")',
    'TEST-002 not found in pending list'
  );

  // TEST-002 should have null customer_email
  assert(
    test002 && (test002.customer_email === null || test002.customer_email === undefined || test002.customer_email === ''),
    'TEST-002 has null/empty customer_email (would be skipped by batch sender)',
    `Got customer_email: "${test002 ? test002.customer_email : 'N/A'}"`
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function cleanup() {
  section('Cleanup');
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log(`  Deleted test DB: ${TEST_DB_PATH}`);
  } else {
    console.log(`  Test DB not found at ${TEST_DB_PATH} (may have already been cleaned up)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log('=================================================');
  console.log('  Consent Flow Smoke Test');
  console.log(`  DB: ${TEST_DB_PATH}`);
  console.log('=================================================');

  let consent;
  try {
    consent = setup();
  } catch (err) {
    console.error('FATAL: Setup failed:', err.message);
    process.exit(1);
  }

  // Run all test sections
  const tests = [
    () => testStateTransitions(consent),
    () => testTokens(consent),
    () => testEmailTemplate(),
    () => testConsentServer(consent),
    () => testBatchSenderFilter(consent),
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      console.error('  [ERROR] Unhandled exception in test:', err.message);
      failCount++;
      failedTests.push({ name: 'unhandled', reason: err.message });
    }
  }

  cleanup();

  // Summary
  const total = passCount + failCount;
  console.log('\n=================================================');
  console.log(`  Results: ${passCount}/${total} tests passed`);
  if (failedTests.length > 0) {
    console.log('\n  Failed tests:');
    for (const t of failedTests) {
      console.log(`    - ${t.name}: ${t.reason}`);
    }
  }
  console.log('=================================================');

  if (failCount > 0) {
    process.exit(1);
  }
})();
