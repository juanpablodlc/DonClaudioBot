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

# Restart service on server with health checks
echo ""
echo "Restarting service on server..."
ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml up -d --build --no-recreate"

# Wait for health check to initialize
echo ""
echo "Waiting for service to be healthy..."
sleep 15

# Check container status
echo ""
echo "Checking container status..."
CONTAINER_STATUS=$(ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml ps --format json | jq -r '.[0].State'")
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
if [[ "$HEALTH_CHECK" != *"OK"* ]] && [[ "$HEALTH_CHECK" != *"healthy"* ]]; then
    echo "ERROR: Health check failed"
    echo ""
    echo "Response: $HEALTH_CHECK"
    echo ""
    echo "Recent logs:"
    ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml logs --tail 50"
    exit 1
fi
echo "Health check: OK"

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Check logs: ssh $SERVER 'docker compose -f $PROJECT_DIR/docker/docker-compose.yml logs -f'"
echo "Old container will be kept for 10 minutes as rollback window"
echo ""
