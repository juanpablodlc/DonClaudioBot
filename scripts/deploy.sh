#!/bin/bash
# deploy.sh - Deploy DonClaudioBot to Hetzner VPS

set -e

# Configuration
SERVER="root@135.181.93.227"  # Update with your server
PROJECT_DIR="/root/don-claudio-bot"

echo "=== Deploying DonClaudioBot ==="
echo ""

# Build locally
echo "Building locally..."
./scripts/build.sh

# Copy files to server
echo ""
echo "Copying files to server..."
rsync -av --exclude='node_modules' --exclude='.git' \
    /Users/jp/CodingProjects/DonClaudioBot/ \
    "$SERVER:$PROJECT_DIR/"

# CRITICAL: Copy .env to docker/ subdirectory for compose file
# Docker Compose reads .env from same directory as docker-compose.yml
echo "Copying .env to docker/ subdirectory..."
ssh "$SERVER" "cp $PROJECT_DIR/.env $PROJECT_DIR/docker/.env 2>/dev/null || echo 'No .env found'"

# Restart service on server with health checks
echo ""
echo "Restarting service on server..."
ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml up -d --build --force-recreate"

# Wait for health check to initialize
echo ""
echo "Waiting for service to be healthy..."
sleep 15

# CRITICAL: Verify env vars are NOT showing "change-me" defaults
echo ""
echo "Verifying environment variables..."
ENV_CHECK=$(ssh "$SERVER" "docker exec don-claudio-bot env | grep -E 'ZAI_API_KEY|OPENCLAW_GATEWAY_TOKEN|HOOK_TOKEN' | grep 'change-me' || true")
if [[ -n "$ENV_CHECK" ]]; then
    echo "ERROR: Environment variables not set (showing 'change-me' defaults):"
    echo "$ENV_CHECK"
    echo ""
    echo "Check that .env exists in both:"
    echo "  - $PROJECT_DIR/.env"
    echo "  - $PROJECT_DIR/docker/.env"
    exit 1
fi
echo "Environment variables: OK"

# Check container status
echo ""
echo "Checking container status..."
CONTAINER_STATUS=$(ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml ps --format json | grep -o '"State":"[^"]*"' | cut -d':' -f2 | tr -d '"'")
if [[ "$CONTAINER_STATUS" != "running" ]] && [[ "$CONTAINER_STATUS" != "healthy" ]]; then
    echo "ERROR: Container is not running (status: $CONTAINER_STATUS)"
    echo ""
    echo "Recent logs:"
    ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml logs --tail 50"
    exit 1
fi
echo "Container status: $CONTAINER_STATUS"

# Check health endpoint
echo ""
echo "Checking health endpoint..."
HEALTH_CHECK=$(ssh "$SERVER" "curl -s http://localhost:3000/health")
if [[ "$HEALTH_CHECK" != *"status"* ]] || [[ "$HEALTH_CHECK" != *"ok"* ]]; then
    echo "ERROR: Health check failed"
    echo ""
    echo "Response: $HEALTH_CHECK"
    echo ""
    echo "Recent logs:"
    ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml logs --tail 50"
    exit 1
fi
echo "Health check: OK ($HEALTH_CHECK)"

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Check logs: ssh $SERVER 'docker compose -f $PROJECT_DIR/docker/docker-compose.yml logs -f'"
echo "Old container will be kept for 10 minutes as rollback window"
echo ""
