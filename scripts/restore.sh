#!/bin/bash
set -e

# Restore script for don-claudio-state Docker volume
# Usage: ./restore.sh <backup-file>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"
VOLUME_NAME="don-claudio-state"

# Check for backup file argument
if [ $# -eq 0 ]; then
  echo "Error: No backup file specified"
  echo "Usage: $0 <backup-file>"
  echo "Example: $0 don-claudio-state-20250202-120000.tar.gz"
  exit 1
fi

BACKUP_FILE="$1"

# Support both full paths and just filenames
if [[ "$BACKUP_FILE" == */* ]]; then
  # Full path provided
  BACKUP_PATH="$BACKUP_FILE"
else
  # Just filename, look in backups directory
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILE"
fi

# Check if backup file exists
if [ ! -f "$BACKUP_PATH" ]; then
  echo "Error: Backup file not found: $BACKUP_PATH"
  exit 1
fi

echo "Restoring $VOLUME_NAME from $BACKUP_PATH..."

# Stop containers gracefully
echo "Stopping containers..."
cd "$SCRIPT_DIR/docker"
docker compose down

# Restore backup using Alpine container
echo "Restoring from backup archive..."
docker run --rm \
  -v "$VOLUME_NAME":/data \
  -v "$BACKUP_DIR":/backup \
  alpine tar xzf "/backup/$(basename "$BACKUP_FILE")" -C /data

# Restart containers
echo "Restarting containers..."
docker compose up -d

echo "Restore completed successfully"
