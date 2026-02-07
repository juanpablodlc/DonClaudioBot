# DonClaudioBot v2 - Architecture Reference
**Version:** 2.16.0 | **Updated:** 2026-02-07

---

## 1. What This Is

WhatsApp-based multi-user AI assistant. Each user gets a sandboxed OpenClaw agent with Google OAuth (Gmail/Calendar). Built on [OpenClaw](https://github.com/openclaw/openclaw) as an npm dependency.

**v2 fixes v1's core bug:** Create agents with sandbox config FIRST, then do OAuth in that agent's context. Onboarding is a deterministic Node.js service with SQLite state, not LLM-driven.

---

## 2. Product Vision & Constraints

**What JP wants:** A personal AI assistant service for friends and family over WhatsApp. Each person gets their own sandboxed agent that can read their Gmail, manage their Calendar, and chat naturally — like having a personal secretary. Not a commercial product (yet). Currently ~2-5 users.

**UX goal:** Zero-friction onboarding. Text the bot, get a response immediately, have your own agent within seconds. No signup forms, no email verification, no app install. WhatsApp is the only interface.

**Constraints:**
- Single Hetzner VPS (CX32: 8GB RAM, 2 CPU) — budget-conscious, not hyperscale
- One WhatsApp number shared by all users — OpenClaw handles per-user routing
- Each user's data must be completely isolated (privacy is non-negotiable after the breach incident)
- The system must survive code deployments without losing WhatsApp authentication

---

## 3. System Design

```
Hetzner VPS (Docker Compose)
├── DonClaudioBot Container (launcher.js)
│   ├── Process 1: OpenClaw Gateway
│   │   ├── WhatsApp channel (Baileys)
│   │   ├── Multi-agent routing (bindings → agents)
│   │   ├── Session management (dmScope: per-channel-peer)
│   │   └── Config: ~/.openclaw/openclaw.json (JSON5)
│   │
│   └── Process 2: Onboarding Service (Express)
│       ├── Agent Creator (writes config + binding + workspace)
│       ├── State Manager (SQLite: phone → agent_id)
│       └── SIGUSR1 → Launcher → SIGTERM Gateway (restart for binding pickup)
│
├── Per-User Sandbox Containers
│   ├── user_<hex> (dedicated agent per user)
│   └── Each with: isolated OAuth tokens, workspace, GOG_KEYRING_PASSWORD
│
└── State Volume: don-claudio-state (~/.openclaw/)
    ├── openclaw.json        (agent config + bindings)
    ├── agents/<id>/         (per-agent state, sessions, auth)
    ├── workspace-<id>/      (AGENTS.md, SOUL.md, MEMORY.md)
    ├── workspace-welcome/   (welcome agent template)
    └── onboarding.db        (SQLite)
```

---

## 4. Auto-Onboarding Flow

New users are onboarded automatically via a `message_received` plugin that fires on every inbound WhatsApp message.

```
User sends WhatsApp message
  │
  ├─ message_received PLUGIN fires (BEFORE routing)
  │   ├─ senderE164 in knownPhones cache? → YES → skip
  │   └─ NO → HTTP POST localhost:3000/webhook/onboarding
  │          └─ Onboarding Service: SQLite check → createAgent → write binding → SIGUSR1 restart
  │
  ├─ Binding exists? ──YES──→ Route to dedicated agent (normal operation)
  │
  └─ No binding ──→ Route to Welcome Agent (default, zero personal data)
                      └─ Welcome Agent responds: "Setting up your assistant..."
                         └─ Next message routes to dedicated agent ✓
```

**Why a plugin instead of polling?** The previous Session Watcher polled `sessions.json` every 5s (~146 lines). The `message_received` plugin (~35 lines) fires instantly on every inbound message, detects unknown phones via an in-memory cache, and calls the existing webhook. Event-driven replaces polling. See `findings.md` Patterns 66-73 for plugin research.

**Why SIGUSR1 to Launcher (not directly to Gateway)?** OpenClaw has a bug: `config-reload.ts` classifies `bindings` as `kind: "none"` (assumes dynamic read), but `monitorWebChannel` captures config in a closure at startup and never refreshes. New bindings are invisible until Gateway restarts. The webhook handler sends SIGUSR1 to launcher, which sets `intentionalGatewayRestart=true` and sends SIGTERM to gateway. On exit, launcher detects the intentional flag, resets restart counter to 0, and respawns gateway cleanly. See `findings.md` Patterns 60, 62, 68 for details.

**Why a Welcome Agent?** Plugin hooks cannot modify routing (Pattern 67) — they are observe-only. The first message from an unknown user still routes to the Welcome Agent, which provides immediate feedback while the dedicated agent is being created (~2-5 seconds including Gateway restart).

---

## 5. Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **`message_received` plugin, not polling** | Gateway plugin fires instantly on every inbound message. Replaces Session Watcher (5s polling) and Baileys sidecar (WebSocket conflict). Plugin calls existing webhook — ~35 lines vs ~146. |
| 2 | **Welcome Agent as default** | Catches unknown users safely (zero personal data). Replaces "no default agent" design that dropped first messages. |
| 3 | **SIGUSR1 Gateway restart via Launcher IPC** | Only reliable way to pick up new bindings. Session watcher sends SIGUSR1 to launcher (`process.ppid`), launcher SIGTERM→respawns gateway. Counter resets to 0 on intentional restart (not after 30s). |
| 4 | **Zod .strict() on bindings** | Privacy breach root cause was unknown keys in bindings breaking OpenClaw's validator. Strict validation catches this before config write. |
| 5 | **OAuth-in-Sandbox via XDG_CONFIG_HOME** | `gogcli` uses `os.UserConfigDir()`, not `GOG_CONFIG_DIR` (env var doesn't exist). `XDG_CONFIG_HOME` isolates each agent's tokens. |
| 6 | **SQLite with WAL + UNIQUE constraints** | Single-file, in-process, concurrent readers, handles race conditions via UNIQUE on phone_number. |
| 7 | **Atomic config writes** | `proper-lockfile` + temp file + rename. Prevents corruption from concurrent agent creation. |
| 8 | **Phone prefix → language routing** | `config/phone-language-map.json` maps country codes to template folders. Add language = add folder + one JSON line. |
| 9 | **JSON5 for OpenClaw config** | OpenClaw uses JSON5 (unquoted keys, comments). Always use `json5` package, never `JSON.parse()`. |
| 10 | **Dual-process launcher** | Gateway (`node node_modules/openclaw/openclaw.mjs gateway`) + Onboarding (`node dist/index.js`) as independent processes. Enables SIGUSR1-mediated restart of Gateway without affecting Onboarding. No `npx` wrapper — direct node invocation ensures clean signal handling. |

---

## 6. Security: Five-Layer Isolation

```
┌────────────────────────────────────────────────────────────┐
│ Layer 1: Routing        Bindings: phone → specific agent   │
│                         dmScope: per-channel-peer           │
│                         Zod .strict() binding validation    │
├────────────────────────────────────────────────────────────┤
│ Layer 2: Workspace      Each agent: workspace-<id>/         │
│                         AGENTS.md, SOUL.md, MEMORY.md       │
│                         workspaceAccess: rw                 │
├────────────────────────────────────────────────────────────┤
│ Layer 3: Auth           Per-agent: agents/<id>/agent/.gog/  │
│                         XDG_CONFIG_HOME isolation            │
│                         Unique GOG_KEYRING_PASSWORD          │
├────────────────────────────────────────────────────────────┤
│ Layer 4: Sandbox        Per-agent Docker container           │
│                         512MB memory, 0.5 CPU, 100 pids     │
│                         No docker.sock, no privileged        │
├────────────────────────────────────────────────────────────┤
│ Layer 5: Network        Sandbox: network: bridge             │
│                         Main: cap_drop: ALL, read_only: true │
│                         HOOK_TOKEN on webhook endpoints      │
└────────────────────────────────────────────────────────────┘
```

---

## 7. Gotchas by Category

### OpenClaw Framework
| Gotcha | Detail |
|--------|--------|
| **Bindings need Gateway restart** | `config-reload.ts` classifies bindings as `kind: "none"` (assumes dynamic read), but `monitorWebChannel` captures config in a closure at startup. New bindings invisible until restart. Session watcher sends SIGUSR1 to launcher, which SIGTERM→respawns gateway automatically. |
| **Config is JSON5, not JSON** | Unquoted keys, trailing commas. `JSON.parse()` fails silently. Always use `json5` package or `openclaw config get/set` CLI. |
| **`openclaw status` lies** | Reports cached config state, not real WebSocket health. Can show "OK" for hours after connection dies. Check Gateway logs for recent `[whatsapp] Listening...` entries instead. |
| **Sessions are sticky** | Once created (e.g., `agent:welcome:whatsapp:dm:+1555`), sessions persist until `/new`, `/reset`, or 4am daily expiry. A catch-all agent traps users in the wrong agent. |
| **`message_received` IS implemented** | Docs mislabel it as "Future Event" (that's internal hooks only). Plugin hooks (`api.on()`) support `message_received` — confirmed working in OpenClaw 2026.1.30 (Pattern 66). |
| **Sandbox `docker.env` is broken** | `buildSandboxCreateArgs()` in OpenClaw 2026.1.30 skips `params.cfg.env` entirely. Env vars defined in config never reach the container. Use `setupCommand` workaround. |
| **Sandbox schema is strict camelCase** | `pidsLimit` not `pids_limit`, `cpus: 0.5` (number) not `"0.5"` (string). No extra keys allowed. |
| **Sandbox ENTRYPOINT must not be `node`** | OpenClaw runs `sleep infinity` as CMD to keep sandbox alive, then `docker exec` for tools. `ENTRYPOINT ["node"]` makes it run `node sleep infinity` which crashes. |

### Docker & Deployment
| Gotcha | Detail |
|--------|--------|
| **Docker socket needs `group_add`** | Non-root container can't talk to daemon. Add `group_add: ["988"]` (docker GID on Hetzner). |
| **Docker API version mismatch** | Container client speaks 1.41, host daemon requires 1.44+. Fix: `DOCKER_API_VERSION=1.44` env var. |
| **`.env` must be in `docker/` dir** | Docker Compose reads `.env` from same directory as `docker-compose.yml`. Not the project root. |
| **`docker compose restart` keeps old image** | Only `up -d --force-recreate` or `down` + `up` picks up new images. |
| **Build cache serves stale JS** | Docker layer cache can keep old compiled TypeScript. Verify deployed code matches local: `docker exec ... head -15 /app/path/file.js`. |
| **Sandbox binds use HOST paths** | Docker daemon resolves bind mounts, not the container. Named volume paths don't exist on host. Use actual host filesystem paths. |

### Config & State
| Gotcha | Detail |
|--------|--------|
| **Template changes don't apply to existing volumes** | `openclaw.json.template` only used on first volume init. Live config needs `openclaw config set` or `node -e` with JSON5. This bit us 3+ times. |
| **`deploy.sh` doesn't fix live config** | Deploys code, not config. Config migrations are a separate step. Entrypoint handles some migrations but not all. |
| **grep doesn't work on JSON5** | `grep '"key"'` misses unquoted keys in JSON5. Always use `node -e` with `JSON5.parse()` for config inspection. |
| **SQLite: double quotes = column identifiers** | `datetime("now")` treats `"now"` as a column name. Always use single quotes: `datetime('now')`. |
| **`dmScope` must be set from first boot** | If `openclaw.json` doesn't exist when first agent is created, OpenClaw defaults to `dmScope: 'main'` — ALL DMs share one session. This caused our privacy breach. |
| **`dmScope` lives under `session`, not `gateway`** | Setting `gateway.dmScope` causes Gateway crash: `Unrecognized key: "dmScope"`. Correct location: `session.dmScope: 'per-channel-peer'`. Template has it right, but entrypoint migration got it wrong initially. |
| **In-flight messages dropped during Gateway restart** | SIGTERM kills the Gateway mid-LLM-request. Any message being processed is lost — no retry, no error to user. Observed: user's message at T+0 had no reply because gateway restarted at T+2s for another user's onboarding. |
| **Welcome agent duplication on restart** | Entrypoint's `grep -q '"welcome"'` failed on JSON5 (unquoted keys). **Fixed:** Replaced grep with `node -e` + JSON5.parse() and added deduplication logic. |

### OAuth (gog CLI)
| Gotcha | Detail |
|--------|--------|
| **`GOG_CONFIG_DIR` doesn't exist** | `gogcli` uses Go's `os.UserConfigDir()` which respects `XDG_CONFIG_HOME`, not `GOG_CONFIG_DIR`. 3 days wasted on this assumption. |
| **Read-only bind mount = "poison pill"** | Shared credentials at `/workspace/.config/gogcli/credentials.json` (read-only) breaks OAuth if gog falls back to default path. Use `XDG_CONFIG_HOME` to isolate. |
| **`setupCommand` vs tool exec have different HOME** | `setupCommand` runs via `docker create` (HOME=/root). Tool exec runs via `docker exec` with HOME=/workspace. Set HOME explicitly in setupCommand. |
| **OAuth tokens must be inside the volume** | Any path outside `don-claudio-state` is lost on container recreation. Tokens go in `~/.openclaw/agents/<id>/agent/.gog/`. |

---

## 8. Dual-Process Architecture

`launcher.js` spawns two processes with independent lifecycle:

| Process | Command | Purpose | Restart |
|---------|---------|---------|---------|
| Gateway | `node node_modules/openclaw/openclaw.mjs gateway --bind lan --port 18789` | WhatsApp routing, agent sessions, `onboarding-hook` plugin | Auto (max 3), counter resets to 0 on intentional SIGUSR1 restart |
| Onboarding | `node onboarding/dist/index.js` | Webhook API, agent creation, SQLite | Auto (max 3) |

**Inter-process communication:**
- Shared state: both read/write `~/.openclaw/openclaw.json`
- SIGUSR1: Onboarding → Launcher → SIGTERM Gateway → respawn (triggers restart for binding pickup)
- No RPC, no message bus

**Shutdown:** SIGTERM/SIGINT → graceful (5s timeout) → SIGKILL.

---

## 9. Operations & Debugging Playbook

```bash
# Deploy (WhatsApp auth survives in volume)
./scripts/deploy.sh

# Reset all user state for testing (preserves WhatsApp auth + welcome agent)
./scripts/reset-onboarding.sh

# SSH + logs
ssh root@135.181.93.227
cd /root/don-claudio-bot/docker && docker compose logs -f

# Re-authenticate WhatsApp (only if volume was deleted)
docker exec -it don-claudio-bot npx openclaw channels login

# Check agent count + bindings
docker exec don-claudio-bot node -e "
  const J=require('json5'),f=require('fs');
  const c=J.parse(f.readFileSync('/home/node/.openclaw/openclaw.json','utf-8'));
  console.log('agents:', c.agents.list.map(a=>a.id));
  console.log('bindings:', c.bindings.length);
"
```

**Debugging commands we actually use:**
```bash
# Is Gateway actually receiving messages? (don't trust `openclaw status`)
ssh root@135.181.93.227 'cd /root/don-claudio-bot/docker && docker compose logs --tail=30 2>&1 | grep "\[whatsapp\]"'

# What agents and bindings exist right now?
ssh root@135.181.93.227 'docker exec don-claudio-bot node -e "
  const J=require(\"json5\"),f=require(\"fs\");
  const c=J.parse(f.readFileSync(\"/home/node/.openclaw/openclaw.json\",\"utf-8\"));
  console.log(\"agents:\",c.agents.list.map(a=>a.id));
  console.log(\"bindings:\",JSON.stringify(c.bindings,null,2));
"'

# What's in the onboarding database?
ssh root@135.181.93.227 'docker exec don-claudio-bot sqlite3 /home/node/.openclaw/onboarding.db "SELECT phone_number, agent_id, status FROM onboarding_states;"'

# Plugin activity (onboarding-hook)
ssh root@135.181.93.227 'cd /root/don-claudio-bot/docker && docker compose logs --tail=30 2>&1 | grep "onboarding-hook"'

# Verify plugin is loaded
ssh root@135.181.93.227 'docker exec don-claudio-bot npx openclaw plugins list 2>/dev/null | grep onboarding'

# Full container restart (clears all in-memory state)
ssh root@135.181.93.227 'cd /root/don-claudio-bot/docker && docker compose restart'
```

**Cron Jobs:**
- Hourly: State reconciliation (cleanup orphaned agents)
- Daily 2am: OAuth expiry check (>90 days)
- Daily 3am: Backup to `don-claudio-state-backup` volume (retains 7)

---

## 10. Project Structure

```
DonClaudioBot/
├── launcher.js                     # Dual-process launcher (Gateway + Onboarding)
├── package.json                    # Root dependencies (OpenClaw 2026.1.30)
├── tsconfig.json
├── ARCHITECTURE_REPORT.md          # This file
│
├── onboarding/src/
│   ├── index.ts                    # Express server (webhook API)
│   ├── routes/
│   │   ├── webhook.ts              # POST /webhook/onboarding
│   │   └── state.ts                # GET /state, POST /update, /handover
│   ├── services/
│   │   ├── agent-creator.ts        # Creates agent: config + workspace + sandbox
│   │   ├── config-writer.ts        # Atomic openclaw.json updates (JSON5)
│   │   ├── state-manager.ts        # SQLite CRUD
│   │   └── session-watcher.ts      # DEPRECATED: kept as rollback reference
│   └── lib/
│       ├── validation.ts           # Zod schemas (phone, binding with .strict())
│       └── language-detector.ts    # Phone prefix → template language
│
├── config/
│   ├── openclaw.json.template      # Base config (welcome agent, dmScope, channels)
│   ├── phone-language-map.json     # Country code → template folder
│   ├── extensions/
│   │   └── onboarding-hook/        # message_received plugin (auto-onboarding)
│   └── agents/
│       ├── welcome/AGENTS.md       # Multilingual greeting, zero personal data
│       ├── dedicated-en/           # English "Mr Botly" (AGENTS.md, SOUL.md, MEMORY.md)
│       └── dedicated-es/           # Spanish "Don Claudio" (AGENTS.md, SOUL.md, MEMORY.md)
│
├── docker/
│   ├── Dockerfile                  # Main container (node:22-bookworm-slim)
│   ├── docker-compose.yml          # Volume, env, security hardening
│   └── docker-entrypoint.sh        # Config init + welcome agent migration
│
└── scripts/
    ├── deploy.sh                   # rsync + docker compose up --build
    └── reset-onboarding.sh         # 7-step reset for fresh testing
```

**State in volume (`don-claudio-state`):**
- `openclaw.json` — agents, bindings, channels
- `agents/<id>/` — per-agent state, sessions, auth
- `agents/<id>/agent/.gog/` — OAuth tokens (XDG_CONFIG_HOME isolated)
- `workspace-<id>/` — agent templates (AGENTS.md, SOUL.md, MEMORY.md)
- `onboarding.db` — SQLite (phone → agent_id mapping)

---

## 11. Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Framework | OpenClaw 2026.1.30 | npm dependency, not fork |
| Runtime | Node.js 22+ | ESM (imports need `.js` extensions) |
| Language | TypeScript 5+ | Strict mode |
| Database | SQLite (better-sqlite3) | WAL mode, 5s busy timeout |
| Config | JSON5 | OpenClaw's format (unquoted keys, comments) |
| Validation | Zod 3.22+ | .strict() on bindings |
| Container | Docker 24+ | compose v2, named volumes |
| OAuth | gog CLI | XDG_CONFIG_HOME for per-agent isolation |

---

## 12. Architecture Evolution

Each row is a design that failed and the pivot that replaced it. Read this to avoid re-inventing dead ends.

| # | What We Tried | Why It Failed | What Replaced It |
|---|---------------|---------------|------------------|
| 1 | **v1 "Clawd4All":** OAuth during onboarding conversation | Tokens persisted before sandbox existed. User 2+ never worked — tokens stored in user 1's context. | **v2:** Create agent + sandbox FIRST, then OAuth in that agent's context. |
| 2 | **LLM-driven onboarding agent** | Unpredictable, slow, fragile. Agent forgot steps, asked wrong questions, got stuck in loops. | **Deterministic Node.js service** with SQLite state. No LLM in the onboarding path. |
| 3 | **No default agent** (drop first message) | Users texted the bot and got silence. Confused, they stopped trying. Terrible UX. | **Welcome Agent** (zero personal data, multilingual). Immediate response while dedicated agent is created. |
| 4 | **Catch-all "onboarding" agent** with `default: true` | Sticky sessions trapped users. Once routed to onboarding agent, they stayed there even after dedicated agent was created. Sessions persist until `/new`, `/reset`, or 4am. | **Welcome Agent + Session Watcher.** Welcome agent has no personal data (safe if stuck). Session watcher auto-creates dedicated agent + SIGUSR1→Launcher IPC restarts Gateway. |
| 5 | **Baileys sidecar** to detect new users | WhatsApp allows only ONE WebSocket per phone. Baileys sidecar and Gateway fought for the connection — infinite reconnect loop, messages silently dropped. | **Session watcher** → then **`message_received` plugin** (Phase 12). Plugin fires instantly, ~35 lines, no polling. |
| 6 | **Hot reload for new bindings** (trust `fs.watch()`) | OpenClaw logs "config change applied" but `monitorWebChannel` captures config in a closure at startup. New bindings are invisible. We trusted the log message for hours. | **SIGUSR1→Launcher IPC Gateway restart** after each agent creation. Session watcher sends SIGUSR1 to launcher (parent PID), launcher SIGTERM→respawns gateway within 2s. Counter resets to 0 on intentional restart. |
| 7 | **`GOG_CONFIG_DIR` env var** for OAuth token isolation | This env var doesn't exist in gogcli. 3 days of circular debugging. gog uses Go's `os.UserConfigDir()` which only respects `XDG_CONFIG_HOME`. | **`XDG_CONFIG_HOME=/workspace/.gog-config`** — properly isolates each agent's OAuth tokens. |
| 8 | **Read-only bind mount** for shared OAuth credentials | "Poison pill" — when agents forgot `--client` flag, gog found the read-only file at default path and failed with cryptic error. | **Copy credentials via `setupCommand`**, set as default client. Agents run `gog auth add <email>` with zero flags. Fail-safe > agent memory. |

---

## 13. Battle Scars — Bugs That Shaped the Architecture

These aren't typos or config mistakes. These are the bugs that cost hours/days and permanently changed how the system works.

### The Privacy Breach (Pattern 59) — *Most painful*
**What happened:** Sebastian texted the bot. His messages were routed to JP's agent. Sebastian saw JP's personal info (name, email, phone number).
**Root cause:** `openclaw.json` didn't exist when JP's agent was created (first ever). OpenClaw defaulted to `dmScope: 'main'` — ALL DMs share one session. JP's agent became the catch-all.
**What changed:** Config is now created defensively at TWO points (deploy.sh + docker-entrypoint.sh). `dmScope: 'per-channel-peer'` is set from first boot. Zod `.strict()` validates all bindings before write.

### The 3-Day OAuth Spiral (Patterns 49-54) — *Most time wasted*
**What happened:** OAuth setup failed with cryptic errors. We tried `GOG_CONFIG_DIR`, `--client` flag, read-only bind mounts, per-client credentials, HOME path overrides — 15+ deployment attempts over 3 days.
**Root cause:** `GOG_CONFIG_DIR` doesn't exist in gogcli. The env var was assumed from naming patterns, never verified in source code.
**What changed:** We now use DeepWiki MCP to verify tool behavior before coding. `XDG_CONFIG_HOME` replaced all GOG_* env vars. "If it's not in the docs, don't use it."

### The WebSocket War (Pattern 37) — *Most confusing*
**What happened:** Gateway logs showed "Stream Errored (conflict)" in infinite loops. Messages silently dropped. `openclaw status` said "OK."
**Root cause:** Baileys sidecar and Gateway both opened WhatsApp WebSocket connections with the same credentials. WhatsApp allows one connection per phone — they fought endlessly.
**What changed:** Baileys sidecar removed entirely. Session watcher replaced it. Never run two Baileys connections with same credentials.

### The Stale Config Closure (Pattern 60) — *Most deceptive*
**What happened:** New agent binding written to config. Gateway logged "config change applied (dynamic reads: bindings)." But messages kept routing to welcome agent. We trusted the log for hours, tried clearing sessions, restarting services — nothing worked until full Gateway restart.
**Root cause:** We read OpenClaw's actual source code. `config-reload.ts:72` classifies bindings as `kind: "none"`. `monitorWebChannel` calls `loadConfig()` once at startup, captures it in a closure forever. The log message is technically correct ("dynamic reads: bindings") but misleading — the monitor never dynamically reads.
**What changed:** Session watcher sends SIGUSR1 to launcher (not directly to gateway — `npx` wrapper didn't propagate signals). Launcher does clean SIGTERM→respawn. We no longer trust "config change applied" log messages.

### Template ≠ Volume (Patterns 2, 39, 46) — *Most repeated*
**What happened:** Changed `openclaw.json.template`, deployed, nothing changed. Changed it again, deployed again, still nothing. This happened THREE separate times across different phases.
**Root cause:** Docker named volumes persist data. Template is only copied on first volume creation. `deploy.sh` deploys code, not config.
**What changed:** Entrypoint now handles migrations (e.g., adding welcome agent to existing config). We document that template changes need corresponding live config migrations. But it still bites us with new changes.

For all 65 patterns, see `findings.md`.
