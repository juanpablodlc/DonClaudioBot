# Deployment Checklist & Runbook

**Purpose:** Production deployment procedures for DonClaudioBot on Hetzner VPS (135.181.93.227)

**Last Updated:** 2026-02-01

**Critical Concept:** Code deployments do NOT affect WhatsApp authentication. The `don-claudio-state` Docker volume persists across deployments.

---

## 1. Pre-Deployment Checklist

Complete ALL items before deploying to production.

### Environment Readiness

- [ ] **`.env` file exists and contains all required variables**
  ```bash
  # On Hetzner server
  ssh root@135.181.93.227
  cd /root/don-claudio-bot
  cat .env
  ```
  Must contain:
  - `GATEWAY_TOKEN` (strong random string)
  - `HOOK_TOKEN` (strong random string)
  - `NODE_ENV=production`

- [ ] **Docker security hardening is applied**
  ```bash
  # Verify docker-compose.yml has:
  grep -A 5 "security_opt" docker/docker-compose.yml
  # Should show: no-new-privileges:true
  grep -A 3 "cap_drop" docker/docker-compose.yml
  # Should show: cap_drop: - ALL
  grep "read_only" docker/docker-compose.yml
  # Should show: read_only: true
  ```

- [ ] **Recent backup exists (within last 6 hours)**
  ```bash
  # On Hetzner server
  ssh root@135.181.93.227
  ls -lh /root/don-claudio-bot/backups/ | tail -5
  # Verify most recent backup is recent
  ```

- [ ] **Local build passes**
  ```bash
  # On local machine
  cd /Users/jp/CodingProjects/DonClaudioBot
  npm run build
  # Exit code should be 0
  ```

- [ ] **Tests pass (if applicable)**
  ```bash
  npm test
  # All tests should pass
  ```

- [ ] **No uncommitted changes in critical files**
  ```bash
  git status
  # Verify docker/docker-compose.yml and config/ are committed if changed
  ```

### Service Health Check (Before Deploy)

- [ ] **Current production service is healthy**
  ```bash
  curl http://135.181.93.227:3000/health
  # Should return: {"status":"healthy","service":"don-claudio-onboarding"}
  ```

- [ ] **WhatsApp authentication is active**
  ```bash
  ssh root@135.181.93.227
  docker exec -it don-claudio-bot npx openclaw channels status
  # Should show: Connected
  ```

- [ ] **Volume exists and is mounted**
  ```bash
  ssh root@135.181.93.227
  docker volume ls | grep don-claudio-state
  # Should show: don-claudio-state
  docker volume inspect don-claudio-state
  # Should show mountpoint
  ```

---

## 2. Deployment Process

Follow these steps exactly when deploying to production.

### Step 1: Create Volume Backup (Optional but Recommended)

```bash
# On Hetzner server BEFORE deployment
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Create timestamped backup
docker run --rm \
  -v don-claudio-state:/data \
  -v /root/don-claudio-bot/backups:/backup \
  alpine tar czf /backup/pre-deploy-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

### Step 2: Deploy Code

```bash
# From local machine - use the deploy script
cd /Users/jp/CodingProjects/DonClaudioBot
./scripts/deploy.sh
```

**What happens:**
1. TypeScript code is compiled locally (`./scripts/build.sh`)
2. Files are rsync'd to Hetzner server (excluding `node_modules`, `.git`)
3. Old container is gracefully stopped
4. New container is built and started
5. **Volume stays attached** - WhatsApp auth is preserved

### Step 3: Verify Deployment

Wait 10 seconds after deploy completes, then run:

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Check container is running
docker ps | grep don-claudio-bot
# Should show: Up X seconds

# Check logs for errors
docker compose logs --tail=50 don-claudio-bot
# Look for: ERROR, FAIL, Exception
```

---

## 3. Post-Deployment Verification

Complete ALL checks before considering deployment successful.

### Health Checks

- [ ] **Health endpoint responds**
  ```bash
  curl http://135.181.93.227:3000/health
  # Expected: {"status":"healthy","service":"don-claudio-onboarding"}
  ```

- [ ] **Webhook endpoint accepts POST (smoke test)**
  ```bash
  curl -X POST http://135.181.93.227:3000/webhook/onboarding \
    -H "Content-Type: application/json" \
    -d '{"phone":"1234567890","message":"test"}' \
    -w "\nHTTP Status: %{http_code}\n"
  # Expected: HTTP Status 200 or 400 (validation), NOT 500
  ```

- [ ] **WhatsApp authentication survived**
  ```bash
  ssh root@135.181.93.227
  docker exec -it don-claudio-bot npx openclaw channels status
  # Expected: Connected (NOT "Not authenticated")
  ```

- [ ] **Volume is still mounted**
  ```bash
  ssh root@135.181.93.227
  docker inspect don-claudio-bot --format='{{range .Mounts}}{{if eq .Destination "/root/.openclaw"}}{{.Source}}{{end}}{{end}}'
  # Expected: /var/lib/docker/volumes/don-claudio-state/_data
  ```

- [ ] **Onboarding database is accessible**
  ```bash
  ssh root@135.181.93.227
  docker exec -it don-claudio-bot ls -la /root/.openclaw/onboarding.db
  # Expected: File exists and is > 0 bytes
  ```

### Functional Tests

- [ ] **Onboarding state endpoint works**
  ```bash
  curl http://135.181.93.227:3000/onboarding/state/1234567890
  # Expected: JSON response with status field
  ```

- [ ] **No error spikes in logs**
  ```bash
  ssh root@135.181.93.227
  docker compose logs --since=1m don-claudio-bot | grep -i error
  # Expected: No output (or only expected warnings)
  ```

---

## 4. Rollback Procedure

Use if deployment fails verification or causes critical issues.

### Immediate Rollback (Code Only)

If you deployed bad code but volume is intact:

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Find previous Git commit
git log --oneline -5

# Rollback to previous commit
git checkout HEAD~1

# Rebuild and restart
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d --build
```

### Volume Rollback (If State Corruption)

If the volume or database was corrupted:

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Stop container
docker compose -f docker/docker-compose.yml down

# List backups
ls -lh backups/

# Restore volume from backup (replace YYYYMMDD-HHMMSS with actual timestamp)
docker run --rm \
  -v don-claudio-state:/data \
  -v /root/don-claudio-bot/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/pre-deploy-YYYYMMDD-HHMMSS.tar.gz -C /data"

# Restart container
docker compose -f docker/docker-compose.yml up -d
```

### Full System Reset (Last Resort)

**WARNING:** This destroys ALL state including WhatsApp authentication and user data. Use only for disaster recovery.

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Stop container
docker compose -f docker/docker-compose.yml down

# Remove volume (DESTROYS WHATSAPP AUTH)
docker volume rm don-claudio-state

# Rebuild from scratch
docker compose -f docker/docker-compose.yml up -d --build

# Re-authenticate WhatsApp
docker exec -it don-claudio-bot npx openclaw channels login
```

---

## 5. Common Failure Scenarios

### Scenario: Container Won't Start

**Symptoms:**
```bash
docker ps
# don-claudio-bot not listed
```

**Diagnosis:**
```bash
# Check container logs
docker compose logs don-claudio-bot

# Check if volume exists
docker volume ls | grep don-claudio-state
```

**Recovery:**
```bash
# If volume is missing, recreate it
docker volume create don-claudio-state

# If container crashed, check logs for fix
# Then rebuild:
docker compose -f docker/docker-compose.yml up -d --build
```

### Scenario: WhatsApp Authentication Lost

**Symptoms:**
```bash
docker exec -it don-claudio-bot npx openclaw channels status
# Returns: Not authenticated
```

**Diagnosis:**
```bash
# Check if auth files exist
docker exec -it don-claudio-bot ls -la /root/.openclaw/credentials/whatsapp/
# If directory exists but empty -> auth lost
# If directory doesn't exist -> volume problem
```

**Recovery:**
```bash
# Option 1: Restore from backup (preferred)
docker run --rm \
  -v don-claudio-state:/data \
  -v /root/don-claudio-bot/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/MOST_RECENT_BACKUP.tar.gz -C /data"

# Option 2: Re-authenticate (causes downtime)
docker exec -it don-claudio-bot npx openclaw channels login
# Scan QR code within 60 seconds
```

### Scenario: Webhook Returns 500

**Symptoms:**
```bash
curl -X POST http://135.181.93.227:3000/webhook/onboarding \
  -H "Content-Type: application/json" \
  -d '{"phone":"123","message":"test"}'
# Returns: HTTP 500 Internal Server Error
```

**Diagnosis:**
```bash
# Check onboarding service logs
docker compose logs don-claudio-bot | grep -A 20 "webhook"

# Check if database is accessible
docker exec -it don-claudio-bot sqlite3 /root/.openclaw/onboarding.db ".tables"
```

**Recovery:**
```bash
# If database issue: restart onboarding service
docker compose restart don-claudio-bot

# If code issue: rollback to previous commit
# See "Immediate Rollback (Code Only)" above
```

### Scenario: High CPU/Memory Usage

**Symptoms:**
```bash
docker stats
# Shows high CPU or memory for don-claudio-bot
```

**Diagnosis:**
```bash
# Check what's using resources
docker exec -it don-claudio-bot top

# Check for memory leaks
docker compose logs don-claudio-bot | grep -i "memory\|heap"
```

**Recovery:**
```bash
# Restart container (preserves state)
docker compose restart don-claudio-bot

# If issue persists, check for runaway agent sessions
docker exec -it don-claudio-bot ls -la /root/.openclaw/agents/
```

### Scenario: Health Check Fails

**Symptoms:**
```bash
curl http://135.181.93.227:3000/health
# Returns: 502 Bad Gateway or timeout
```

**Diagnosis:**
```bash
# Check if container is running
docker ps | grep don-claudio-bot

# Check port is exposed
docker port don-claudio-bot
# Should show: 3000/tcp -> 0.0.0.0:3000
```

**Recovery:**
```bash
# If container crashed, restart it
docker compose up -d don-claudio-bot

# If port issue, check docker-compose.yml ports section
# Should have: - "3000:3000"
```

---

## 6. Monitoring Commands

Use these commands to monitor system health during and after deployment.

### Real-Time Monitoring

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Follow all logs (live)
docker compose logs -f

# Follow only onboarding service logs
docker compose logs -f don-claudio-bot | grep -i onboarding

# Follow only gateway logs
docker compose logs -f don-claudio-bot | grep -i gateway

# Check container resource usage
docker stats don-claudio-bot

# Check container status
docker ps -a | grep don-claudio
```

### Health Monitoring

```bash
# Health endpoint
curl http://135.181.93.227:3000/health
curl http://135.181.93.227:3000/health | jq .

# WhatsApp status
docker exec -it don-claudio-bot npx openclaw channels status

# Volume integrity
docker volume inspect don-claudio-state

# Database integrity
docker exec -it don-claudio-bot sqlite3 /root/.openclaw/onboarding.db "PRAGMA integrity_check;"
```

### Error Monitoring

```bash
# Recent errors (last 10 minutes)
docker compose logs --since=10m don-claudio-bot | grep -i error

# All errors in current session
docker compose logs don-claudio-bot 2>&1 | grep -i error

# Warnings (non-critical)
docker compose logs --since=1h don-claudio-bot | grep -i warn
```

### Backup Monitoring

```bash
# List all backups
ls -lh /root/don-claudio-bot/backups/

# Check backup age (in seconds)
backups_dir=/root/don-claudio-bot/backups
latest_backup=$(ls -t $backups_dir/*.tar.gz | head -1)
backup_age=$(( ($(date +%s) - $(stat -f %m "$latest_backup")) ))
echo "Latest backup age: $backup_age seconds"
# Should be < 21600 seconds (6 hours)
```

---

## 7. Emergency Procedures

### Emergency Shutdown

If you need to immediately stop all services:

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Stop main container (preserves volume)
docker compose -f docker/docker-compose.yml down

# Stop all sandbox containers
docker ps -q --filter "name=don-claudio-bot-sbx" | xargs docker stop
```

### Emergency Contact

| Role | Name | Contact | Availability |
|------|------|---------|--------------|
| System Administrator | JP | [Contact method TBD] | 24/7 for critical issues |
| On-Call Engineer | [TBD] | [Contact method TBD] | [Hours TBD] |

**Critical Issue Definition:**
- Service completely down (all users affected)
- WhatsApp authentication lost
- Data corruption suspected
- Security breach suspected

**Non-Critical Issue Definition:**
- Single user can't onboard
- Intermittent webhook failures
- High latency (but service responding)

### Escalation Path

1. **Level 1 (Non-Critical):** Create issue, investigate within 4 hours
2. **Level 2 (Critical):** Immediate investigation, emergency contact within 30 minutes
3. **Level 3 (Security/Data Loss):** Emergency contact immediately, prepare rollback

### Disaster Recovery

If complete system failure occurs:

```bash
# 1. Assess damage
ssh root@135.181.93.227
docker ps -a
docker volume ls

# 2. If volume exists but container won't start
cd /root/don-claudio-bot
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d --build

# 3. If volume is destroyed
# a) Check if offsite backup exists
ls -lh /root/don-claudio-bot/backups/

# b) Restore from most recent backup
docker volume create don-claudio-state
docker run --rm \
  -v don-claudio-state:/data \
  -v /root/don-claudio-bot/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/MOST_RECENT_BACKUP.tar.gz -C /data"

# c) Restart container
docker compose -f docker/docker-compose.yml up -d --build

# d) Re-authenticate WhatsApp if backup didn't include credentials
docker exec -it don-claudio-bot npx openclaw channels login
```

---

## 8. Quick Reference Card

### Standard Deployment

```bash
# Local build and deploy
cd /Users/jp/CodingProjects/DonClaudioBot
./scripts/deploy.sh

# Verify health
curl http://135.181.93.227:3000/health
```

### Manual Deployment (If Script Fails)

```bash
# SSH to Hetzner
ssh root@135.181.93.227
cd /root/don-claudio-bot

# Rebuild and restart
docker compose -f docker/docker-compose.yml up -d --build

# Watch logs
docker compose logs -f
```

### Health Check Commands

```bash
# Container running?
docker ps | grep don-claudio-bot

# Service healthy?
curl http://135.181.93.227:3000/health

# WhatsApp connected?
docker exec -it don-claudio-bot npx openclaw channels status

# Volume intact?
docker volume ls | grep don-claudio-state
```

### Rollback Commands

```bash
# Code rollback
ssh root@135.181.93.227
cd /root/don-claudio-bot
git checkout HEAD~1
docker compose -f docker/docker-compose.yml up -d --build

# Volume restore
docker run --rm \
  -v don-claudio-state:/data \
  -v /root/don-claudio-bot/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/BACKUP_FILE.tar.gz -C /data"
```

---

## Appendix: Docker Volume Details

The `don-claudio-state` volume contains:

| Path | Contents | Critical? |
|------|----------|-----------|
| `/root/.openclaw/credentials/whatsapp/` | WhatsApp auth tokens | YES - loss requires re-auth |
| `/root/.openclaw/openclaw.json` | OpenClaw configuration | YES - loss breaks service |
| `/root/.openclaw/onboarding.db` | Onboarding state database | YES - loss breaks onboarding |
| `/root/.openclaw/agents/<id>/` | Per-agent sessions and OAuth tokens | YES - loss affects users |

**Volume Mount Point:** `/var/lib/docker/volumes/don-claudio-state/_data`

**Size Check:**
```bash
docker volume inspect don-claudio-state --format='{{.UsageData.Size}}'
```

---

**Document Version:** 1.0

**Change Log:**
- 2026-02-01: Initial creation (P1-010)
