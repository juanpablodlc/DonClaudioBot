# Deployment Guide - DonClaudioBot on Hetzner VPS

## Critical Concept: Code vs. State

| Code | State |
|------|-------|
| Application code (TypeScript) | WhatsApp authentication |
| Docker image | SQLite database |
| Dependencies | Agent sessions |
| Config templates | User data |

**Key point:** State survives deployments. Code changes don't affect WhatsApp authentication.

---

## What Gets Deployed to Hetzner

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Hetzner VPS                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Docker Volume: don-claudio-state (PERSISTENT)             │ │
│  │                                                             │ │
│  │  ~/.openclaw/                                               │ │
│  │  ├── credentials/whatsapp/     ← WhatsApp auth (survives)  │ │
│  │  ├── openclaw.json            ← Config (survives)            │ │
│  │  ├── onboarding.db            ← State (survives)            │ │
│  │  └── agents/<id>/             ← Per-agent state (survives)  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↑                                     │
│                           │ mounted to                           │
│                           ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Docker Container: don-claudio-bot                         │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  OpenClaw Gateway                                    │ │ │
│  │  │  - WhatsApp channel (auth from volume)              │ │ │
│  │  │  - Multi-agent routing                               │ │ │
│  │  │  - Hooks (trigger onboarding)                       │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Onboarding Service (your code)                       │ │ │
│  │  │  - Express server                                     │ │ │
│  │  │  - SQLite operations                                  │ │ │
│  │  │  - Agent creation logic                              │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │  Code updates happen here (container recreated)            │ │
│  │  State stays in volume (survives updates)                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Per-User Sandbox Containers (created dynamically)          │ │
│  │                                                             │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │ │
│  │  │ user_abc123 │  │ user_def456 │  │ user_ghi789 │            │ │
│  │  │             │  │             │  │             │            │ │
│  │  │ gog CLI     │  │ gog CLI     │  │ gog CLI     │            │ │
│  │  │ OAuth       │  │ OAuth       │  │ OAuth       │            │ │
│  │  └────────────┘  └────────────┘  └────────────┘            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### What Survives Deployments

| Data Type | Location | Survives? |
|-----------|----------|-----------|
| WhatsApp auth | `~/.openclaw/credentials/whatsapp/` | ✅ Yes (in volume) |
| Config | `~/.openclaw/openclaw.json` | ✅ Yes (in volume) |
| Onboarding DB | `~/.openclaw/onboarding.db` | ✅ Yes (in volume) |
| Agent sessions | `~/.openclaw/agents/*/sessions/` | ✅ Yes (in volume) |
| User OAuth tokens | `~/.openclaw/agents/*/agent/.gog/` | ✅ Yes (in volume) |
| Application code | Container image | ❌ No (replaced) |

**Result:** You can deploy code changes 100 times without re-authenticating WhatsApp.

---

## Deployment Commands (On Hetzner VPS)

### Option 1: Just Update Code (No WhatsApp Re-auth)

```bash
# From your local machine
ssh root@135.181.93.227

# On Hetzner
cd /root/don-claudio-bot

# Rebuild and restart (state preserved in volume)
docker compose -f docker/docker-compose.yml up -d --build
```

**What happens:**
- New container image built with your code changes
- Old container stopped
- **Volume stays attached** - WhatsApp auth preserved
- New container starts with existing state

### Option 2: Full Reset (Everything Wiped)

```bash
# WARNING: This destroys WhatsApp auth and all user data
ssh root@135.181.93.227

cd /root/don-claudio-bot

# Stop containers
docker compose -f docker/docker-compose.yml down

# Remove volumes (destroys all state)
docker volume rm don-claudio-state

# Rebuild from scratch
docker compose -f docker/docker-compose.yml up -d --build

# Re-authenticate WhatsApp
docker exec -it don-claudio-bot npx openclaw channels login
```

Only use Option 2 for disaster recovery or intentional reset.

---

## First-Time Setup

### 1. Server Requirements

- Hetzner VPS (any plan with 2GB+ RAM)
- Ubuntu 22.04 or Debian 12+
- Docker and Docker Compose installed
- SSH key access

### 2. Install Docker on Hetzner

```bash
ssh root@135.181.93.227

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### 3. Initial Deployment

```bash
# From your local machine
./scripts/deploy.sh
```

This creates:
- Docker volume `don-claudio-state` (empty initially)
- Container `don-claudio-bot` (running OpenClaw + Onboarding Service)

### 4. Authenticate WhatsApp (One-Time Only)

```bash
# SSH to Hetzner
ssh root@135.181.93.227

# Start the container (if not running)
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml up -d

# Authenticate WhatsApp (scans QR code)
docker exec -it don-claudio-bot npx openclaw channels login
```

**This is the ONLY time you need to authenticate.** The auth tokens are stored in the Docker volume and survive all future deployments.

---

## Updating the Deployment

### Scenario 1: You Changed Code (Most Common)

```bash
# From your local machine
./scripts/deploy.sh
```

Or manually:

```bash
ssh root@135.181.93.227
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml up -d --build
```

**Result:** New code deployed, WhatsApp still authenticated.

### Scenario 2: You Changed Config

```bash
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Edit config in volume
docker exec -it don-claudio-bot nano /root/.openclaw/openclaw.json

# Reload config (no restart needed)
docker exec -it don-claudio-bot npx openclaw gateway reload
```

**Result:** Config updated, container still running, WhatsApp still authenticated.

### Scenario 3: You Need to Rebuild Everything

```bash
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Graceful shutdown
docker compose -f docker/docker-compose.yml down

# Remove old image
docker rmi don-claudio-bot:latest

# Rebuild and start
docker compose -f docker/docker-compose.yml up -d --build
```

**Result:** Fresh container, but state volume preserved (WhatsApp still authenticated).

---

## Fast Iteration Development Loop

For rapid development without breaking WhatsApp:

### Local Development

```bash
# On your local machine
npm run build
npm start

# Test with local OpenClaw (see LOCAL_DEVELOPMENT.md)
```

### Deploy to Hetzner (When Ready)

```bash
./scripts/deploy.sh
```

**WhatsApp stays authenticated.** The volume is never destroyed unless you explicitly remove it.

---

## Monitoring

### Check logs

```bash
ssh root@135.181.93.227
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
ssh root@135.181.93.227
docker ps

# Should see:
# - don-claudio-bot (main container, running)
# - don-claudio-bot-sbx-* (sandbox containers, one per active user)
```

### Check volume

```bash
ssh root@135.181.93.227
docker volume ls | grep don-claudio

# Should see:
# don-claudio-state    (where WhatsApp auth lives)
```

### Health check

```bash
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

Backs up the entire volume:
- `~/.openclaw/credentials/whatsapp/` (WhatsApp auth)
- `~/.openclaw/openclaw.json` (config)
- `~/.openclaw/onboarding.db` (state)
- `~/.openclaw/agents/*/` (all agent data)

### Restore

```bash
# On Hetzner (disaster recovery)
ssh root@135.181.93.227
cd /root/don-claudio-bot
./scripts/restore.sh /path/to/backup
```

This restores everything including WhatsApp authentication.

---

## Troubleshooting

### Container won't start

```bash
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Check logs
docker compose logs don-claudio-bot

# Check volume exists
docker volume ls | grep don-claudio

# If volume is missing, recreate it
docker volume create don-claudio-state

# Restart
docker compose -f docker/docker-compose.yml up -d
```

### WhatsApp not working after deploy

```bash
ssh root@135.181.93.227

# Check if auth exists in volume
docker exec -it don-claudio-bot ls -la /root/.openclaw/credentials/whatsapp/

# If auth is missing, re-authenticate
docker exec -it don-claudio-bot npx openclaw channels login

# If auth exists but not working
docker exec -it don-claudio-bot npx openclaw channels status
```

### Lost WhatsApp auth (Volume deleted)

If the volume was accidentally deleted:

```bash
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Check if volume exists
docker volume ls | grep don-claudio

# If missing, this is why WhatsApp needs re-auth
# Re-authenticate:
docker exec -it don-claudio-bot npx openclaw channels login
```

**Prevention:** Never run `docker volume rm don-claudio-state` unless intentional.

---

## Security Notes

1. **Volume protection:** The `don-claudio-state` volume contains sensitive data (WhatsApp auth, user tokens). Protect access to the server.

2. **Backups:** Automated backups every 6 hours to an offsite location.

3. **WhatsApp allowlist:** In production, set `allowFrom` to specific phone numbers in config.

4. **Tokens:** Never commit `.env` files. Use strong random strings for `GATEWAY_TOKEN` and `HOOK_TOKEN`.

---

## What Lives Where

| Location | Content | Survives Deploy? |
|----------|---------|------------------|
| **Git repo** | Source code, templates, docs | N/A (version controlled) |
| **Docker image** | Compiled code, dependencies | ❌ No (replaced) |
| **Docker volume** | WhatsApp auth, config, state | ✅ Yes (persisted) |

---

## Quick Reference

```bash
# Deploy code changes (WhatsApp stays auth'd)
./scripts/deploy.sh

# SSH to server
ssh root@135.181.93.227

# View logs
cd /root/don-claudio-bot && docker compose logs -f

# Restart (preserves state)
docker compose -f docker/docker-compose.yml restart

# Check status
docker ps
curl localhost:3000/health

# WhatsApp auth (one-time only, unless volume deleted)
docker exec -it don-claudio-bot npx openclaw channels login

# Check volume (where auth lives)
docker volume inspect don-claudio-state

# DANGER: Destroy everything (including WhatsApp auth)
docker compose -f docker/docker-compose.yml down
docker volume rm don-claudio-state
```

---

## Common Misconceptions

### Misconception: "Deploying = Re-authenticating WhatsApp"

**False.** Deploying updates the code. WhatsApp authentication is in the volume and survives deployments.

### Misconception: "I need to stop the container to deploy"

**False.** `docker compose up -d --build` gracefully restarts the container while preserving the volume.

### Misconception: "Docker volume is deleted when I deploy"

**False.** Volumes persist until explicitly deleted with `docker volume rm`.

### Misconception: "I need a separate container for WhatsApp"

**False.** One container runs OpenClaw + Onboarding Service. WhatsApp auth is just files in a volume.
