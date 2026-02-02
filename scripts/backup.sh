#!/bin/bash
set -e

BACKUP_VOLUME="don-claudio-state-backup"
SOURCE_VOLUME="don-claudio-state"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="backup-${TIMESTAMP}.tar.gz"

echo "=== Starting backup of ${SOURCE_VOLUME} ==="

# Create backup volume if it doesn't exist
if ! docker volume inspect "${BACKUP_VOLUME}" &>/dev/null; then
  echo "Creating backup volume: ${BACKUP_VOLUME}"
  docker volume create "${BACKUP_VOLUME}"
else
  echo "Backup volume ${BACKUP_VOLUME} already exists"
fi

# Run backup container to create tarball
echo "Creating backup: ${BACKUP_FILE}"
docker run --rm \
  -v "${SOURCE_VOLUME}:/from" \
  -v "${BACKUP_VOLUME}:/to" \
  alpine:latest \
  tar czf "/to/${BACKUP_FILE}" -C /from .

# Retain last 7 backups, delete older ones
echo "Cleaning up old backups (retaining last 7)..."
docker run --rm \
  -v "${BACKUP_VOLUME}:/data" \
  alpine:latest \
  sh -c "cd /data && ls -t backup-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f"

# List current backups
echo ""
echo "=== Current backups in ${BACKUP_VOLUME} ==="
docker run --rm \
  -v "${BACKUP_VOLUME}:/data" \
  alpine:latest \
  ls -lh /data

echo ""
echo "=== Backup complete: ${BACKUP_FILE} ==="
