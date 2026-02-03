# Findings & Decisions
<!--
  WHAT: Your knowledge base for the task. Stores everything you discover and decide.
  WHY: Context windows are limited. This file is your "external memory" - persistent and unlimited.
  WHEN: Update after ANY discovery, especially after 2 view/browser/search operations (2-Action Rule).
-->

## Requirements
<!--
  WHAT: What the user asked for, broken down into specific requirements.
  WHY: Keeps requirements visible so you don't forget what you're building.
  WHEN: Fill this in during Phase 1 (Requirements & Discovery).
-->
- Deploy DonClaudioBot v2 to Hetzner VPS (135.181.93.227)
- Verify container is running and healthy
- Authenticate WhatsApp channel
- Build sandbox image for dedicated agent OAuth
- Test webhook endpoint and onboarding flow
- Document deployment results
- **Critical:** Preserve WhatsApp authentication in don-claudio-state volume

## Research Findings
<!--
  WHAT: Key discoveries from web searches, documentation reading, or exploration.
  WHY: Multimodal content (images, browser results) doesn't persist. Write it down immediately.
  WHEN: After EVERY 2 view/browser/search operations, update this section (2-Action Rule).
-->

### From OpenClaw Reference Docs (QMD search)

**Critical Discovery - Config Schema:**
- Current schema uses `gateway.auth.token`, NOT `gateway.token`
- From troubleshooting.md: "`gateway.token` is ignored; use `gateway.auth.token`"
- Config uses `agents.defaults` not `agent`, `channels` not separate top-level
- Non-loopback binds require auth: `gateway.auth.token` (or `OPENCLAW_GATEWAY_TOKEN` env var)

**Critical Discovery - `openclaw setup` behavior:**
- `openclaw setup` creates `~/.openclaw/openclaw.json` (config) + workspace files
- Gateway REQUIRES this config file before starting - fails with "Missing config" if missing
- From agent.md: "Recommended: use `openclaw setup` to create `~/.openclaw/openclaw.json` if missing and initialize the workspace files"

**Critical Discovery - Env Var Substitution:**
- OpenClaw supports `${VAR_NAME:-default}` syntax in config for env var substitution
- Variables are substituted at config LOAD TIME, before validation
- From configuration.md: "Only uppercase env var names are matched: `[A-Z_][A-Z0-9_]*`"

**CRITICAL FIX (2026-02-02): Environment Variable Name**
- OpenClaw docs consistently use `OPENCLAW_GATEWAY_TOKEN` (32 matches in reference docs)
- Project was using `GATEWAY_TOKEN` which doesn't match OpenClaw's expected env var name
- Gateway's internal validation looks for `OPENCLAW_GATEWAY_TOKEN` when checking auth config
- **Root cause:** Env var substitution worked, but Gateway validation checks for specific var name
- **Fix applied (2026-02-02):**
  - `config/openclaw.json.template`: `${GATEWAY_TOKEN}` → `${OPENCLAW_GATEWAY_TOKEN}`
  - `.env.example`: `GATEWAY_TOKEN=` → `OPENCLAW_GATEWAY_TOKEN=`
  - `docker/docker-compose.yml`: `GATEWAY_TOKEN` → `OPENCLAW_GATEWAY_TOKEN`
  - `.env`: Token value preserved, only key name changed
  - `onboarding/src/lib/audit-logger.ts`: Added `OPENCLAW_GATEWAY_TOKEN` to sensitive keys list
- **Verification:** 32 QMD searches confirm `OPENCLAW_GATEWAY_TOKEN` is the standard; 0 matches for `GATEWAY_TOKEN` in OpenClaw docs

**Critical Discovery - OpenClaw Doctor:**
- `openclaw doctor --fix` can migrate configs from old schema to new schema
- Creates backup at `~/.openclaw/openclaw.json.bak`
- Doctor migrations: `agent` → `agents.defaults`, `gateway.token` → `gateway.auth.token`
- BUT: doctor may not preserve all sections (lost `gateway.auth` in our case)

**From Hetzner guide (platforms/hetzner.md):**
- Standard env var name is `OPENCLAW_GATEWAY_TOKEN`
- Original DonClaudioBot used `GATEWAY_TOKEN` (appears to have been a mistake, not a conscious choice)
- Pre-create host directories: `mkdir -p /root/.openclaw` and `chown -R 1000:1000`
- Config persists via volume mount - survives rebuilds

**Docker setup flow (from docker.md):**
- Standard flow: `docker compose run --rm openclaw-cli onboard` (runs wizard including setup)
- Or manual: `openclaw setup` → `openclaw channels login` → `openclaw gateway`

### From ARCHITECTURE_REPORT.md
- **v1 Timing Bug:** OAuth happened before sandbox environment existed. User 002+ never worked because tokens stored in wrong location (user001's context).
- **v2 Fix:** Create agent + sandbox config FIRST, then do OAuth in that agent's context. OpenClaw is npm dependency (not fork), agents created dynamically.
- **Dual-Process Architecture:** Single container runs TWO processes via launcher.js:
  - Gateway: `npx openclaw gateway --port 18789` (handles WhatsApp routing)
  - Onboarding: `node /app/onboarding/dist/index.js` (creates agents, manages SQLite)
- **Communication:** Gateway and Onboarding communicate via shared state in `/home/node/.openclaw/`. Gateway watches `openclaw.json` via `fs.watch()` for auto-reload.

### From tasks.md (Deployment Readiness Plan)
- **Server Status:** Fresh Hetzner VPS - no containers, no volumes (wiped 2026-02-02)
- **Completed:** 9/11 deployment readiness tasks (P0-DEPLOY-000 through P0-DEPLOY-008)
- **Pending:** 2/11 tasks - P0-DEPLOY-009 (Deploy to Hetzner) and P1-DEPLOY-010 (Build Sandbox)
- **All paths standardized:** Changed from `/root/.openclaw` to `/home/node/.openclaw` atomically (P0-DEPLOY-003)
- **Gateway reload mechanism:** Removed manual reload - Gateway auto-detects config changes via fs.watch()

### From IMPLEMENTATION_PLAN.json
- **Total LOC:** 1,909 across validation, database, API, infrastructure, observability, OAuth monitoring, maintenance, sandbox, and testing
- **Status:** Production Ready (31/31 implementation tasks complete, 59/59 verification steps passed)
- **Onboarding Flow:** Unknown WhatsApp message → webhook → phone validation → SQLite state → OpenClaw config → dedicated agent

### Infrastructure Scripts Available
- `scripts/backup.sh` - Backup don-claudio-state volume
- `scripts/restore.sh` - Restore from backup
- `scripts/verify-prereqs.sh` - Verify Hetzner is ready (SSH, Docker, disk space)
- `scripts/integration-test.sh` - Local dress rehearsal before deployment
- `scripts/deploy.sh` - Deploy to Hetzner with health checks
- `scripts/rollback.sh` - Automated rollback procedure
- `scripts/build-sandbox.sh` - Build sandbox image
- `scripts/build.sh` - Build TypeScript + Docker
- `scripts/setup.sh` - Initial setup
- `scripts/cron-setup.sh` - Configure cron jobs

## Technical Decisions
<!--
  WHAT: Architecture and implementation choices you've made, with reasoning.
  WHY: You'll forget why you chose a technology or approach. This table preserves that knowledge.
  WHEN: Update whenever you make a significant technical choice.
-->
| Decision | Rationale |
|----------|-----------|
| Dual-process launcher (P0-DEPLOY-006) | Enables independent restart for debugging - can restart Gateway without killing Onboarding |
| npx openclaw instead of global install | Avoids version pinning issues - always runs version in package.json |
| SSH tunnel for Gateway UI access | Port 18789 may be blocked by Hetzner firewall; tunnel guarantees access |
| Named volume for state | don-claudio-state survives code deployments (WhatsApp auth preserved) |
| ATOMIC path changes (P0-DEPLOY-003) | All /root/.openclaw → /home/node/.openclaw in one task prevents split-brain |
| Integration test before deploy | Dress rehearsal catches issues before they reach production |
| Keep old container 10min during deploy | Rollback window if deployment fails |
| Build sandbox after deploy | Onboarding works without sandbox; dedicated agents need it but aren't step 1 |

## Issues Encountered
<!--
  WHAT: Problems you ran into and how you solved them.
  WHY: Similar to errors in task_plan.md, but focused on broader issues (not just code errors).
-->
| Issue | Resolution |
|-------|------------|
| v1 OAuth timing bug | v2 creates sandbox config BEFORE OAuth happens |
| Tilde paths don't expand in Node | Use explicit paths with env var fallback |
| Gateway reload mechanism wrong | Removed manual reload - Gateway uses fs.watch() for auto-reload |
| ES module import errors | Added .js extensions to import paths |

## Resources
<!--
  WHAT: URLs, file paths, API references, documentation links you've found useful.
  WHY: Easy reference for later. Don't lose important links in context.
-->
- **Architecture Reference:** ARCHITECTURE_REPORT.md
- **Deployment Plan:** tasks.md (P0-DEPLOY-000 through P1-DEPLOY-010)
- **Implementation History:** IMPLEMENTATION_PLAN.json
- **Developer Workflow:** CLAUDE.md
- **Deployment Checklist:** docs/DEPLOYMENT_CHECKLIST.md (654 LOC)
- **Rollback Documentation:** docs/ROLLBACK.md (147 LOC)
- **Hetzner Server:** root@135.181.93.227 (SSH key: ~/.ssh/hetzner)
- **OpenClaw Docs:** .openclaw-reference/ (search via `mcp__qmd__search` or `mcp__qmd__vsearch`)

## Visual/Browser Findings
<!--
  WHAT: Information you learned from viewing images, PDFs, or browser results.
  WHY: CRITICAL - Visual/multimodal content doesn't persist in context. Must be captured as text.
-->
- None yet - will update when viewing images or browser results

## What Went Wrong - Circular Debugging Trap

**The Trap:**
1. Gateway failed with "Missing config" → ran `openclaw setup`
2. Created minimal config without gateway settings → copied template
3. Template had old schema → changed env var names to match OpenClaw docs
4. **ERROR:** Should have checked original architecture first!
5. Realized original used `GATEWAY_TOKEN` → reverted changes
6. Fixed template schema → re-deployed
7. Volume had old config → `doctor --fix` migrated it but broke `gateway.auth`
8. Set `gateway.mode` → set `gateway.auth.token` → still failing
9. **STUCK:** Config looks correct, env var is set, but Gateway still says "no token"

**Root Cause Hypothesis:**
- The `openclaw doctor` migration may have corrupted the config in the volume
- OR: The Gateway process needs to be fully killed and restarted (not just container restart)
- OR: There's a permission issue with the config file (doctor warned about permissions)
- OR: The config validation is happening before env var substitution

**Evidence:**
```
Doctor warning: "Config file is group/world readable (~/.openclaw/openclaw.json). Recommend chmod 600."
Doctor warning: "State directory permissions are too open (~/.openclaw). Recommend chmod 700."
```

**Next Steps (when resuming):**
1. Check config file permissions: `ls -la /home/node/.openclaw/openclaw.json`
2. Try removing volume entirely and starting fresh: `docker volume rm don-claudio-state`
3. OR: Use `--allow-unconfigured` flag to bypass auth temporarily
4. OR: Set `gateway.auth.mode = "off"` temporarily to get Gateway running

## Migration Decisions
<!--
  WHAT: Decisions made during migration from tasks.md to planning-with-files system.
  WHY: Documents the transition between planning systems.
-->
| Decision | Rationale |
|----------|-----------|
| Keep ARCHITECTURE_REPORT.md as reference | Static design reference doesn't need phase tracking |
| Keep IMPLEMENTATION_PLAN.json as history | Completed work record, useful for context |
| Keep tasks.md for now | Source of truth for deployment readiness status |
| Phase 0 = completed work | Clearly separates what's done from what's pending |
| 6 phases for 2 pending tasks | Breaks deployment into logical steps (verify, deploy, auth, sandbox, test, document) |

---
<!--
  REMINDER: The 2-Action Rule
  After every 2 view/browser/search operations, you MUST update this file.
  This prevents visual information from being lost when context resets.
-->
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
