#!/bin/bash
# rollback.sh - Rollback DonClaudioBot deployment to previous commit
# Usage: ./rollback.sh [--with-volume-restore]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)"
SERVER="root@135.181.93.227"
PROJECT_DIR="/root/don-claudio-bot"
VOLUME_RESTORE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --with-volume-restore)
      VOLUME_RESTORE=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--with-volume-restore]"
      echo ""
      echo "Rollback to previous git commit and redeploy."
      echo ""
      echo "Options:"
      echo "  --with-volume-restore    Also restore Docker volume from latest backup"
      echo "  -h, --help              Show this help message"
      echo ""
      echo "Example:"
      echo "  $0                      # Git rollback only"
      echo "  $0 --with-volume-restore # Git rollback + volume restore"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

echo "=== Rolling Back DonClaudioBot Deployment ==="
echo ""

# Step 1: Confirm rollback
echo "This will:"
echo "  1. Revert to previous git commit (HEAD~1)"
if [ "$VOLUME_RESTORE" = true ]; then
  echo "  2. Restore Docker volume from latest backup"
fi
echo "  3. Redeploy to Hetzner"
echo ""
read -p "Continue? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Rollback cancelled"
  exit 0
fi

# Step 2: Get current commit for reference
echo ""
echo "Current commit:"
git log -1 --oneline

# Step 3: Git revert
echo ""
echo "Reverting to previous commit..."
git checkout HEAD~1

# Step 4: Volume restore (if requested)
if [ "$VOLUME_RESTORE" = true ]; then
  echo ""
  echo "Finding latest backup..."
  LATEST_BACKUP=$(ls -t "$SCRIPT_DIR/backups/don-claudio-state-"*.tar.gz 2>/dev/null | head -1)

  if [ -z "$LATEST_BACKUP" ]; then
    echo "WARNING: No backup found in backups/ directory"
    echo "Continuing with git rollback only..."
  else
    echo "Restoring volume from: $LATEST_BACKUP"
    "$SCRIPT_DIR/scripts/restore.sh" "$(basename "$LATEST_BACKUP")"
  fi
fi

# Step 5: Redeploy
echo ""
echo "Redeploying to Hetzner..."
"$SCRIPT_DIR/scripts/deploy.sh"

# Step 6: Verify rollback
echo ""
echo "Verifying rollback..."
sleep 5

HEALTH_CHECK=$(ssh "$SERVER" "curl -s http://localhost:3000/health" || echo "failed")
if [[ "$HEALTH_CHECK" == *"failed"* ]] || [[ -z "$HEALTH_CHECK" ]]; then
  echo ""
  echo "WARNING: Health check failed after rollback"
  echo "Check logs: ssh $SERVER 'cd $PROJECT_DIR && docker compose logs -f --tail 50'"
  exit 1
fi

echo ""
echo "=== Rollback Complete ==="
echo ""
echo "Previous commit (now active):"
git log -1 --oneline
echo ""
echo "Next steps:"
echo "  1. Check logs: ssh $SERVER 'cd $PROJECT_DIR && docker compose logs -f'"
echo "  2. Verify health: curl http://135.181.93.227:3000/health"
echo "  3. Fix issues that caused rollback"
echo ""
