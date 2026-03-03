'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { google } = require('googleapis');
const path = require('path');

/**
 * Google Sheets client for reading tracking spreadsheets.
 *
 * Auth priority:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY env var (path to service account JSON)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var (Application Default Credentials)
 */

let _authClient = null;

/**
 * Resolve a Google auth client using available credentials.
 * Caches the client for reuse across calls.
 */
async function getAuthClient() {
  if (_authClient) return _authClient;

  let credentials;

  // Priority 1: JSON string in env var (for cloud deployments like Railway)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else {
    // Priority 2: File path
    const serviceAccountKeyPath =
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!serviceAccountKeyPath) {
      throw new Error(
        'ERROR: No Google credentials configured. ' +
          'Set GOOGLE_SERVICE_ACCOUNT_JSON (JSON string) or GOOGLE_SERVICE_ACCOUNT_KEY (file path).'
      );
    }

    const resolvedPath = path.resolve(serviceAccountKeyPath);
    credentials = require(resolvedPath);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  _authClient = await auth.getClient();
  return _authClient;
}

/**
 * Fetch data from a Google Sheets spreadsheet.
 *
 * @param {string} spreadsheetId - The spreadsheet ID from the URL
 * @param {string} range - A1 notation range (e.g. "Sheet1!A1:Z")
 * @returns {Promise<string[][]>} Rows as arrays of strings
 */
async function getSheetData(spreadsheetId, range) {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    return [];
  }

  return rows;
}

module.exports = { getSheetData, getAuthClient };
