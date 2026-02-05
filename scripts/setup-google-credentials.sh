#!/usr/bin/env bash
# Setup Google OAuth client credentials on Hetzner server
# Run ONCE after initial deployment (or when credentials change)
#
# Prerequisites:
#   - config/client_secret_*.json exists locally (from Google Cloud Console)
#   - SSH access to Hetzner (ssh -i ~/.ssh/hetzner root@135.181.93.227)
#
# What this does:
#   1. Creates /root/google-credentials/ on server
#   2. Copies client_secret file as credentials.json
#   3. Sets permissions (600)
#
# Both the main container and sandbox containers access this path:
#   - Main container: via docker-compose volume mount
#   - Sandbox containers: via OpenClaw binds config in agent-creator.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="root@135.181.93.227"
SSH_KEY="$HOME/.ssh/hetzner"
REMOTE_DIR="/root/google-credentials"

# Find client_secret file
CLIENT_SECRET=$(find "$PROJECT_ROOT/config" -name 'client_secret_*.json' -maxdepth 1 | head -1)

if [[ -z "$CLIENT_SECRET" ]]; then
  echo "ERROR: No client_secret_*.json found in config/"
  echo "Download it from Google Cloud Console:"
  echo "  https://console.cloud.google.com/apis/credentials"
  exit 1
fi

echo "[setup-google-credentials] Found: $(basename "$CLIENT_SECRET")"
echo "[setup-google-credentials] Creating $REMOTE_DIR on server..."

# Create directory and copy file
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $REMOTE_DIR && chmod 755 $REMOTE_DIR"
scp -i "$SSH_KEY" "$CLIENT_SECRET" "$SERVER:$REMOTE_DIR/credentials.json"
ssh -i "$SSH_KEY" "$SERVER" "chmod 644 $REMOTE_DIR/credentials.json"

echo "[setup-google-credentials] Verifying..."
ssh -i "$SSH_KEY" "$SERVER" "ls -la $REMOTE_DIR/credentials.json"

echo ""
echo "[setup-google-credentials] Done! OAuth client credentials installed."
echo "[setup-google-credentials] Main container reads from: /home/node/.config/gogcli/credentials.json"
echo "[setup-google-credentials] Sandbox containers read via: binds in agent config"
