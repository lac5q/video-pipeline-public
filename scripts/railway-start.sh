#!/bin/bash
# Railway startup script - import data then start dashboard

echo "=== Video Pipeline Dashboard Startup ==="

export DB_PATH="${DB_PATH:-/data/pipeline.db}"
mkdir -p "$(dirname "$DB_PATH")"

echo "Running data import (DB_PATH=$DB_PATH)..."
timeout 30 node scripts/import-tracking-sheets.js || echo "Import failed, starting with empty database"

echo "Starting dashboard server..."
exec node scripts/dashboard.js
