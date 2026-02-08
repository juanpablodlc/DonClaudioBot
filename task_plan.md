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
**Phase 12: COMPLETE** — Replace Session Watcher with `message_received` Plugin (see findings.md Patterns 66-73)
**Phase 13: COMPLETE** — OpenClaw PR submitted: https://github.com/openclaw/openclaw/pull/11372
**Phase 14: PENDING** — Slash commands
**Phase 15: PENDING** — Seamless WhatsApp OAuth Flow (HTTPS callback, no localhost, no test users)

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
- **Status:** complete

### Phase 1: Pre-Deployment Verification
<!--
  WHAT: Verify all prerequisites are met before attempting deployment.
  WHY: Deploying without verification leads to hard-to-debug failures in production.
  MAPPED FROM: P0-DEPLOY-009 verification_steps
-->
- **Status:** complete

### Phase 2: Deploy to Hetzner VPS
[x] Executed deploy.sh and initialized OpenClaw config via npx openclaw setup.
[x] Fixed configuration schema: set gateway.bind to "lan", corrected auth tokens, and renamed env var to OPENCLAW_GATEWAY_TOKEN.
[x] Resolved state corruption by destroying the volume and redeploying with a fresh state.
[x] Restarted container to apply all configuration and schema fixes.
[x] Verified Production Health: Container Up, Health Endpoint (200 OK), Volume created, and Gateway active.

### Phase 3: WhatsApp Authentication — COMPLETE
 SSH tunnel to Gateway UI (-L 18789)
 Authenticated Gateway UI with token
 Logged into WhatsApp channel, scanned QR
 Credentials created (creds.json), channel linked (+12062274085)

### Phase 3a: Gateway UI Auth Fix — COMPLETE
 Root causes: missing gateway.auth.mode=token + browser WebCrypto blocked over HTTP tunnel
 Enabled gateway.controlUi.allowInsecureAuth=true
 Set gateway auth + remote tokens via openclaw config set
 UI accessible, Gateway reachable, dashboard URL valid

### Phase 4: Sandbox Image Build — COMPLETE
 Fixed sandbox Dockerfile (pinned gog CLI v0.9.0)
 Fixed build script (paths + vars)
 Built image locally + on Hetzner
 Verified gog binary + version
 Image size verified (495MB)

### Phase 5: Integration Testing — COMPLETE
 Discovered: deployed image used old interactive CLI code
 Redeployed with config-writer.js (no execFile)
 Webhook auth tests: 401 OK, 500 SQLite error found
 Root cause: SQLite datetime("now") (wrong quotes)
 Fixed to datetime('now'), redeployed
 Gateway crash traced to invalid agent schema
 Fixed agent config (cpus number, pidsLimit, removed timeoutMs)
 Removed corrupted agent, restarted Gateway
 Final test: webhook PASSED, agent created, Gateway stable
 Bonus fix: mounted state router, GET/POST verified
Status: ALL PHASES COMPLETE — end-to-end onboarding fully operational

### Phase 6: Documentation & Handoff (COMPLETE - PRODUCTION APPROVED)
<!-- WHAT: Document deployment results and handoff notes. WHY: Ensure future verification and maintainability. -->
 Update tasks_plan.md and progress.md (2026-02-04)
 Create post-deployment verification checklist
 Document deviations in findings.md (Patterns 16-23)
 Fix 1: Reconciliation CLI entry point (reconciliation-cli.ts, cron-setup.sh)
 Fix 2: Baileys sidecar enabled (BAILEYS_SIDECAR_ENABLED, auth fix)
 Production readiness: ~4.5GB RAM usage fits CX32 (8GB)
 fs.watch() risk accepted (chokidar + cron safety net)
Status: COMPLETE — PRODUCTION LIVE 🚀

### Phase 7: Spanish "Don Claudio" Agent Templates (COMPLETE)
<!-- WHAT: Spanish-language agent templates for new users. WHY: Prevent empty workspaces on agent creation. -->
 Create Spanish AGENTS.md, SOUL.md, MEMORY.md templates
 Update agent-creator.ts to copy templates on creation
 Verify templates copied to new workspaces
Status: COMPLETE — Spanish templates live and functional

### Phase 8: Two-Phase Onboarding & Variable Collection (COMPLETE)
<!-- WHAT: Collect user name/email after agent creation. WHY: Agents previously created with phone number only. -->

 CRITICAL: Change workspaceAccess from ro → rw
 Design and implement conversational data collection flow
 Persist name/email into MEMORY.md
 End-to-end test: phone → agent → conversation → data
 Enable user edits to AGENTS.md/SOUL.md/MEMORY.md
Status: COMPLETE — Two-phase onboarding operational

### Phase 9: Google OAuth Credential Setup & Per-User Auth Flow
<!-- WHAT: Shared OAuth client + per-user Google authorization. WHY: Enable Gmail/Calendar access via gogcli. -->
Requirements

 Shared OAuth client credentials (secure, sandbox-accessible)
 Per-agent isolated Google tokens (GOG_CONFIG_DIR)
 WhatsApp-driven manual OAuth flow
 No credential leakage (repo/log safety)
 Idempotent setup

Implementation Tasks

Task 1: Credential Storage
 Chosen: Bind mount host ./config → sandbox /credentials (RO)
 Rejected: Baking credentials into image

Task 2: Docker Compose Update
 Add read-only bind mount:

volumes:
  - don-claudio-state:/home/node/.openclaw
  - ./config:/credentials:ro


Task 3: Sandbox Environment

 Add env vars:

GOG_KEYRING_PASSWORD
GOG_CONFIG_DIR
GOG_CREDENTIALS_PATH=/credentials
 Fallback via symlink if unsupported

Task 4: One-Time Credential Setup
 Create setup-google-credentials.sh
 Verify via gog auth credentials list

Task 5: Per-User OAuth Flow
 Agent checks for tokens
 If missing, guides user through gog auth add --manual
 OAuth completed via WhatsApp (headless-safe)

Task 6: Spanish Template Update
 Add "🔐 Google OAuth" section to MEMORY.md
 Include steps + troubleshooting

Verification Steps
 Verify /credentials mount visibility
 Confirm OAuth client registration
 Manual OAuth flow validation
 Gmail/Calendar command access
 Token isolation across agents

Success Criteria
 OAuth client accessible in sandbox
 gog credentials registered once
 Agents complete manual OAuth
 Gmail/Calendar access confirmed
 Tokens isolated per agent
 No secrets committed to git

Security Considerations
 Read-only credential mount
 Unique per-agent keyrings
 Optional post-auth network hardening
 Audit logging for OAuth events

Rollback Plan
 Revert bind mount if needed
 Symlink credentials as fallback
 Manual SSH auth as last resort
 Revoke tokens via Google Console if compromised
Status: COMPLETE — Deployed and verified (2026-02-05)

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
**Task 2: Investigate and fix env var injection**
**Task 3: Recreate sandbox and verify**
**Task 4: Backport server-only changes to repo** (from earlier session)
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

### Phase 12: Replace Session Watcher With `message_received` Plugin
<!--
  WHAT: Replace the 5-second polling session watcher with an event-driven OpenClaw plugin.
  WHY: Session watcher is a polling workaround (Pattern 60). The `message_received` plugin hook
       was confirmed WORKING on 2026.1.30 in production (2026-02-07, Pattern 66).
  CONFIRMED: Works on current OpenClaw 2026.1.30. No version upgrade required.
  RESEARCH: See findings.md Patterns 66-73 for full DeepWiki validation.
-->

#### What Changes vs What Stays

**CHANGES (plugin replaces session watcher):**
| Current (Session Watcher) | New (Plugin) |
|--------------------------|-------------|
| ~146 lines in `session-watcher.ts` | ~50 lines in `extensions/onboarding-hook/index.ts` |
| Polls `sessions.json` every 5 seconds | Event fires instantly on every inbound message |
| Parses session keys with regex | Gets `event.metadata.senderE164` directly |
| Started from `onboarding/src/index.ts:38` | Auto-loaded by Gateway from `~/.openclaw/extensions/` |
| Runs in Onboarding process | Runs in Gateway process |

**STAYS THE SAME (do NOT change these):**
| Component | Why It Stays |
|-----------|-------------|
| **Welcome Agent** | Plugin cannot reroute messages (Pattern 67). First message needs catch-all. |
| **SIGUSR1 → Launcher → restart Gateway** | Bindings hot-reload bug still NOT fixed (Pattern 68). |
| **agent-creator.ts + config-writer.ts** | Plugin has no `api.createAgent()` (Pattern 69). Calls webhook instead. |
| **state-manager.ts (SQLite)** | Idempotency check stays — webhook checks SQLite. |
| **launcher.js** | SIGUSR1 handler, intentional restart flag, all unchanged. |

#### Architecture After Phase 12

```
User sends WhatsApp message
  │
  ├─ message_received PLUGIN fires (BEFORE routing)
  │   ├─ senderE164 in cache? → YES → skip
  │   └─ NO → HTTP POST localhost:3000/webhook/onboarding
  │          └─ Onboarding Service: SQLite check → createAgent → write binding → SIGUSR1 restart
  │
  ├─ Binding exists? → Route to dedicated agent
  └─ No binding → Route to Welcome Agent
```

#### Implementation Tasks

**Task 1: Create the production plugin**
**Task 2: Dockerfile + entrypoint (get plugin into volume)**
**Task 3: Remove session watcher from Onboarding Service**
**Task 4: Update documentation**

#### Verification Steps

**Deploy:**
- [ ] `./scripts/deploy.sh`
- [ ] Plugin loaded: `docker exec don-claudio-bot npx openclaw plugins list | grep onboarding-hook` → `loaded`
- [ ] Session watcher NOT running: no `[session-watcher] Starting` in logs

#### Known Limitations (Unchanged)

- **`knownPhones` cache lost on gateway restart** — rebuilt lazily, worst case one extra webhook call per user (returns "existing")
- **Welcome Agent duplication** (Pattern 65) — separate fix, not this phase

**Status:** **COMPLETE** (2026-02-07) — Session watcher replaced by `message_received` plugin in production. 6 users onboarded via Welcome Agent + plugin-driven flow.

---

### Phase 13: RESEARCH — Eliminate Gateway Restarts via OpenClaw PR
<!--
  TYPE: Research + PR preparation (NOT implementation in our codebase)
  WHY: Every new user triggers a gateway restart (SIGUSR1→SIGTERM→respawn).
       This drops in-flight messages (Pattern 64), causes ~2-5s downtime,
       and loses knownPhones cache. The root cause is an OpenClaw bug, not ours.
  GOAL: Prepare a PR for openclaw/openclaw that makes bindings hot-reloadable.
  DEPENDS ON: Phase 12 (can research in parallel, but the PR would simplify Phase 12's restart chain)
-->

#### The Bug (3 layers, confirmed in source code)

```
Layer 1: config-reload.ts:72
  { prefix: "bindings", kind: "none" }
  ↑ Classifies binding changes as "no action needed" (assumes dynamic reads)

Layer 2: monitor.ts:65
  const baseCfg = loadConfig();   // Called ONCE at startup, captured in closure
  createWebOnMessageHandler({ cfg, ... });   // line 160-174, stale forever

Layer 3: on-message.ts:66-67
  resolveAgentRoute({ cfg: params.cfg, ... });   // Uses stale snapshot
```

**The irony:** `loadConfig()` in `io.ts:532` already HAS a 200ms TTL cache (`DEFAULT_CONFIG_CACHE_MS = 200`). It was DESIGNED for per-request dynamic reads. But `monitorWebChannel` never calls it again.

**Same bug in Telegram:** `bot-message-context.ts:166` and `bot.ts:424` also use captured `cfg`.

#### Three PR Approaches (ranked by feasibility)

**PR A — One-line fix per channel (RECOMMENDED)**
Change routing calls to use `loadConfig()` instead of `params.cfg`:
```typescript
// on-message.ts:66 — BEFORE:
const route = resolveAgentRoute({ cfg: params.cfg, channel: "whatsapp", ... });
// AFTER:
const route = resolveAgentRoute({ cfg: loadConfig(), channel: "whatsapp", ... });
```
- Same fix in `telegram/bot-message-context.ts:166` and `telegram/bot.ts:424`
- ~3 lines changed across 3 files. No new abstractions.
- 200ms cache means no disk I/O per message — perf impact negligible
- `kind: "none"` classification BECOMES CORRECT (bindings truly are dynamically read now)
- Highest chance of acceptance: minimal diff, no new APIs, backward-compatible

**PR B — Hot action for bindings (architectural)**
- Change `bindings` from `kind: "none"` to `kind: "hot"` with `actions: ["refresh-routing"]`
- Add mutable config reference or event for routing updates in channels
- ~50-100 lines. More "correct" but more review surface.

**PR C — Route override in plugin hooks (ambitious)**
- Let `message_received` handler return `{ routeTo: "agentId" }`
- Eliminates bindings entirely for dynamic routing
- Major API change. Long shot for acceptance.

#### Impact On Our Architecture If PR A Accepted

| Component | Current | After PR |
|-----------|---------|----------|
| SIGUSR1 restart chain | Required for every new user | **ELIMINATED** |
| In-flight message drops | ~2-5s window per onboarding | **ELIMINATED** |
| launcher.js SIGUSR1 handler | Complex restart logic | Can simplify (keep for other uses) |
| Phase 12 plugin | Calls webhook → SIGUSR1 restart | Calls webhook → binding written → **done** |
| Welcome Agent | Still needed (first message) | Still needed (same) |
| knownPhones cache | Lost on every restart | **Survives** (no restarts) |

#### Research Tasks

**Task R1: Verify the fix locally**
- Fork openclaw/openclaw, apply PR A's 3-line change
- Build, run gateway with WhatsApp channel
- Write binding to config while running → verify routing picks it up without restart
- Verify: `npx openclaw plugins list`, send test message, check routing

**Task R2: Check existing issues/PRs**
- Search openclaw/openclaw GitHub issues for "bindings", "hot reload", "restart", "routing"
- Check if there's already a fix in progress or a reason it was intentionally `kind: "none"`
- Check CHANGELOG for any recent changes to config-reload.ts

**Task R3: Write the PR**
- Title: "fix: Make bindings hot-reloadable by using loadConfig() in routing calls"
- Body: explain the 3-layer bug, the 200ms cache design intent, affected channels
- Include before/after test: write binding → verify routing without restart
- Reference the existing test: `config-reload.test.ts`

**Task R4: Understand edge cases**
- What if config is written mid-message-processing? (200ms cache → stale for at most 200ms, acceptable)
- What if config file is corrupted? (`loadConfig()` already handles this — returns last valid)
- Performance under load? (200ms cache → at most 5 disk reads/second, negligible)
- Does Discord also have this bug? Check `discord/monitor/message-handler.ts`

**Task R5: Fallback plan if PR rejected**
- If maintainers prefer PR B or C, estimate effort
- If they reject all approaches, document why SIGUSR1 chain is permanent
- Consider: `gateway.reload.mode: "restart"` as heavy-handed alternative (restarts on ALL config changes)

#### DeepWiki Warning

DeepWiki (2026-02-07) claims "bindings related to channels should be picked up without restart" — **THIS IS WRONG**. It confuses channel-level hot-reload (which exists for channel config like `channels.whatsapp.allowFrom`) with bindings-level hot-reload (which doesn't work because `bindings` is `kind: "none"`). Do not trust DeepWiki on this specific topic. Trust the source code.

**Status:** **COMPLETE** (2026-02-07) — PR #11372 submitted to openclaw/openclaw. Fixes #6602 (bindings ignored). 4 files changed across WhatsApp/Telegram/Discord channels. All 6510 tests pass. Awaiting maintainer review.

---

### Phase 14: Disable Slash Commands for WhatsApp User Agents
<!--
  WHAT: Fully disable slash command parsing for end users on WhatsApp.
  WHY: Users can use `/model`, `/think` (cost risk), `/status` (info leak), `/reset` (UX disruption).
       Dangerous commands are already blocked by defaults/sandbox, but benign-but-undesirable ones remain.
  APPROACH: Dockerfile patch (immediate) + upstream PR (proper fix).
-->

#### Context

Users assigned to DonClaudioBot agents on WhatsApp can use OpenClaw slash commands (`/status`, `/model`, `/think`, etc.). While dangerous commands (`/elevated`, `/bash`, `/config`, `/restart`) are already blocked by defaults and sandbox gates, benign-but-undesirable commands remain available. The goal is to fully disable slash command parsing for end users on WhatsApp.

#### Problem

**`commands.text: false` does not work on WhatsApp.** This is hardcoded in OpenClaw's `shouldHandleTextCommands` function — it always returns `true` for channels without native command support (WhatsApp, WebChat, Signal, iMessage, Google Chat, MS Teams). Unit tests enforce this behavior.

OpenClaw's rationale: WhatsApp has no native command UI, so text commands are the only control surface. Disabling them would remove all admin access.

**`allowFrom` can't separate messaging from command auth.** With `allowFrom: ["*"]` (required for our open-access setup), all senders are authorized for commands. `dmPolicy: "open"` also requires `allowFrom: ["*"]`, so there's no way to decouple them.

#### Current Risk Surface

| Command | Status | Risk |
|---------|--------|------|
| `/elevated` | **Blocked** (sandbox + allowFrom gates) | None |
| `/bash` | **Blocked** (disabled by default) | None |
| `/config` | **Blocked** (disabled by default) | None |
| `/restart` | **Blocked** (disabled by default) | None |
| `/model <name>` | **Available** | Cost — users can switch to expensive models |
| `/think <level>` | **Available** | Cost — users can increase thinking level |
| `/status` | **Available** | Info leak — reveals internal config details |
| `/reset` / `/new` | **Available** | UX — user loses session context |
| `/help`, `/commands` | **Available** | Low — informational |
| `/whoami`, `/id` | **Available** | Low — shows sender ID |
| `/verbose`, `/reasoning` | **Available** | Low — changes output format |
| `/queue` | **Available** | Low — changes queue mode |
| `/usage` | **Available** | Low — shows usage stats |
| `/compact` | **Available** | Low — triggers context compaction |

#### Implementation: Option 1 — Dockerfile Patch (Immediate Fix)

Patch `shouldHandleTextCommands` in the built JS at Docker build time, same approach as the bindings hot-reload patch (Phase 13).

**How it works:**
- Find the `shouldHandleTextCommands` function in the compiled OpenClaw JS
- Patch it in the Dockerfile `RUN` step to return `false` for WhatsApp when `commands.text` is `false`
- Then set `channels.whatsapp.commands.text: false` in `openclaw.json.template`

**References:**
- `shouldHandleTextCommands` — `src/auto-reply/commands-registry.ts` (or compiled equivalent)
- Test: `src/auto-reply/commands-registry.test.ts` — asserts `true` for WhatsApp when `text: false`
- Existing patch precedent: bindings hot-reload in `docker/Dockerfile`

**Risk:** If we disable ALL text commands on WhatsApp, the bot owner also loses `/status`, `/model`, etc. access via WhatsApp. Admin actions would need SSH or the control UI.

#### Implementation: Option 2 — Upstream PR (Proper Fix)

Submit a PR to `openclaw/openclaw` that makes `channels.<provider>.commands.text` a true per-channel override that takes precedence over the "no native commands" fallback.

**Proposed behavior:**
- If `channels.whatsapp.commands.text` is explicitly set to `false`, honor it (don't override)
- If not set, keep current behavior (fallback to `true` for channels without native commands)

**PR scope:**
1. Modify `shouldHandleTextCommands` to check channel-level `commands.text` override
2. Update tests in `commands-registry.test.ts`
3. Update docs in `tools/slash-commands.md`

#### Implementation Steps

1. Locate `shouldHandleTextCommands` in compiled OpenClaw JS inside `node_modules/openclaw/`
2. Write a `sed`/`node` patch in `docker/Dockerfile` (after the existing bindings patch)
3. Add `commands: { text: false, native: false }` to `channels.whatsapp` in `openclaw.json.template`
4. Test locally with `docker compose up`
5. Verify: send `/status` from a user phone → should be treated as plain text, not a command
6. Deploy to Hetzner
7. Draft upstream PR for `openclaw/openclaw`

#### Verification

- [ ] Send `/status` via WhatsApp → agent should respond to it as regular text (not a status report)
- [ ] Send `/model gpt-5` via WhatsApp → agent should respond to it as regular text (not switch models)
- [ ] Send `/think high` via WhatsApp → no acknowledgment, treated as plain text
- [ ] Gateway control UI still works for admin operations

#### Decisions

| Decision | Rationale |
|----------|-----------|
| **Do both: Option 1 now + Option 2 in parallel** | Immediate protection via Dockerfile patch + proper upstream fix for long-term |
| **Accept losing admin WhatsApp commands** | Admin operations rarely needed via WhatsApp chat. Use Gateway control UI or SSH instead. |
| **Proven patch pattern** | Same approach as bindings hot-reload patch (Phase 13) — reliable, survives rebuilds |

**Status:** pending

---

### Phase 15: Seamless WhatsApp OAuth Flow (No Localhost, No Test Users)
<!--
  WHAT: Replace the broken `gog auth add --manual` OAuth flow with a tap-to-authenticate HTTPS callback flow.
  WHY: Two problems: (1) Google project WAS in Testing mode (100-user cap, 7-day token expiry) — NOW PUBLISHED TO PRODUCTION.
       (2) `--manual` uses `http://localhost:1` redirect URI — on mobile this lands on broken page, requires
       users to copy URL from browser address bar and paste back into WhatsApp. Confusing and error-prone.
  GOAL: User taps OAuth link in WhatsApp → authenticates on phone → done. No copy-paste, no manual steps.
  DEPENDS ON: Domain name (A record pointing to 135.181.93.227), Web OAuth client credentials from Google Cloud Console.
-->

#### Context

**Problem 1 (RESOLVED):** Google project was in "Testing" mode — every new user had to be manually pre-added in Google Cloud Console (max 100), tokens expired after 7 days. **FIX:** Published to production. Users see "unverified app" warning (click Advanced → Go to app). No code change needed.

**Problem 2 (THIS PHASE):** `gog auth add --manual` uses `http://localhost:1` as redirect URI. On mobile, this lands on a broken page. Users must copy the URL from the browser address bar and paste it back into WhatsApp. This is confusing and error-prone.

**Solution:** HTTPS callback endpoint via Caddy reverse proxy + server-side token import into gog keyring.

#### New User Experience (After Implementation)

| Step | What happens |
|------|-------------|
| 1. User texts WhatsApp | Plugin detects unknown number → creates agent + OAuth URL |
| 2. Agent asks for name | Normal onboarding conversation |
| 3. Agent sends OAuth link | "Tap this link to connect your Google account" |
| 4. User taps link | Opens Google sign-in on their phone's browser |
| 5. User taps "Allow" | Google redirects to `https://DOMAIN/oauth/callback` |
| 6. Server handles everything | Exchanges code → imports token → shows success page |
| 7. User returns to WhatsApp | Agent confirms: "Your Google account is connected!" |

**Total user effort: Tap link → sign in → tap Allow. Done.**

#### Prerequisites (Manual Steps — Before Implementation)

**P0: Verify `gog auth tokens import` exists**
```bash
ssh -i ~/.ssh/hetzner root@135.181.93.227
docker exec don-claudio-bot gog auth tokens --help
```
If `import` subcommand exists, proceed. If not, see Fallback section at end.

**P1: Get a domain name (user to do)**
- Buy a cheap domain (~$1-10/year from Cloudflare, Namecheap, or Porkbun)
- Point an A record to `135.181.93.227` (e.g., `auth.donclaudio.app` or any subdomain)
- Caddy handles TLS automatically via Let's Encrypt (zero config beyond the domain name)
- Only ONE subdomain/domain needed — it's just for the OAuth callback

**P2: Google Cloud Console changes**
- [x] **Publish to production**: Already done — removes 100-user cap and 7-day token expiry
- [ ] **Create new OAuth client**: APIs & Services → Credentials → Create → OAuth client ID → "Web application"
  - Name: `DonClaudioBot Web`
  - Authorized redirect URIs: `https://DOMAIN/oauth/callback`
  - Download the credentials JSON (has `"web"` key instead of `"installed"`)
- [ ] **Upload to server**: Place new credentials at `/root/google-credentials-web/credentials.json` on Hetzner

#### Implementation Tasks

**Task 1: Infrastructure — Caddy Reverse Proxy**

New file: `config/Caddyfile`
```
{$OAUTH_DOMAIN} {
    handle /oauth/* {
        reverse_proxy don-claudio-bot:3000
    }
    handle {
        respond "Not Found" 404
    }
}
```

Modified file: `docker/docker-compose.yml`
- [ ] Add `caddy` service (caddy:2-alpine image)
- [ ] Expose ports 80 + 443 (needed for ACME challenge + HTTPS)
- [ ] Add `caddy-data` volume (persists TLS certs)
- [ ] Add `caddy-config` volume
- [ ] Add new env vars to `don-claudio-bot`:
  - `GOOGLE_WEB_CLIENT_ID`
  - `GOOGLE_WEB_CLIENT_SECRET`
  - `OAUTH_REDIRECT_URI=https://DOMAIN/oauth/callback`
- [ ] Mount new web credentials: `/root/google-credentials-web/credentials.json:/home/node/.config/gogcli-web/credentials.json:ro`

Security: Caddy only proxies `/oauth/*` — internal APIs (webhooks, state endpoints) remain unexposed.

**Task 2: OAuth State Management**

New file: `onboarding/src/lib/oauth-state.ts` (~50 LOC)
- [ ] `encodeState(agentId, phone)` → base64url JSON + HMAC-SHA256 signature (using HOOK_TOKEN as secret)
- [ ] `decodeState(stateParam)` → validates HMAC, checks 30-min expiry, returns `{agentId, phone, nonce}`
- [ ] Nonce is random 16 bytes, stored in SQLite for single-use verification

Modified file: `onboarding/src/services/state-manager.ts`
- [ ] Add columns: `oauth_nonce TEXT`, `oauth_url TEXT`, `oauth_status TEXT DEFAULT 'pending'`
- [ ] New function: `updateOAuthStatus(phone, status)` and `getOAuthNonce(phone)`

**Task 3: OAuth URL Generation at Agent Creation**

Modified file: `onboarding/src/services/agent-creator.ts`
- [ ] After creating workspace + copying templates (existing step 7), generate CSRF state token with agent ID + phone
- [ ] Build OAuth URL with correct scopes and `access_type=offline&prompt=consent`
- [ ] Write URL to `workspace/.oauth-url.txt`
- [ ] Store nonce in SQLite via state-manager

New file: `onboarding/src/services/oauth-url-generator.ts` (~40 LOC)
- [ ] Reads `GOOGLE_WEB_CLIENT_ID` and `OAUTH_REDIRECT_URI` from env
- [ ] Scopes: `https://mail.google.com/ https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive openid email`
- [ ] Returns `{url, nonce}`

**Task 4: OAuth Callback Endpoint**

New file: `onboarding/src/routes/oauth.ts` (~80 LOC)

`GET /oauth/callback?code=AUTH_CODE&state=STATE`

- [ ] Decode + validate state parameter (HMAC + nonce + expiry)
- [ ] Exchange code for tokens via POST to `https://oauth2.googleapis.com/token`
  - Uses `GOOGLE_WEB_CLIENT_ID` + `GOOGLE_WEB_CLIENT_SECRET` + redirect URI
  - Returns `{access_token, refresh_token, scope, id_token}`
- [ ] Extract user email from id_token (JWT decode, no verification needed — we trust Google's response over HTTPS)
- [ ] Import refresh token into agent's gog keyring (Task 5)
- [ ] Update SQLite: `oauth_status = 'complete'`
- [ ] Return HTML success page: "Connected! You can close this tab and return to WhatsApp."

Mount in `onboarding/src/index.ts`: `app.use('/', oauthRouter);`

**Task 5: Token Import into Agent's Gog Keyring**

New file: `onboarding/src/services/token-importer.ts` (~60 LOC)

`importTokenToAgent(agentId, email, refreshToken)`

- [ ] Read agent's `GOG_KEYRING_PASSWORD` from openclaw.json (via config-writer's readConfig)
- [ ] Compute workspace path: `$OPENCLAW_STATE_DIR/workspace-$agentId`
- [ ] Ensure gog config dir exists: `workspace/.gog-config/gogcli/keyring/`
- [ ] Register credentials (idempotent): `gog auth credentials /path/to/web-credentials.json`
- [ ] Write temp token file with email, services, scopes, refresh_token
- [ ] Run: `gog auth tokens import /tmp/token-xxx.json` with env: `GOG_KEYRING_PASSWORD=..., GOG_KEYRING_BACKEND=file, XDG_CONFIG_HOME=workspace/.gog-config`
- [ ] Delete temp token file immediately (contains secrets)

Note: Runs from main container (not sandbox) — gog is already installed, volume is shared.

**Task 6: Agent Template Updates**

Modified files:
- [ ] `config/agents/dedicated-en/AGENTS.md` — Replace `gog auth add --manual` section with: read OAuth URL from `/workspace/.oauth-url.txt`, send to user, tell them to tap link. After completion verify with `gog auth list`.
- [ ] `config/agents/dedicated-en/MEMORY.md` — Simplify Google Services Setup section
- [ ] `config/agents/dedicated-es/AGENTS.md` — Same changes in Spanish
- [ ] `config/agents/dedicated-es/MEMORY.md` — Same changes in Spanish

#### Verification Steps

- [ ] **P0 gate**: Verify `gog auth tokens import` works on server before writing any code
- [ ] **Local docker compose**: `docker compose up` succeeds with Caddy + bot
- [ ] **TLS works**: `curl https://DOMAIN/oauth/callback` returns 400 (missing params), not connection error
- [ ] **OAuth flow**: Text from test phone → agent sends OAuth link → tap link → authenticate → return to WhatsApp → agent confirms connection
- [ ] **gog commands work**: Agent can run `gog auth list`, `gog gmail search 'newer_than:1d'`
- [ ] **CSRF protection**: Forged state parameter returns error page
- [ ] **Existing users unaffected**: Previously onboarded users still work normally

#### Key Files

| File | Status | Purpose |
|------|--------|---------|
| `config/Caddyfile` | NEW | Reverse proxy config |
| `onboarding/src/routes/oauth.ts` | NEW | Callback handler |
| `onboarding/src/services/oauth-url-generator.ts` | NEW | URL construction + CSRF |
| `onboarding/src/services/token-importer.ts` | NEW | gog keyring token import |
| `onboarding/src/lib/oauth-state.ts` | NEW | HMAC state token encode/decode |
| `docker/docker-compose.yml` | MODIFY | Add Caddy, env vars |
| `onboarding/src/index.ts` | MODIFY | Mount oauth router |
| `onboarding/src/services/agent-creator.ts` | MODIFY | Generate OAuth URL at creation |
| `onboarding/src/services/state-manager.ts` | MODIFY | OAuth columns |
| `config/agents/dedicated-en/AGENTS.md` | MODIFY | New OAuth instructions |
| `config/agents/dedicated-en/MEMORY.md` | MODIFY | New OAuth instructions |
| `config/agents/dedicated-es/AGENTS.md` | MODIFY | New OAuth instructions (ES) |
| `config/agents/dedicated-es/MEMORY.md` | MODIFY | New OAuth instructions (ES) |

#### Estimated Scope

- ~5 new files, ~280 LOC of new TypeScript
- ~5 modified files, ~40 LOC of changes
- Caddy config: ~10 lines
- Docker compose changes: ~25 lines
- Agent templates: ~40 lines updated across 4 files

#### Fallback: If `gog auth tokens import` Doesn't Exist

If the command doesn't exist in v0.9.0:

**Option A — Pipe to gog auth add**: The callback stores the auth code in SQLite. Write `pending-code.txt` to workspace. AGENTS.md instructs agent: "If `pending-code.txt` exists, run `echo 'http://localhost:1/?code=CODE' | gog auth add EMAIL --manual --services gmail,calendar,drive`". This feeds the redirect URL to gog via stdin.

**Option B — Skip gog for token storage**: Use `google-auth-library` (Node.js) directly. Store tokens in a JSON file. Write a thin CLI wrapper the agent uses instead of `gog gmail/calendar` commands. More work, but fully under our control.

#### Rollback Plan

- If Caddy fails: Remove caddy service from compose, revert to SSH-tunnel-only access
- If token import fails: Fall back to existing `gog auth add --manual` flow (still works, just bad UX)
- If callback endpoint crashes: Agent templates still have manual auth instructions as fallback

**Status:** pending

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

### Phase 15 Specific Questions (Seamless OAuth Flow)
22. **Does `gog auth tokens import` exist in v0.9.0?** Must verify on server before writing code. If not, use Fallback Option A or B.
23. **What domain name will be used?** User needs to buy + point A record to 135.181.93.227.
24. **Does Hetzner firewall allow ports 80/443?** Caddy needs both for ACME + HTTPS. May need firewall rule.
25. **Can main container write to agent workspace paths?** Token import needs write access to `workspace-<agentId>/`.
26. **Does `gog auth credentials` accept web client JSON?** Web client JSON has `"web"` key vs `"installed"` — verify gog handles both.

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


### Phase 13 Decisions (Gateway Restart Elimination Research)
| Decision | Rationale |
|----------|-----------|
| **PR A (loadConfig per-route) over PR B/C** | Smallest diff (~3 lines), backward-compatible, uses existing 200ms cache. Highest chance of acceptance. |
| **Research phase, not implementation** | Fix is in OpenClaw's repo, not ours. Need to fork, test, submit PR, wait for merge. |
| **Phase 12 independent of Phase 13** | Phase 12 replaces session watcher (polling→event). Phase 13 eliminates restarts. Both valuable independently. |
| **DeepWiki unreliable on this topic** | Claims bindings are hot-reloadable — proven wrong by source code. Trust `config-reload.ts:72` only. |
| **Use Node 22 built-in `fetch()`** | No new dependencies. Available in our runtime (node:22-bookworm-slim). |

### Phase 15 Decisions (Seamless WhatsApp OAuth Flow)
| Decision | Rationale |
|----------|-----------|
| **Caddy for TLS** | Auto-TLS via Let's Encrypt, zero config beyond domain name, Alpine image (~40MB) |
| **Only proxy `/oauth/*`** | Keeps webhooks, state endpoints, Gateway UI unexposed to internet |
| **HMAC-SHA256 state parameter** | CSRF protection using existing HOOK_TOKEN as secret — no new secrets needed |
| **30-min state expiry + single-use nonce** | Prevents replay attacks, nonce stored in SQLite |
| **Token import from main container** | gog already installed, volume shared, no Docker API calls needed |
| **Web OAuth client (not installed)** | `"web"` client type supports HTTPS redirect URIs; `"installed"` only supports localhost |
| **Google project published to production** | Removes 100-user cap and 7-day token expiry. Users see "unverified app" warning (acceptable) |
| **JWT decode without verification for id_token** | Token comes from Google over HTTPS in token exchange response — trusted source |
| **Write `.oauth-url.txt` to workspace** | Agent reads it when user asks to connect Google — decouples URL generation from agent template logic |

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

### Git History Context
Recent commits show:
- `4fd34bb`: docs: Align documentation with code reality (v2.14.0)
- `38a56b1`: fix: Complete dual-process launcher and fix ES module imports
- `73d3d81`: feat: Complete P0-DEPLOY-000 through P0-DEPLOY-005 (deployment readiness)
- `0b85570`: fix: Address code review issues from production readiness commits
- `448cf09`: feat: Complete P1 production readiness tasks (P1-007 through P1-011)