#!/bin/bash
# Railway startup script - import data then start dashboard

echo "=== Video Pipeline Dashboard Startup ==="

export DB_PATH="${DB_PATH:-/data/pipeline.db}"
echo "DB_PATH is set to: $DB_PATH"
echo "Directory exists: $(ls -la $(dirname "$DB_PATH") 2>/dev/null || echo 'Directory does not exist')"
mkdir -p "$(dirname "$DB_PATH")"

# Check if database exists and has orders
if [ ! -f "$DB_PATH" ]; then
  echo "Database file doesn't exist, initializing with sample data..."
  node scripts/init-db-at-volume.js
else
  # Check if database has any orders (try to query it)
  ORDER_COUNT=$(node -e "
    try {
      const db = require('better-sqlite3')('$DB_PATH');
      const result = db.prepare('SELECT count(*) as count FROM orders').get();
      console.log(result.count);
      db.close();
    } catch(e) {
      console.log(0); // If there's an error (e.g., table doesn't exist), treat as empty
    }
  ")
  
  if [ "$ORDER_COUNT" -eq 0 ]; then
    echo "Database exists but is empty, initializing with sample data..."
    node scripts/init-db-at-volume.js
  else
    echo "Database exists with $ORDER_COUNT orders, proceeding with import..."
    echo "Running data import (DB_PATH=$DB_PATH)..."
    timeout 30 node scripts/import-tracking-sheets.js || echo "Import failed, continuing with existing data"
  fi
fi

echo "Starting dashboard server..."
exec node scripts/dashboard.js
