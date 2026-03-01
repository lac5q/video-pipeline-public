'use strict';

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

/**
 * Base class for OMS adapters.
 * Provides a unified interface for fetching order assets regardless of source.
 */
class OmsAdapter {
  /**
   * Factory method: create the correct adapter for a brand.
   * @param {object} brandConfig - Parsed brand JSON config
   * @returns {OmsAdapter}
   */
  static create(brandConfig) {
    if (brandConfig.oms_app) {
      return new SharedOmsAdapter(brandConfig);
    }
    if (brandConfig.heroku_app) {
      return new PopSmithsAdapter(brandConfig);
    }
    throw new Error(`No OMS configured for brand: ${brandConfig.slug}`);
  }

  constructor(brandConfig) {
    this.brandConfig = brandConfig;
    this.slug = brandConfig.slug;
  }

  /**
   * Fetch illustration for an order.
   * @param {string} orderId
   * @param {string} workspace - Path to order workspace directory
   * @returns {Promise<{success: boolean, path: string|null, error: string|null}>}
   */
  async fetchIllustration(orderId, workspace) {
    return { success: false, path: null, error: 'Not implemented' };
  }

  /**
   * Fetch customer photos for an order.
   * @param {string} orderId
   * @param {string} workspace
   * @returns {Promise<{success: boolean, path: string|null, error: string|null}>}
   */
  async fetchPhotos(orderId, workspace) {
    return { success: false, path: null, error: 'Not implemented' };
  }

  /**
   * Fetch reaction video for an order.
   * @param {string} orderId
   * @param {string} workspace
   * @returns {Promise<{success: boolean, path: string|null, error: string|null}>}
   */
  async fetchReactionVideo(orderId, workspace) {
    return { success: false, path: null, error: 'Not implemented' };
  }
}

/**
 * Adapter for shared-OMS brands (TurnedYellow, MakeMeJedi, TurnedWizard, TurnedComics).
 * Fetches assets from the brand's OMS app (e.g., turnedyellowordermanagement.com).
 */
class SharedOmsAdapter extends OmsAdapter {
  constructor(brandConfig) {
    super(brandConfig);
    this.omsApp = brandConfig.oms_app;
  }

  /**
   * Download a file from a URL to a local path.
   * @param {string} url
   * @param {string} destPath
   * @returns {Promise<void>}
   */
  _download(url, destPath) {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      proto.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect
          this._download(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  async fetchIllustration(orderId, workspace) {
    try {
      // Get order data from database to find illustration_id
      const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
      const db = getDatabase();
      const order = db.prepare('SELECT illustration_id, oms_url FROM orders WHERE order_id = ? AND brand = ?')
        .get(orderId, this.slug);
      db.close();

      if (!order || !order.illustration_id) {
        return { success: false, path: null, error: 'No illustration_id in database' };
      }

      const illustrationUrl = `https://${this.omsApp}.com/api/illustration/${order.illustration_id}/image`;
      const destPath = path.join(workspace, 'mockups', 'illustration.png');
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      await this._download(illustrationUrl, destPath);
      return { success: true, path: destPath, error: null };
    } catch (err) {
      return { success: false, path: null, error: err.message };
    }
  }

  async fetchPhotos(orderId, workspace) {
    try {
      const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
      const db = getDatabase();
      const order = db.prepare('SELECT photos_url FROM orders WHERE order_id = ? AND brand = ?')
        .get(orderId, this.slug);
      db.close();

      if (!order || !order.photos_url) {
        return { success: false, path: null, error: 'No photos_url in database' };
      }

      const photosDir = path.join(workspace, 'photos');
      fs.mkdirSync(photosDir, { recursive: true });

      // Extract Google Drive folder ID
      const match = order.photos_url.match(/folders\/([^/?]+)/);
      if (!match) {
        return { success: false, path: null, error: 'Could not extract Drive folder ID from photos_url' };
      }

      // Photos download requires gdown or manual download
      // Return the URL for the download script to handle
      return { success: false, path: photosDir, error: `Drive folder download needed: ${order.photos_url}` };
    } catch (err) {
      return { success: false, path: null, error: err.message };
    }
  }

  async fetchReactionVideo(orderId, workspace) {
    try {
      const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));
      const db = getDatabase();
      const order = db.prepare('SELECT reaction_video_url FROM orders WHERE order_id = ? AND brand = ?')
        .get(orderId, this.slug);
      db.close();

      if (!order || !order.reaction_video_url) {
        return { success: false, path: null, error: 'No reaction_video_url in database' };
      }

      // Extract Google Drive file ID
      let driveFileId = null;
      const fileMatch = order.reaction_video_url.match(/\/d\/([^/]+)/);
      const idMatch = order.reaction_video_url.match(/[?&]id=([^&]+)/);
      driveFileId = (fileMatch && fileMatch[1]) || (idMatch && idMatch[1]);

      if (!driveFileId) {
        return { success: false, path: null, error: 'Could not extract Drive file ID from reaction_video_url' };
      }

      const destPath = path.join(workspace, `${orderId}.mp4`);
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;

      await this._download(downloadUrl, destPath);
      return { success: true, path: destPath, error: null };
    } catch (err) {
      return { success: false, path: null, error: err.message };
    }
  }
}

/**
 * Adapter for PopSmiths.
 * Fetches art from PopSmiths' Heroku server (not shared OMS).
 * Generates AI lifestyle imagery via Gemini instead of customer photos.
 */
class PopSmithsAdapter extends OmsAdapter {
  constructor(brandConfig) {
    super(brandConfig);
    this.herokuApp = brandConfig.heroku_app;
    this.herokuApiUrl = brandConfig.heroku_api_url || `https://${this.herokuApp}.herokuapp.com`;
  }

  async fetchIllustration(orderId, workspace) {
    try {
      const artUrl = `${this.herokuApiUrl}/api/art/${orderId}`;
      const destPath = path.join(workspace, 'mockups', 'illustration.png');
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // Download art from Heroku
      await new Promise((resolve, reject) => {
        https.get(artUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            https.get(res.headers.location, (res2) => {
              if (res2.statusCode !== 200) {
                reject(new Error(`HTTP ${res2.statusCode} from redirect`));
                return;
              }
              const file = fs.createWriteStream(destPath);
              res2.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} from ${artUrl}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      });

      return { success: true, path: destPath, error: null };
    } catch (err) {
      return { success: false, path: null, error: err.message };
    }
  }

  async fetchPhotos(orderId, workspace) {
    // PopSmiths has no customer photos -- uses AI-generated lifestyle imagery instead
    return { success: false, path: null, error: 'PopSmiths uses AI lifestyle imagery (call generateLifestyleImagery instead)' };
  }

  async fetchReactionVideo(orderId, workspace) {
    // PopSmiths has no customer reaction videos yet
    return { success: false, path: null, error: 'PopSmiths has no customer reaction videos' };
  }

  /**
   * Generate AI lifestyle imagery featuring PopSmiths art using Gemini.
   * Creates styled room/interior scenes with framed art on walls.
   *
   * @param {string} artPath - Path to the art image file
   * @param {string} workspace - Path to order workspace directory
   * @returns {Promise<{success: boolean, paths: string[], error: string|null}>}
   */
  async generateLifestyleImagery(artPath, workspace) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return { success: false, paths: [], error: 'GEMINI_API_KEY not set' };
    }

    if (!fs.existsSync(artPath)) {
      return { success: false, paths: [], error: `Art file not found: ${artPath}` };
    }

    const photosDir = path.join(workspace, 'photos');
    fs.mkdirSync(photosDir, { recursive: true });

    const prompts = [
      'Generate a photorealistic interior design scene of a modern living room with this framed art prominently displayed on the wall above a sofa. Natural lighting, home decoration aesthetic, the art is the focal point. Professional interior photography.',
      'Generate a photorealistic scene of this framed art hanging in a cozy home office with a wooden desk below it. Warm natural light from a window, bookshelves nearby. The art is the star of the room. Interior design photography.',
      'Generate a photorealistic scene of a stylish bedroom with this framed art as the centerpiece above the headboard. Soft ambient lighting, modern minimalist decor. The art draws the eye. Home decor photography.',
    ];

    const base64Image = fs.readFileSync(artPath).toString('base64');
    const mimeType = artPath.endsWith('.jpg') || artPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

    const paths = [];

    for (let i = 0; i < prompts.length; i++) {
      try {
        const body = JSON.stringify({
          contents: [{
            parts: [
              { text: prompts[i] },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            responseMimeType: 'image/png'
          }
        });

        const imageData = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  reject(new Error(parsed.error.message));
                  return;
                }
                const parts = parsed.candidates && parsed.candidates[0] &&
                  parsed.candidates[0].content && parsed.candidates[0].content.parts;
                if (parts) {
                  const imgPart = parts.find(p => p.inlineData);
                  if (imgPart) {
                    resolve(imgPart.inlineData.data);
                    return;
                  }
                }
                reject(new Error('No image in Gemini response'));
              } catch (e) {
                reject(new Error(`Failed to parse Gemini response: ${e.message}`));
              }
            });
          });

          req.on('error', reject);
          req.write(body);
          req.end();
        });

        const destPath = path.join(photosDir, `lifestyle_0${i + 1}.png`);
        fs.writeFileSync(destPath, Buffer.from(imageData, 'base64'));
        paths.push(destPath);
        console.log(`    → Generated lifestyle scene ${i + 1}/3`);
      } catch (err) {
        console.log(`    → Failed to generate scene ${i + 1}/3: ${err.message}`);
      }
    }

    return {
      success: paths.length > 0,
      paths,
      error: paths.length === 0 ? 'All lifestyle image generations failed' : null
    };
  }
}

module.exports = { OmsAdapter, SharedOmsAdapter, PopSmithsAdapter };
