#!/bin/bash
set -e

# Backup script for don-claudio-state Docker volume
# Creates timestamped backups in /root/don-claudio-bot/backups/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"
VOLUME_NAME="don-claudio-state"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/$VOLUME_NAME-$TIMESTAMP.tar.gz"

echo "Starting backup of $VOLUME_NAME..."

# Stop containers gracefully
echo "Stopping containers..."
cd "$SCRIPT_DIR/docker"
docker compose down

# Create backup using Alpine container
echo "Creating backup archive..."
docker run --rm \
  -v "$VOLUME_NAME":/data \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/$VOLUME_NAME-$TIMESTAMP.tar.gz" -C /data .

# Restart containers
echo "Restarting containers..."
docker compose up -d

echo "Backup completed: $BACKUP_FILE"
