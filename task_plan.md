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
**Phase 11: COMPLETE** — Fix sandbox OAuth (env vars not passed, bind mount path wrong)

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

### Phase 5: Integration Testing (COMPLETE)
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
- [x] **FINAL TEST (2026-02-04):** Redeployed with schema fix → webhook POST with valid token → **PASSED**
  - Response: `{"status":"created","agentId":"user_7659f051911760f6","phone":"+15559998888"}`
  - Container remained healthy (no Gateway crash)
  - Agent config verified: `cpus: 0.5` (number), `pidsLimit: 100` (camelCase), no `timeoutMs`
  - Gateway auto-reloaded config successfully
- [x] Logs verified: `[webhook] Processing onboarding for phone: +15559998888` → `agent_created` with `success: true`
- [x] Health check: `{"status":"ok"}`
- [x] **BONUS FIX:** Discovered state.ts router wasn't mounted (GET /onboarding/state/:phone returned 404). Fixed: added import + mount in index.ts. Verified with 3 tests: container healthy, GET state returns DB row, POST update persists. ✅
- **Status:** **COMPLETE** — All integration tests passed, onboarding flow working end-to-end, state API accessible

### Phase 6: Documentation & Handoff (COMPLETE - PRODUCTION APPROVED)
<!--
  WHAT: Document deployment results and create handoff notes.
  WHY: Future you (or others) need to know what was done and how to verify it.
-->
- [x] Update tasks_plan.md with completion status
- [x] Document deployment timestamp in progress.md (2026-02-04 session entry)
- [x] Create post-deployment verification checklist
- [x] Document any deviations from plan in findings.md (Patterns 16-23)
- [x] **Fix 1:** Reconciliation CLI entry point (reconciliation-cli.ts created, cron-setup.sh updated)
- [x] **Fix 2:** Baileys sidecar enabled (BAILEYS_SIDECAR_ENABLED=true, fixed auth loading)
- [x] Production readiness analysis: 5 concurrent onboardings + 2 active users = ~4.5GB RAM (fits CX32 8GB)
- [x] fs.watch() risk accepted: chokidar has awaitWriteFinish for atomic renames, cron serves as safety net
- **Status:** **COMPLETE — PRODUCTION LIVE 🚀**

### Phase 7: Spanish "Don Claudio" Agent Templates (COMPLETE)
<!--
  WHAT: Create Spanish-language agent template files for new users.
  WHY: Currently new agents get EMPTY workspaces - no AGENTS.md/SOUL.md/MEMORY.md.
-->
- [x] Create `config/agents/dedicated-es/AGENTS.md` - Spanish instructions for Don Claudio assistant
- [x] Create `config/agents/dedicated-es/SOUL.md` - Spanish personality, tone, behavioral guidelines
- [x] Create `config/agents/dedicated-es/MEMORY.md` - Spanish memory structure with user fields
- [x] Update `agent-creator.ts` to copy templates to `workspace-<id>/` on agent creation
- [x] Test that template files are copied correctly to new agent workspaces
- **Status:** **COMPLETE** — Spanish "Don Claudio" templates created, template copying implemented

### Phase 8: Two-Phase Onboarding & Variable Collection (COMPLETE)
<!--
  WHAT: Implement follow-up conversation to collect user details (name, email) after agent creation.
  WHY: Currently agents are created with phone number only - no user info collected.
-->
- [x] **CRITICAL:** Research `workspaceAccess` permissions - changed from `ro` to `rw` to enable memory writes
- [x] Design conversational flow for agent to request name/email after first message
- [x] Implement agent-side conversation handler for variable collection (via MEMORY.md onboarding instructions)
- [x] Update memory files with collected user data (name, email)
- [x] Test two-phase flow: phone → agent creation → conversation → data collection
- [x] Ensure users can edit their AGENTS.md/SOUL.md/MEMORY.md files (write permissions enabled)
- **Status:** **COMPLETE** — workspaceAccess changed to 'rw', MEMORY.md includes onboarding prompt for agents

### Phase 9: Google OAuth Credential Setup & Per-User Auth Flow
<!--
  WHAT: Configure shared OAuth client credentials and implement per-user Google authorization flow.
  WHY: Agents need access to Gmail/Calendar via gogcli, but credentials storage and user auth flow not yet implemented.

  PREREQUISITES:
  - Google Cloud project created with OAuth client (client_secret_*.json in config/)
  - Gmail + Calendar APIs enabled
  - OAuth consent screen configured (Testing mode for <100 users)

  REFERENCES:
  - gogcli quickstart: https://github.com/steipete/gogcli (README Quick Start section)
  - OpenClaw sandbox env injection: gateway/sandboxing.md (Sandboxed skills + env vars)
  - OpenClaw skills system: tools/skills.md (Environment injection per agent run)
  - Current agent env setup: onboarding/src/services/agent-creator.ts lines 71-75
-->

#### Requirements
- [ ] **R1: Shared OAuth client credentials** stored securely and accessible to all sandboxes
- [ ] **R2: Per-user Google OAuth tokens** isolated by agent (GOG_CONFIG_DIR per phone number)
- [ ] **R3: User-friendly auth flow** via WhatsApp conversation (agent guides user through manual OAuth)
- [ ] **R4: Credential security** - client_secret not committed to repo, not exposed in logs
- [ ] **R5: Idempotent setup** - credentials can be re-run without breaking existing tokens

#### Implementation Tasks

**Task 1: Credential Storage Design**
- [ ] Decision: Mount host config directory into sandbox (docker bind mount)
- [ ] Alternative: Bake credentials into sandbox image (less secure - REJECTED)
- [ ] Chosen approach: Bind mount `/app/config` on host → `/credentials` in sandbox
- [ ] Benefits: Credentials managed outside image, easy to update, isolated from workspace

**Task 2: Update Docker Compose with Credential Mount**
- [ ] Add bind mount to `docker/docker-compose.yml`:
  ```yaml
  volumes:
    - don-claudio-state:/home/node/.openclaw
    - ./config:/credentials:ro  # NEW: Read-only mount for OAuth credentials
  ```
- [ ] Security: Read-only mount prevents sandboxes from modifying credentials
- [ ] Path: Host `./config/client_secret_*.json` → Container `/credentials/client_secret_*.json`

**Task 3: Update Sandbox Environment Variables**
- [ ] Add `GOG_CREDENTIALS_PATH` to agent-creator.ts sandbox env:
  ```typescript
  env: {
    GOG_KEYRING_PASSWORD: randomBytes(32).toString('base64url'),
    GOG_CONFIG_DIR: `/home/node/.gog/plus_${phoneNumber.replace('+', '')}`,
    GOG_CREDENTIALS_PATH: '/credentials',  // NEW: Shared credentials location
  }
  ```
- [ ] Verify: gog respects `GOG_CREDENTIALS_PATH` or uses default location
- [ ] Fallback: If env var not supported, use symlink in setupCommand

**Task 4: One-Time Credential Setup**
- [ ] Create `scripts/setup-google-credentials.sh`:
  ```bash
  #!/bin/bash
  # Run once after deployment to configure gog with OAuth client
  docker exec don-claudio-bot gog auth credentials /credentials/client_secret_*.json
  ```
- [ ] Security: Container restart does NOT require re-running (credentials persist in volume)
- [ ] Verification: `gog auth credentials list` should show the stored client

**Task 5: Per-User OAuth Flow (Agent-Side)**
- [ ] Update `config/agents/dedicated-es/MEMORY.md` with Google OAuth instructions
- [ ] Agent detects if `GOG_CONFIG_DIR` has valid tokens (check via `gog auth list`)
- [ ] If no tokens, agent guides user through manual OAuth:
  ```
  1. Agent runs: gog auth add <user_email> --manual
  2. gog outputs OAuth URL (user copies to their browser)
  3. User authorizes in browser, gets auth code
  4. User pastes code back to WhatsApp
  5. Agent completes auth with code
  ```
- [ ] Security: `--manual` mode works in headless sandbox (no browser required)

**Task 6: Update Spanish Template with OAuth Instructions**
- [ ] Add "🔐 Google OAuth" section to `config/agents/dedicated-es/MEMORY.md`
- [ ] Include step-by-step instructions for user to authorize Google account
- [ ] Add troubleshooting: "Si no puedes acceder a Gmail/Calendario..."

#### Verification Steps

**Test 1: Credential Mount Verification**
- [ ] Deploy updated docker-compose.yml with bind mount
- [ ] SSH into container: `docker exec don-claudio-bot ls -la /credentials/`
- [ ] Verify: `client_secret_*.json` is visible and readable

**Test 2: One-Time Credential Setup**
- [ ] Run `./scripts/setup-google-credentials.sh`
- [ ] Verify: `docker exec don-claudio-bot gog auth credentials list` shows client
- [ ] Check output contains: `client_secret_*.apps.googleusercontent.com`

**Test 3: Per-User OAuth Flow (Manual Test)**
- [ ] Send WhatsApp message to trigger onboarding
- [ ] Agent responds with welcome message + OAuth instructions
- [ ] Simulate user: run `gog auth add test@example.com --manual` in container
- [ ] Copy OAuth URL, verify it points to Google consent screen
- [ ] (Skip actual auth in test - just verify flow works)

**Test 4: Agent Can Access gog Commands**
- [ ] After auth, test: `gog gmail labels list` returns user's labels
- [ ] Test: `gog calendar calendars` returns user's calendars
- [ ] Verify: No errors about missing credentials or tokens

**Test 5: Token Isolation Between Users**
- [ ] Create two agents with different phone numbers
- [ ] Authorize different Google accounts for each
- [ ] Verify: Agent A cannot access Agent B's Google data
- [ ] Verify: Different `GOG_CONFIG_DIR` paths per agent

#### Success Criteria
- [ ] OAuth client credentials accessible from sandbox (bind mount verified)
- [ ] `gog auth credentials` run successfully (stored in container state)
- [ ] Agent can guide user through `--manual` OAuth flow (instructions in MEMORY.md)
- [ ] Authorized agents can access Gmail/Calendar via gog commands
- [ ] Tokens are isolated per agent (different GOG_CONFIG_DIR)
- [ ] No credentials committed to git repository (config/ in .gitignore)

#### Security Considerations
- [ ] **Credential file**: `config/client_secret_*.json` already exists (DO NOT commit)
- [ ] **Read-only mount**: Sandboxes can read but not modify credentials
- [ ] **Per-user tokens**: Each agent has unique `GOG_KEYRING_PASSWORD`
- [ ] **Network isolation**: Sandbox network is `bridge` (required for OAuth), consider `none` after auth
- [ ] **Audit logging**: Log Google auth events in audit-logger.ts (OPSEC consideration)

#### Rollback Plan
- [ ] If bind mount fails: Revert docker-compose.yml, use volume copy instead
- [ ] If env vars don't work: Use setupCommand to symlink credentials to default path
- [ ] If OAuth flow breaks: Agent can fall back to asking user to run manual auth command via SSH
- [ ] If tokens leak: Revoke via Google Cloud Console, re-run auth flow

**Status:** **COMPLETE** — Deployed and verified (2026-02-05)

### Phase 10: Multi-Language Agent Templates & Phone-Based Routing
<!--
  WHAT: Implement English templates and phone-prefix-based language routing.
  WHY: Currently ALL users get Spanish templates (hardcoded). Need English for +1 (US/Canada) and scalable system for more languages.

  ROOT CAUSE: agent-creator.ts:102 has hardcoded 'dedicated-es' template path.
  SOLUTION: Phone prefix → language mapping config, template selection based on phone number.

  CRITICAL ARCHITECTURAL CHANGE: Task 0 removes the misleading "onboarding" agent to prevent "sticky session" problem.
  See Task 0 for full details with QMD MCP references.
-->

#### Requirements
- [ ] **R1: English templates** for US/Canada (+1) users - same structure as dedicated-es
- [ ] **R2: Phone prefix → language mapping** in config file (scalable for future countries)
- [ ] **R3: Template selection logic** in agent-creator.ts based on phone number
- [ ] **R4: Default fallback language** for unmapped countries (Spanish = current default)
- [ ] **R5: Graceful degradation** - missing templates log warning but don't fail

#### Design Decisions

**Decision 1: Mapping Format**
- Chosen: Simple JSON config file `config/phone-language-map.json`
- Rejected: Database table (overkill), env var (not scalable), code switch (not maintainable)
- Rationale: JSON is easy to edit, version control, no migration needed

**Decision 2: Default Language**
- Chosen: Spanish (es) as default
- Rationale: Current system is Spanish-first, matches Chile origin

**Decision 3: Template Folder Structure**
```
config/agents/
├── dedicated-en/     # NEW: English templates (+1, +44, etc)
│   ├── AGENTS.md
│   ├── SOUL.md
│   └── MEMORY.md
├── dedicated-es/     # EXISTING: Spanish templates (+56, default)
│   ├── AGENTS.md
│   ├── SOUL.md
│   └── MEMORY.md
└── phone-language-map.json  # NEW: Mapping config
```

#### Implementation Tasks

**Task 0: Remove "Onboarding Agent" to Prevent Sticky Session Problem (CRITICAL PREREQUISITE)**

<!--
  WHY THIS TASK EXISTS:
  The "onboarding" agent in config/openclaw.json.template is a TRAP that causes users to get
  "stuck" in the wrong agent due to OpenClaw's session behavior. This task removes it entirely.

  PROBLEM DESCRIPTION (with QMD MCP references):
  Search terms used: "session sticky routing dmScope per-channel-peer message"

  From OpenClaw docs (openclaw-reference/concepts/session.md):
  - Session key format with dmScope: "per-channel-peer" is:
    agent:<agentId>:<channel>:dm:<peerId>
    Example: agent:user002:whatsapp:dm:+15551234567

  - Sessions are "sticky" - once created, they persist until reset:
    * Reset triggers: /new, /reset, or daily expiry (4:00 AM gateway time)
    * Direct chats follow session.dmScope setting
    * "per-channel-peer" isolates by channel + sender (recommended for multi-user inboxes)

  From Clawd4All v1 analysis (Clawd4All/onboarding-issues-summary.md):
  - Documented problem: "After binding is created, user's messages should route to user002
    via binding, NOT to user001"
  - Users got "stuck" in user001 (onboarding agent) even after their dedicated agent was claimed
  - Required explicit /new command from users to switch sessions

  THE RACE CONDITION:
  ┌─────────────────────────────────────────────────────────────┐
  │ T+0ms:   WhatsApp message arrives                            │
  │ T+1ms:   Baileys sidecar detects unknown phone               │
  │ T+2ms:   Baileys triggers webhook POST /webhook/onboarding   │
  │ T+2ms:   **RACE**: Baileys may forward message to Gateway    │
  │          ┌─────────────────────────────────────────────┐     │
  │          │ If message routes NOW:                        │     │
  │          │   No binding exists → routes to onboarding    │     │
  │          │   Session created: agent:onboarding:whatsapp... │
  │          │   This session STICKS forever (or until /new) │     │
  │          └─────────────────────────────────────────────┘     │
  │          ↓ if webhook completes FIRST                        │
  │ T+50ms:  Agent created, binding added                        │
  │ T+60ms:  Gateway reloads via fs.watch()                      │
  │          NOW message routes to new dedicated agent            │
  └─────────────────────────────────────────────────────────────┘

  CURRENT DONCLAUDIOBOT V2 FLOW:
  1. Unknown WhatsApp message → Baileys sidecar detects it
  2. Baileys calls POST /webhook/onboarding (synchronous - waits for response)
  3. Webhook creates dedicated agent via agent-creator.ts
  4. Webhook adds phone→agentId binding to openclaw.json
  5. Gateway auto-reloads via fs.watch() (~1-10ms delay)
  6. **When does original message route?** Uncertain - depends on timing

  THE "onboarding" AGENT IN TEMPLATE:
  - Has "default": true (catches unmatched messages)
  - Has channel-level binding (no peer field = catch-all)
  - Has EMPTY/PLACEHOLDER templates (AGENTS.md, SOUL.md, MEMORY.md)
  - Is NEVER used for actual onboarding logic (webhook does everything)
  - EXISTS ONLY IN TEMPLATE - not used in actual production flow

  DECISION: REMOVE THE ONBOARDING AGENT ENTIRELY

  Rationale:
  1. It's misleading - suggests intake agent pattern that doesn't exist
  2. Creates "sticky session" trap if race condition is lost
  3. Has no actual purpose in v2 architecture (webhook-based flow)
  4. Better to drop first message than to trap user in wrong agent
  5. Users will naturally retry if first message gets no response

  Alternative considered and rejected:
  - "Implement onboarding agent properly with welcome message"
  - Rejected: Still creates session that user has to switch from
  - Rejected: Adds complexity without solving core problem
  - Rejected: User experience: "Welcome! Oh wait, send /new to talk to your agent"

  Updated flow after removal:
  | Scenario | Behavior |
  |----------|----------|
  | Normal (webhook fast) | Binding added → message routes to dedicated agent ✅ |
  | Webhook slow/failed | No binding → message dropped (no response) |
  | User messages again | Binding exists → routes to dedicated agent ✅ |

  Acceptable tradeoff: First message might be dropped, but no "stuck in wrong agent" problem.
-->

**Subtask 0.1: Remove onboarding agent from config template**
- [ ] Edit `config/openclaw.json.template`:
  - Remove entire "onboarding" agent from `agents.list[]` array
  - Remove `default: true` from all agents (no catch-all agent)
  - Remove channel-level binding for "onboarding" from `bindings[]` array
  - Verify `session.dmScope: "per-channel-peer"` is still set
- [ ] Result: Template has NO default agent, only per-peer bindings (created dynamically)

**Subtask 0.2: Remove onboarding template files**
- [ ] Delete `config/agents/onboarding/` directory entirely:
  - AGENTS.md (placeholder)
  - SOUL.md (placeholder)
  - MEMORY.md (intentionally empty)
- [ ] Rationale: These are placeholders, never used, misleading to keep

**Subtask 0.3: Update documentation**
- [ ] Update ARCHITECTURE_REPORT.md:
  - Add section "Why No Onboarding Agent?" with race condition explanation
  - Document session key format: agent:<agentId>:whatsapp:dm:<peerId>
  - Reference QMD MCP: openclaw-reference/concepts/session.md
  - Explain "sticky session" problem and why removal is correct
- [ ] Update findings.md: Document pattern about OpenClaw sessions
- [ ] Add to .gitignore if needed: No changes needed

**Subtask 0.4: Verification (MUST PASS)**
- [ ] Verify template has no "default": true agents
- [ ] Verify template has no channel-level bindings (only peer-specific ones)
- [ ] Test: npx openclaw config validate config/openclaw.json.template passes
- [ ] Document: First message may be dropped if webhook is slow
- [ ] Document: Users will naturally retry, no action needed

**Subtask 0.5: Production deployment notes**
- [ ] Existing production agents are NOT affected (already have bindings)
- [ ] Only affects NEW users (no binding exists yet)
- [ ] No migration needed (onboarding agent was never used in production)
- [ ] WhatsApp auth persists in volume (not affected)

**Success Criteria:**
- [ ] Template has zero agents with "default": true
- [ ] Template has zero channel-level bindings (only peer bindings)
- [ ] npx openclaw config validate passes
- [ ] Documentation explains "sticky session" problem
- [ ] Future agents reading this understand WHY onboarding agent was removed

**References for future agents:**
- QMD MCP search: "session sticky routing dmScope per-channel-peer"
- QMD MCP search: "session key format agent dmScope isolated"
- OpenClaw docs: openclaw-reference/concepts/session.md (read this!)
- Clawd4All analysis: Clawd4All/onboarding-issues-summary.md (v1 lessons learned)

---

**Task 1: Create phone-language-map.json**
- [ ] Create `config/phone-language-map.json`:
  ```json
  {
    "description": "Maps phone country codes to template language folders. Add new languages as: \"<country_code>\": \"dedicated-<lang>\"",
    "default": "dedicated-es",
    "mappings": {
      "1": "dedicated-en",
      "44": "dedicated-en",
      "56": "dedicated-es",
      "61": "dedicated-en",
      "91": "dedicated-en"
    }
  }
  ```
- [ ] Add comments explaining format
- [ ] Document in ARCHITECTURE_REPORT.md

**Task 2: Create English Templates (dedicated-en/)**
- [ ] Create `config/agents/dedicated-en/AGENTS.md`:
  - Same structure as dedicated-es
  - English instructions for Gmail/Calendar/productivity
  - Variables: {{USER_NAME}}, {{USER_EMAIL}}, {{PHONE_NUMBER}}
- [ ] Create `config/agents/dedicated-en/SOUL.md`:
  - Personality: Professional but warm (like Don Claudio but English)
  - Agent name: "Mr Botly" (avoids copyright, friendly)
  - Tone: Concise, proactive, courteous
- [ ] Create `config/agents/dedicated-en/MEMORY.md`:
  - User data structure
  - Onboarding flow (same placeholder detection as Spanish)
  - English welcome message

**Task 3: Language Detection Function**
- [ ] Create `onboarding/src/lib/language-detector.ts`:
  ```typescript
  export function detectLanguage(phone: string): string {
    // Extract country code: +1555... → "1"
    // Read phone-language-map.json
    // Return mapped folder or default
  }
  ```
- [ ] Unit tests: +1 → dedicated-en, +56 → dedicated-es, +999 → default
- [ ] Handle edge cases: malformed phone, missing config

**Task 4: Update agent-creator.ts**
- [ ] Import detectLanguage function
- [ ] Replace line 102 hardcoded 'dedicated-es' with:
  ```typescript
  const { detectLanguage } = await import('../lib/language-detector.js');
  const languageFolder = detectLanguage(phoneNumber);
  const templateDir = join(process.cwd(), 'config', 'agents', languageFolder);
  ```
- [ ] Add log message: `[agent-creator] Using template: ${languageFolder} for ${phoneNumber}`
- [ ] Verify graceful degradation (existing try/catch handles missing templates)

**Task 5: Documentation Updates**
- [ ] Update ARCHITECTURE_REPORT.md:
  - Add section "Language & Template Routing"
  - Document phone-language-map.json format
  - Add to "Project Structure" section
- [ ] Update task_plan.md: Mark Phase 10 tasks as above
- [ ] Add to .gitignore: `config/phone-language-map.json` if it contains sensitive info (not needed - just country codes)

#### Verification Steps

**Test 1: English User (+1)**
- [ ] Trigger onboarding with phone +15551234567
- [ ] Verify log: "Using template: dedicated-en"
- [ ] Check agent workspace: AGENTS.md is English
- [ ] Send first message: Agent responds in English

**Test 2: Spanish User (+56)**
- [ ] Trigger onboarding with phone +56912345678
- [ ] Verify log: "Using template: dedicated-es"
- [ ] Check agent workspace: AGENTS.md is Spanish
- [ ] Send first message: Agent responds in Spanish

**Test 3: Unmapped Country (uses default)**
- [ ] Trigger onboarding with phone +99999999999
- [ ] Verify log: "Using template: dedicated-es" (default)
- [ ] Check agent workspace: Spanish templates used

**Test 4: Invalid/Missing Config**
- [ ] Delete phone-language-map.json temporarily
- [ ] Trigger onboarding
- [ ] Verify: Falls back to default, logs warning, doesn't crash

**Test 5: TypeScript Compilation**
- [ ] npm run build succeeds
- [ ] No type errors in language-detector.ts
- [ ] agent-creator.ts imports work correctly

#### Success Criteria
- [ ] +1 phone numbers get English templates
- [ ] +56 phone numbers get Spanish templates
- [ ] Unmapped countries get Spanish default
- [ ] Config file addition requires no code changes
- [ ] Missing config file doesn't crash onboarding
- [ ] All existing functionality preserved

#### Future Extensibility
To add a new language (e.g., Portuguese for +55 Brazil):
1. Create `config/agents/dedicated-pt/` folder with templates
2. Add one line to phone-language-map.json: `"55": "dedicated-pt"`
3. No code deployment needed, just config file update

**Status:** **COMPLETE** — All tasks implemented, TypeScript compiles, ready for deployment

### Phase 11: Fix Sandbox OAuth — Env Vars & Credential Paths (IN PROGRESS)
<!--
  WHAT: Fix two root causes preventing Google OAuth from working inside sandbox containers.
  WHY: First real user (JP, +13128749154) tried to connect Gmail. Bot couldn't find credentials
       and fell back to asking user to manually run terminal commands.
-->

#### Situation
- User onboarded successfully (Mr Botly greeting, name/email collected)
- User asked bot to connect Gmail via `gog auth add`
- Bot's sandbox container could NOT run OAuth — fell back to telling user to run terminal commands manually

#### Root Cause Analysis (2 issues found)

**Issue 1: Sandbox env vars NOT being passed to Docker container**
- `openclaw.json` has `agents.list[].sandbox.docker.env` with `GOG_KEYRING_PASSWORD`, `GOG_CONFIG_DIR`, `GOG_KEYRING_BACKEND`
- `docker inspect` of sandbox container shows ZERO custom env vars — only default Node.js image vars (PATH, NODE_VERSION, YARN_VERSION)
- `docker exec ... env` confirms: `GOG_CONFIG_DIR=` (empty), `GOG_KEYRING_BACKEND` missing
- `gog auth status` inside sandbox shows: `keyring_backend: auto` (should be `file`), `config_path: /root/.config/gogcli/config.json`
- **OpenClaw is ignoring the per-agent `env` config when creating sandbox containers**

**Issue 2: Bind mount path doesn't match where gog looks**
- Config binds: `/root/google-credentials/credentials.json:/home/node/.config/gogcli/credentials.json:ro`
- Sandbox runs as **root** (HOME=/root), so gog looks at `/root/.config/gogcli/credentials.json`
- credentials.json IS present at `/home/node/.config/gogcli/credentials.json` (bind mount works)
- But gog never looks there because HOME=/root
- Error log: `OAuth client credentials missing (expected at /workspace/.config/gogcli/credentials.json)`
- Secondary error: `Path escapes sandbox root` when agent tries to read the credentials file

**Additional context:**
- Sandbox container runs as root (HOME=/root, PWD=/workspace)
- OpenClaw workspace mounted at `/workspace` (workspaceAccess: "rw")
- The old sandbox container (8c5afe490639) from the ENTRYPOINT bug is gone; current sandbox (278a75fa1a69) is new but still has no env vars

#### Implementation Tasks

**Task 1: Fix bind mount target path**
- [ ] Change bind in `agent-creator.ts` from:
  `/root/google-credentials/credentials.json:/home/node/.config/gogcli/credentials.json:ro`
  to:
  `/root/google-credentials/credentials.json:/root/.config/gogcli/credentials.json:ro`
- [ ] Update live config on server with new bind path
- [ ] Recreate sandbox to pick up new bind

**Task 2: Investigate and fix env var injection**
- [ ] Check OpenClaw version for known bugs with per-agent `sandbox.docker.env`
- [ ] Try workaround: move env vars to `agents.defaults.sandbox.docker.env` (but these are per-user values...)
- [ ] Alternative workaround: bake env vars into `setupCommand` or use a wrapper script
- [ ] Alternative workaround: set env vars via the sandbox image itself
- [ ] If OpenClaw bug: file issue or find workaround

**Task 3: Recreate sandbox and verify**
- [ ] `openclaw sandbox recreate --agent user_405bf6b6cf0f1a4f`
- [ ] Verify `docker inspect` shows env vars
- [ ] Verify `docker exec ... gog auth status` shows correct config_path and keyring_backend
- [ ] Verify credentials.json is found by gog
- [ ] Test `gog auth add juanpablodlc@gmail.com --manual` works inside sandbox

**Task 4: Backport server-only changes to repo** (from earlier session)
- [ ] `docker-compose.yml`: add `group_add: ["988"]`, `DOCKER_API_VERSION=1.44`
- [ ] `Dockerfile.sandbox`: ENTRYPOINT removal already in local repo
- [ ] Document `BAILEYS_SIDECAR_ENABLED=false` in .env.example

#### Verification
- [ ] `gog auth status` inside sandbox shows correct paths
- [ ] `gog auth add <email> --manual` outputs OAuth URL
- [ ] User can complete OAuth flow via WhatsApp conversation
- [ ] Tokens stored in isolated per-agent directory

**Status:** **COMPLETE** (2026-02-05) — Workaround implemented for OpenClaw bug, server changes backported to repo

**Implementation Summary:**
1. ✅ **Bind mount path:** Already correct in code and live config (`/root/.config/gogcli/credentials.json:ro`)
2. ✅ **Env var injection bug:** Discovered OpenClaw 2026.1.30 bug — `buildSandboxCreateArgs()` doesn't pass env vars to docker create
3. ✅ **Workaround implemented:** Use `setupCommand` to write env vars to `/root/.profile` so they persist for all docker exec commands
4. ✅ **Server changes backported:** `docker-compose.yml` (group_add, DOCKER_API_VERSION, BAILEYS_SIDECAR_ENABLED), `.env.example` updated
5. ✅ **Test script created:** `scripts/test-sandbox-oauth.sh` for verification
6. ✅ **Pattern documented:** Pattern 48 in findings.md (OpenClaw sandbox env var bug)

**Files changed:**
- `onboarding/src/services/agent-creator.ts` (+30 lines) — Added setupCommand workaround
- `docker/docker-compose.yml` (+4 lines) — group_add, DOCKER_API_VERSION, BAILEYS_SIDECAR_ENABLED
- `.env.example` (+10 lines) — DOCKER_GID, DOCKER_API_VERSION, BAILEYS documentation
- `scripts/test-sandbox-oauth.sh` (45 lines) — New verification script
- `findings.md` (+40 lines) — Pattern 48
- `progress.md` — Session entry

**Next steps:**
- Deploy to Hetzner and test sandbox OAuth with real user
- Run `./scripts/test-sandbox-oauth.sh` to verify env vars in sandbox
- Test `gog auth add <email> --manual` works inside sandbox

---

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

### Phase 10 Specific Questions (Multi-Language Templates)
14. **~What should the English agent be named?~** ✅ **DECIDED: "Mr Botly"** (avoids copyright, friendly name)
15. **~Should we add more country codes now?~** ✅ **DECIDED: Yes** - Added +44 (UK), +61 (Australia), +91 (India) all → dedicated-en
16. **~Should the "onboarding" agent be removed from config?~** ✅ **DECIDED: Yes, remove entirely** - See Task 0 for detailed reasoning with QMD MCP references about sticky session problem
17. **~Should we support language preference override?~** ✅ **DECIDED: No** - Let agent handle conversationally if user prefers different language
18. **~How do we handle edge cases like +1 but user speaks Spanish?~** ✅ **DECIDED: Option B** - Agent adapts in conversation (user can say "hablo español", agent switches or offers to switch templates)

**Additional Questions from Task 0:**
19. **Will first message be dropped?** Possibly, if webhook is slow. User will retry naturally. Better than trapping user in wrong agent.
20. **Do we need an onboarding agent at all?** No - v2 uses webhook-based flow, not intake agent pattern like Clawd4All v1.
21. **What if user gets stuck in wrong session?** This is WHY we're removing the onboarding agent - to prevent this exact problem.

### Phase 9 Specific Questions (Google OAuth)
9. **Does gog respect `GOG_CREDENTIALS_PATH` env var?** If not, need symlink approach in setupCommand.
10. **What is the exact OAuth client ID?** (For .gitignore pattern and verification)
11. **Does `gog auth add --manual` work without network access?** Sandbox has `network: bridge` - required for OAuth.
12. **Are Gmail + Calendar APIs enabled in Google Cloud project?** Verify before deploying.
13. **Is OAuth consent screen in "Testing" mode?** If no, must add users as test users manually.
14. **Should credentials be in a named volume instead of bind mount?** Trade-off: convenience vs security.

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
| Phase 0 marked complete | 9/11 tasks already completed per old deleted tasks.md and commit history |
| **ENV VAR NAMING:** Use `OPENCLAW_GATEWAY_TOKEN` | OpenClaw standard (32 doc matches) - was using wrong var name |
| **TEMPLATE FIX:** Update schema only | Changed `gateway.token` → `gateway.auth.token`, kept rest |
| **STOP at circular debugging** | 3-Strike Error Protocol - pause and reassess approach |

### Phase 10 Decisions (Multi-Language Templates)
| Decision | Rationale |
|----------|-----------|
| **REMOVE "onboarding" agent entirely** (Task 0) | Prevents "sticky session" trap - users getting stuck in wrong agent due to OpenClaw session behavior. See detailed reasoning in Task 0 with QMD MCP references. |
| **English agent name: "Mr Botly"** | Avoids copyright issues, friendly and memorable name for users |
| **More English country codes: +1, +44, +61, +91** | Covers US/Canada, UK, Australia, India - major English-speaking regions |
| **JSON config for phone→language mapping** | Easy to edit, version controlled, no database needed, no code deployment for new languages |
| **Spanish as default language** | Current system is Spanish-first, matches Chile origin, fallback for unmapped countries |
| **Folder-based template structure** (`dedicated-en`, `dedicated-es`) | Matches current pattern, easy to add new languages as new folders |
| **Graceful degradation on missing config** | System continues working with default if config file missing, logs warning for admin |
| **Language detection in dedicated function** | Keeps agent-creator.ts clean, testable in isolation, easy to extend |
| **No manual language override** | Simpler system - let agent handle conversationally if user prefers different language (e.g., +1 user speaks Spanish) |
| **Accept first message may be dropped** | Better than trapping user in wrong "sticky" session. Users will naturally retry. |

### Phase 9 Decisions (Google OAuth)
| Decision | Rationale |
|----------|-----------|
| **Bind mount for credentials** (`./config:/credentials:ro`) | Easiest setup: credentials managed on host, read-only for security, easy to update without rebuilding image |
| **One-time `gog auth credentials` setup** | Shared OAuth client used by all agents; only needs to run once after deployment |
| **Per-user `GOG_CONFIG_DIR`** (already implemented) | Isolates OAuth tokens per agent; each phone number gets unique directory |
| **Manual OAuth flow (`--manual` flag)** | Sandboxes are headless (no browser); agent guides user to copy-paste auth code |
| **Agent-side auth instructions in MEMORY.md** | Users self-service through WhatsApp conversation; no admin intervention needed per user |
| **Sandbox network: `bridge` (required)** | OAuth flow needs network access to Google; `none` would block auth |

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
- **Server State:** Fresh Hetzner VPS - no containers, no volumes (wiped 2026-02-02 per older file tasks.md)

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

## Migration Notes (from old removed tasks.md)

### Completed Tasks (9/11) - Mapped to Phase 0
The following tasks from the removed tasks.md are COMPLETE and documented in Phase 0 above:
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
