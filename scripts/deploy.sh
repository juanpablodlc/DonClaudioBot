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

# Restart service on server
echo ""
echo "Restarting service on server..."
ssh "$SERVER" "cd $PROJECT_DIR && docker compose -f docker/docker-compose.yml down && docker compose -f docker/docker-compose.yml up -d"

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Check logs: ssh $SERVER 'docker compose -f $PROJECT_DIR/docker/docker-compose.yml logs -f'"
echo ""
