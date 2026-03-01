'use strict';

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with rate limit detection and exponential backoff.
 *
 * Detects HTTP 429 responses (or errors mentioning "429") and retries with
 * exponential backoff. Used to wrap Printful, Gooten, and Gemini API calls
 * during batch processing.
 *
 * @param {Function} fn - Async function to execute
 * @param {object} options
 * @param {number} [options.maxRetries=3] - Maximum number of retries
 * @param {number} [options.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @param {string} [options.label='API call'] - Label for logging
 * @returns {Promise<*>} Result of fn()
 */
async function withRateLimit(fn, { maxRetries = 3, baseDelay = 1000, label = 'API call' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status =
        err.statusCode ||
        err.status ||
        (err.message && err.message.includes('429') ? 429 : 0);

      if (status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`  [RATE LIMIT] ${label}: retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

module.exports = { withRateLimit, sleep };
