#!/bin/bash
# deploy-railway.sh -- Deploy dashboard to Railway
# Usage: ./scripts/deploy-railway.sh
#
# Prerequisites:
#   1. railway login
#   2. Have .env file with credentials
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PIPELINE_ROOT"

echo "=== Video Pipeline Dashboard — Railway Deploy ==="
echo ""

# Check railway CLI
if ! command -v railway &>/dev/null; then
    echo "ERROR: railway CLI not found. Install: npm i -g @railway/cli"
    exit 1
fi

# Check auth
if ! railway whoami &>/dev/null 2>&1; then
    echo "Not logged in. Running railway login..."
    railway login
fi

# Init project if not linked
if ! railway status &>/dev/null 2>&1; then
    echo "Creating Railway project..."
    railway init --name video-pipeline-dashboard
fi

echo ""
echo "=== Setting environment variables ==="

# Load from .env
source "$PIPELINE_ROOT/.env"

# Read service account JSON for cloud deployment
SA_JSON=""
if [[ -f "$GOOGLE_SERVICE_ACCOUNT_KEY" ]]; then
    SA_JSON=$(cat "$GOOGLE_SERVICE_ACCOUNT_KEY")
fi

# Set env vars on Railway
railway variables \
    --set "GOOGLE_SERVICE_ACCOUNT_JSON=$SA_JSON" \
    --set "DASHBOARD_USER=${DASHBOARD_USER:-admin}" \
    --set "DASHBOARD_PASS=${DASHBOARD_PASS:-pipeline2024}" \
    --set "NODE_ENV=production" \
    --set "DB_PATH=/data/pipeline.db"

echo ""
echo "=== Adding volume for SQLite persistence ==="
echo "NOTE: You need to add a volume manually in Railway dashboard:"
echo "  1. Go to your project at https://railway.app/dashboard"
echo "  2. Click your service → Settings → Volumes"
echo "  3. Add volume: Mount Path = /data, Size = 1GB"
echo ""
echo "=== Deploying ==="
railway up --detach

echo ""
echo "=== Deploy triggered! ==="
echo ""
echo "After first deploy:"
echo "  1. Add volume (mount: /data) in Railway dashboard"
echo "  2. Run initial data import:"
echo "     railway run node scripts/import-tracking-sheets.js"
echo "  3. Get your URL:"
echo "     railway open"
echo ""
echo "Dashboard login:"
echo "  User: ${DASHBOARD_USER:-admin}"
echo "  Pass: ${DASHBOARD_PASS:-pipeline2024}"
