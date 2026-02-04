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

### Pattern 21: Missing Route Mount = Silent 404
**Symptom:** GET `/onboarding/state/:phone` returns 404 "Cannot GET" even though route exists in `state.ts`
**Root Cause:** Router was defined and exported, but never imported or mounted in `index.ts`. Only `webhookRouter` was mounted.
**Evidence:** `index.ts` had `import { router as webhookRouter }` but no import for `stateRouter`. Webhook's internal `getState()` calls worked (uses state-manager.js directly), but HTTP API was inaccessible.
**Fix:** Import router in `index.ts` + mount with `app.use('/', stateRouter)`
**Prevention:** When adding new route files, always mount them in the main app file. Use a checklist: (1) create route file, (2) export router, (3) import in index, (4) mount with app.use()

---

### Pattern 20: Two-Bug Interaction Creates Deceptive Root Cause
**Symptom:** Test 2 passed (200 OK) after fixing bug #2 (schema), making it seem like bug #1 (SQLite quotes) was the only issue.
**Root Cause:** Bug #1 (SQLite quotes) was caught first because it threw immediately. Bug #2 (schema) was silent — agent was written to config before DB insert failed, so Gateway only crashed when it tried to load that agent on next restart or config reload.
**Evidence:** Test 2 hit SQLite error first (DB insert happens after config write). The orphan agent with invalid schema sat in `openclaw.json` harmless until Gateway tried to load it.
**Prevention:** When fixing bugs, always consider: "What if the fix exposes the next bug?" The fact that Test 2 returned 500 means the request failed before hitting bug #2's symptoms. If Test 2 had returned 200, bug #2 would have been silent until Gateway restart.
**Lesson:** Log-level analysis matters. The Gateway crash logs showed the schema validation error, not the SQLite error. SQLite error was in onboarding logs.

---
**Symptom:** Gateway crashes after webhook returns 500 (SQLite error). Agent exists in `openclaw.json` but not in SQLite.
**Root Cause:** `agent-creator.ts` writes agent to `openclaw.json` (Step 4) BEFORE `state-manager.ts` inserts into SQLite (called from webhook handler after `createAgent()` returns). When the DB insert fails, the config already has the agent — but rollback only triggers if `createAgent()` itself throws.
**Evidence:** `openclaw.json` had `user_7f0d3241ec4aae7a` with binding, but no matching row in `onboarding.db`.
**Fix (immediate):** Removed orphan agent via Node.js script in container.
**Consideration:** The current flow is: createAgent (writes config) → createState (writes DB). If createState fails, the agent is orphaned. The rollback in createAgent only covers errors within its own try/catch. The webhook handler should ideally wrap both in a single transaction-like pattern.
**Prevention:** Verify end-to-end flow after fixing individual bugs — a fix that prevents one error may expose the next step's failure mode.

### Pattern 22: Exported Module Without Main Entry Point = Silent Cron Failure
**Symptom:** Cron job executes `node reconciliation.js` but nothing happens — no logs, no cleanup, no errors
**Root Cause:** `reconciliation.ts` exports functions (`reconcileStates()`, `cleanupOrphans()`) but has no main execution block. When Node.js runs the file directly, it imports the module and immediately exits without calling any functions.
**Evidence:** Cron job `node dist/services/reconciliation.js` would start, compile the module, and exit with code 0 — appearing successful while doing nothing.
**Fix:** Created `reconciliation-cli.ts` with main() entry point that calls the exported functions and handles process exit codes. Updated cron-setup.sh to reference `reconciliation-cli.js`.
**Prevention:** Any file intended for standalone execution (CLI tools, cron jobs) MUST have a main execution block. Use `#!/usr/bin/env node` shebang and check `import.meta.url === process.argv[1]` or simply call main() at module level.

### Pattern 23: Wrong Baileys Auth Loading - Direct File Read vs useMultiFileAuthState
**Symptom:** Baileys sidecar crashes with `TypeError: Cannot read properties of undefined (reading 'me')`
**Root Cause:** `baileys-sidecar.ts` read `creds.json` directly and passed it to `makeWASocket({ auth: authState })`. Baileys expects auth state loaded via `useMultiFileAuthState(authDir)` which returns `{ creds, keys }` object structure, not the raw creds.json content.
**Evidence:** OpenClaw's WhatsApp provider uses `useMultiFileAuthState(authDir)` then passes `auth: { creds: state.creds, keys: state.keys }`. Our sidecar did `JSON.parse(readFileSync(authPath))` and passed raw content.
**Fix:** Changed from:
  - `const authState = JSON.parse(readFileSync(authPath, 'utf-8'))`
  - `makeWASocket({ auth: authState })`
To:
  - `const { state } = await useMultiFileAuthState(authDir)`
  - `makeWASocket({ auth: { creds: state.creds, keys: state.keys } })`
**Prevention:** When using third-party libraries (Baileys, OpenClaw), always check how they load resources. Don't assume direct file reading works — use the library's provided auth loading functions (`useMultiFileAuthState`, `makeCacheableSignalKeyStore`).

### Pattern 24: Empty Agent Workspaces - No Template Files Copied
**Symptom:** Newly created agents have EMPTY workspaces - no AGENTS.md, SOUL.md, or MEMORY.md files
**Root Cause:** `agent-creator.ts` creates workspace directory but doesn't copy template files from `config/agents/dedicated/`. The workspace is created empty, so agents use OpenClaw defaults with no custom instructions or personality.
**Evidence:** `mkdir(agentConfig.workspace, { recursive: true })` - only creates directory, no file copy. Template files exist in `config/agents/dedicated/` but are never used.
**Fix Needed:** Implement template copying in `agent-creator.ts` to copy `config/agents/dedicated/*` to `workspace-<id>/` during agent creation.
**Prevention:** When implementing agent creation, ALWAYS verify workspace template files are copied. Test by checking if `workspace-<id>/AGENTS.md` exists after agent creation.

### Pattern 25: Read-Only Workspace Blocks Memory Writes and User Edits
**Symptom:** Users cannot edit their AGENTS.md/SOUL.md/MEMORY.md files; agents cannot write memory to MEMORY.md
**Root Cause:** Sandbox config has `workspaceAccess: 'ro'` (read-only) which mounts workspace as read-only in sandbox. This prevents:
  - Agents from writing to memory files
  - Users from editing their agent configuration
**Current Config:** `workspaceAccess: 'ro'` in agent-creator.ts:69
**Fix Needed:** Change to `workspaceAccess: 'rw'` OR separate read-only instructions from writeable memory. Research OpenClaw's memory write patterns to understand the security implications.
**Trade-off:** Read-write workspace allows user customization and agent memory writes, but potentially allows compromised agents to modify their own instructions (security consideration for untrusted AI).
**Prevention:** When setting sandbox permissions, consider whether users should be able to modify their agent's behavior. If yes, workspace must be writeable. If no, keep read-only and use alternative memory storage.

### Pattern 26: Missing User Data - No Onboarding Conversation
**Symptom:** Agents created with only phone number - no name, email, or user preferences collected
**Root Cause:** Agent creation is transactional and immediate - webhook triggers → agent created → binding added. No conversational flow to collect user details.
**Current Flow:** Unknown WhatsApp message → Webhook → Create agent with phone → Return 201
**Desired Flow:** Unknown WhatsApp message → Webhook → Create agent → Agent greets user → Agent asks for name/email → Agent stores in MEMORY.md
**Fix Needed:** Implement conversational onboarding in the agent itself (post-creation). Agent's first interaction should request user details, then update its own memory files.
**Prevention:** When designing agent creation, consider whether you need user metadata upfront. If yes, design a two-phase flow: (1) Create agent with minimal data, (2) Agent collects rest via conversation.

### Pattern 27: Template Directory Path in Container
**Discovery:** When running in Docker container, `process.cwd()` returns `/app` (the WORKDIR from Dockerfile). Template path must be relative to this, not to the source file location.
**Templates Location:** `/app/config/agents/dedicated-es/` (mounted from host `config/agents/dedicated-es/`)
**Implementation:** `join(process.cwd(), 'config', 'agents', 'dedicated-es')` resolves to `/app/config/agents/dedicated-es/` in container
**Prevention:** When adding file operations in containerized services, remember that `process.cwd()` is the container WORKDIR, not the source file directory. Use paths relative to WORKDIR.

### Pattern 28: Template Copy Failures Should Be Warnings, Not Errors
**Design Decision:** Template copy failures (missing files, permission errors) log `console.warn()` but don't throw. Agent creation succeeds even if templates are missing.
**Rationale:** Agents should be functional even without custom templates - they'll use OpenClaw defaults. Failing agent creation for missing templates would be too strict.
**Trade-off:** Silent failure means admins might not notice templates are missing until agents behave with default personality.
**Prevention:** When implementing optional file operations (templates, configs), consider whether failure should be (a) silent (feature is optional), (b) warning (feature is nice-to-have), or (c) error (feature is critical).

### Pattern 29: Memory Write Requires workspaceAccess 'rw'
**Discovery:** OpenClaw memory flush (auto-writing to MEMORY.md and memory/YYYY-MM-DD.md) is SKIPPED when `workspaceAccess: 'ro'` or `'none'`.
**Root Cause:** From memory.md docs: "Workspace must be writable: if the session runs sandboxed with `workspaceAccess: \"ro\"` or `\"none\"`, the flush is skipped."
**Fix:** Changed `workspaceAccess: 'ro'` → `'rw'` in agent-creator.ts
**Security Consideration:** `'rw'` allows agents to modify their own AGENTS.md/SOUL.md files. This is acceptable for user-owned dedicated agents (users can already edit files via host access).
**Prevention:** When designing agent workspaces, decide: (a) Read-only instructions + separate memory storage (complex), or (b) Writeable workspace with user trust (simple, Clawd4All v1 approach).

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
