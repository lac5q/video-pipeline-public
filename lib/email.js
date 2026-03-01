'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Resolve pipeline root
// ---------------------------------------------------------------------------
const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Brand config loader
// ---------------------------------------------------------------------------
function loadBrandConfig(brandSlug) {
  const configPath = path.join(PIPELINE_ROOT, 'brands', `${brandSlug}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Brand config not found: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Template rendering (Mustache-style {{VAR}} replacement)
// ---------------------------------------------------------------------------

/**
 * Replace all {{KEY}} placeholders in a template string.
 *
 * @param {string} templatePath - absolute or relative path to the HTML template
 * @param {Record<string, string>} vars - key/value pairs to substitute
 * @returns {string} rendered HTML
 */
function renderTemplate(templatePath, vars) {
  const resolved = path.isAbsolute(templatePath)
    ? templatePath
    : path.join(PIPELINE_ROOT, templatePath);

  let html = fs.readFileSync(resolved, 'utf8');

  for (const [key, value] of Object.entries(vars)) {
    // Replace all occurrences of {{KEY}}
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    html = html.replace(pattern, value || '');
  }

  return html;
}

// ---------------------------------------------------------------------------
// Nodemailer transport (lazy-loaded)
// ---------------------------------------------------------------------------
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  // nodemailer is an optional dependency -- fail clearly if missing
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_err) {
    throw new Error(
      'nodemailer is not installed. Run: npm install nodemailer'
    );
  }

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return _transporter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a consent-request email to a customer.
 *
 * @param {string} orderId
 * @param {string} brand - brand slug
 * @param {string} customerEmail
 * @param {string} customerName
 * @param {string} orderDescription
 * @param {object} [options]
 * @param {string} [options.approveUrl] - pre-built approve URL
 * @param {string} [options.declineUrl] - pre-built decline URL
 * @returns {Promise<object>} nodemailer send result
 */
async function sendConsentRequest(
  orderId,
  brand,
  customerEmail,
  customerName,
  orderDescription,
  options
) {
  const brandConfig = loadBrandConfig(brand);
  const opts = options || {};

  const baseUrl = process.env.CONSENT_BASE_URL || `http://localhost:${process.env.CONSENT_PORT || 3000}`;

  // Generate tokens if URLs not provided
  let approveUrl = opts.approveUrl;
  let declineUrl = opts.declineUrl;

  if (!approveUrl || !declineUrl) {
    const consent = require('./consent');
    const tokens = consent.generateConsentToken(orderId, brand);
    approveUrl = approveUrl || `${baseUrl}/consent/${tokens.approveToken}`;
    declineUrl = declineUrl || `${baseUrl}/consent/${tokens.denyToken}`;
  }

  const logoUrl = opts.logoUrl || `https://${brandConfig.url.toLowerCase()}/logo.png`;

  // Fetch illustration URL from orders table
  let illustrationUrl = '';
  try {
    const consent = require('./consent');
    const db = consent.getDb();
    const orderRow = db
      .prepare('SELECT oms_url, illustration_id FROM orders WHERE order_id = ? AND brand = ?')
      .get(orderId, brand);
    if (orderRow) {
      if (orderRow.oms_url) {
        illustrationUrl = orderRow.oms_url;
      } else if (orderRow.illustration_id) {
        // Fallback: construct from illustration_id using brand slug
        illustrationUrl = `https://doh.${brand}.com/customer/illustration/${orderRow.illustration_id}`;
      }
    }
  } catch (_illErr) {
    // Non-fatal: illustration URL not critical for email delivery
    console.warn('Warning: could not fetch illustration URL:', _illErr.message);
  }

  const html = renderTemplate(
    path.join(PIPELINE_ROOT, 'templates', 'consent-email.html'),
    {
      BRAND_LOGO_URL: logoUrl,
      BRAND_NAME: brandConfig.name,
      BRAND_ACCENT: brandConfig.colors.accent,
      BRAND_BG: brandConfig.colors.background,
      BRAND_URL: brandConfig.url,
      CUSTOMER_NAME: customerName,
      ORDER_DESCRIPTION: orderDescription,
      APPROVE_URL: approveUrl,
      DECLINE_URL: declineUrl,
      ILLUSTRATION_URL: illustrationUrl,
    }
  );

  const transporter = getTransporter();
  const from =
    process.env.SMTP_FROM || `${brandConfig.name} <noreply@${brandConfig.url.toLowerCase()}>`;

  const result = await transporter.sendMail({
    from,
    to: customerEmail,
    subject: `${brandConfig.name} - We loved your art and have a little gift for you!`,
    html,
  });

  // Log to consent_log
  try {
    const consent = require('./consent');
    const db = consent.getDb();
    db.prepare(
      'INSERT INTO consent_log (order_id, brand, action, details) VALUES (?, ?, ?, ?)'
    ).run(orderId, brand, 'consent_email_sent', `Consent email sent to ${customerEmail}`);
  } catch (_logErr) {
    // Non-fatal: log failure should not prevent email from being sent
    console.error('Warning: failed to log consent email send:', _logErr.message);
  }

  return result;
}

/**
 * Send a thank-you email after consent approval.
 *
 * @param {string} orderId
 * @param {string} brand - brand slug
 * @param {string} customerEmail
 * @param {string} customerName
 * @param {string} discountCode
 * @param {string} discountAmount - e.g. "15%", "$10"
 * @returns {Promise<object>} nodemailer send result
 */
async function sendThankYou(
  orderId,
  brand,
  customerEmail,
  customerName,
  discountCode,
  discountAmount
) {
  const brandConfig = loadBrandConfig(brand);

  const logoUrl = `https://${brandConfig.url.toLowerCase()}/logo.png`;

  const html = renderTemplate(
    path.join(PIPELINE_ROOT, 'templates', 'consent-thankyou.html'),
    {
      BRAND_LOGO_URL: logoUrl,
      BRAND_NAME: brandConfig.name,
      BRAND_ACCENT: brandConfig.colors.accent,
      BRAND_BG: brandConfig.colors.background,
      BRAND_URL: brandConfig.url,
      CUSTOMER_NAME: customerName,
      DISCOUNT_CODE: discountCode,
      DISCOUNT_AMOUNT: discountAmount,
    }
  );

  const transporter = getTransporter();
  const from =
    process.env.SMTP_FROM || `${brandConfig.name} <noreply@${brandConfig.url.toLowerCase()}>`;

  const result = await transporter.sendMail({
    from,
    to: customerEmail,
    subject: `${brandConfig.name} - Thank you! Here's your discount`,
    html,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  sendConsentRequest,
  sendThankYou,
  renderTemplate,
  loadBrandConfig,
};
