'use strict';

const path = require('path');
const fs = require('fs');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

// Brand-specific default hashtags
const BRAND_HASHTAGS = {
  turnedyellow: ['#TurnedYellow', '#CustomArt', '#PersonalizedGift', '#HandIllustrated', '#UniqueGifts'],
  makemejedi: ['#MakeMeJedi', '#JediPortrait', '#StarWarsArt', '#CustomPortrait', '#FandomArt'],
  turnedwizard: ['#TurnedWizard', '#WizardPortrait', '#HarryPotterArt', '#MagicPortrait', '#FandomGift'],
  turnedcomics: ['#TurnedComics', '#ComicArt', '#ComicPortrait', '#CustomComic', '#PopArt'],
  popsmiths: ['#PopSmiths', '#CustomFramedArt', '#HomeDecor', '#PersonalizedArt', '#WallArt'],
};

// Trending/general hashtags by category
const TRENDING_TAGS = {
  reaction: ['#UnboxingReaction', '#CustomerReaction', '#GiftReaction', '#Surprise'],
  gift: ['#PerfectGift', '#GiftIdeas', '#UniqueGifts', '#PersonalizedGifts'],
  family: ['#FamilyPortrait', '#FamilyGift', '#FamilyLove'],
  couple: ['#CoupleGoals', '#CoupleGift', '#Anniversary'],
  holiday: ['#HolidayGift', '#ChristmasGift', '#ValentinesDay'],
};

// Audio suggestions per platform/mood
const AUDIO_SUGGESTIONS = {
  reaction_upbeat: {
    youtube: 'Upbeat royalty-free track (e.g., "Happy Day" by Mixaund). Keep reaction audio audible.',
    tiktok: 'Use trending sound or original audio from reaction video. Layer light background music.',
    instagram: 'Upbeat instrumental loop. Keep under 15s for Reels algorithm boost.',
    x: 'N/A (video auto-plays muted on X — rely on captions)',
  },
  showcase_chill: {
    youtube: 'Chill lo-fi or acoustic background track. No vocals to compete with product visuals.',
    tiktok: 'Trending chill/aesthetic sound. Check TikTok Creative Center for current top sounds.',
    instagram: 'Soft instrumental or trending Reels audio. Match brand aesthetic.',
    x: 'N/A (video auto-plays muted on X — rely on captions)',
  },
};

// Platform-specific posting notes
const POSTING_NOTES = {
  youtube: {
    ugc: 'Upload as YouTube Short (vertical, < 60s). Enable "Allow embedding". Set visibility to Unlisted first, then Public after thumbnail review.',
    reel: 'Upload as YouTube Short. Add end screen with subscribe CTA. Schedule during peak hours (2-4 PM EST).',
  },
  tiktok: {
    ugc: 'Post during peak hours (7-9 PM). Enable Duet and Stitch for engagement. Add 2-3 relevant topics via TikTok Creator Tools.',
    reel: 'Use "Photo Mode" carousel if no reaction. Otherwise standard video post. Enable comments for engagement.',
  },
  instagram: {
    ugc: 'Post as Reel (not Story). Use cover image from best frame. Add to "Customer Reactions" highlight. Enable Remix.',
    reel: 'Post as Reel. Add product tags if Shop is set up. Cross-post to Facebook. Use collab tag if customer consented to tagging.',
  },
  x: {
    ugc: 'Post with media. Pin if engagement is high. Quote-tweet from brand account if posted from personal.',
    reel: 'Post with media. Keep tweet text punchy — the video does the talking. Add alt text for accessibility.',
  },
};

/**
 * Parse order tags from JSON or comma-separated string.
 */
function parseTags(tagsField) {
  if (!tagsField) return [];
  try {
    const parsed = JSON.parse(tagsField);
    return Array.isArray(parsed) ? parsed.map(t => String(t).trim()) : [];
  } catch (_) {
    return String(tagsField).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  }
}

/**
 * Build a short tag summary for descriptions (e.g., "Family, Dad").
 */
function tagSummary(tags) {
  return tags.filter(t => !t.toLowerCase().includes('good for hook')).slice(0, 3).join(', ');
}

/**
 * Truncate text to max length, appending ellipsis if needed.
 */
function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Select relevant trending hashtags based on order tags.
 */
function selectTrendingTags(tags) {
  const lowerTags = tags.map(t => t.toLowerCase());
  const result = [];

  for (const [category, hashtags] of Object.entries(TRENDING_TAGS)) {
    const matches = lowerTags.some(t => t.includes(category));
    if (matches) {
      result.push(...hashtags.slice(0, 2));
    }
  }

  // Always include reaction if has_reaction_video
  if (result.length === 0) {
    result.push(...TRENDING_TAGS.gift.slice(0, 2));
  }

  return result;
}

/**
 * Generate platform-specific social copy for an order.
 *
 * @param {object} order - Order row from database
 * @param {object} brandConfig - Parsed brand JSON config
 * @returns {{ youtube: object, tiktok: object, instagram: object, x: object }}
 */
function generateCopy(order, brandConfig) {
  const brandName = brandConfig.name;
  const brandUrl = brandConfig.url;
  const tagline = brandConfig.tagline || '';
  const tags = parseTags(order.tags);
  const description = order.description || '';
  const holiday = order.holiday || '';
  const layout = order.layout || '';
  const hasReaction = Boolean(order.has_reaction_video);

  const brandHashtags = BRAND_HASHTAGS[brandConfig.slug] || [`#${brandName.replace(/\s+/g, '')}`];
  const trendingTags = selectTrendingTags(tags);
  const tagStr = tagSummary(tags);

  // Build base description elements
  const subjectLine = tagStr ? `${tagStr} portrait` : 'custom portrait';
  const reactionNote = hasReaction ? 'Watch the real customer reaction!' : '';

  // === YouTube ===
  const ytTitle = truncate(
    hasReaction
      ? `${brandName} ${subjectLine} - Real Customer Reaction`
      : `${brandName} ${subjectLine} Showcase`,
    60
  );

  const ytDescription = [
    reactionNote || `Check out this ${subjectLine} from ${brandName}.`,
    '',
    tagline,
    '',
    `Order yours: ${brandUrl}`,
    '',
    '--- Timestamps ---',
    hasReaction ? '0:00 Intro' : '0:00 Product Showcase',
    hasReaction ? '0:02 Customer Reaction' : '',
    hasReaction ? '0:10 Product Showcase' : '',
    '',
    `#${brandName.replace(/\s+/g, '')} ${brandHashtags.slice(1, 4).join(' ')}`,
  ].filter(Boolean).join('\n');

  const ytTags = [...brandHashtags, ...trendingTags].slice(0, 15);

  // === TikTok ===
  const ttCaption = truncate(
    hasReaction
      ? `Wait for the reaction! ${subjectLine} by ${brandName}`
      : `${subjectLine} by ${brandName} - ${tagline}`,
    150
  );
  const ttHashtags = [...brandHashtags.slice(0, 3), ...trendingTags.slice(0, 3), '#FYP', '#CustomArt'];

  // === Instagram ===
  const igCaption = [
    hasReaction
      ? `The reaction says it all! This ${subjectLine} made their day.`
      : `Another stunning ${subjectLine} from ${brandName}.`,
    '',
    tagline,
    '',
    `Shop the link in bio or visit ${brandUrl}`,
    holiday ? `Perfect for ${holiday}!` : '',
  ].filter(Boolean).join('\n');

  const igHashtags = [
    ...brandHashtags,
    ...trendingTags,
    '#CustomPortrait', '#PersonalizedGifts', '#ArtOfTheDay',
    '#GiftIdeas', '#SmallBusiness', '#HandmadeGifts',
  ].slice(0, 30);

  const igAltText = `A ${layout || 'portrait'} format product showcase video from ${brandName} featuring a ${subjectLine}.`;

  // === X / Twitter ===
  const xTweet = truncate(
    hasReaction
      ? `This customer reaction is everything! ${subjectLine} by ${brandName}. Order yours at ${brandUrl}`
      : `Check out this ${subjectLine} from ${brandName}! ${tagline} ${brandUrl}`,
    280
  );
  const xHashtags = brandHashtags.slice(0, 2).concat(trendingTags.slice(0, 1));

  // Select audio mood based on content type
  const audioMood = hasReaction ? 'reaction_upbeat' : 'showcase_chill';
  const audioSuggestions = AUDIO_SUGGESTIONS[audioMood];

  // Determine video type for posting notes (caller can override via options)
  const videoType = hasReaction ? 'ugc' : 'reel';

  return {
    youtube: {
      title: ytTitle,
      description: ytDescription,
      tags: ytTags,
      audio_suggestion: audioSuggestions.youtube,
      posting_notes: POSTING_NOTES.youtube[videoType],
    },
    tiktok: {
      caption: ttCaption,
      hashtags: ttHashtags,
      audio_suggestion: audioSuggestions.tiktok,
      posting_notes: POSTING_NOTES.tiktok[videoType],
    },
    instagram: {
      caption: igCaption,
      hashtags: igHashtags,
      alt_text: igAltText,
      audio_suggestion: audioSuggestions.instagram,
      posting_notes: POSTING_NOTES.instagram[videoType],
    },
    x: {
      tweet: xTweet,
      hashtags: xHashtags,
      audio_suggestion: audioSuggestions.x,
      posting_notes: POSTING_NOTES.x[videoType],
    },
  };
}

/**
 * Format generated copy as markdown.
 */
function formatAsMarkdown(copy, order, brandConfig) {
  const lines = [];
  lines.push(`# Social Copy - ${brandConfig.name} - Order ${order.order_id}`);
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  // YouTube
  lines.push('## YouTube');
  lines.push('');
  lines.push(`**Title:** ${copy.youtube.title}`);
  lines.push('');
  lines.push('**Description:**');
  lines.push('```');
  lines.push(copy.youtube.description);
  lines.push('```');
  lines.push('');
  lines.push(`**Tags:** ${copy.youtube.tags.join(', ')}`);
  lines.push('');
  lines.push(`**Audio:** ${copy.youtube.audio_suggestion}`);
  lines.push('');
  lines.push(`**Posting Notes:** ${copy.youtube.posting_notes}`);
  lines.push('');

  // TikTok
  lines.push('## TikTok');
  lines.push('');
  lines.push(`**Caption:** ${copy.tiktok.caption}`);
  lines.push('');
  lines.push(`**Hashtags:** ${copy.tiktok.hashtags.join(' ')}`);
  lines.push('');
  lines.push(`**Audio:** ${copy.tiktok.audio_suggestion}`);
  lines.push('');
  lines.push(`**Posting Notes:** ${copy.tiktok.posting_notes}`);
  lines.push('');

  // Instagram
  lines.push('## Instagram');
  lines.push('');
  lines.push('**Caption:**');
  lines.push('```');
  lines.push(copy.instagram.caption);
  lines.push('```');
  lines.push('');
  lines.push(`**Hashtags:** ${copy.instagram.hashtags.join(' ')}`);
  lines.push('');
  lines.push(`**Alt Text:** ${copy.instagram.alt_text}`);
  lines.push('');
  lines.push(`**Audio:** ${copy.instagram.audio_suggestion}`);
  lines.push('');
  lines.push(`**Posting Notes:** ${copy.instagram.posting_notes}`);
  lines.push('');

  // X / Twitter
  lines.push('## X / Twitter');
  lines.push('');
  lines.push(`**Tweet:** ${copy.x.tweet}`);
  lines.push('');
  lines.push(`**Hashtags:** ${copy.x.hashtags.join(' ')}`);
  lines.push('');
  lines.push(`**Audio:** ${copy.x.audio_suggestion}`);
  lines.push('');
  lines.push(`**Posting Notes:** ${copy.x.posting_notes}`);
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateCopy, formatAsMarkdown, parseTags, BRAND_HASHTAGS };
