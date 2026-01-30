# Deployment Guide - DonClaudioBot on Hetzner VPS

## What Gets Deployed

### On Your Hetzner VPS, you will run:

```
┌─────────────────────────────────────────────────────────┐
│  Docker Container: don-claudio-bot                      │
│                                                          │
│  ┌────────────────────────────────────────────────┐     │
│  │  OpenClaw Gateway                                │     │
│  │  - Installed via npm (not separate repo)       │     │
│  │  - WhatsApp channel                              │     │
│  │  - Multi-agent routing                           │     │
│  │  - Hooks (trigger onboarding)                   │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  ┌────────────────────────────────────────────────┐     │
│  │  Onboarding Service (your code)                 │     │
│  │  - Express server                                │     │
│  │  - SQLite state database                         │     │
│  │  - Agent creation logic                          │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  State: ~/.openclaw/                                     │
│  - openclaw.json (config)                                │
│  - onboarding.db (SQLite)                                │
│  - agents/<id>/ (per-agent state)                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Per-User Sandbox Containers (created dynamically)       │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ user_abc123 │  │ user_def456 │  │ user_ghi789 │        │
│  │             │  │             │  │             │        │
│  │ gog CLI     │  │ gog CLI     │  │ gog CLI     │        │
│  │ OAuth       │  │ OAuth       │  │ OAuth       │        │
│  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### Key Point

**OpenClaw is NOT a separate deployment.** It's an npm dependency that gets installed inside the Docker container.

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production  # <-- This installs OpenClaw
COPY . .
CMD ["node", "onboarding/dist/index.js"]
```

---

## Deployment Commands (On Hetzner VPS)

### Option 1: Using the deploy script (Recommended)

```bash
# From your local machine
./scripts/deploy.sh
```

This script:
1. Builds the Docker image locally
2. Copies files to Hetzner via rsync
3. Restarts the container on Hetzner

### Option 2: Manual deployment

```bash
# 1. SSH into Hetzner
ssh root@135.181.93.227

# 2. Create project directory
mkdir -p /root/don-claudio-bot
cd /root/don-claudio-bot

# 3. Copy files (from your local machine)
# Run this from your local DonClaudioBot directory:
rsync -av --exclude='node_modules' --exclude='.git' \
    /Users/jp/CodingProjects/DonClaudioBot/ \
    root@135.181.93.227:/root/don-claudio-bot/

# 4. On Hetzner, build and start
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml up -d --build
```

---

## First-Time Setup

### 1. Server Requirements

- Hetzner VPS (any plan with 2GB+ RAM)
- Ubuntu 22.04 or Debian 12+
- Docker and Docker Compose installed
- SSH key access

### 2. Install Docker on Hetzner

```bash
# SSH into Hetzner
ssh root@135.181.93.227

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### 3. Configure Environment Variables

On Hetzner, create `/root/don-claudio-bot/.env`:

```bash
# On Hetzner
cd /root/don-claudio-bot
cat > .env << 'EOF'
# Gateway authentication (generate a random string)
GATEWAY_TOKEN=$(openssl rand -hex 32)

# Webhook authentication (generate a different random string)
HOOK_TOKEN=$(openssl rand -hex 32)

# Optional: Your AI provider API key
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
EOF

chmod 600 .env
```

### 4. Initialize OpenClaw

```bash
# On Hetzner
cd /root/don-claudio-bot

# Create OpenClaw state directory
mkdir -p ~/.openclaw

# Copy config template
cp config/openclaw.json.template ~/.openclaw/openclaw.json

# Edit the config with your tokens
nano ~/.openclaw/openclaw.json
```

### 5. Start the Service

```bash
# On Hetzner
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml up -d --build
```

### 6. Authenticate WhatsApp

```bash
# On Hetzner
docker exec -it don-claudio-bot npx openclaw channels login
```

Scan the QR code with your WhatsApp phone.

---

## Updating the Deployment

### When you change code:

```bash
# From your local machine
./scripts/deploy.sh
```

### When you just change config:

```bash
# SSH into Hetzner
ssh root@135.181.93.227

# Restart container (reloads config)
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml restart
```

---

## Monitoring

### Check logs

```bash
# On Hetzner
cd /root/don-claudio-bot

# All logs
docker compose logs -f

# Just OpenClaw gateway
docker compose logs -f don-claudio-bot | grep gateway

# Just onboarding service
docker compose logs -f don-claudio-bot | grep onboarding
```

### Check container status

```bash
# On Hetzner
docker ps

# Should see:
# - don-claudio-bot (main container)
# - don-claudio-bot-sbx-* (sandbox containers, one per active user)
```

### Health check

```bash
# From your local machine
curl http://135.181.93.227:3000/health
```

Should return: `{"status":"healthy","service":"don-claudio-onboarding"}`

---

## Backup & Restore

### Backup

```bash
# From your local machine (runs via cron)
./scripts/backup.sh
```

Backs up:
- `~/.openclaw/openclaw.json` (config)
- `~/.openclaw/onboarding.db` (state)
- `~/.openclaw/agents/*/` (agent data)

### Restore

```bash
# On Hetzner (disaster recovery)
cd /root/don-claudio-bot
./scripts/restore.sh /path/to/backup
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs don-claudio-bot

# Check if ports are already in use
netstat -tlnp | grep -E '3000|18789'

# Rebuild from scratch
docker compose down
docker system prune -a
docker compose up -d --build
```

### WhatsApp not working

```bash
# Check if WhatsApp is authenticated
docker exec -it don-claudio-bot npx openclaw channels status

# Re-authenticate if needed
docker exec -it don-claudio-bot npx openclaw channels login
```

### Agent not created

```bash
# Check onboarding service logs
docker compose logs don-claudio-bot | grep onboarding

# Check OpenClaw config
docker exec -it don-claudio-bot cat /root/.openclaw/openclaw.json | jq .agents
```

---

## Security Notes

1. **Firewall:** Only expose ports 3000 (onboarding) and 18789 (gateway) via reverse proxy or SSH tunnel
2. **Tokens:** Never commit `.env` files. Use the generated tokens in `GATEWAY_TOKEN` and `HOOK_TOKEN`
3. **WhatsApp:** Use allowlist mode in production. Set `allowFrom` to specific phone numbers.
4. **Backups:** Run automated backups every 6 hours to an offsite location.

---

## What Lives Where

| Location | Content |
|----------|---------|
| **Local machine** | Source code, development, deployment scripts |
| **Hetzner VPS** | Docker containers, runtime state, configs |
| **Git repo** | Source code, configs, documentation (NOT: `.env`, state files) |
| **.openclaw-reference/** | OpenClaw source for docs only (gitignored, NOT deployed) |

---

## Quick Reference

```bash
# Deploy (from local)
./scripts/deploy.sh

# SSH to server
ssh root@135.181.93.227

# View logs (on server)
cd /root/don-claudio-bot && docker compose logs -f

# Restart (on server)
cd /root/don-claudio-bot && docker compose restart

# Check status (on server)
docker ps
curl localhost:3000/health

# WhatsApp auth (on server)
docker exec -it don-claudio-bot npx openclaw channels login
```
