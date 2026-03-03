#!/bin/bash
# Upload database to Railway volume
echo "=== Uploading database to Railway ==="

# Create a tarball of the database
tar -czf /tmp/pipeline-db.tar.gz -C data pipeline.db

# Check if railway CLI can upload files
if command -v railway &> /dev/null; then
    echo "Railway CLI found, attempting upload..."
    # This would need the service to be linked
    echo "Please upload manually or use Railway dashboard"
fi

echo "Database ready at: $(pwd)/data/pipeline.db"
echo "Size: $(ls -lh data/pipeline.db | awk '{print $5}')"
