#!/bin/bash
# build.sh - Build DonClaudioBot for deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building DonClaudioBot ==="
echo ""

cd "$PROJECT_DIR"

# Clean previous build
echo "Cleaning previous build..."
rm -rf onboarding/dist

# Install dependencies
echo "Installing dependencies..."
npm ci --legacy-peer-deps

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Build Docker image
echo "Building Docker image..."
docker build -t don-claudio-bot:latest -f docker/Dockerfile .

echo ""
echo "=== Build Complete ==="
echo ""
echo "To run: docker run -p 3000:3000 don-claudio-bot:latest"
echo ""
