# Rollback Procedure

When to use this procedure: when deployment fails, health checks fail, or WhatsApp authentication is lost.

## Trigger Conditions

Run rollback if ANY of these occur:
- Health check fails: `curl http://135.181.93.227:3000/health` returns error
- Container crash loop: `docker ps` shows container constantly restarting
- WhatsApp auth lost: `/home/node/.openclaw/credentials/whatsapp/` is empty
- Integration test fails locally (before Hetzner deploy)

## Automated Rollback (Recommended)

### Quick Rollback (Git Only)

Use when code is broken but volume data is intact:

```bash
./scripts/rollback.sh
```

### Full Rollback (Git + Volume)

Use when both code AND data are affected:

```bash
./scripts/rollback.sh --with-volume-restore
```

## Manual Rollback

### Step 1: Git Revert

```bash
# View current commit
git log -1 --oneline

# Revert to previous commit
git checkout HEAD~1

# Verify correct commit
git log -1 --oneline
```

### Step 2: Volume Restore (If Needed)

```bash
# List available backups
ls -lh backups/don-claudio-state-*.tar.gz

# Restore from backup
./scripts/restore.sh don-claudio-state-20250202-120000.tar.gz
```

### Step 3: Redeploy

```bash
./scripts/deploy.sh
```

### Step 4: Verify

```bash
# Check container status
ssh -i ~/.ssh/hetzner root@135.181.93.227 'docker ps | grep don-claudio-bot | grep -q Up'

# Check health endpoint
curl -f -s http://135.181.93.227:3000/health | jq -e '.status == "ok"'

# Check logs
ssh -i ~/.ssh/hetzner root@135.181.93.227 'cd /root/don-claudio-bot && docker compose logs -f --tail=50'
```

## Expected Output

### Healthy Deployment

```bash
$ docker ps
CONTAINER ID   IMAGE                    STATUS         NAMES
abc123def456   don-claudio-bot          Up 10 minutes  don-claudio-bot

$ curl http://135.181.93.227:3000/health
{"status":"ok"}

$ docker compose logs
[INFO] Onboarding service listening on port 3000
[INFO] OpenClaw Gateway initialized
```

### Unhealthy Deployment (Rollback Needed)

```bash
$ docker ps
CONTAINER ID   IMAGE                    STATUS                    NAMES
abc123def456   don-claudio-bot          Restarting (1) 5s ago     don-claudio-bot

$ curl http://135.181.93.227:3000/health
curl: (7) Failed to connect

$ docker compose logs
[ERROR] Cannot find module 'missing-dependency'
[ERROR] Port 3000 already in use
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
ssh root@135.181.93.227 'cd /root/don-claudio-bot && docker compose logs --tail 100'

# Common fixes:
# - Missing dependency: rebuild with --build flag
# - Port conflict: check docker compose ps
# - Volume mount issue: verify volume exists with docker volume ls
```

### Health Check Fails

```bash
# Test health endpoint directly on server
ssh root@135.181.93.227 'curl -v http://localhost:3000/health'

# If connection refused: container not running
# If 404/500: application error, check logs
```

### WhatsApp Auth Lost After Rollback

```bash
# If using git-only rollback, auth should be preserved in volume
# Check: ls -la /home/node/.openclaw/credentials/whatsapp/

# If empty, restore from backup:
./scripts/restore.sh don-claudio-state-<timestamp>.tar.gz
```

## Prevention

To avoid needing rollback:
1. Always run `./scripts/integration-test.sh` before Hetzner deploy
2. Create backup before deployment: `./scripts/backup.sh`
3. Review git diff before committing: `git diff HEAD~1`
4. Test changes locally first with `docker compose up --build`
