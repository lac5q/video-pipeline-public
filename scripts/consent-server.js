#!/usr/bin/env node
'use strict';

// Dependencies: npm install express
// This server requires: express

const path = require('path');
const fs = require('fs');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Lazy require express (provide clear error if not installed)
// ---------------------------------------------------------------------------
let express;
try {
  express = require('express');
} catch (_err) {
  console.error('Error: express is not installed. Run: npm install express');
  process.exit(1);
}

const consent = require(path.join(PIPELINE_ROOT, 'lib', 'consent'));
const email = require(path.join(PIPELINE_ROOT, 'lib', 'email'));

const PORT = parseInt(process.env.CONSENT_PORT || '3000', 10);

const app = express();

// ---------------------------------------------------------------------------
// Helper: load brand config for styling inline pages
// ---------------------------------------------------------------------------
function getBrandConfig(slug) {
  try {
    return email.loadBrandConfig(slug);
  } catch (_err) {
    return { name: slug, colors: { background: '#1a1a2e', accent: '#FF8C00' }, url: '' };
  }
}

// ---------------------------------------------------------------------------
// Helper: generate a branded inline HTML page
// ---------------------------------------------------------------------------
function brandedPage(brand, title, bodyHtml) {
  const config = getBrandConfig(brand);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${config.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f4f7;
      color: #333;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      max-width: 520px;
      width: 90%;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .header {
      background-color: ${config.colors.background};
      padding: 28px 32px;
      text-align: center;
    }
    .header h2 {
      color: #fff;
      font-size: 22px;
      font-weight: 700;
    }
    .body {
      padding: 32px;
    }
    .body h1 {
      font-size: 24px;
      margin-bottom: 16px;
      color: #333;
    }
    .body p {
      font-size: 16px;
      line-height: 26px;
      color: #555;
      margin-bottom: 16px;
    }
    .illustration-preview {
      text-align: center;
      margin: 20px 0;
    }
    .illustration-preview img {
      max-width: 100%;
      width: 280px;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
      display: inline-block;
    }
    .btn {
      display: inline-block;
      padding: 14px 36px;
      background-color: ${config.colors.accent};
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 700;
      font-size: 16px;
      margin-top: 8px;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: transparent;
      color: #999;
      border: 1px solid #ddd;
    }
    .footer {
      padding: 16px 32px;
      text-align: center;
      font-size: 13px;
      color: #aaa;
      border-top: 1px solid #eee;
    }
    .footer a { color: ${config.colors.accent}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>${config.name}</h2>
    </div>
    <div class="body">
      ${bodyHtml}
    </div>
    <div class="footer">
      <a href="https://${config.url}">${config.url}</a>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helper: fetch order illustration URL from DB
// ---------------------------------------------------------------------------
function getOrderIllustrationUrl(orderId, brand) {
  try {
    const db = consent.getDb();
    const order = db
      .prepare('SELECT oms_url FROM orders WHERE order_id = ? AND brand = ?')
      .get(orderId, brand);
    return (order && order.oms_url) ? order.oms_url : '';
  } catch (_err) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/status', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /consent/:token -- show confirmation page
app.get('/consent/:token', (req, res) => {
  const tokenData = consent.validateConsentToken(req.params.token);

  if (!tokenData) {
    return res.status(400).send(
      brandedPage('turnedyellow', 'Invalid Link', `
        <h1>Link Expired or Invalid</h1>
        <p>This consent link is no longer valid. It may have already been used or expired.</p>
        <p>If you believe this is an error, please contact us and we'll be happy to help.</p>
      `)
    );
  }

  const config = getBrandConfig(tokenData.brand);

  if (tokenData.action === 'approve') {
    const confirmUrl = `/consent/${req.params.token}/confirm`;
    const illustrationUrl = getOrderIllustrationUrl(tokenData.orderId, tokenData.brand);
    const illustrationHtml = illustrationUrl
      ? `<div class="illustration-preview"><img src="${illustrationUrl}" alt="Your custom art"></div>`
      : '';

    return res.send(
      brandedPage(tokenData.brand, 'We\'d love to share your art!', `
        <h1>We'd love to share your art!</h1>
        ${illustrationHtml}
        <p>We really loved how your art turned out and think others would enjoy seeing it too. As a thank-you, you'll get a discount code for your next order!</p>
        <p style="text-align: center; margin-top: 24px;">
          <a href="${confirmUrl}" class="btn">Yes, share my art!</a>
        </p>
        <p style="text-align: center; margin-top: 12px;">
          <a href="/consent/${req.params.token}/decline" style="color: #999; font-size: 14px;">No thanks</a>
        </p>
      `)
    );
  }

  // Deny action -- show decline page directly
  return res.redirect(`/consent/${req.params.token}/decline`);
});

// GET /consent/:token/confirm -- finalize approval
app.get('/consent/:token/confirm', async (req, res) => {
  const tokenData = consent.validateConsentToken(req.params.token);

  if (!tokenData) {
    return res.status(400).send(
      brandedPage('turnedyellow', 'Invalid Link', `
        <h1>Link Expired or Invalid</h1>
        <p>This consent link is no longer valid. It may have already been used or expired.</p>
      `)
    );
  }

  try {
    // Mark token as used
    consent.markTokenUsed(req.params.token);

    // Update consent status
    consent.updateConsent(
      tokenData.orderId,
      tokenData.brand,
      'approved',
      'Approved via email consent link'
    );

    // Also mark any corresponding deny token as used (prevent double-action)
    const db = consent.getDb();
    db.prepare(
      "UPDATE consent_tokens SET used_at = datetime('now') WHERE order_id = ? AND brand = ? AND token != ? AND used_at IS NULL"
    ).run(tokenData.orderId, tokenData.brand, req.params.token);

    const config = getBrandConfig(tokenData.brand);
    const order = consent.getConsentStatus(tokenData.orderId, tokenData.brand);

    // Attempt to create Shopify discount and send thank-you email
    let discountCode = `THANKYOU-${tokenData.orderId.slice(-6).toUpperCase()}`;
    let discountAmount = '15%';

    // Try Shopify discount creation (non-blocking)
    try {
      const shopifyDiscount = await createShopifyDiscount(
        tokenData.brand,
        discountCode,
        15
      );
      if (shopifyDiscount && shopifyDiscount.code) {
        discountCode = shopifyDiscount.code;
      }
    } catch (shopifyErr) {
      console.error('Shopify discount creation failed (non-fatal):', shopifyErr.message);
    }

    // Send thank-you email (non-blocking)
    if (order && order.customer_email) {
      email
        .sendThankYou(
          tokenData.orderId,
          tokenData.brand,
          order.customer_email,
          order.customer_name || 'Valued Customer',
          discountCode,
          discountAmount
        )
        .catch((err) =>
          console.error('Failed to send thank-you email:', err.message)
        );
    }

    const illustrationUrl = getOrderIllustrationUrl(tokenData.orderId, tokenData.brand);
    const illustrationHtml = illustrationUrl
      ? `<div class="illustration-preview"><img src="${illustrationUrl}" alt="Your custom art"></div>`
      : '';

    return res.send(
      brandedPage(tokenData.brand, 'Thank you so much!', `
        <h1>Thank you so much!</h1>
        ${illustrationHtml}
        <p>We truly appreciate you sharing your art with us. It means the world to our team at <strong>${config.name}</strong>.</p>
        <p>Here's your discount code -- use it on your next order!</p>
        <div style="background: ${config.colors.background}; padding: 24px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="color: rgba(255,255,255,0.7); font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px 0;">Your Discount Code</p>
          <p style="color: ${config.colors.accent}; font-size: 28px; font-weight: 800; letter-spacing: 3px; font-family: monospace; margin: 0 0 8px 0;">${discountCode}</p>
          <p style="color: #fff; font-size: 14px; margin: 0;">${discountAmount} off your next order</p>
        </div>
        <p style="text-align: center; margin-top: 24px;">
          <a href="https://${config.url}" class="btn">Visit ${config.name}</a>
        </p>
      `)
    );
  } catch (err) {
    console.error('Error processing consent approval:', err);
    return res.status(500).send(
      brandedPage(tokenData.brand, 'Error', `
        <h1>Something went wrong</h1>
        <p>We encountered an error processing your response. Please try again later or contact us for help.</p>
      `)
    );
  }
});

// GET /consent/:token/decline -- mark as declined
app.get('/consent/:token/decline', (req, res) => {
  const tokenData = consent.validateConsentToken(req.params.token);

  if (!tokenData) {
    return res.status(400).send(
      brandedPage('turnedyellow', 'Invalid Link', `
        <h1>Link Expired or Invalid</h1>
        <p>This consent link is no longer valid.</p>
      `)
    );
  }

  try {
    consent.markTokenUsed(req.params.token);

    consent.updateConsent(
      tokenData.orderId,
      tokenData.brand,
      'denied',
      'Declined via email consent link'
    );

    // Also mark any corresponding approve token as used
    const db = consent.getDb();
    db.prepare(
      "UPDATE consent_tokens SET used_at = datetime('now') WHERE order_id = ? AND brand = ? AND token != ? AND used_at IS NULL"
    ).run(tokenData.orderId, tokenData.brand, req.params.token);

    const config = getBrandConfig(tokenData.brand);

    return res.send(
      brandedPage(tokenData.brand, 'No Problem', `
        <h1>No problem at all!</h1>
        <p>We completely understand and respect your decision.</p>
        <p>Thank you for being a <strong>${config.name}</strong> customer -- we hope you love your order!</p>
        <p style="text-align: center; margin-top: 24px;">
          <a href="https://${config.url}" class="btn">Visit ${config.name}</a>
        </p>
      `)
    );
  } catch (err) {
    console.error('Error processing consent decline:', err);
    return res.status(500).send(
      brandedPage(tokenData ? tokenData.brand : 'turnedyellow', 'Error', `
        <h1>Something went wrong</h1>
        <p>We encountered an error processing your response. Please try again later.</p>
      `)
    );
  }
});

// ---------------------------------------------------------------------------
// Shopify discount code creation via GraphQL (best-effort)
// ---------------------------------------------------------------------------
async function createShopifyDiscount(brand, code, percentOff) {
  // Load brand config to get Shopify credentials
  let brandConfig;
  try {
    brandConfig = email.loadBrandConfig(brand);
  } catch (_err) {
    console.warn('Could not load brand config for Shopify -- skipping discount creation');
    return { code };
  }

  const store =
    brandConfig.shopify && brandConfig.shopify.store
      ? brandConfig.shopify.store
      : null;

  const tokenEnv =
    brandConfig.shopify && brandConfig.shopify.access_token_env
      ? brandConfig.shopify.access_token_env
      : null;

  const token = tokenEnv ? process.env[tokenEnv] : null;

  if (!store || !token) {
    console.warn(
      `Shopify credentials not configured for brand "${brand}" -- skipping discount creation`
    );
    return { code };
  }

  // Use native https to avoid extra dependencies
  const https = require('https');

  const mutation = `mutation($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

  const variables = {
    input: {
      title: code,
      code: code,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      customerSelection: { all: true },
      customerGets: {
        value: { percentage: 0.15 },
        items: { all: true },
      },
      usageLimit: 1,
    },
  };

  const body = JSON.stringify({ query: mutation, variables });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: store,
        path: '/admin/api/2026-01/graphql.json',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            const result =
              parsed.data && parsed.data.discountCodeBasicCreate;

            if (result && result.userErrors && result.userErrors.length > 0) {
              console.error(
                'Shopify GraphQL userErrors:',
                JSON.stringify(result.userErrors)
              );
              resolve({ code });
            } else {
              resolve({ code });
            }
          } catch (_e) {
            resolve({ code });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('Shopify GraphQL request error:', err.message);
      resolve({ code });
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Consent server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/status`);
  });
}

module.exports = app;
