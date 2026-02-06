#!/bin/sh
# docker-entrypoint.sh - Container entrypoint that ensures OpenClaw config exists
# This prevents OpenClaw from using wrong defaults (dmScope='main') which causes
# all users to share one session (sticky session bug)

set -e

CONFIG_PATH="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}/openclaw.json"
TEMPLATE_PATH="/app/config/openclaw.json.template"

echo "[entrypoint] Checking OpenClaw config..."

if [ ! -f "$CONFIG_PATH" ]; then
    echo "[entrypoint] Config not found at $CONFIG_PATH"
    echo "[entrypoint] Creating from template: $TEMPLATE_PATH"

    # Ensure state directory exists
    mkdir -p "$(dirname "$CONFIG_PATH")"

    # Copy template to config location
    cp "$TEMPLATE_PATH" "$CONFIG_PATH"

    echo "[entrypoint] Created openclaw.json with dmScope=per-channel-peer"
    echo "[entrypoint] This prevents sticky session bug where all users share one agent"
else
    echo "[entrypoint] Config exists: $CONFIG_PATH"

    # Verify dmScope is correct (defensive check)
    if grep '"dmScope"[[:space:]]*:[[:space:]]*"per-channel-peer"' "$CONFIG_PATH" > /dev/null 2>&1; then
        echo "[entrypoint] Config verified: dmScope=per-channel-peer ✓"
    else
        echo "[entrypoint] WARNING: dmScope is not set to 'per-channel-peer'!"
        echo "[entrypoint] This may cause sticky session bug. Current config:"
        grep -A 2 '"session"' "$CONFIG_PATH" || true
    fi
fi

echo "[entrypoint] Starting OpenClaw Gateway + Onboarding Service..."
exec node /app/launcher.js
