# DonClaudioBot

WhatsApp-based multi-user AI assistant service powered by OpenClaw.

## Overview

DonClaudioBot provides personalized AI agents to thousands of users via WhatsApp, with:
- **Strong isolation** - Per-user sandboxed environments
- **Google integration** - OAuth for Gmail and Calendar access
- **Dynamic provisioning** - Agents created on-demand
- **Reliable onboarding** - Deterministic state machine, not LLM-driven

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start onboarding service
npm start

# Docker (recommended)
npm run docker:build
npm run docker:up
```

## Architecture

See [ARCHITECTURE_REPORT.md](./ARCHITECTURE_REPORT.md) for complete design documentation.

## Project Structure

```
DonClaudioBot/
├── onboarding/          # Onboarding service (Express + SQLite)
├── config/              # OpenClaw configurations
├── scripts/             # Deployment scripts
└── docker/              # Docker files
```

## License

MIT
