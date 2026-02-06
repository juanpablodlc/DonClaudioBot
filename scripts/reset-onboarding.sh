#!/bin/bash
# reset-onboarding.sh - Reset all user onboarding state for fresh testing
# Preserves: WhatsApp auth, welcome agent, container image
# Destroys: user agents, bindings, SQLite data, workspaces, sessions

set -e

SERVER="root@135.181.93.227"
CONTAINER="don-claudio-bot"
STATE_DIR="/home/node/.openclaw"
COMPOSE_FILE="/root/don-claudio-bot/docker/docker-compose.yml"

echo "=== Reset Onboarding State ==="
echo ""
echo "This will DESTROY:"
echo "  - All user agents and bindings in openclaw.json"
echo "  - All rows in onboarding.db"
echo "  - All user agent directories (agents/user_*)"
echo "  - All user workspaces (workspace-user_*)"
echo "  - Welcome agent sessions"
echo "  - Orphan sandbox containers"
echo ""
echo "This will PRESERVE:"
echo "  - WhatsApp credentials (no re-scan needed)"
echo "  - Welcome agent config and workspace"
echo ""
read -p "Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
fi

echo ""

# Step 1: Strip user agents from openclaw.json (keep only welcome agent)
echo "[1/7] Resetting openclaw.json..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker exec $CONTAINER node -e \"
  const JSON5 = require('json5');
  const fs = require('fs');
  const p = '$STATE_DIR/openclaw.json';
  const c = JSON5.parse(fs.readFileSync(p, 'utf-8'));
  const before = c.agents.list.length;
  c.agents.list = c.agents.list.filter(a => !a.id.startsWith('user_'));
  c.bindings = [];
  fs.writeFileSync(p, JSON5.stringify(c, null, 2));
  console.log('Removed ' + (before - c.agents.list.length) + ' user agent(s), cleared bindings');
\""

# Step 2: Truncate SQLite tables
echo "[2/7] Clearing onboarding database..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker exec $CONTAINER node -e \"
  const Database = require('better-sqlite3');
  const db = new Database('$STATE_DIR/onboarding.db');
  const states = db.prepare('SELECT COUNT(*) as n FROM onboarding_states').get();
  db.exec('DELETE FROM state_transitions; DELETE FROM onboarding_states;');
  console.log('Deleted ' + states.n + ' onboarding record(s)');
  db.close();
\""

# Step 3: Remove user agent directories
echo "[3/7] Removing user agent directories..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker exec $CONTAINER sh -c 'rm -rf $STATE_DIR/agents/user_* && echo Done || echo No agent dirs found'"

# Step 4: Remove user workspaces
echo "[4/7] Removing user workspaces..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker exec $CONTAINER sh -c 'rm -rf $STATE_DIR/workspace-user_* && echo Done || echo No workspaces found'"

# Step 5: Clear welcome agent sessions
echo "[5/7] Clearing welcome agent sessions..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker exec $CONTAINER sh -c 'echo \"{}\" > $STATE_DIR/agents/welcome/sessions/sessions.json && echo Done'"

# Step 6: Remove orphan sandbox containers (runs on host, not in container)
echo "[6/7] Removing orphan sandbox containers..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker ps -a --filter name=user_ -q | xargs docker rm -f 2>/dev/null && echo 'Removed sandbox containers' || echo 'No sandbox containers found'"

# Step 7: Restart container to clear in-memory state
echo "[7/7] Restarting container..."
ssh -i ~/.ssh/hetzner "$SERVER" "docker compose -f $COMPOSE_FILE restart"

echo ""
echo "=== Reset Complete ==="
echo ""
echo "Verify: ssh -i ~/.ssh/hetzner $SERVER 'cd /root/don-claudio-bot/docker && docker compose logs --tail=10 2>&1 | grep session-watcher'"
echo "Test: Send a WhatsApp message from +1312 number"
