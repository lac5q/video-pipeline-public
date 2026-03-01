'use strict';

const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const PIPELINE_ROOT =
  process.env.PIPELINE_ROOT || path.resolve(__dirname, '..');

const { getDatabase } = require(path.join(PIPELINE_ROOT, 'lib', 'db'));

// === Usage ===
function usage() {
  console.log(`Usage: node ${path.basename(__filename)} --brand SLUG --order ORDER_ID [OPTIONS]

Upload all produced outputs (videos + social copy) to Google Drive.

Required:
  --brand SLUG        Brand slug (e.g., turnedyellow, makemejedi)
  --order ORDER_ID    Order ID (e.g., 133627)

Options:
  --folder FOLDER_ID  Override Drive folder ID (default: from brand config)
  --help              Show this help message

The script reads the brand config for drive_folder_ids.video_pipeline,
creates a date subfolder, and uploads ALL exportable files:
  - *.mp4 (reel and UGC videos)
  - *_social.md (social copy markdown)

Environment:
  GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS
    Path to Google service account JSON key file.`);
  process.exit(0);
}

// === Parse arguments ===
const args = process.argv.slice(2);
let brand = null;
let orderId = null;
let folderOverride = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--brand':
      brand = args[++i];
      break;
    case '--order':
      orderId = args[++i];
      break;
    case '--folder':
      folderOverride = args[++i];
      break;
    case '--help':
    case '-h':
      usage();
      break;
    default:
      console.error(`ERROR: Unknown argument: ${args[i]}`);
      process.exit(1);
  }
}

if (!brand) {
  console.error('ERROR: --brand is required');
  process.exit(1);
}
if (!orderId) {
  console.error('ERROR: --order is required');
  process.exit(1);
}

// === Main ===
async function main() {
  // Load brand config
  const configPath = path.join(PIPELINE_ROOT, 'brands', `${brand}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Brand config not found: ${configPath}`);
    process.exit(1);
  }
  const brandConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const brandName = brandConfig.name;

  // Determine parent folder
  const parentFolderId =
    folderOverride ||
    (brandConfig.drive_folder_ids && brandConfig.drive_folder_ids.video_pipeline);

  if (!parentFolderId) {
    console.error('ERROR: No Drive folder ID found. Provide --folder or set drive_folder_ids.video_pipeline in brand config.');
    process.exit(1);
  }

  // Find exportable files (videos + social copy)
  const exportsDir = path.join(PIPELINE_ROOT, 'orders', brand, orderId, 'exports');
  if (!fs.existsSync(exportsDir)) {
    console.error(`ERROR: Exports directory not found: ${exportsDir}`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(exportsDir);
  const uploadableFiles = allFiles.filter(f =>
    f.endsWith('.mp4') || f.endsWith('_social.md')
  );

  if (uploadableFiles.length === 0) {
    console.error(`ERROR: No uploadable files found in ${exportsDir}`);
    process.exit(1);
  }

  console.log(`=== Uploading to Google Drive ===`);
  console.log(`  Brand: ${brandName} (${brand})`);
  console.log(`  Order: ${orderId}`);
  console.log(`  Files: ${uploadableFiles.join(', ')}`);
  console.log(`  Parent folder: ${parentFolderId}`);

  // Authenticate
  const credentialsPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath) {
    console.error(
      'ERROR: No Google credentials configured. ' +
      'Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.'
    );
    process.exit(1);
  }

  const keyFile = require(path.resolve(credentialsPath));
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const authClient = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: authClient });

  // Create date subfolder: {brand_name}/videos/{YYYY-MM-DD}/
  const today = new Date().toISOString().slice(0, 10);
  const subfolderName = `${brandName}/videos/${today}`;
  console.log(`  Subfolder: ${subfolderName}`);

  // Create folder hierarchy
  let currentParent = parentFolderId;
  const folderParts = subfolderName.split('/');
  for (const part of folderParts) {
    // Check if subfolder already exists
    const search = await drive.files.list({
      q: `name='${part}' and '${currentParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    if (search.data.files && search.data.files.length > 0) {
      currentParent = search.data.files[0].id;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [currentParent],
        },
        fields: 'id',
      });
      currentParent = folder.data.id;
    }
  }

  // Upload all files
  const driveUrls = {};
  for (const fileName of uploadableFiles) {
    const filePath = path.join(exportsDir, fileName);
    const mimeType = fileName.endsWith('.mp4') ? 'video/mp4' : 'text/markdown';

    console.log(`  Uploading: ${fileName} (${mimeType})...`);

    const fileMetadata = {
      name: fileName,
      parents: [currentParent],
    };
    const media = {
      mimeType,
      body: fs.createReadStream(filePath),
    };

    const uploaded = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    const driveUrl = uploaded.data.webViewLink;
    console.log(`    -> ${driveUrl}`);

    // Categorize URLs by type
    if (fileName.includes('_ugc.mp4')) {
      driveUrls.ugc = driveUrl;
    } else if (fileName.includes('_reel.mp4')) {
      driveUrls.reel = driveUrl;
    } else if (fileName.endsWith('_social.md')) {
      driveUrls.social = driveUrl;
    } else {
      driveUrls[fileName] = driveUrl;
    }
  }

  // Update database with all Drive URLs (store as JSON)
  const db = getDatabase();
  const allUrlsJson = JSON.stringify(driveUrls);
  // Primary drive_url is UGC if available, else reel, else first uploaded
  const primaryUrl = driveUrls.ugc || driveUrls.reel || Object.values(driveUrls)[0];
  const stmt = db.prepare(
    'UPDATE orders SET drive_url = ?, drive_urls_json = ?, updated_at = datetime(\'now\') WHERE order_id = ? AND brand = ?'
  );
  const result = stmt.run(primaryUrl, allUrlsJson, orderId, brand);
  db.close();

  if (result.changes > 0) {
    console.log(`  Database updated (${Object.keys(driveUrls).length} URLs saved).`);
  } else {
    console.log('  WARNING: Order not found in database. Drive URLs not saved.');
  }

  console.log(`  Uploaded ${uploadableFiles.length} file(s) to Drive.`);
  console.log('=== Upload complete ===');
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
