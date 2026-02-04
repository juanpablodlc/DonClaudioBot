# Task Plan: Deploy DonClaudioBot v2 to Hetzner VPS
<!--
  WHAT: This is your roadmap for the entire task. Think of it as your "working memory on disk."
  WHY: After 50+ tool calls, your original goals can get forgotten. This file keeps them fresh.
  WHEN: Create this FIRST, before starting any work. Update after each phase completes.
-->

## Goal
<!--
  WHAT: One clear sentence describing what you're trying to achieve.
  WHY: This is your north star. Re-reading this keeps you focused on the end state.
-->
Deploy DonClaudioBot v2 to production Hetzner VPS (135.181.93.227) with health verification, rollback capability, and sandbox image for OAuth.

## Current Phase
<!--
  WHAT: Which phase you're currently working on (e.g., "Phase 1", "Phase 3").
  WHY: Quick reference for where you are in the task. Update this as you progress.
-->
**Phase 5 IN PROGRESS** → SQLite fix deployed + verified. Found 2nd bug: agent-creator.ts generates invalid OpenClaw config schema (cpus as string, pids_limit snake_case, timeoutMs not valid). Fixed locally, cleaned bad agent from live config, needs redeploy + re-test.

## Phases
<!--
  WHAT: Break your task into 3-7 logical phases. Each phase should be completable.
  WHY: Breaking work into phases prevents overwhelm and makes progress visible.
  WHEN: Update status after completing each phase: pending → in_progress → complete
-->

### Phase 0: Infrastructure (COMPLETE)
<!--
  WHAT: All prerequisite infrastructure tasks completed in previous work sessions.
  WHY: Documents what's already done so we don't repeat work.
  SOURCE: tasks.md P0-DEPLOY-000 through P0-DEPLOY-008 (9 completed tasks)
-->
- [x] P0-DEPLOY-000: Pre-deployment backup procedure (scripts/backup.sh created)
- [x] P0-DEPLOY-001: Verify prerequisites (scripts/verify-prereqs.sh created)
- [x] P0-DEPLOY-002: Install OpenClaw CLI in container (Dockerfile updated)
- [x] P0-DEPLOY-003: Standardize paths ATOMICALLY (/root/.openclaw → /home/node/.openclaw)
- [x] P0-DEPLOY-004: Runtime env vars in .env.example
- [x] P0-DEPLOY-005: deploy.sh with health checks
- [x] P0-DEPLOY-006: Dual-process launcher (launcher.js created, CORE architectural fix)
- [x] P0-DEPLOY-007: Local integration test (scripts/integration-test.sh created)
- [x] P0-DEPLOY-008: Rollback procedure (scripts/rollback.sh and docs/ROLLBACK.md created)
- **Status:** complete

### Phase 1: Pre-Deployment Verification
<!--
  WHAT: Verify all prerequisites are met before attempting deployment.
  WHY: Deploying without verification leads to hard-to-debug failures in production.
  MAPPED FROM: P0-DEPLOY-009 verification_steps
-->
- [x] Run ./scripts/verify-prereqs.sh (SSH, Docker, disk space, clean server state)
- [x] Run ./scripts/integration-test.sh (local dress rehearsal - requires Docker daemon running)
- [x] Verify .env has HOOK_TOKEN and GATEWAY_TOKEN set (generated via openssl)
- [x] Document any blockers in findings.md (OpenClaw setup requirement documented)
- **Status:** complete

### Phase 2: Deploy to Hetzner VPS
- [x] Run ./scripts/deploy.sh (with health checks baked in)
- [x] Initialize OpenClaw config: `ssh root@135.181.93.227 'docker exec don-claudio-bot npx openclaw setup'`
- [x] Restart container to pick up config: `ssh root@135.181.93.227 'docker compose -f /root/don-claudio-bot/docker-compose.yml restart'`
- [x] Fixed template schema: `gateway.token` → `gateway.auth.token`
- [x] Set `gateway.mode = local` via `openclaw config set`
- [x] Set `gateway.auth.token` via `openclaw config set`
- [x] **FIXED:** Changed env var from `GATEWAY_TOKEN` to `OPENCLAW_GATEWAY_TOKEN` (root cause found via QMD research)
- [x] **FIXED:** Removed `$schema` key and fixed `gateway.bind` format (`"ws://127.0.0.1:18789"` → `"lan"`)
- [x] Destroyed corrupted volume: `docker volume rm docker_don-claudio-state`
- [x] Rebuilt and redeployed with fresh volume
- [x] Verify container running: `ssh -i ~/.ssh/hetzner root@135.181.93.227 'docker ps | grep don-claudio-bot | grep -q Up'` ✅
- [x] Check health endpoint: `curl -f -s http://135.181.93.227:3000/health | jq -e '.status == "ok"'` ✅
- [x] Verify volume created: `ssh -i ~/.ssh/hetzner root@135.181.93.227 'docker volume ls | grep don-claudio-state'` ✅
- [x] Verify Gateway running: `curl -s http://localhost:18789/ | grep OpenClaw` ✅
- **Status:** **COMPLETE** - Gateway and Onboarding both running successfully
<!--
  WHAT: Execute the deployment script and verify container is running.
  WHY: This is the main deployment event. Health checks catch failures early.
  MAPPED FROM: P0-DEPLOY-009 main deployment steps

  UPDATED: Added post-deploy `openclaw setup` step (from OpenClaw docs research)
-->
- [ ] Run ./scripts/deploy.sh (with health checks baked in)
- [ ] Initialize OpenClaw config: `ssh root@135.181.93.227 'docker exec don-claudio-bot npx openclaw setup'`
- [ ] Restart container to pick up config: `ssh root@135.181.93.227 'docker compose -f /root/don-claudio-bot/docker-compose.yml restart'`
- [ ] Verify container running: `ssh -i ~/.ssh/hetzner root@135.181.93.227 'docker ps | grep don-claudio-bot | grep -q Up'`
- [ ] Check health endpoint: `curl -f -s http://135.181.93.227:3000/health | jq -e '.status == "ok"'`
- [ ] Verify volume created: `ssh -i ~/.ssh/hetzner root@135.181.93.227 'docker volume ls | grep don-claudio-state'`
- [ ] Check logs: `ssh root@135.181.93.227 'cd /root/don-claudio-bot && docker compose logs -f --tail=50'`
- **Status:** pending

### Phase 3: WhatsApp Authentication
<!--
  WHAT: Authenticate WhatsApp channel through Gateway UI.
  WHY: Without WhatsApp auth, the service cannot receive messages.
  MAPPED FROM: P0-DEPLOY-009 post_deployment_steps
-->
- [x] Set up SSH tunnel for Gateway UI: `ssh -i ~/.ssh/hetzner -N -L 18789:127.0.0.1:18789 root@135.181.93.227`
- [x] Open browser: http://127.0.0.1:18789/
- [x] Authenticate with GATEWAY_TOKEN from .env
- [x] Navigate to Channels -> WhatsApp -> Login
- [x] Scan QR code with phone
- [x] Verify auth files exist: `ls -la /home/node/.openclaw/credentials/whatsapp/`
- **Status:** **COMPLETE** - creds.json created, channel linked (+12062274085)

### Phase 3a: Gateway UI Authentication (COMPLETE)
<!--
  WHAT: Fix Gateway Control UI browser authentication - token mismatch error.
  WHY: Cannot access Gateway UI via browser to manage channels, agents, or config.
  RESOLVED: 2026-02-04
-->
**Root Causes (two compounding issues):**
1. **Missing `gateway.auth.mode: "token"`** — non-loopback binds (`bind: "lan"`) require explicit auth mode
2. **Missing `gateway.controlUi.allowInsecureAuth: true`** — SSH tunnel serves HTTP, browser blocks WebCrypto device identity generation in non-secure contexts, causing auth failure even with correct token

**Fix Applied (runtime config via `openclaw config set`, no file changes):**
```bash
docker exec don-claudio-bot npx openclaw config set gateway.auth.mode token
docker exec don-claudio-bot npx openclaw config set gateway.controlUi.allowInsecureAuth true
docker exec don-claudio-bot npx openclaw config set gateway.auth.token "<token>"
docker exec don-claudio-bot npx openclaw config set gateway.remote.token "<token>"
```

**Access URL:** `http://127.0.0.1:18790/?token=gGmp9ov9tx54pRmFHOcVeuG%2Fk1OdlR8EYpcnp40PeXY%3D`
(via SSH tunnel: `ssh -i ~/.ssh/hetzner -N -L 18790:127.0.0.1:18789 root@135.181.93.227`)

**Verification:**
- [x] Browser UI opens without "disconnected" error
- [x] `openclaw status` shows Gateway as "reachable" (24ms)
- [x] `openclaw dashboard` prints tokenized URL correctly

**Status:** **COMPLETE**

---

### Phase 4: Sandbox Image Build
<!--
  WHAT: Build the sandbox image required for dedicated agent OAuth.
  WHY: Onboarding agent doesn't need sandbox (mode='off'), but dedicated agents do.
  MAPPED FROM: P1-DEPLOY-010
-->
- [x] Verify config/sandbox/Dockerfile.sandbox exists
- [x] Fixed Dockerfile: pinned gog CLI to v0.9.0 from steipete/gogcli (OpenClaw docs reference steipete/gog which 404s)
- [x] Fixed build-sandbox.sh: proper variable expansion, auto-cd to project root
- [x] Build image locally (linux/amd64 via buildx): `docker build --platform linux/amd64 -f config/sandbox/Dockerfile.sandbox -t openclaw-sandbox:bookworm-slim .`
- [x] Build image on Hetzner directly: `docker build -f config/sandbox/Dockerfile.sandbox -t openclaw-sandbox:bookworm-slim .`
- [x] Verify gog CLI: `docker run --rm --entrypoint /usr/local/bin/gog openclaw-sandbox:bookworm-slim --version` → v0.9.0
- [x] Verify which gog: `/usr/local/bin/gog`
- [x] Image size: 495MB (ID: 053b342741af)
- **Status:** **COMPLETE**

### Phase 5: Integration Testing
<!--
  WHAT: Test webhook endpoint and verify onboarding flow works.
  WHY: Production deployment means nothing if the service doesn't work end-to-end.
  MAPPED FROM: P0-DEPLOY-009 verification steps
-->
- [x] **DISCOVERED:** Deployed code was OLD — still used `execFile`/`npx openclaw agents add` (interactive CLI). Local source already fixed to use `config-writer.js` (direct config editing). Root cause: previous deploys didn't rebuild the Docker image layer with new compiled JS.
- [x] Redeployed with updated code — verified `/app/onboarding/dist/services/agent-creator.js` now uses `config-writer.js` imports (no `execFile`)
- [x] Test webhook without token (expect 401): **PASSED** → `401 Unauthorized`, `{"error":"Missing authorization header"}`
- [x] Test webhook with valid token: **FAILED 500** → SQLite error: `no such column: "now"`
- [x] **ROOT CAUSE:** `state-manager.ts:61` used `datetime("now")` — double quotes = column identifier in SQLite. Schema.sql correctly uses `datetime('now')` with single quotes.
- [x] **FIX APPLIED:** Changed line 61 from single-quoted JS string with double-quoted SQL to backtick template literal with single-quoted SQL: `` `...datetime('now', '+24 hours')` ``
- [x] TypeScript compiled successfully after fix
- [x] Redeployed with SQLite fix — verified `datetime('now')` in deployed JS ✅
- [x] Verified deployed `agent-creator.js` uses `config-writer.js` imports ✅
- [x] Test 2 re-run: **FAILED** — curl HTTP 000 (connection reset). Gateway was crashing, killed the onboarding process.
- [x] **ROOT CAUSE #2:** Previous Test 2 (which hit SQLite error) had already written an agent to `openclaw.json` before the DB insert failed. That agent's config had 3 schema violations that crashed Gateway:
  - `cpus: '0.5'` — string, OpenClaw expects number
  - `pids_limit: 100` — snake_case, OpenClaw expects `pidsLimit` (camelCase)
  - `timeoutMs: 30000` — not a valid sandbox-level key (only valid for browser config)
- [x] **FIX APPLIED (agent-creator.ts):** Changed `cpus` to number `0.5`, `pids_limit` to `pidsLimit`, removed `timeoutMs` from sandbox config. Also removed stale `timeoutMs` check from `sandbox-validator.ts`.
- [x] Removed bad agent (`user_7f0d3241ec4aae7a`) from live config via Node.js script
- [x] Restarted container — Gateway starting with cleaned config
- [ ] **NEXT:** Redeploy with schema fix, then re-run Test 2 (webhook with valid token)
- [ ] Verify agent creation in logs
- [ ] Verify Gateway doesn't crash after agent creation
- [ ] Check database state: `ssh root@135.181.93.227 'docker exec don-claudio-bot sqlite3 /home/node/.openclaw/onboarding.db "SELECT * FROM onboarding_states;"'`
- **Status:** **in_progress** — Schema fix applied locally, bad agent cleaned from live config, needs redeploy + re-test

### Phase 6: Documentation & Handoff
<!--
  WHAT: Document deployment results and create handoff notes.
  WHY: Future you (or others) need to know what was done and how to verify it.
-->
- [ ] Update tasks.md with completion status for P0-DEPLOY-009 and P1-DEPLOY-010
- [ ] Document deployment timestamp in progress.md
- [ ] Create post-deployment verification checklist
- [ ] Document any deviations from plan in findings.md
- **Status:** pending

## Key Questions
<!--
  WHAT: Important questions you need to answer during the task.
  WHY: These guide your research and decision-making. Answer them as you go.
-->
1. Will Hetzner firewall block port 18789 (Gateway UI)? If yes, use SSH tunnel.
2. Will cap_drop: [ALL] block sandbox container creation? May need cap_add whitelist.
3. What is the current GATEWAY_TOKEN value? (Check .env or local environment)
4. Does the Hetzner server have Docker Compose v2 installed? (verify-prereqs.sh checks this)
5. **Is Docker daemon running locally?** (Needed for integration-test.sh in Phase 1)
6. **Have I searched QMD MCP for ALL env vars and config I'm using?** (MANDATORY before deploy)
7. **Have I validated the template locally?** (npx openclaw config validate)
8. **Is this my 3rd+ deployment attempt?** (If yes, STOP and follow 3-Strike Protocol)

## Decisions Made
<!--
  WHAT: Technical and design decisions you've made, with the reasoning behind them.
  WHY: You'll forget why you made choices. This table helps you remember and justify decisions.
-->
| Decision | Rationale |
|----------|-----------|
| SSH tunnel for Gateway UI | Port 18789 may be blocked by Hetzner firewall; tunnel guarantees access |
| Local integration test first | Dress rehearsal catches issues before they reach production |
| Keep old container 10min | Rollback window if deployment fails |
| Build sandbox AFTER deploy | Onboarding works without sandbox; dedicated agents need it but aren't step 1 |
| Phase 0 marked complete | 9/11 tasks already completed per tasks.md and commit history |
| **ENV VAR NAMING:** Use `OPENCLAW_GATEWAY_TOKEN` | OpenClaw standard (32 doc matches) - was using wrong var name |
| **TEMPLATE FIX:** Update schema only | Changed `gateway.token` → `gateway.auth.token`, kept rest |
| **STOP at circular debugging** | 3-Strike Error Protocol - pause and reassess approach |

## Prevention Rules
<!--
  WHAT: Hard-learned rules that prevent symptom-chasing and circular debugging.
  WHY: These rules are derived from analysis of 15+ deployment failures.
  WHEN: Read before ANY deployment or configuration change.
-->

### Rule 1: Documentation First (Zero Exceptions)
- **MANDATORY**: Before ANY OpenClaw integration work, search QMD MCP
- **Required searches**:
  - All env var names (verify they exist in OpenClaw docs)
  - Config schema you're modifying
  - CLI commands you're running
- **Timebox**: 15 minutes research prevents 15 deployment attempts
- **Evidence**: `OPENCLAW_GATEWAY_TOKEN` appears 32 times in docs, took 15 attempts to find

### Rule 2: 3-Strike Error Protocol
- **After 3 deployment failures**: STOP. DO NOT deploy again.
- **Required actions**:
  1. Re-read ALL relevant documentation
  2. Create minimal reproduction locally
  3. Only resume when root cause is identified
- **Circular debugging indicators**:
  - Reverting previous changes
  - Fixing issues caused by your fixes
  - Trying 3+ approaches to same error
- **Evidence**: Attempts 3-9 were circular debugging; real fix was attempt 3 (reverted in attempt 4)

### Rule 3: Local Testing Gate
- **Before ANY Hetzner deployment**: Test locally with Docker
- **Required verifications**:
  - `docker compose up` succeeds
  - Env vars load correctly
  - `npx openclaw config validate` passes
- **Only when local passes**: Deploy to production

### Rule 4: Template Validation Before Deploy
- **MANDATORY**: Validate template before every deployment
- **Command**: `npx openclaw config validate config/openclaw.json.template`
- **Fix errors BEFORE deploying, not after**

### Rule 5: Volume Persistence Awareness
- **Template changes ≠ Running config changes**
- **Two options**:
  1. Fresh volume (loses WhatsApp auth)
  2. Manual config update via `openclaw config set`
- **Never assume** template change will apply to existing volume

### Rule 6: Anti-Pattern Recognition
If you find yourself doing any of these, STOP and reassess:
- "Just try it and see what happens"
- "The docs are too long, I'll figure it out"
- "This should work, the format looks right"
- "I'll fix it in production"
- "One more deploy won't hurt"

**These thoughts indicate you're symptom-chasing. Return to Rule 1.**

## Errors Encountered
<!--
  WHAT: Every error you encounter, what attempt number it was, and how you resolved it.
  WHY: Logging errors prevents repeating the same mistakes. This is critical for learning.
-->
| Error | Attempt | Resolution |
|-------|---------|------------|
| SSH key not in agent | 1 | **Resolved:** Ran `ssh-add ~/.ssh/hetzner` |
| .env has placeholder tokens | 1 | **Resolved:** Generated tokens via `openssl rand -base64 32` |
| deploy.sh fails: `jq: command not found` | 1 | **Known issue:** Hetzner lacks jq. Workaround: manual checks. |
| Gateway fails: "Missing config. Run `openclaw setup`" | 1 | Ran `npx openclaw setup` - created minimal config (no gateway settings) |
| Copied template → schema error | 2 | Template used `gateway.token` (old schema) |
| **CRITICAL:** Changed env var names without checking architecture | 3 | Changed `GATEWAY_TOKEN` → `OPENCLAW_GATEWAY_TOKEN` - broke consistency |
| Reverted env var changes | 4 | **Resolved:** Restored `GATEWAY_TOKEN` to respect original architecture |
| Fixed template schema | 5 | **Resolved:** Updated template: `gateway.token` → `gateway.auth.token` |
| Volume has old config | 6 | Ran `openclaw doctor --fix` - migrated but lost `gateway.auth` section |
| Set `gateway.mode = local` | 7 | **Resolved:** Used `openclaw config set gateway.mode local` |
| Gateway: "no token configured" | 8 | Set `gateway.auth.token` directly via `openclaw config set` |
| **ROOT CAUSE FOUND:** Wrong env var name | 9 | **FIXED:** Changed `GATEWAY_TOKEN` → `OPENCLAW_GATEWAY_TOKEN` (verified via 32 QMD searches) |
| Deployed code was stale (old agent-creator.js) | Phase 5 | **FIXED:** Redeployed — Docker build layer was cached with old compiled JS |
| SQLite 500: `no such column: "now"` | Phase 5 | **FIXED:** `datetime("now")` → `datetime('now')` in state-manager.ts:61 (double quotes = column name in SQLite) |
| SSH flaky: `kex_exchange_identification: Connection reset` | Phase 5 | **Transient:** Retry after 3-5s delay works. Hetzner SSH rate limiting or network hiccup. |
| Gateway crash: invalid agent config schema | Phase 5 | **FIXED:** `agent-creator.ts` generated `cpus: '0.5'` (string), `pids_limit` (snake_case), `timeoutMs` (invalid key). Changed to `cpus: 0.5` (number), `pidsLimit` (camelCase), removed `timeoutMs`. |
| Partial agent creation before DB error | Phase 5 | **FIXED:** Previous test wrote agent to openclaw.json before SQLite INSERT failed. Removed orphan via Node.js script. Need to consider: should config write happen AFTER DB insert? |

## Notes
<!--
  REMINDERS:
  - Update phase status as you progress: pending → in_progress → complete
  - Re-read this plan before major decisions (attention manipulation)
  - Log ALL errors - they help avoid repetition
  - Never repeat a failed action - mutate your approach instead
-->
- **Critical Reference:** ARCHITECTURE_REPORT.md sections 1-3 for v1 post-mortem and v2 architecture
- **Rollback:** If deployment fails, run ./scripts/rollback.sh immediately
- **Volume Persistence:** don-claudio-state volume survives deployments (WhatsApp auth lives here)
- **Never run:** `docker volume rm don-claudio-state` unless you want to re-authenticate WhatsApp
- **Server State:** Fresh Hetzner VPS - no containers, no volumes (wiped 2026-02-02 per tasks.md)

**RESUMING TOMORROW - Read this first:**

**RESOLVED (2026-02-02):** Root cause identified - env var name mismatch.

**The fix:** Changed `GATEWAY_TOKEN` → `OPENCLAW_GATEWAY_TOKEN` in 5 files:
1. `config/openclaw.json.template` - Template substitution var
2. `.env.example` - Documentation
3. `docker/docker-compose.yml` - Container env var
4. `.env` - Actual token value (preserved)
5. `onboarding/src/lib/audit-logger.ts` - Sensitive keys for redaction

**Evidence from QMD research (5-10 searches):**
- `OPENCLAW_GATEWAY_TOKEN`: 32 matches in OpenClaw reference docs
- `GATEWAY_TOKEN`: 0 matches (only found in project files)
- Key docs: gateway/protocol.md:183, web/dashboard.md:35, gateway/configuration.md:329

**Next steps:**
1. Rebuild Docker image with new env var names
2. Deploy to Hetzner with fresh volume (recommended) or test locally first
3. Verify Gateway starts without "no token" error

**Files changed today:**
- `config/openclaw.json.template` - Fixed schema: `gateway.token` → `gateway.auth.token`
- `.env` - Generated proper tokens
- `.env.example` - Updated comments
- `docker/docker-compose.yml` - No change needed (already correct)
- `task_plan.md`, `findings.md`, `progress.md` - Updated with today's work

---

## Migration Notes (from tasks.md)

### Completed Tasks (9/11) - Mapped to Phase 0
The following tasks from tasks.md are COMPLETE and documented in Phase 0 above:
- P0-DEPLOY-000: Pre-deployment backup procedure ✓
- P0-DEPLOY-001: Verify prerequisites ✓
- P0-DEPLOY-002: Install OpenClaw CLI in container ✓
- P0-DEPLOY-003: Standardize paths ATOMICALLY ✓
- P0-DEPLOY-004: Runtime env vars in .env.example ✓
- P0-DEPLOY-005: deploy.sh with health checks ✓
- P0-DEPLOY-006: Dual-process launcher ✓
- P0-DEPLOY-007: Local integration test ✓
- P0-DEPLOY-008: Rollback procedure ✓

### Pending Tasks (2/11) - Mapped to Phases 1-6
- **P0-DEPLOY-009** → Mapped to Phases 1, 2, 3, 5, 6 (Verify, Deploy, Auth, Test, Document)
- **P1-DEPLOY-010** → Mapped to Phase 4 (Sandbox image build)

### Git History Context
Recent commits show:
- `4fd34bb`: docs: Align documentation with code reality (v2.14.0)
- `38a56b1`: fix: Complete dual-process launcher and fix ES module imports
- `73d3d81`: feat: Complete P0-DEPLOY-000 through P0-DEPLOY-005 (deployment readiness)
- `0b85570`: fix: Address code review issues from production readiness commits
- `448cf09`: feat: Complete P1 production readiness tasks (P1-007 through P1-011)
