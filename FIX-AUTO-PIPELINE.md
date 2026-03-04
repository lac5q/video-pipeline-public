# Video Pipeline - Approval & Production Workflow Fix

## Problem Summary

**Issue:** When clicking "Approve" on an order, the pipeline didn't start automatically. Users had to manually click the "Run Pipeline" button after approving orders.

**Root Cause:** The approve button only changed the `production_status` to `'approved'` and moved the order to the "Consent Approved" lane, but didn't trigger the actual video production pipeline.

## What Was Fixed

### 1. Automatic Pipeline Trigger on Approval ✅

**File:** `scripts/dashboard.js`

**Changes:**
- Modified `approveOrder()` function to automatically trigger the pipeline after approval
- Modified `batchApproveAll()` function to automatically trigger the pipeline after batch approval
- Added confirmation dialog: "Approve this order and start the video production pipeline?"
- Added user feedback toasts showing pipeline start status

**New Behavior:**
```javascript
Approve clicked 
  → Confirm dialog 
  → Update status to 'approved' 
  → Automatically trigger pipeline for that brand 
  → Show success/warning toast 
  → Refresh board
```

### 2. Permanent Database Path Fix ✅

**Files:** `lib/db.js`, `scripts/railway-start.sh`, `.env`, `.env.example`

**Changes:**
- Added fallback logic in `openDatabase()` to handle directory creation failures
- When `/data` directory can't be created (local development), automatically falls back to `./data/pipeline.db`
- Made directory creation non-fatal in startup script
- Updated `.env.example` to suggest using relative path `data/pipeline.db`

**Behavior:**
- **Local development:** Uses `./data/pipeline.db` in project folder
- **Railway deployment:** Uses `/data/pipeline.db` from mounted volume
- No more startup failures due to permission issues

## Updated Workflow

### Single Order Approval
1. Click "✓ Approve" button on an order card
2. Confirm dialog: "Approve this order and start the video production pipeline?"
3. Order status updated to `production_status: 'approved'`
4. **Pipeline automatically starts** for that specific brand (limit: 1 order)
5. Toast notification: "Pipeline started for [brand]"
6. Board refreshes automatically

### Batch Approval
1. Click "Approve All (N)" button in Candidates lane header
2. Confirm dialog: "Approve N candidates and start the video production pipeline?"
3. All selected orders updated to `production_status: 'approved'`
4. **Pipeline automatically starts** for all approved orders
5. Toast notification: "Pipeline started for N orders"
6. Board refreshes automatically

### Manual Pipeline Run (Still Available)
- "Run Pipeline" button still available in the dashboard
- Useful for re-running failed orders or processing multiple brands at once
- Opens pipeline console with live logs

## User Experience Improvements

### Before
```
1. Approve order → moves to "Consent Approved" lane
2. Notice pipeline didn't start
3. Scroll to top of page
4. Click "Run Pipeline" button
5. Wait for pipeline to process
6. Check if order was processed
```

### After
```
1. Approve order → confirm dialog
2. Pipeline starts automatically
3. See "Pipeline started" toast notification
4. Watch live progress in pipeline console
5. Order moves through production stages automatically
```

## Error Handling

If the pipeline fails to start after approval:
- User sees: "Approved (pipeline start failed - you can run it manually)"
- Order is still approved and in the queue
- User can manually click "Run Pipeline" button
- No data loss or inconsistent state

## Testing

To test the fix:

1. **Start the dashboard:**
   ```bash
   npm run start
   ```

2. **Open the dashboard:** http://localhost:3001

3. **Approve an order:**
   - Find an order in "Candidates" lane
   - Click "✓ Approve" button
   - Confirm the dialog
   - Watch for "Pipeline started" toast
   - Check pipeline console for live progress

4. **Verify database:**
   - Check `data/pipeline.db` exists and is being updated
   - No permission errors should occur

## Files Modified

- `scripts/dashboard.js` - Auto-trigger pipeline on approval
- `lib/db.js` - Fallback logic for database directory
- `scripts/railway-start.sh` - Non-fatal directory creation
- `.env` - Added comment about default path
- `.env.example` - Suggested relative path
- `FIX-AUTO-PIPELINE.md` - This documentation

## Configuration

No configuration changes needed - works out of the box!

**Optional:** If you want to use a custom database path, set in `.env`:
```bash
DB_PATH=/custom/path/pipeline.db
```

## Troubleshooting

### Pipeline doesn't start after approval
- Check browser console for errors
- Verify `DB_PATH` is writable
- Check `logs/` directory for pipeline errors
- Try manual "Run Pipeline" button

### Database permission errors
- The fallback logic should handle this automatically
- Check that `./data/` directory exists and is writable
- On Railway, ensure `/data` volume is mounted

### Approval confirmation dialog annoying
- This is intentional to prevent accidental pipeline triggers
- Pipeline costs compute resources and API calls
- Consider it a "are you sure?" safety check

---

**Fix Date:** March 4, 2026  
**Issue:** Pipeline not starting on order approval  
**Status:** ✅ RESOLVED
