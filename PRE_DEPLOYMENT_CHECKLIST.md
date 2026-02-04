# Pre-Deployment Checklist
<!--
  WHAT: Mandatory verification steps BEFORE deploying to Hetzner
  WHY: 70% of recent fixes were symptom workarounds preventable by this checklist
  WHEN: Run BEFORE every deployment, no exceptions
-->

## Phase 1: Documentation Review (15 minutes, MANDATORY)

### OpenClaw Documentation Research
- [ ] Search QMD MCP for ALL env var names you're using
  - Example: `mcp__qmd__search(query="OPENCLAW_GATEWAY_TOKEN")`
  - Verify: Each env var appears in OpenClaw docs with expected format
- [ ] Search QMD MCP for config schema you're modifying
  - Example: `mcp__qmd__search(query="gateway.bind")`
  - Verify: Schema format matches OpenClaw expectations
- [ ] Search QMD MCP for any CLI commands you're running
  - Example: `mcp__qmd__search(query="openclaw doctor")`
  - Verify: Command behavior and side effects are understood

**STOP if any search returns 0 results** - You're using undocumented features.

### Docker Documentation Review
- [ ] Verify Docker Compose .env behavior
  - .env is read from same directory as docker-compose.yml
  - Use `env_file:` for explicit paths
- [ ] Verify volume persistence behavior
  - Template changes DON'T apply to existing volumes
  - Plan for fresh volume OR manual config migration

## Phase 2: Local Validation (30 minutes, MANDATORY)

### Template Validation
- [ ] Run: `npx openclaw config validate config/openclaw.json.template`
- [ ] Fix any schema errors BEFORE deploying

### Docker Compose Validation
- [ ] Run: `docker compose config` (shows final composed config)
- [ ] Verify all env vars are substituted (no "change-me" defaults)
- [ ] Verify volume mounts are correct

### Local Container Test
- [ ] Run: `docker compose up -d`
- [ ] Verify container starts: `docker compose ps`
- [ ] Check env vars inside container: `docker exec don-claudio-bot env | grep -E "ZAI|GATEWAY|HOOK"`
- [ ] Verify health endpoint: `curl http://localhost:3000/health`
- [ ] Stop: `docker compose down`

## Phase 3: Pre-Deploy Verification (5 minutes, MANDATORY)

### Env Var Checklist
- [ ] HOOK_TOKEN is set (not "change-me")
- [ ] OPENCLAW_GATEWAY_TOKEN is set (not "change-me")
- [ ] ZAI_API_KEY is set (if using Z.AI model)

### File Location Checklist
- [ ] .env exists in project root
- [ ] .env exists in docker/ subdirectory OR docker-compose.yml uses `env_file: - ../.env`
- [ ] No duplicate .env files with conflicting values

### Git Status Check
- [ ] All intended changes are committed
- [ ] No unintended changes are staged
- [ ] Commit message clearly describes what's being deployed

## Phase 4: Deploy (After phases 1-3 pass)

### Deployment Steps
- [ ] Run: `./scripts/deploy.sh`
- [ ] Monitor logs: `ssh root@135.181.93.227 'cd /root/don-claudio-bot && docker compose logs -f --tail=50'`
- [ ] Verify container healthy: `ssh root@135.181.93.227 'docker ps | grep don-claudio-bot | grep -q healthy'`
- [ ] Verify health endpoint: `curl -f http://135.181.93.227:3000/health`

## Phase 5: Post-Deploy Verification (5 minutes, MANDATORY)

### Config Verification
- [ ] Check running config matches template: `ssh root@135.181.93.227 'docker exec don-claudio-bot cat /home/node/.openclaw/openclaw.json'`
- [ ] Verify env vars in container: `ssh root@135.181.93.227 'docker exec don-claudio-bot env | grep -E "ZAI|GATEWAY|HOOK"'`

### Smoke Tests
- [ ] Gateway UI accessible via SSH tunnel
- [ ] Onboarding health endpoint returns {"status":"ok"}
- [ ] No error messages in logs

## 3-Strike Error Protocol

**If deployment fails 3 times:**
1. STOP deploying immediately
2. Return to Phase 1 (Documentation Review)
3. Create minimal reproduction locally
4. Only resume when root cause is identified

**Evidence of circular debugging:**
- You're reverting previous changes
- You're fixing issues caused by your previous fixes
- You've tried 3+ different approaches to the same error

## Anti-Patterns to Avoid

| Anti-Pattern | Prevention |
|-------------|-------------|
| "Just deploy and see what happens" | Complete this checklist first |
| "The docs are too long" | 15 minutes of research saves 15 deployment attempts |
| "I'll fix it in production" | Test locally, deploy once |
| "This env var name should work" | Search QMD MCP, use documented names |
| "Template changes will apply to volume" | They won't. Plan for fresh volume or manual migration |

## References

- ARCHITECTURE_REPORT.md - Complete architecture reference
- findings.md - "Docker Anti-Patterns" section
- CLAUDE.md - "Documentation First Rule" and "3-Strike Error Protocol"
