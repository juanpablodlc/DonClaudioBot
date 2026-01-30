#!/bin/bash
# setup.sh - Initial setup for DonClaudioBot

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== DonClaudioBot Setup ==="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 22+ first"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "Error: Node.js 22+ is required (current: $(node -v))"
    exit 1
fi

echo "✓ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$PROJECT_DIR"
npm install

# Build TypeScript
echo ""
echo "Building TypeScript..."
npm run build

# Create state directory
echo ""
echo "Creating state directory..."
mkdir -p "$HOME/.openclaw"

# Initialize database
echo ""
echo "Initializing onboarding database..."
# TODO: Run SQLite migrations

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Configure OpenClaw: cp config/openclaw.json.template ~/.openclaw/openclaw.json"
echo "  2. Edit the config to set your tokens and settings"
echo "  3. Start the service: npm start"
echo ""
