# Quick Start Guide - Video Pipeline

**Last Updated:** March 4, 2026

---

## Starting the Dashboard

```bash
cd /Users/lcalderon/github/video-pipeline
npm run start
```

**Opens at:** http://localhost:3001

---

## Approving Orders & Starting Production

### Single Order
1. Find order in **"Candidates"** lane
2. Click **"✓ Approve"** button
3. Confirm: "Approve this order and start the video production pipeline?"
4. ✅ Pipeline starts automatically
5. Watch live progress in pipeline console

### Batch Approval
1. Click **"Approve All (N)"** in Candidates lane header
2. Confirm dialog
3. ✅ Pipeline starts for all N orders
4. Monitor progress in console

### Manual Pipeline Run
1. Scroll to pipeline console section
2. Click **"Run Pipeline"** button
3. Select brand (optional)
4. Watch live logs

---

## Understanding the Lanes

```
Candidates → Consent Pending → Consent Approved → Video Built → Uploaded
```

- **Candidates:** New orders from tracking sheets, waiting for approval
- **Consent Pending:** Approved, waiting for customer consent
- **Consent Approved:** Customer consented, ready for production
- **Video Built:** Video produced, ready for upload
- **Uploaded:** Complete! Video uploaded to Google Drive

---

## Common Tasks

### Check Pipeline Status
- Look at pipeline console at bottom of dashboard
- Shows: orders attempted, succeeded, failed, skipped
- Live logs during execution

### View Order Details
- Click any order card to expand
- See: mockups, video preview, social copy, Drive links

### Download Assets
- Automatic when pipeline runs
- Manual: Use order card download button

### Generate Social Copy
- Automatic after video built
- Manual: Use order card "Generate Copy" button

### Upload to Drive
- Automatic final step
- Manual: Use order card "Upload" button

---

## Troubleshooting

### Pipeline Won't Start
- Check browser console (F12) for errors
- Try manual "Run Pipeline" button
- Check `logs/` directory for error logs

### Database Errors
- Restart dashboard: `npm run start`
- Database auto-repairs on startup
- Backup at: `data/pipeline.db.backup`

### Orders Not Importing
- Check Google credentials in `.env`
- Verify tracking sheet URLs in brand configs
- Check `logs/` for import errors

### Video Production Fails
- Check order has all assets (photos, OMS)
- Verify score is above minimum (40)
- Check `logs/daily-*.log` for detailed errors

---

## Environment Variables

**Required (in `.env`):**
```bash
PRINTFUL_API_KEY=your_key
GEMINI_API_KEY=your_key
GOOGLE_SERVICE_ACCOUNT_KEY=/path/to/credentials.json
SMTP_PASS=your_sendgrid_password
```

**Optional:**
```bash
DB_PATH=data/pipeline.db  # Leave empty for default
BRANDS=turnedyellow makemejedi  # Brands to process
MIN_SCORE=40  # Minimum candidate score
```

---

## File Locations

- **Database:** `data/pipeline.db`
- **Logs:** `logs/daily-YYYYMMDD-HHMMSS.log`
- **Brand Configs:** `brands/*.json`
- **Assets:** `brands/{brand}/assets/`
- **Videos:** `brands/{brand}/output/`

---

## API Endpoints

```
GET  /api/stats                    - Dashboard statistics
GET  /api/board                    - Kanban board data
POST /api/orders/:id/:brand/status - Update order status
POST /api/pipeline/run             - Start pipeline
GET  /api/pipeline/status/:runId   - Pipeline status
POST /api/consent/send-batch       - Send consent emails
```

---

## Need Help?

1. Check `FIXES-SUMMARY.md` for recent fixes
2. Check `FIX-AUTO-PIPELINE.md` for approval workflow
3. Check `FIX-STARTUP-ISSUE.md` for startup issues
4. Review logs in `logs/` directory
5. Check console for errors (F12)

---

**Dashboard:** http://localhost:3001  
**Status:** ✅ All systems operational
