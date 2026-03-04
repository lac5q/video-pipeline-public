'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const { getSheetData } = require('../lib/sheets-client');
const { getDatabase } = require('../lib/db');

// === Spreadsheet configuration ===
// Configuration can be overridden by environment variables for flexibility

const DEFAULT_SHEETS = {
  turnedyellow: {
    spreadsheetId: '1KFToq2s9Pul4e1qQ5UcGP9XR0IIavSaraJbyf-4mJgI',
    range: 'Customer Reaction Videos!A1:U',
    brand: 'turnedyellow',
    headerRow: 2, // 2 metadata rows before actual header
    // Column indices (0-based) — indices 9 & 10 are empty spacer columns
    columns: {
      dateAdded: 0,
      videoLink: 1,
      fileName: 2,
      score: 3,
      startTime: 4,
      endTime: 5,
      startTime2: 6,
      endTime2: 7,
      screenshot: 8,
      tags: 11,
      clearProduct: 12,
      photosLink: 13,
      omsLink: 14,
      layout: 15,
      source: 16,
      holiday: 17,
      description: 18,
      creativeScript: 19,
      adCreatives: 20,
    },
  },
  makemejedi: {
    spreadsheetId: '1kii13Ztckn-T_sEu0npPeJRyfX2gNf9DzVeFV7jgZ_E',
    range: 'Customer Reaction Videos!A1:AA',
    brand: 'makemejedi',
    columns: {
      videoLink: 0,
      fileName: 1,
      score: 2,
      goodForHook: 3,
      startTime: 4,
      endTime: 5,
      startTime2: 6,
      endTime2: 7,
      screenshot: 8,
      clearProduct: 9,
      photosLink: 10,
      omsLink: 11,
      layout: 12,
      tags: 13,
      source: 14,
      holiday: 15,
      reactionCopy: 16,
      description: 17,
      adCreatives: 18,
      aiNumPeople: 19,
      aiMen: 20,
      aiWomen: 21,
      aiKids: 22,
      aiPets: 23,
      aiHolidayTheme: 24,
      aiLaughterIntensity: 25,
    },
  },
};

// Allow dynamic configuration via environment variables
function loadSpreadsheetConfig() {
  const configJson = process.env.SPREADSHEET_CONFIG;
  if (configJson) {
    try {
      const customConfig = JSON.parse(configJson);
      console.log('Using custom spreadsheet configuration from environment');
      return { ...DEFAULT_SHEETS, ...customConfig };
    } catch (err) {
      console.error('Error parsing SPREADSHEET_CONFIG:', err.message);
      console.log('Falling back to default configuration');
    }
  }
  return DEFAULT_SHEETS;
}

const SHEETS = loadSpreadsheetConfig();

/**
 * Extract order ID from a filename by stripping the extension.
 * Examples: "133627.mov" -> "133627", "some-uuid.mp4" -> "some-uuid"
 */
function extractOrderId(fileName) {
  if (!fileName || typeof fileName !== 'string') return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  // Strip file extension
  const base = path.basename(trimmed).replace(/\.[^.]+$/, '');
  return base || null;
}

/**
 * Extract illustration ID from an OMS URL.
 * URL patterns:
 *   https://doh.turnedyellow.com/customer/illustration/{id}
 *   https://theforce.makemejedi.com/customer/illustration/{id}
 */
function extractIllustrationId(omsUrl) {
  if (!omsUrl || typeof omsUrl !== 'string') return null;
  const match = omsUrl.match(/\/illustration\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Parse a "yes"/"no"/boolean-like value to 0 or 1.
 */
function parseBool(val) {
  if (!val) return 0;
  const lower = String(val).trim().toLowerCase();
  if (lower === 'yes' || lower === 'y' || lower === 'true' || lower === '1') return 1;
  return 0;
}

/**
 * Parse score, returning integer or null.
 */
function parseScore(val) {
  if (!val) return null;
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? null : n;
}

/**
 * Safely get a cell value from a row, returning empty string if missing.
 */
function cell(row, index) {
  if (index === undefined || index === null) return '';
  return (row[index] || '').trim();
}

/**
 * Import rows from a single tracking sheet into the database.
 */
async function importSheet(db, config) {
  const { spreadsheetId, range, brand, columns } = config;

  console.log(`=== Fetching ${brand} tracking sheet ===`);
  const rows = await getSheetData(spreadsheetId, range);

  if (rows.length < 2) {
    console.log(`  No data rows found for ${brand}`);
    return 0;
  }

  // Skip metadata + header rows (headerRow is 0-based index of header)
  const skipRows = (config.headerRow || 0) + 1;
  const dataRows = rows.slice(skipRows);

  const upsert = db.prepare(`
    INSERT INTO orders (
      order_id, brand, consent_status, score, layout,
      has_reaction_video, reaction_video_url,
      reaction_start, reaction_end, reaction_start2, reaction_end2,
      photos_url, oms_url, illustration_id,
      tags, description, clear_product, source, holiday,
      production_status, updated_at
    ) VALUES (
      @order_id, @brand, 'pre_approved', @score, @layout,
      @has_reaction_video, @reaction_video_url,
      @reaction_start, @reaction_end, @reaction_start2, @reaction_end2,
      @photos_url, @oms_url, @illustration_id,
      @tags, @description, @clear_product, @source, @holiday,
      'pending', datetime('now')
    )
    ON CONFLICT(order_id, brand) DO UPDATE SET
      score = @score,
      layout = @layout,
      has_reaction_video = @has_reaction_video,
      reaction_video_url = @reaction_video_url,
      reaction_start = @reaction_start,
      reaction_end = @reaction_end,
      reaction_start2 = @reaction_start2,
      reaction_end2 = @reaction_end2,
      photos_url = @photos_url,
      oms_url = @oms_url,
      illustration_id = @illustration_id,
      tags = @tags,
      description = @description,
      clear_product = @clear_product,
      source = @source,
      holiday = @holiday,
      updated_at = datetime('now')
  `);

  let imported = 0;
  let skipped = 0;

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const fileName = cell(row, columns.fileName);
      const orderId = extractOrderId(fileName);

      if (!orderId) {
        skipped++;
        continue;
      }

      const videoLink = cell(row, columns.videoLink);
      const omsUrl = cell(row, columns.omsLink);
      const tagsRaw = cell(row, columns.tags);

      // Normalize tags: split by comma, trim, filter empty, store as JSON
      let tags = null;
      if (tagsRaw) {
        const tagList = tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        if (tagList.length > 0) tags = JSON.stringify(tagList);
      }

      upsert.run({
        order_id: orderId,
        brand,
        score: parseScore(cell(row, columns.score)),
        layout: cell(row, columns.layout) || null,
        has_reaction_video: videoLink ? 1 : 0,
        reaction_video_url: videoLink || null,
        reaction_start: cell(row, columns.startTime) || null,
        reaction_end: cell(row, columns.endTime) || null,
        reaction_start2: cell(row, columns.startTime2) || null,
        reaction_end2: cell(row, columns.endTime2) || null,
        photos_url: cell(row, columns.photosLink) || null,
        oms_url: omsUrl || null,
        illustration_id: extractIllustrationId(omsUrl),
        tags,
        description: cell(row, columns.description) || null,
        clear_product: parseBool(cell(row, columns.clearProduct)),
        source: cell(row, columns.source) || null,
        holiday: cell(row, columns.holiday) || null,
      });
      imported++;
    }
  });

  insertMany(dataRows);
  console.log(`  Imported: ${imported}, Skipped (no order ID): ${skipped}`);
  return imported;
}

async function main() {
  const db = getDatabase();

  try {
    let totalCount = 0;
    const results = [];

    // Import from all configured sheets
    for (const [brandKey, config] of Object.entries(SHEETS)) {
      try {
        const count = await importSheet(db, config);
        results.push({ brand: config.brand, count });
        totalCount += count;
        console.log(`  Imported ${count} ${config.brand} orders`);
      } catch (err) {
        console.error(`  Error importing ${config.brand}:`, err.message);
      }
    }

    console.log('');
    console.log(`=== Import complete ===`);
    console.log(`  Total imported: ${totalCount} orders from ${results.length} brands`);
    results.forEach(result => {
      if (result.count > 0) {
        console.log(`    ${result.count} ${result.brand} orders`);
      }
    });
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
