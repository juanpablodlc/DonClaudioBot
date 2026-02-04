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

**ADDITIONAL FIX (2026-02-03): Template Schema Issues**
- Template had `$schema` key that OpenClaw doesn't recognize (caused validation failure)
- Template had wrong `gateway.bind` format: `"ws://127.0.0.1:18789"` instead of `"lan"`
- **Root cause:** OpenClaw config uses JSON5 and expects specific values for `gateway.bind`:
  - `"lan"` - bind to all interfaces (0.0.0.0)
  - `"loopback"` or omit - bind to 127.0.0.1 only
  - `"tailnet"` - bind to Tailscale
- **Fix applied:** Removed `$schema` key, changed `gateway.bind` to `"lan"`

**MODEL CONFIG (2026-02-04): Z.AI GLM-4.7 Setup**
- Configured Z.AI as default model provider for ALL agents
- **Approach chosen:** Option B (manual config + env var) vs Option A (wizard)
- **Rationale:** Wizard only configures onboarding agent; env var applies to ALL agents including dynamically created ones
- **Changes:**
  - `config/openclaw.json.template`: Added `agents.defaults.model.primary: "zai/glm-4.7"`
  - `docker/docker-compose.yml`: Added `ZAI_API_KEY` environment variable
  - `.env.example`: Documented `ZAI_API_KEY` setup
- **Verification:** Env var set, model configured, applies globally

---

## Docker Anti-Patterns (Patterns We Keep Hitting)
<!-- WHAT: Common Docker/Docker Compose pitfalls encountered repeatedly. WHY: Pattern recognition prevents repetition. WHEN: Update when same issue occurs 2+ times. -->

### Pattern 1: .env File Location Mismatch
**Symptom:** Env vars show "change-me" defaults instead of actual values
**Root Cause:** Docker Compose reads `.env` from the same directory as `docker-compose.yml`
**Our Setup:**
- Compose file: `/root/don-claudio-bot/docker/docker-compose.yml`
- .env file: `/root/don-claudio-bot/.env` (wrong directory!)
**Fix:** Copy `.env` to `/root/don-claudio-bot/docker/.env` OR add `env_file: - ../.env` to compose file
**Prevention:** Document .env location in DEPLOYMENT.md or use absolute `env_file` path

### Pattern 2: Template Changes Don't Apply to Existing Volumes
**Symptom:** Template changes (like adding `model.primary`) don't appear in running config
**Root Cause:** Docker volumes persist data; template is only used on FIRST volume init
**Our Setup:**
- Template: `config/openclaw.json.template` (has `model.primary`)
- Volume config: `/home/node/.openclaw/openclaw.json` (stale, no `model.primary`)
**Fix:** Use `openclaw config set` to update existing config OR destroy volume
**Prevention:** Document that template changes require manual config update OR fresh volume

### Pattern 3: Container Restart Doesn't Pick Up New Image
**Symptom:** Container still runs old image after `deploy.sh`
**Root Cause:** `docker compose restart` doesn't pull new image; needs `--force-recreate`
**Our Setup:**
- New image: `26825c69...` (just built)
- Running container: `38f40b49...` (21 hours old)
**Fix:** Use `docker compose up -d --force-recreate` OR `down` + `up -d`
**Prevention:** Update deploy.sh to use `--force-recreate` by default

### Pattern 4: Env Var Substitution Happens at Compose Time
**Symptom:** Changing `.env` has no effect until container is recreated
**Root Cause:** `${VAR:-default}` is substituted when `docker compose up` runs, not at container runtime
**Implication:** Env var changes require FULL container recreate, not just restart
**Prevention:** Document this in ops runbook; don't expect hot-reload for env vars

### Pattern 5: jq Not Available on Hetzner
**Symptom:** Deploy script health checks fail with "jq: command not found"
**Root Cause:** Minimal Hetzner image lacks jq
**Workaround:** Manual verification via `curl` and `docker exec`
**Prevention:** Either (a) install jq in deploy script, (b) use native JSON parsing, or (c) accept manual verification

### Pattern 6: Local Port Conflicts with SSH Tunnels
**Symptom:** SSH tunnel accesses local service instead of remote
**Root Cause:** User's Mac runs OpenClaw on 18789 (same as Gateway)
**Fix:** Use different local port: `ssh -N -L 18790:127.0.0.1:18789 root@host` → access at http://127.0.0.1:18790/
**Prevention:** Check `lsof -i :PORT` before creating tunnels; document local dev ports

### Pattern 7: Status Commands Lie (Trust Filesystem)
**Symptom:** `openclaw status` showed "WhatsApp linked" but credentials folder was empty
**Root Cause:** Status caches configuration state, not actual authentication
**Fix:** Verify filesystem directly: `ls -la /home/node/.openclaw/credentials/whatsapp/default/creds.json`
**Prevention:** For critical state (auth, credentials), check files FIRST, then trust status

### Pattern 8: Terminal QR Code Works (No Browser Needed)
**Discovery:** `npx openclaw channels login --channel whatsapp` displays ASCII QR in terminal
**Benefit:** No SSH tunnel needed, no browser, scriptable
**Command:** `ssh root@host 'docker exec container npx openclaw channels login --channel whatsapp'`

### Pattern 9: Non-Interactive SSH Needs No `-it`
**Issue:** `ssh 'docker exec -it container cmd'` fails with "input device not a TTY"
**Fix:** Remove `-it`: `ssh 'docker exec container cmd'` (works for QR display)

### Pattern 10: WhatsApp Code 515 = Success (Not Error)
**Observation:** After QR scan: "WhatsApp asked for a restart after pairing (code 515); creds are saved"
**Meaning:** Normal Baileys behavior - connection restarts to establish persistent session
**Files created:** `creds.json`, `creds.json.bak`, 100+ `pre-key-*.json` files

### Pattern 11: Non-Loopback Bind Requires Explicit Auth Mode
**Symptom:** Gateway UI shows "unauthorized: gateway token mismatch" even with correct token
**Root Cause:** `gateway.bind: "lan"` requires `gateway.auth.mode: "token"` to be explicitly set
**Our Setup:**
- Config had `gateway.auth.token` set correctly
- But `gateway.auth.mode` was missing (defaults don't apply for non-loopback)
**Fix:** `openclaw config set gateway.auth.mode token`
**Prevention:** When using `gateway.bind: "lan"`, ALWAYS set `gateway.auth.mode` explicitly

### Pattern 12: SSH Tunnel + HTTP = No Device Identity (WebCrypto Blocked)
**Symptom:** Control UI fails with "connect failed" (code 4008) after token_mismatch
**Root Cause:** SSH tunnel serves HTTP (not HTTPS). Browser non-secure context blocks WebCrypto API, preventing device identity generation. Gateway requires device identity by default.
**Fix:** `openclaw config set gateway.controlUi.allowInsecureAuth true`
**Trade-off:** Security downgrade - disables device identity/pairing for Control UI. Acceptable for SSH-tunneled access since tunnel provides transport security.
**Prevention:** For SSH tunnel access, always set `allowInsecureAuth: true`. Prefer Tailscale Serve for production HTTPS.
**Reference:** QMD `openclaw-reference/web/control-ui.md` (Insecure HTTP section), `openclaw-reference/gateway/security/index.md`

### Pattern 14: OpenClaw Docs Reference Wrong gog CLI URL
**Symptom:** `curl -L https://github.com/steipete/gog/releases/latest/download/gog_Linux_x86_64.tar.gz` returns "Not Found" (9 bytes, not gzip)
**Root Cause:** OpenClaw docs (hetzner.md, gcp.md) reference `steipete/gog` repo which doesn't have release artifacts. Actual repo is `steipete/gogcli`.
**Artifact naming:** `gogcli_${VERSION}_linux_amd64.tar.gz` (not `gog_Linux_x86_64.tar.gz`)
**Binary name inside tarball:** `gog` (correct, despite repo being `gogcli`)
**Fix:** Use `https://github.com/steipete/gogcli/releases/download/v0.9.0/gogcli_0.9.0_linux_amd64.tar.gz`
**Prevention:** Always verify download URLs return valid content before baking into Dockerfiles. Pin versions for reproducibility.

### Pattern 15: Sandbox ENTRYPOINT is `node` (By Design)
**Symptom:** `docker run --rm openclaw-sandbox:bookworm-slim gog --version` fails with `SyntaxError: Invalid or unexpected token`
**Root Cause:** ENTRYPOINT is `["node"]`, so Docker executes `node gog --version` (tries to run ELF binary as JavaScript)
**Expected behavior:** OpenClaw sandbox uses `node` as entrypoint for tool execution. Direct binary invocation requires `--entrypoint` override.
**Verification command:** `docker run --rm --entrypoint /usr/local/bin/gog openclaw-sandbox:bookworm-slim --version`
**Alternative:** `docker run --rm --entrypoint which openclaw-sandbox:bookworm-slim gog` → `/usr/local/bin/gog`
**Discovery:** `openclaw dashboard` generates the correct tokenized URL with URL-encoded token
**Use Case:** Headless servers - prints URL instead of opening browser
**Command:** `docker exec don-claudio-bot npx openclaw dashboard`
**Output:** `http://127.0.0.1:18789/?token=<url-encoded-token>`
**Prevention:** Always use `openclaw dashboard` to get the correct access URL instead of manually constructing it

### Pattern 16: SQLite Double Quotes = Column Identifiers (NOT String Literals)
**Symptom:** `500 Internal Server Error: no such column: "now" - should this be a string literal in single-quotes?`
**Root Cause:** `datetime("now", "+24 hours")` — double quotes in SQLite are column identifiers per SQL standard. `"now"` is treated as a column name, not the string `'now'`.
**Our Setup:**
- `state-manager.ts:61` used JS single-quoted string containing SQL with double-quoted `"now"`
- `schema.sql` correctly used `datetime('now')` with single quotes everywhere
**Fix:** Changed to backtick template literal: `` `...datetime('now', '+24 hours')` `` — allows single quotes inside SQL without escaping
**Prevention:** Always use backtick template literals for SQL strings containing single quotes. Never use double quotes for SQL string literals.

### Pattern 17: Docker Build Cache Serves Stale Compiled JS
**Symptom:** Deployed container has OLD `agent-creator.js` (uses `execFile`/CLI) despite local source being correct (uses `config-writer.js`)
**Root Cause:** Docker `COPY onboarding/src` + `RUN npm run build` layers were cached. The COPY layer hash didn't change because the `.ts` source was the same as when the cache was built — but the compiled `.js` in `dist/` was different locally.
**Evidence:** `head -15 /app/onboarding/dist/services/agent-creator.js` showed `execFile` imports (old code) while local `dist/` had `config-writer.js` imports (new code).
**Fix:** Forced rebuild with `--no-cache` or ensured source files changed to bust cache. Deploy script's `docker compose up --build --force-recreate` rebuilt correctly after rsync updated source on server.
**Prevention:** After significant code changes, verify deployed JS matches local JS: `ssh ... 'docker exec container head -15 /app/path/to/file.js'`

### Pattern 18: OpenClaw Sandbox Docker Schema Uses camelCase + Strict Types
**Symptom:** Gateway crashes with: `agents.list.1.sandbox.docker.cpus: Invalid input: expected number, received string`, `Unrecognized key: "pids_limit"`, `Unrecognized key: "timeoutMs"`
**Root Cause:** `agent-creator.ts` generated config with wrong types/keys:
- `cpus: '0.5'` — OpenClaw expects **number** `0.5`, not string
- `pids_limit: 100` — OpenClaw expects **camelCase** `pidsLimit`
- `timeoutMs: 30000` — not a valid sandbox key (only valid for `browser` config)
**OpenClaw sandbox.docker valid keys (from docs):**
`network`, `user`, `pidsLimit`, `memory`, `memorySwap`, `cpus`, `ulimits`, `seccompProfile`, `apparmorProfile`, `dns`, `extraHosts`, `image`, `env`, `setupCommand`
**Fix:** Changed `cpus` to number, `pids_limit` to `pidsLimit`, removed `timeoutMs`
**Prevention:** ALWAYS search QMD for exact schema keys before writing config. OpenClaw uses camelCase consistently. Numeric limits (`cpus`) must be actual numbers.

### Pattern 19: Config Write Before DB Insert = Orphan Agent on Failure
**Symptom:** Gateway crashes after webhook returns 500 (SQLite error). Agent exists in `openclaw.json` but not in SQLite.
**Root Cause:** `agent-creator.ts` writes agent to `openclaw.json` (Step 4) BEFORE `state-manager.ts` inserts into SQLite (called from webhook handler after `createAgent()` returns). When the DB insert fails, the config already has the agent — but rollback only triggers if `createAgent()` itself throws.
**Evidence:** `openclaw.json` had `user_7f0d3241ec4aae7a` with binding, but no matching row in `onboarding.db`.
**Fix (immediate):** Removed orphan agent via Node.js script in container.
**Consideration:** The current flow is: createAgent (writes config) → createState (writes DB). If createState fails, the agent is orphaned. The rollback in createAgent only covers errors within its own try/catch. The webhook handler should ideally wrap both in a single transaction-like pattern.
**Prevention:** Verify end-to-end flow after fixing individual bugs — a fix that prevents one error may expose the next step's failure mode.

---

## Docker Deployment Checklist (Anti-Pattern Prevention)
<!-- WHAT: Pre-deployment verification steps. WHY: Catches Docker issues BEFORE they reach production. -->

### Pre-Deploy
- [ ] .env file exists in BOTH `/root/don-claudio-bot/` AND `/root/don-claudio-bot/docker/`
- [ ] All env vars in .env have actual values (no "change-me" placeholders)
- [ ] Template changes documented: either update existing config OR plan fresh volume

### During Deploy
- [ ] Use `--force-recreate` to ensure new image is used
- [ ] Verify container image hash: `docker ps | grep don-claudio | awk '{print $2}'`
- [ ] Check env vars inside container: `docker exec don-claudio-bot env | grep -E "ZAI|GATEWAY|HOOK"`

### Post-Deploy
- [ ] Verify env vars NOT showing "change-me"
- [ ] Verify config has expected changes (e.g., `model.primary`)
- [ ] Health check: `curl http://135.181.93.227:3000/health`
- [ ] If config changes don't appear: use `openclaw config set` manually

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
