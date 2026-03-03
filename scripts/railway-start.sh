#!/bin/bash
# Railway startup script - import data then start dashboard

echo "=== Video Pipeline Dashboard Startup ==="

export DB_PATH="${DB_PATH:-/data/pipeline.db}"
mkdir -p "$(dirname "$DB_PATH")"

# Copy the initial database if it doesn't exist
if [ ! -f "$DB_PATH" ]; then
  echo "Database not found, copying initial database..."
  cp ./data/pipeline.db "$DB_PATH" 2>/dev/null || echo "No initial database to copy"
fi

echo "Running data import (DB_PATH=$DB_PATH)..."
timeout 30 node scripts/import-tracking-sheets.js || echo "Import failed, starting with existing database"

echo "Starting dashboard server (v2)..."
exec node scripts/dashboard.js
