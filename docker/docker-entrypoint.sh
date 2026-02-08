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

    # Ensure dmScope is set (volumes created before this setting exist without it)
    # Use node+JSON5 for checks — grep fails on JSON5 unquoted keys (Pattern 24)
    if node -e "const JSON5=require('json5'),fs=require('fs');const c=JSON5.parse(fs.readFileSync('$CONFIG_PATH','utf-8'));process.exit(c.session?.dmScope==='per-channel-peer'?0:1)"; then
        echo "[entrypoint] Config verified: dmScope=per-channel-peer ✓"
    else
        echo "[entrypoint] Setting session.dmScope=per-channel-peer (required for multi-user session isolation)..."
        node -e "
            const JSON5 = require('json5');
            const fs = require('fs');
            const p = '$CONFIG_PATH';
            const config = JSON5.parse(fs.readFileSync(p, 'utf-8'));
            if (!config.session) config.session = {};
            config.session.dmScope = 'per-channel-peer';
            // Clean up: remove dmScope if it was mistakenly set under gateway
            if (config.gateway?.dmScope) delete config.gateway.dmScope;
            fs.writeFileSync(p, JSON5.stringify(config, null, 2));
        "
        echo "[entrypoint] dmScope set ✓"
    fi

    # Migrate: disable text slash commands (Phase 14 — prevents /model, /think cost risk, /status info leak)
    if node -e "const JSON5=require('json5'),fs=require('fs');const c=JSON5.parse(fs.readFileSync('$CONFIG_PATH','utf-8'));process.exit(c.commands?.text===false?0:1)"; then
        echo "[entrypoint] Config verified: commands.text=false ✓"
    else
        echo "[entrypoint] Setting commands.text=false (disables slash commands for WhatsApp users)..."
        node -e "
            const JSON5 = require('json5');
            const fs = require('fs');
            const p = '$CONFIG_PATH';
            const config = JSON5.parse(fs.readFileSync(p, 'utf-8'));
            if (!config.commands) config.commands = {};
            config.commands.text = false;
            fs.writeFileSync(p, JSON5.stringify(config, null, 2));
        "
        echo "[entrypoint] commands.text=false set ✓"
    fi

    # Migrate: lock model allowlist to zai/glm-4.7 (Phase 14 — prevents /model directive from switching to expensive models)
    if node -e "const JSON5=require('json5'),fs=require('fs');const c=JSON5.parse(fs.readFileSync('$CONFIG_PATH','utf-8'));const m=c.agents?.defaults?.models;process.exit(m&&Object.keys(m).length===1&&m['zai/glm-4.7']?0:1)"; then
        echo "[entrypoint] Config verified: models allowlist=zai/glm-4.7 ✓"
    else
        echo "[entrypoint] Setting models allowlist to zai/glm-4.7 (locks model selection)..."
        node -e "
            const JSON5 = require('json5');
            const fs = require('fs');
            const p = '$CONFIG_PATH';
            const config = JSON5.parse(fs.readFileSync(p, 'utf-8'));
            if (!config.agents) config.agents = {};
            if (!config.agents.defaults) config.agents.defaults = {};
            config.agents.defaults.models = { 'zai/glm-4.7': {} };
            config.agents.defaults.thinkingDefault = 'low';
            config.agents.defaults.elevatedDefault = 'off';
            config.agents.defaults.verboseDefault = 'off';
            fs.writeFileSync(p, JSON5.stringify(config, null, 2));
        "
        echo "[entrypoint] models allowlist set ✓"
    fi

    # Migrate: ensure exactly one welcome agent exists (deduplicate if needed)
    # Uses node+JSON5 — grep fails on JSON5 unquoted keys (Pattern 24)
    node -e "
        const JSON5 = require('json5');
        const fs = require('fs');
        const p = '$CONFIG_PATH';
        const config = JSON5.parse(fs.readFileSync(p, 'utf-8'));
        const hasWelcome = config.agents.list.some(a => a.id === 'welcome');
        if (!hasWelcome) {
            config.agents.list.unshift({ id: 'welcome', name: 'Welcome Agent', default: true, workspace: '~/.openclaw/workspace-welcome' });
            config.agents.list.forEach((a, i) => { if (i > 0) delete a.default; });
            fs.writeFileSync(p, JSON5.stringify(config, null, 2));
            console.log('[entrypoint] Welcome agent added to config');
        } else {
            // Deduplicate: keep first welcome, remove extras
            const seen = new Set();
            const before = config.agents.list.length;
            config.agents.list = config.agents.list.filter(a => {
                if (a.id === 'welcome') { if (seen.has('welcome')) return false; seen.add('welcome'); }
                return true;
            });
            if (config.agents.list.length < before) {
                fs.writeFileSync(p, JSON5.stringify(config, null, 2));
                console.log('[entrypoint] Deduplicated welcome agent (' + (before - config.agents.list.length) + ' duplicates removed)');
            } else {
                console.log('[entrypoint] Welcome agent already in config ✓');
            }
        }
    "
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

# Install onboarding-hook plugin (volume overrides image layer, so copy at runtime)
if [ ! -f "/home/node/.openclaw/extensions/onboarding-hook/openclaw.plugin.json" ]; then
  mkdir -p /home/node/.openclaw/extensions/onboarding-hook
  cp /app/config/extensions/onboarding-hook/* /home/node/.openclaw/extensions/onboarding-hook/
  echo "[entrypoint] Installed onboarding-hook plugin"
else
  echo "[entrypoint] onboarding-hook plugin already installed"
fi

echo "[entrypoint] Starting OpenClaw Gateway + Onboarding Service..."
exec node /app/launcher.js
