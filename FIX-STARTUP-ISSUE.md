# Startup Issue Fix - Database Directory Creation

## Problem
The application was failing to start locally with the error:
```
Error: ENOENT: no such file or directory, mkdir '/data'
```

## Root Cause
The `DB_PATH` environment variable was set to `/data/pipeline.db` (intended for Railway deployment), but the code tried to create the `/data` directory at the root level of the filesystem. On macOS and most Unix systems, creating directories at the root level requires sudo privileges.

## Solution
Updated two files to handle this gracefully:

### 1. `lib/db.js`
Added error handling in the `openDatabase()` function to:
- Catch directory creation failures
- Fall back to using the local `data/` directory within the project
- Log warnings and the fallback path being used

### 2. `scripts/railway-start.sh`
Modified the directory creation step to:
- Not fail if directory creation fails
- Continue execution allowing the fallback logic in `db.js` to handle it

## Behavior

### Local Development
When running locally with `DB_PATH=/data/pipeline.db`:
- Application detects it cannot create `/data` directory
- Automatically falls back to `./data/pipeline.db` in the project root
- Database and all features work normally

### Railway Deployment
When deployed to Railway with the `/data` volume mounted:
- Application successfully creates/uses `/data/pipeline.db`
- No fallback needed
- Works as originally intended

## Testing
Run `npm run start` locally - the application should now start successfully with:
- Database initialized at `./data/pipeline.db`
- Data imported from tracking sheets
- Dashboard server running on http://localhost:3001

## Files Modified
- `lib/db.js` - Added fallback logic for database directory creation
- `scripts/railway-start.sh` - Made directory creation non-fatal

---
**Fix Date:** March 4, 2026  
**Issue:** Application failing to start locally due to permission denied on `/data` directory creation
