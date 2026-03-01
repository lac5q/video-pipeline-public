'use strict';

const path = require('path');
const { getDatabase } = require('./db');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// Tags that contribute to diversity scoring
const VALUABLE_TAGS = [
  'family', 'couple', 'dad', 'mom', 'kids', 'pet', 'wedding',
  'birthday', 'anniversary', 'graduation', 'holiday', 'valentine',
  'christmas', 'mother', 'father', 'grandparent', 'baby', 'friends'
];

/**
 * Score a single order row from the database.
 *
 * Scoring algorithm (total 130 points max):
 *   Original signals (100 points):
 *   - reaction_score: score field * 10 (max 50 points)
 *   - clear_product:  15 points if clear product visibility
 *   - layout_bonus:   5 points for portrait layout
 *   - recency:        10 points scaled by order age (newer = more)
 *   - tags_diversity: up to 10 points for useful tags
 *   - has_good_hook:  10 points if tags JSON contains "Good for Hook"
 *
 *   Phase 3 signals (30 points):
 *   - illustrationQuality: up to 10 points (inferred from product/order metadata)
 *   - peopleCount:   up to 10 points (more people = more visual interest)
 *   - bodyFraming:   up to 10 points (full-body outranks shoulder-up)
 *
 * @param {object} orderRow - A row from the orders table
 * @returns {{ total: number, breakdown: object }}
 */
function scoreOrder(orderRow) {
  const breakdown = {
    reaction: 0,
    clearProduct: 0,
    layout: 0,
    recency: 0,
    tags: 0,
    hook: 0,
    illustrationQuality: 0,
    peopleCount: 0,
    bodyFraming: 0,
  };

  // --- Reaction score: score * 10, capped at 50 ---
  const rawScore = Number(orderRow.score) || 0;
  breakdown.reaction = Math.min(rawScore * 10, 50);

  // --- Clear product visibility: 15 points ---
  if (orderRow.clear_product) {
    breakdown.clearProduct = 15;
  }

  // --- Layout bonus: 5 points for portrait ---
  const layout = (orderRow.layout || '').toLowerCase();
  if (layout === 'portrait' || layout === 'port') {
    breakdown.layout = 5;
  }

  // --- Recency: 10 points scaled by age (newer = more) ---
  if (orderRow.created_at) {
    const created = new Date(orderRow.created_at);
    const now = new Date();
    const daysSinceCreation = (now - created) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation <= 7) {
      breakdown.recency = 10;
    } else if (daysSinceCreation <= 30) {
      breakdown.recency = 8;
    } else if (daysSinceCreation <= 90) {
      breakdown.recency = 5;
    } else if (daysSinceCreation <= 180) {
      breakdown.recency = 3;
    } else {
      breakdown.recency = 1;
    }
  }

  // --- Tags diversity: up to 10 points ---
  let parsedTags = [];
  if (orderRow.tags) {
    try {
      const raw = JSON.parse(orderRow.tags);
      parsedTags = Array.isArray(raw) ? raw.map(t => String(t).toLowerCase()) : [];
    } catch (_) {
      // Treat as comma-separated string
      parsedTags = String(orderRow.tags).toLowerCase().split(/[,;]+/).map(t => t.trim());
    }
  }

  const matchedTags = parsedTags.filter(t =>
    VALUABLE_TAGS.some(vt => t.includes(vt))
  );
  breakdown.tags = Math.min(matchedTags.length * 2, 10);

  // --- Good hook: 10 points ---
  const hasGoodHook = parsedTags.some(t => t.includes('good for hook') || t === 'hook');
  if (hasGoodHook) {
    breakdown.hook = 10;
  }

  // --- Illustration quality proxy: up to 10 points ---
  // Inferred from product category and order completeness
  // Wall art orders (framed_poster, canvas) suggest higher quality illustrations
  const description = (orderRow.description || '').toLowerCase();
  if (description.includes('canvas') || description.includes('framed') || description.includes('poster')) {
    breakdown.illustrationQuality += 5;
  }
  // Complete OMS data (all key fields populated) suggests quality order
  const fieldsFilled = ['score', 'clear_product', 'layout', 'tags', 'description']
    .filter(f => orderRow[f] != null && orderRow[f] !== '').length;
  if (fieldsFilled >= 4) {
    breakdown.illustrationQuality += 3;
  }
  // Has reaction video = strong signal of engaged customer = likely quality order
  if (orderRow.has_reaction_video || orderRow.reaction_video_url) {
    breakdown.illustrationQuality += 2;
  }
  breakdown.illustrationQuality = Math.min(breakdown.illustrationQuality, 10);

  // --- People count: up to 10 points ---
  // More people in illustration = more visual interest in video
  const familyTags = parsedTags.some(t => t.includes('family') || t.includes('kids') || t.includes('grandparent'));
  const coupleTags = parsedTags.some(t => t.includes('couple') || t.includes('wedding') || t.includes('anniversary'));
  const singleTags = parsedTags.some(t => t.includes('single') || t.includes('solo') || t.includes('self'));

  if (familyTags) {
    breakdown.peopleCount = 10; // 4+ people
  } else if (coupleTags) {
    breakdown.peopleCount = 7;  // 2 people
  } else if (singleTags) {
    breakdown.peopleCount = 5;  // 1 person
  } else {
    breakdown.peopleCount = 3;  // Unknown
  }

  // --- Body framing: up to 10 points ---
  // Full-body outranks shoulder-up per user decision
  const hasFullBody = parsedTags.some(t => t.includes('full-body') || t.includes('full body'));
  const hasHalfBody = parsedTags.some(t => t.includes('half-body') || t.includes('waist-up') || t.includes('half body'));
  const hasHeadshot = parsedTags.some(t => t.includes('shoulder-up') || t.includes('headshot') || t.includes('head shot'));

  if (hasFullBody) {
    breakdown.bodyFraming = 10;
  } else if (hasHalfBody) {
    breakdown.bodyFraming = 7;
  } else if (hasHeadshot) {
    breakdown.bodyFraming = 4;
  } else {
    breakdown.bodyFraming = 3; // Unknown framing
  }

  const total =
    breakdown.reaction +
    breakdown.clearProduct +
    breakdown.layout +
    breakdown.recency +
    breakdown.tags +
    breakdown.hook +
    breakdown.illustrationQuality +
    breakdown.peopleCount +
    breakdown.bodyFraming;

  return { total, breakdown };
}

/**
 * Sort orders by total score descending.
 *
 * @param {object[]} orders - Array of order rows
 * @returns {object[]} Sorted array with score data attached
 */
function rankOrders(orders) {
  return orders
    .map(order => {
      const scoring = scoreOrder(order);
      return { ...order, _score: scoring.total, _breakdown: scoring.breakdown };
    })
    .sort((a, b) => b._score - a._score);
}

/**
 * Get top candidate orders for a brand, ready for production.
 *
 * @param {string} brand   - Brand slug
 * @param {number} limit   - Max number to return (default 10)
 * @param {number} minScore - Minimum total score (default 40)
 * @returns {object[]} Top-ranked orders
 */
function getTopCandidates(brand, limit = 10, minScore = 40) {
  const db = getDatabase();

  let query = `
    SELECT * FROM orders
    WHERE consent_status IN ('approved', 'pre_approved')
  `;
  const params = [];

  if (brand) {
    query += ' AND brand = ?';
    params.push(brand);
  }

  const orders = db.prepare(query).all(...params);
  db.close();

  const ranked = rankOrders(orders);
  return ranked
    .filter(o => o._score >= minScore)
    .slice(0, limit);
}

module.exports = { scoreOrder, rankOrders, getTopCandidates, VALUABLE_TAGS };
