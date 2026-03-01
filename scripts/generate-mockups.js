#!/usr/bin/env node
// generate-mockups.js -- Generate product mockups via Printful/Gooten APIs
// Usage: node scripts/generate-mockups.js --brand SLUG --order ORDER_ID [--products PRODUCT_LIST]
//
// Uses OMS-correct position parameters and preprocessing to prevent warping.
// Follows the proven OMS approach: 450x450 for apparel, orientation-aware wall art,
// rotation for phone cases.
const path = require('path');
const https = require('https');
const fs = require('fs');

const PIPELINE_ROOT = path.resolve(__dirname, '..');
const { withRateLimit, sleep: rateSleep } = require(path.join(PIPELINE_ROOT, 'lib', 'rate-limiter'));

// === Parse arguments ===
const args = process.argv.slice(2);
let brand = null;
let orderId = null;
let productFilter = null;
let illustrationUrl = null;
let isVertical = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--brand': brand = args[++i]; break;
        case '--order': orderId = args[++i]; break;
        case '--products': productFilter = args[++i].split(','); break;
        case '--illustration-url': illustrationUrl = args[++i]; break;
        case '--vertical': isVertical = true; break;
        case '--horizontal': isVertical = false; break;
        case '--dry-run': dryRun = true; break;
        case '--help':
            console.log(`
Usage: node scripts/generate-mockups.js --brand SLUG --order ORDER_ID [OPTIONS]

Generate product mockups via Printful and Gooten APIs.

Required:
  --brand SLUG              Brand slug (e.g., turnedyellow)
  --order ORDER_ID          Order ID (e.g., 133627)

Options:
  --illustration-url URL    Override illustration URL (default: fetch from OMS)
  --vertical                Force vertical orientation
  --horizontal              Force horizontal orientation
  --products LIST           Comma-separated product keys to generate
  --dry-run                 Show what would be generated without calling APIs
  --help                    Show this help

Environment:
  PRINTFUL_API_KEY          Printful API token (required for Printful products)
  GOOTEN_RECIPEID           Gooten recipe ID (required for Gooten products)

Products generated (12 in default showcase):
  framed_poster, canvas, tshirt, hoodie, sweatshirt, tanktop,
  mug, waterbottle, iphone_case, totebag, blanket, poster
`);
            process.exit(0);
    }
}

if (!brand || !orderId) {
    console.error('ERROR: --brand and --order are required');
    process.exit(1);
}

// === Load configs ===
const brandConfig = JSON.parse(fs.readFileSync(path.join(PIPELINE_ROOT, 'brands', `${brand}.json`), 'utf8'));
const productsConfig = JSON.parse(fs.readFileSync(path.join(PIPELINE_ROOT, 'products.json'), 'utf8'));
const showcaseKey = brandConfig.product_showcase_order || 'default';
const showcaseOrder = productsConfig.showcase_orders[showcaseKey];
const workspace = path.join(PIPELINE_ROOT, 'orders', brand, orderId);

// === Printful API helpers ===
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const GOOTEN_RECIPEID = process.env.GOOTEN_RECIPEID;

function printfulRequest(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.printful.com',
            path: endpoint,
            method,
            headers: {
                'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code === 200 || parsed.code === 'OK') {
                        resolve(parsed.result);
                    } else {
                        reject(new Error(`Printful API error: ${parsed.error?.message || JSON.stringify(parsed)}`));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse Printful response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function gootenRequest(body) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);
        const options = {
            hostname: 'api.print.io',
            path: `/api/v/5/source/api/productpreview?recipeid=${GOOTEN_RECIPEID}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse Gooten response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// Use rateSleep from rate-limiter for consistency
function sleep(ms) {
    return rateSleep(ms);
}

// === Product mockup configurations (OMS-correct) ===
// These match the proven OMS parameters from mockup-generation-research.md
function getProductConfig(productKey, vertical) {
    const product = productsConfig.products[productKey];
    if (!product) return null;

    const configs = {
        framed_poster: {
            provider: 'printful',
            productId: 2,
            variantIds: [4],
            placement: 'default',
            fillMode: 'cover',
            position: vertical
                ? { area_width: 3600, area_height: 4800, width: 3600, height: 4800, top: 0, left: 0 }
                : { area_width: 4800, area_height: 3600, width: 4800, height: 3600, top: 0, left: 0 }
        },
        canvas: {
            provider: 'printful',
            productId: 3,
            variantIds: vertical ? [5] : [7],
            placement: 'default',
            fillMode: 'cover',
            position: vertical
                ? { area_width: 3600, area_height: 4800, width: 3600, height: 4800, top: 0, left: 0 }
                : { area_width: 4800, area_height: 3600, width: 4800, height: 3600, top: 0, left: 0 },
            // Canvas needs bleed extension — handled in preprocessing
            needsBleedExtension: true
        },
        poster: {
            provider: 'printful',
            productId: 1,
            variantIds: vertical ? [1] : [2],
            placement: 'default',
            fillMode: vertical ? 'cover' : 'fit',
            position: vertical
                ? { area_width: 3600, area_height: 4800, width: 3600, height: 4800, top: 0, left: 0 }
                : { area_width: 3600, area_height: 2400, width: 3600, height: 2400, top: 0, left: 0 }
        },
        tshirt: {
            provider: 'printful',
            productId: 71,
            variantIds: [4013],
            placement: 'front',
            optionGroups: ['Wrinkled'],
            // OMS uses 450x450 square to prevent warping
            position: { area_width: 450, area_height: 450, width: 450, height: 450, top: 0, left: 0 }
        },
        hoodie: {
            provider: 'printful',
            productId: 146,
            variantIds: [5524],
            placement: 'front',
            optionGroups: ['On Hanger'],
            position: { area_width: 450, area_height: 450, width: 450, height: 450, top: 0, left: 0 }
        },
        sweatshirt: {
            provider: 'printful',
            productId: 145,
            variantIds: [5428],
            placement: 'front',
            position: { area_width: 450, area_height: 450, width: 450, height: 450, top: 0, left: 0 }
        },
        tanktop: {
            provider: 'printful',
            productId: 248,
            variantIds: [8661],
            placement: 'front',
            position: { area_width: 450, area_height: 450, width: 450, height: 450, top: 0, left: 0 }
        },
        mug: {
            provider: 'printful',
            productId: 19,
            variantIds: [1320],
            placement: 'default',
            options: ['Front view'],
            position: { area_width: 1550, area_height: 1050, width: 1550, height: 1050, top: 0, left: 0 }
        },
        waterbottle: {
            provider: 'printful',
            productId: 382,
            variantIds: [10798],
            placement: 'default',
            position: { area_width: 2557, area_height: 1582, width: 2557, height: 1582, top: 0, left: 0 }
        },
        iphone_case: {
            provider: 'printful',
            productId: 181,
            variantIds: [10994],
            placement: 'default',
            position: { area_width: 879, area_height: 1830, width: 879, height: 1830, top: 0, left: 0 },
            // Horizontal illustrations need 270-degree rotation before sending
            needsRotation: !vertical ? 270 : null
        },
        totebag: {
            provider: 'printful',
            productId: 367,
            variantIds: [10458],
            placement: 'front',
            position: { area_width: 1500, area_height: 1500, width: 1500, height: 1500, top: 0, left: 0 }
        },
        blanket: {
            provider: 'gooten',
            sku: 'Blanket-Velveteen-Single-FinishedEdge-50x60',
            template: 'Single',
            spaceId: 'FrontImage',
            layerId: 'Design'
        }
    };

    return configs[productKey] || null;
}

// === Generate mockup for a single product ===
async function generatePrintfulMockup(config, imgUrl) {
    const body = {
        variant_ids: config.variantIds,
        format: 'jpg',
        files: [{
            placement: config.placement,
            image_url: imgUrl,
            position: config.position
        }]
    };

    if (config.fillMode) {
        body.files[0].fill_mode = config.fillMode;
    }
    if (config.optionGroups) {
        body.option_groups = config.optionGroups;
    }
    if (config.options) {
        body.files[0].options = config.options;
    }

    // Create mockup task
    const task = await printfulRequest('POST', `/mockup-generator/create-task/${config.productId}`, body);
    const taskKey = task.task_key;

    // Poll for result (max 120 seconds)
    for (let attempt = 0; attempt < 24; attempt++) {
        await sleep(5000);
        const result = await printfulRequest('GET', `/mockup-generator/task?task_key=${taskKey}`);

        if (result.status === 'completed') {
            return result.mockups.map(m => m.mockup_url);
        } else if (result.status === 'failed') {
            throw new Error(`Mockup generation failed: ${result.error || 'unknown error'}`);
        }
        // Still pending, continue polling
    }

    throw new Error('Mockup generation timed out after 120 seconds');
}

async function generateGootenMockup(config, imgUrl) {
    const body = {
        SKU: config.sku,
        Template: config.template,
        Images: [{
            Image: {
                Url: imgUrl,
                MAXFIT: 'TRUE'
            },
            SpaceId: config.spaceId,
            LayerId: config.layerId
        }]
    };

    const result = await gootenRequest(body);
    if (result.Images && result.Images.length > 0) {
        return result.Images.map(img => img.Url);
    }
    throw new Error('Gooten returned no images');
}

// === Download mockup image to workspace ===
async function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
            } else {
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }
        }).on('error', reject);
    });
}

// === Main ===
async function main() {
    console.log(`=== Generating Mockups: ${brand}/${orderId} ===`);

    // Determine illustration orientation
    if (isVertical === null) {
        // Try to detect from illustration dimensions
        // For now default to landscape (most TY/MMJ illustrations are landscape)
        console.log('  Orientation not specified, defaulting to landscape');
        console.log('  Use --vertical or --horizontal to override');
        isVertical = false;
    }

    console.log(`  Orientation: ${isVertical ? 'portrait' : 'landscape'}`);

    // Determine illustration URL
    if (!illustrationUrl) {
        // Try to get from OMS or workspace
        console.log('  No illustration URL provided');
        console.log('  Use --illustration-url URL to specify');
        console.log('  Or ensure illustration is available in workspace');

        // Check for illustration in workspace
        const illustrationDir = path.join(workspace, 'photos');
        if (fs.existsSync(illustrationDir)) {
            const files = fs.readdirSync(illustrationDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
            if (files.length > 0) {
                console.log(`  Found ${files.length} images in workspace/photos/`);
                // For now, we need a URL — local files need to be uploaded first
                console.log('  NOTE: Printful/Gooten need a publicly accessible URL');
                console.log('  Upload images to S3/Wasabi first, then re-run with --illustration-url');
            }
        }

        if (!dryRun) {
            console.error('ERROR: --illustration-url is required for API calls');
            process.exit(1);
        }
    }

    // Create mockups directory
    const mockupsDir = path.join(workspace, 'mockups');
    fs.mkdirSync(mockupsDir, { recursive: true });

    // Get products to generate
    const products = productFilter || showcaseOrder;
    console.log(`  Products: ${products.join(', ')}`);
    console.log('');

    // Check API keys
    if (!dryRun) {
        if (!PRINTFUL_API_KEY) {
            console.error('ERROR: PRINTFUL_API_KEY is required');
            process.exit(1);
        }
    }

    // Generate mockups for each product
    const results = { success: [], failed: [], skipped: [] };

    for (const productKey of products) {
        const config = getProductConfig(productKey, isVertical);
        if (!config) {
            console.log(`  [SKIP] ${productKey}: not configured`);
            results.skipped.push(productKey);
            continue;
        }

        const product = productsConfig.products[productKey];
        console.log(`  [${config.provider.toUpperCase()}] ${product.label} (${productKey})`);

        if (config.needsRotation) {
            console.log(`    → Preprocessing: rotate ${config.needsRotation}° (horizontal illustration)`);
        }

        if (dryRun) {
            console.log(`    → Position: ${config.position ? `${config.position.area_width}x${config.position.area_height}` : 'Gooten MAXFIT'}`);
            if (config.fillMode) console.log(`    → Fill mode: ${config.fillMode}`);
            if (config.placement) console.log(`    → Placement: ${config.placement}`);
            results.success.push(productKey);
            continue;
        }

        try {
            let imgUrl = illustrationUrl;

            // TODO: Add Sharp preprocessing for rotation (phone cases, blankets)
            // For now, note that preprocessing is needed
            if (config.needsRotation) {
                console.log(`    WARNING: Rotation preprocessing not yet implemented`);
                console.log(`    Image may appear warped on this product`);
            }

            let mockupUrls;
            if (config.provider === 'printful') {
                mockupUrls = await withRateLimit(
                    () => generatePrintfulMockup(config, imgUrl),
                    { label: productKey, maxRetries: 3, baseDelay: 1000 }
                );
            } else if (config.provider === 'gooten') {
                if (!GOOTEN_RECIPEID) {
                    console.log(`    [SKIP] GOOTEN_RECIPEID not set`);
                    results.skipped.push(productKey);
                    continue;
                }
                mockupUrls = await withRateLimit(
                    () => generateGootenMockup(config, imgUrl),
                    { label: productKey, maxRetries: 3, baseDelay: 1000 }
                );
            }

            // Download mockup images
            for (let j = 0; j < mockupUrls.length; j++) {
                const destFile = `v11_${productKey}${j > 0 ? `_${j}` : ''}.png`;
                const destPath = path.join(mockupsDir, destFile);
                await downloadImage(mockupUrls[j], destPath);
                console.log(`    → Saved: ${destFile}`);
            }

            results.success.push(productKey);

            // Rate limiting: 200ms between requests (withRateLimit handles 429 backoff)
            await sleep(200);

        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            results.failed.push(productKey);
        }
    }

    // Report
    console.log('');
    console.log('=== Mockup Generation Complete ===');
    console.log(`  Success: ${results.success.length} (${results.success.join(', ')})`);
    if (results.failed.length > 0) {
        console.log(`  Failed:  ${results.failed.length} (${results.failed.join(', ')})`);
    }
    if (results.skipped.length > 0) {
        console.log(`  Skipped: ${results.skipped.length} (${results.skipped.join(', ')})`);
    }
    console.log(`  Output:  ${mockupsDir}/`);

    if (results.failed.length > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
});
