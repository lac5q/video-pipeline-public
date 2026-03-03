#!/bin/bash
# Railway startup script - import data then start dashboard

echo "=== Video Pipeline Dashboard Startup ==="

export DB_PATH="${DB_PATH:-/data/pipeline.db}"
mkdir -p "$(dirname "$DB_PATH")"

# Check if database exists and has orders
if [ ! -f "$DB_PATH" ] || [ $(sqlite3 "$DB_PATH" "SELECT count(*) FROM orders;" 2>/dev/null || echo 0) -eq 0 ]; then
  echo "Database is empty or doesn't exist, initializing with sample data..."
  node scripts/init-sample-data.js
else
  echo "Database exists with data, proceeding with import..."
  echo "Running data import (DB_PATH=$DB_PATH)..."
  timeout 30 node scripts/import-tracking-sheets.js || echo "Import failed, continuing with existing data"
fi

echo "Starting dashboard server..."
exec node scripts/dashboard.js
