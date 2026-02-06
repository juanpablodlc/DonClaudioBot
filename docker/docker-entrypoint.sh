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

    # Migrate: add welcome agent if missing from existing config
    if ! grep -q '"welcome"' "$CONFIG_PATH"; then
        echo "[entrypoint] Adding welcome agent to existing config..."
        node -e "
            const JSON5 = require('json5');
            const fs = require('fs');
            const p = '$CONFIG_PATH';
            const config = JSON5.parse(fs.readFileSync(p, 'utf-8'));
            config.agents.list.unshift({ id: 'welcome', name: 'Welcome Agent', default: true, workspace: '~/.openclaw/workspace-welcome' });
            config.agents.list.forEach((a, i) => { if (i > 0) delete a.default; });
            fs.writeFileSync(p, JSON5.stringify(config, null, 2));
        "
        echo "[entrypoint] Welcome agent added to config"
    else
        echo "[entrypoint] Welcome agent already in config ✓"
    fi
fi

# Ensure welcome agent workspace and directories exist
STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
WELCOME_WORKSPACE="$STATE_DIR/workspace-welcome"
WELCOME_AGENT_DIR="$STATE_DIR/agents/welcome/agent"
WELCOME_SESSIONS_DIR="$STATE_DIR/agents/welcome/sessions"

echo "[entrypoint] Setting up welcome agent..."
mkdir -p "$WELCOME_WORKSPACE" "$WELCOME_AGENT_DIR" "$WELCOME_SESSIONS_DIR"

# Copy welcome agent template (AGENTS.md) to workspace
if [ -f /app/config/agents/welcome/AGENTS.md ]; then
    cp /app/config/agents/welcome/AGENTS.md "$WELCOME_WORKSPACE/AGENTS.md"
    echo "[entrypoint] Welcome agent workspace ready: $WELCOME_WORKSPACE"
else
    echo "[entrypoint] WARNING: Welcome agent template not found at /app/config/agents/welcome/AGENTS.md"
fi

echo "[entrypoint] Starting OpenClaw Gateway + Onboarding Service..."
exec node /app/launcher.js
