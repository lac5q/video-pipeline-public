#!/bin/bash
# Railway startup script - import data then start dashboard

echo "=== Video Pipeline Dashboard Startup ==="

export DB_PATH="${DB_PATH:-/data/pipeline.db}"
echo "DB_PATH is set to: $DB_PATH"
echo "Directory exists: $(ls -la $(dirname "$DB_PATH") 2>/dev/null || echo 'Directory does not exist')"

# Try to create directory, but don't fail if it doesn't work (will fallback to local data/)
if ! mkdir -p "$(dirname "$DB_PATH")" 2>/dev/null; then
  echo "Warning: Cannot create $(dirname "$DB_PATH"), will use fallback location"
fi

# Just ensure the database exists with proper schema
echo "Ensuring database exists with schema..."
node -e "
  const { getDatabase } = require('./lib/db');
  const db = getDatabase();
  console.log('Database initialized with schema');
  db.close();
"

echo "Running data import (will fail gracefully without Google credentials)..."
timeout 30 node scripts/import-tracking-sheets.js || echo "Import failed (expected without Google credentials), continuing with empty database"

echo "Starting dashboard server..."
exec node scripts/dashboard.js
