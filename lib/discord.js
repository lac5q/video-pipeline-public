'use strict';

const https = require('https');
const url = require('url');

/**
 * Send a message to Discord via webhook.
 *
 * @param {string} message - Plain text content
 * @param {object} [options] - Optional settings
 * @param {object} [options.embed] - Discord embed object { title, description, color, fields[] }
 * @returns {Promise<void>}
 */
function sendDiscord(message, options = {}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    process.stderr.write(
      '[discord] DISCORD_WEBHOOK_URL not set — skipping notification\n'
    );
    return Promise.resolve();
  }

  const body = { content: message };
  if (options.embed) {
    body.embeds = [options.embed];
  }

  const payload = JSON.stringify(body);
  const parsed = new URL(webhookUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            process.stderr.write(
              `[discord] Webhook returned ${res.statusCode}: ${data}\n`
            );
            resolve(); // Non-fatal — don't reject
          }
        });
      }
    );

    req.on('error', (err) => {
      process.stderr.write(`[discord] Webhook error: ${err.message}\n`);
      resolve(); // Non-fatal
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Format a run summary as a Discord embed.
 *
 * @param {object} stats
 * @param {string} stats.runId
 * @param {string} stats.brandsProcessed
 * @param {number} stats.ordersAttempted
 * @param {number} stats.ordersSucceeded
 * @param {number} stats.ordersFailed
 * @param {number} stats.ordersSkipped
 * @param {string[]} stats.errors - Error messages
 * @param {string} stats.duration - Human-readable duration
 * @returns {object} Discord embed object
 */
function formatRunSummary(stats) {
  // Green if no failures, yellow if some, red if circuit breaker
  let color;
  if (stats.ordersFailed === 0) {
    color = 3066993; // Green
  } else if (stats.circuitBreaker) {
    color = 15158332; // Red
  } else {
    color = 16776960; // Yellow
  }

  const fields = [
    {
      name: 'Brands',
      value: stats.brandsProcessed || 'none',
      inline: true,
    },
    {
      name: 'Orders',
      value: `${stats.ordersSucceeded}/${stats.ordersAttempted} succeeded`,
      inline: true,
    },
    {
      name: 'Duration',
      value: stats.duration || 'unknown',
      inline: true,
    },
  ];

  if (stats.ordersFailed > 0) {
    fields.push({
      name: 'Failed',
      value: String(stats.ordersFailed),
      inline: true,
    });
  }

  if (stats.ordersSkipped > 0) {
    fields.push({
      name: 'Skipped',
      value: String(stats.ordersSkipped),
      inline: true,
    });
  }

  if (stats.errors && stats.errors.length > 0) {
    const errorText = stats.errors.join('\n').slice(0, 1024);
    fields.push({
      name: 'Errors',
      value: errorText,
      inline: false,
    });
  }

  return {
    title: stats.circuitBreaker
      ? 'Pipeline Stopped -- Circuit Breaker'
      : 'Daily Pipeline Run Summary',
    description: `Run: ${stats.runId}`,
    color,
    fields,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send a circuit breaker alert to Discord.
 *
 * @param {number} consecutiveErrors - Number of consecutive errors
 * @param {string[]} lastErrors - Recent error messages
 * @returns {Promise<void>}
 */
function sendCircuitBreaker(consecutiveErrors, lastErrors) {
  const embed = {
    title: 'Pipeline Stopped -- Circuit Breaker Tripped',
    description: `${consecutiveErrors} consecutive orders failed. Pipeline halted to prevent compounding failures.`,
    color: 15158332, // Red
    fields: [],
    timestamp: new Date().toISOString(),
  };

  if (lastErrors && lastErrors.length > 0) {
    embed.fields.push({
      name: 'Recent Errors',
      value: lastErrors.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.fields.push({
    name: 'Action Required',
    value:
      'Review errors and re-run with `./scripts/daily-pipeline.sh --requeue`',
    inline: false,
  });

  return sendDiscord(null, { embed });
}

module.exports = { sendDiscord, formatRunSummary, sendCircuitBreaker };
