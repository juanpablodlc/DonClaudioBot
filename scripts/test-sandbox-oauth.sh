#!/bin/bash
# Test Sandbox OAuth — Phase 11 Verification
# Tests that sandbox containers receive env vars and can access gog credentials

set -e

AGENT_ID="user_405bf6b6cf0f1a4f"

echo "=== Phase 11: Sandbox OAuth Verification ==="
echo ""
echo "This script verifies:"
echo "1. Agent config has correct bind mount path"
echo "2. Agent config has env vars defined"
echo "3. Sandbox container receives env vars when created"
echo "4. gog can access credentials inside sandbox"
echo ""

# Check 1: Agent config
echo "Check 1: Verifying agent config..."
ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker exec don-claudio-bot npx openclaw config get agents.list | jq -r '.[] | select(.id == \"$AGENT_ID\") | .sandbox.docker.binds'"

# Check 2: Env vars in config
echo ""
echo "Check 2: Verifying env vars in config..."
ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker exec don-claudio-bot npx openclaw config get agents.list | jq -r '.[] | select(.id == \"$AGENT_ID\") | .sandbox.docker.env'"

# Check 3: Trigger sandbox creation (send message to agent)
echo ""
echo "Check 3: Triggering sandbox creation..."
echo "Send a WhatsApp message to +12062274085 with: 'Hello, can you run gog auth status?'"
echo "Then press ENTER to continue..."
read

# Check 4: Find sandbox container
echo ""
echo "Check 4: Finding sandbox container..."
SANDBOX_CONTAINER=$(ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker ps --format '{{.Names}}' | grep sandbox || echo ''")

if [ -z "$SANDBOX_CONTAINER" ]; then
  echo "❌ No sandbox container found. Agent may not have received a message yet."
  echo "   Send a WhatsApp message to trigger sandbox creation."
  exit 1
fi

echo "✓ Found sandbox container: $SANDBOX_CONTAINER"

# Check 5: Verify env vars in sandbox
echo ""
echo "Check 5: Verifying env vars in running sandbox..."
ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker exec $SANDBOX_CONTAINER env | grep -E 'GOG_|HOME' | sort"

# Check 6: Verify credentials file is accessible
echo ""
echo "Check 6: Verifying credentials file..."
ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker exec $SANDBOX_CONTAINER ls -la /root/.config/gogcli/credentials.json"

# Check 7: Test gog auth status
echo ""
echo "Check 7: Testing gog auth status..."
ssh -i ~/.ssh/hetzner root@135.181.93.227 "docker exec $SANDBOX_CONTAINER gog auth status"

echo ""
echo "=== Verification Complete ==="
