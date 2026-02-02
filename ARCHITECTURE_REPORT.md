# DonClaudioBot v2 - Architecture Reference

**Version:** 2.11.0 | **Status:** Production Ready | **Updated:** 2026-02-01

---

## Executive Summary

DonClaudioBot is a WhatsApp-based multi-user AI assistant service where each user gets a sandboxed agent with Google OAuth (Gmail/Calendar). This is v2 — a complete redesign of Clawd4All that fixes the timing problem where OAuth happened before sandbox creation.

**v2 Key Fix:** Create agents with sandbox config FIRST, then do OAuth in that agent's context. OpenClaw is used as an npm dependency (not fork), and agents are created dynamically (no pre-provisioning). Onboarding is a deterministic Node.js service with SQLite state tracking, not LLM-driven instructions.

**Current Status:** 31/31 tasks completed, 59/59 verification steps passed. Total LOC: 1,909 across validation, database, API, infrastructure, observability, OAuth monitoring, maintenance, sandbox, and testing components.

---

## v1 Timing Bug (Why v2 Was Needed)

- **Problem:** OAuth happened before sandbox environment existed
- **Symptom:** User 002+ never worked; tokens stored in wrong location (user001's context)
- **Root Cause:** Pre-provisioning + migration pattern — OAuth completed in onboarding agent, then tokens migrated to dedicated agent
- **v1 Commit Thrash:** 17+ commits claimed to fix paths/mounts but never addressed the timing issue
- **v2 Fix:** Create agent + sandbox config first, add binding, THEN OAuth happens in target agent context

### v1 vs v2 Comparison

| Aspect | v1 (Clawd4All) | v2 (DonClaudioBot) |
|--------|----------------|-------------------|
| Agent provisioning | 100 pre-provisioned upfront | Dynamic, on-demand |
| Onboarding trigger | LLM-driven AGENTS.md | Deterministic service |
| OAuth timing | Before sandbox config | After sandbox exists |
| Token storage | Migrated from user001 | In target agent from start |
| State management | Complex bash scripts | SQLite database |
| OpenClaw integration | Custom fork | npm dependency |
| Updates | Merge conflicts | `npm update` |
| Complexity | High (27 scripts) | Low (~500 lines service) |

---

## Onboarding Flow

1. Unknown WhatsApp message received (Baileys sidecar listeners)
2. Baileys calls `POST /webhook/onboarding` with phone number
3. Webhook validates E.164 format and auth token (HOOK_TOKEN)
4. Check SQLite for existing state (idempotent if exists)
5. Generate unique agentId (`user_<16hex>`) and GOG_KEYRING_PASSWORD
6. Create dedicated agent via OpenClaw CLI with sandbox config
7. Update OpenClaw config with new agent binding
8. Store state in SQLite (phone, agent_id, status='new')
9. Gateway reloads config (hot-reload supported)
10. User gets dedicated agent with Google OAuth prompt

**API Endpoints:**
- `POST /webhook/onboarding` — Triggers agent creation (protected by HOOK_TOKEN)
- `GET /onboarding/state/:phone` — Get current onboarding status
- `POST /onboarding/update` — Update user details (name, email)
- `POST /onboarding/handover` — Transition to 'completed' status

### State Transitions

```
NEW → PENDING_WELCOME → COLLECTING_INFO → READY_FOR_HANDOVER → COMPLETE → ACTIVE
  ↓                                    ↓
ALREADY_ONBOARDED                  CANCELLED
```

| Status | Description | Next States |
|--------|-------------|-------------|
| `new` | Initial state, agent created | `pending_welcome` |
| `pending_welcome` | Welcome message queued | `collecting_info` |
| `collecting_info` | Gathering name/email | `ready_for_handover`, `cancelled` |
| `ready_for_handover` | Awaiting user message | `complete` |
| `complete` | Handover done | `active` |
| `active` | Normal operation | — (terminal) |
| `cancelled` | User abandoned | — (terminal) |

### Error Handling Strategy

The onboarding flow has 4 atomic steps: CLI call → config update → gateway reload → database write. If any step fails, rollback in reverse order.

| Failure Mode | Severity | Recovery |
|--------------|----------|----------|
| CLI call fails (OpenClaw not installed) | Critical | Abort - Return error to user |
| Agent ID already exists | High | Idempotent - Return existing agent |
| Config file locked | High | Retry with backoff (1s, 2s, 5s) |
| Config write fails (disk full) | Critical | Rollback - Delete agent, alert ops |
| Gateway reload fails | High | Rollback - Remove from config, delete agent |
| Database write fails | Critical | Rollback - Remove config, delete agent |
| UNIQUE violation (phone) | High | Idempotent - Return existing agent |
| Container crash mid-onboarding | High | Reconciliation - Cleanup job on restart |

**Transactional Pattern:** Flags track `agentCreated` and `configUpdated`. On error: restore config backup (if updated), then `openclaw agents remove` (if created).

---

## Key Architectural Decisions

| DP | Resolution | Rationale |
|----|------------|-----------|
| DP1 | CLI wrapper for OpenClaw | Documented interface, fast enough for initial scale |
| DP2 | Baileys sidecar → webhook | `message:received` not implemented upstream; `command:new` hook triggers webhook |
| DP3 | SQLite with WAL + UNIQUE constraints | Single-file, in-process, concurrent readers, audit trail |
| DP4 | OAuth-in-Sandbox via `setupCommand` + `network:bridge` | OpenClaw-documented pattern; v1 proved gog works (bug was timing) |
| DP5 | WAL mode + 5s timeout + UNIQUE constraints | Handles concurrent webhook requests atomically |
| DP6 | Transactional rollback pattern | Reverse-order cleanup on any step failure |
| DP7 | Shared HOOK_TOKEN, no docker.sock in sandboxes, file permissions 700/600 | Minimal viable security for Phase 1 |

---

## Components (Reference IMPLEMENTATION_PLAN.json for details)

| Component | Files | Status |
|-----------|-------|--------|
| **Validation** | `onboarding/src/lib/validation.ts`, `phone-normalizer.ts` | ✅ P0-001, P1-001 (50 LOC) |
| **Database** | `onboarding/src/db/schema.sql`, `state-manager.ts` | ✅ P0-002, P0-003 (199 LOC) |
| **Onboarding API** | `routes/webhook.ts`, `routes/state.ts`, `index.ts`, `agent-creator.ts` | ✅ P0-004/007/008/010/011, P1-002 (366 LOC) |
| **Infrastructure** | `config/openclaw.json.template`, `docker/Dockerfile`, `docker-compose.yml`, `.env.example` | ✅ P0-009/013/015 (253 LOC) |
| **Observability** | `baileys-sidecar.ts`, `audit-logger.ts` | ✅ P1-003/004/007 (259 LOC) |
| **OAuth Monitoring** | `oauth-monitor.ts`, `cron-setup.sh` | ✅ P1-005/011 (218 LOC) |
| **Maintenance** | `state-reconciliation.ts`, `backup.sh` | ✅ P1-006/009 (210 LOC) |
| **Sandbox** | `sandbox-validator.ts`, `Dockerfile.sandbox`, `build-sandbox.sh` | ✅ P1-008, P2-001/003/004 (129 LOC) |
| **Testing** | `__tests__/onboarding.flow.test.ts`, vitest config | ✅ P0-012/014/016, P2-002 (225 LOC) |

**Total LOC:** 1,909 | **Tasks:** 31 | **Verification Steps:** 59

### Database Schema Summary

**File:** `onboarding/src/db/schema.sql`

**Core Table: `onboarding_states`**
- `phone_number` TEXT UNIQUE — E.164 format, validated by Zod
- `agent_id` TEXT UNIQUE — Format: `user_[a-zA-Z0-9_-]+`
- `status` TEXT — Enum: new, pending_welcome, collecting_info, ready_for_handover, complete, active, cancelled
- `name`, `email` TEXT — Optional user details
- `created_at`, `updated_at` TEXT — Auto-managed timestamps
- `expires_at` TEXT — NULL for active users, +24h for new states

**Audit Table: `state_transitions`**
- Logs all status changes for debugging

**Indexes:**
- `idx_phone_lookup` — Partial on `WHERE status != 'cancelled'`
- `idx_agent_lookup` — Full on agent_id
- `idx_expiration` — Partial on `WHERE expires_at IS NOT NULL`

**Constraints:**
- WAL mode enabled (concurrent readers)
- FOREIGN KEYS with CASCADE delete
- 5-second busy timeout for locks

---

## System Architecture

```
Hetzner VPS
└── Docker Compose
    ├── DonClaudioBot Container
    │   ├── OpenClaw Gateway (npm dependency)
    │   │   ├── WhatsApp channel
    │   │   ├── Multi-agent routing
    │   │   └── Session management
    │   └── Onboarding Service (sidecar)
    │       ├── Creates agents via OpenClaw API
    │       ├── Manages SQLite state
    │       └── Exposes webhook for Baileys
    ├── Per-Agent Sandbox Containers
    │   ├── user001 (onboarding)
    │   ├── user002, user003, ... (dedicated)
    │   └── Each with isolated gog CLI + OAuth
    └── State Volume: ~/.openclaw/
        ├── openclaw.json (config)
        ├── agents/<id>/ (per-agent state)
        └── onboarding.db (SQLite)
```

**Deployment Model:** Code updates don't affect WhatsApp auth (stored in named volume `don-claudio-state`). Never run `docker volume rm don-claudio-state` unless re-authenticating.

### Technology Stack

| Component | Technology | Version/Notes |
|-----------|-----------|---------------|
| **Framework** | OpenClaw | Latest via npm (not forked) |
| **Runtime** | Node.js | 22+ |
| **Language** | TypeScript | 5+ |
| **Database** | SQLite | 3.x (better-sqlite3 package) |
| **Container** | Docker | 24+ with compose |
| **Validation** | Zod | 3.22+ for schema validation |
| **Web Framework** | Express | 4.19+ |
| **Testing** | Vitest + Supertest | Integration tests |
| **OAuth Tool** | gog CLI | Installed from GitHub releases |

**Update Strategy:** `npm update openclaw@latest` → rebuild → redeploy (no merge conflicts)

---

## Docker Infrastructure

| Component | Configuration |
|-----------|---------------|
| **Main Container** | `node:22-bookworm-slim`, non-root user (UID/GID configurable) |
| **Security** | `cap_drop: [ALL]`, `no-new-privileges:true`, `read_only: true` with tmpfs |
| **Persistence** | Named volume `don-claudio-state` survives deployments |
| **Sandbox Image** | `openclaw-sandbox:bookworm-slim` with gog CLI, 512MB memory, 0.5 CPU, 100 pids limit |
| **Isolation** | Unique `GOG_KEYRING_PASSWORD` per agent, token path: `~/.openclaw/agents/<id>/agent/.gog/` |

---

## Security Hardening

### Five-Layer Isolation Model

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Channel-Level Security                                 │
│ - WhatsApp allowlist (only allowlisted phones can message)     │
│ - dmPolicy: "allowlist" (reject unknown numbers)               │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Routing Isolation                                      │
│ - Bindings: each phone → specific agent                        │
│ - dmScope: "per-channel-peer" (isolated sessions)              │
│ - Sessions: ~/.openclaw/agents/<id>/sessions/                  │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Workspace Isolation                                    │
│ - Each agent has own workspace                                  │
│ - ~/.openclaw/workspace-<id>/                                  │
│ - AGENTS.md, SOUL.md, MEMORY.md per agent                      │
├─────────────────────────────────────────────────────────────────┤
│ Layer 4: Auth Isolation                                         │
│ - Per-agent auth directory                                     │
│ - ~/.openclaw/agents/<id>/agent/auth-profiles.json             │
│ - Google tokens stored here, not shared                        │
├─────────────────────────────────────────────────────────────────┤
│ Layer 5: Sandbox Isolation                                      │
│ - Per-agent Docker container                                    │
│ - Unique GOG_KEYRING_PASSWORD per agent                        │
│ - Read-only token mounts, network: bridge                      │
│ - No privileged mode                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Critical (Implemented):**
- Webhook authentication via `HOOK_TOKEN` middleware (401/403 responses)
- Zod validation for E.164 phone format and agent IDs
- Parameterized SQLite queries (no SQL injection)
- Rate limiting: 15 requests per 15 minutes on webhook (express-rate-limit)
- Audit logging: structured JSON for agent creation, config changes, token access
- Sandbox validation: privileged=false, capDrop exists, no docker.sock bind

**Per-Agent Isolation:**
- Each agent gets unique `GOG_KEYRING_PASSWORD` (auto-generated 16-char hex)
- OAuth tokens stored in `~/.openclaw/agents/<agent_id>/agent/.gog/`
- Session isolation via `dmScope: "per-channel-peer"`

---

## Verification & Operations

```bash
# Build TypeScript
npm run build

# Run tests (vitest + supertest)
npm test

# Deploy to Hetzner (preserves WhatsApp auth)
./scripts/deploy.sh

# SSH to Hetzner
ssh root@135.181.93.227

# View logs
cd /root/don-claudio-bot && docker compose logs -f

# Test webhook locally
curl -X POST http://127.0.0.1:3000/webhook/onboarding \
  -H "Authorization: Bearer $HOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+15551234567"}'

# Re-authenticate WhatsApp (only if volume deleted)
docker exec -it don-claudio-bot npx openclaw channels login
```

### OpenClaw CLI Reference

```bash
# Agent management
openclaw agents add <name>              # Create new agent
openclaw agents list --bindings         # List agents with bindings
openclaw agents remove <id>             # Remove agent

# Gateway management
openclaw gateway reload                 # Apply config changes
openclaw gateway status                 # Check if running

# Channels
openclaw channels login                 # Authenticate WhatsApp
openclaw channels status                 # Check channel connection

# Sandbox
openclaw sandbox list                   # List sandbox containers
openclaw sandbox recreate <id>          # Recreate sandbox
```

**Cron Jobs (setup via `scripts/cron-setup.sh`):**
- Hourly: State reconciliation (cleanup orphaned agents/stale states)
- Daily 2am: OAuth expiry check (>90 days)
- Daily 3am: Backup to `don-claudio-state-backup` volume (retains 7)

---

## Deployment Checklist Highlights

For complete runbook, see `docs/DEPLOYMENT_CHECKLIST.md` (654 LOC).

**Pre-deployment:**
- [ ] Verify `.env` contains HOOK_TOKEN, WhatsApp credentials
- [ ] Build sandbox image: `./scripts/build-sandbox.sh`
- [ ] Test webhook endpoint with valid/invalid tokens

**Rollback Procedure:**
- [ ] `git revert` or checkout previous commit
- [ ] `./scripts/deploy.sh` (volume preserves auth)
- [ ] Verify logs: `docker compose logs -f`

**Failure Scenarios:**
- Webhook 401/403 → Check HOOK_TOKEN in `.env`
- Agent creation fails → Check OpenClaw CLI: `npx openclaw agents list`
- OAuth fails → Verify `setupCommand` in sandbox config, check network mode
- Container won't start → Check `cap_drop` conflict with Docker socket (whitelist DAC_OVERRIDE, SETGID, SETUID if needed)

---

## Project Structure

```
DonClaudioBot/
├── .gitignore                      # OpenClaw reference excluded
├── .openclaw-reference/            # OpenClaw source (docs only, gitignored)
├── package.json                    # Root dependencies
├── tsconfig.json                   # TypeScript config
├── ARCHITECTURE_REPORT.md          # This file
├── IMPLEMENTATION_PLAN.json        # Task list, file inventory, LOC
│
├── onboarding/                     # Onboarding service
│   ├── src/
│   │   ├── index.ts                # Express server entry point
│   │   ├── routes/
│   │   │   ├── webhook.ts          # POST /webhook/onboarding endpoint
│   │   │   └── state.ts            # GET /onboarding/state, POST /update, /handover
│   │   ├── middleware/
│   │   │   └── webhook-auth.ts     # HOOK_TOKEN validation
│   │   ├── services/
│   │   │   ├── agent-creator.ts    # OpenClaw CLI wrapper + rollback
│   │   │   ├── state-manager.ts    # SQLite CRUD operations
│   │   │   ├── config-writer.ts    # Atomic openclaw.json updates
│   │   │   ├── baileys-sidecar.ts  # Auto-onboarding trigger
│   │   │   ├── oauth-monitor.ts    # Token expiry checking
│   │   │   ├── state-reconciliation.ts  # Cleanup orphaned agents
│   │   │   └── audit-logger.ts     # Security event logging
│   │   ├── lib/
│   │   │   ├── validation.ts       # Zod schemas
│   │   │   ├── phone-normalizer.ts # E.164 formatting
│   │   │   └── sandbox-validator.ts # Security checks
│   │   ├── db/
│   │   │   └── schema.sql          # SQLite database schema
│   │   └── __tests__/
│   │       └── onboarding.flow.test.ts
│   ├── package.json
│   └── tsconfig.json
│
├── config/                         # OpenClaw configurations
│   ├── openclaw.json.template      # Base template
│   ├── agents/
│   │   ├── onboarding/             # Onboarding agent templates
│   │   │   ├── AGENTS.md
│   │   │   ├── SOUL.md
│   │   │   └── MEMORY.md
│   │   └── dedicated/              # Dedicated agent templates
│   │       ├── AGENTS.md
│   │       ├── SOUL.md
│   │       └── MEMORY.md
│   └── sandbox/
│       └── Dockerfile.sandbox      # Custom sandbox with gog CLI
│
├── scripts/                        # Deployment & utility scripts
│   ├── setup.sh                    # Initial setup
│   ├── build.sh                    # Build TypeScript + Docker
│   ├── deploy.sh                   # Deploy to Hetzner
│   ├── build-sandbox.sh            # Build sandbox image
│   ├── backup.sh                   # Backup state volume
│   └── cron-setup.sh               # Configure cron jobs
│
├── docker/
│   ├── Dockerfile                  # Main container image
│   └── docker-compose.yml          # Compose configuration
│
└── docs/
    ├── DEPLOYMENT_CHECKLIST.md     # Production runbook
    └── ONBOARDING_TRIGGER.md       # Baileys investigation
```

**State Storage (in container at ~/.openclaw/):**
- `openclaw.json` — Main config (agents, bindings, channels)
- `agents/<id>/agent/` — Per-agent auth and sessions
- `agents/<id>/agent/.gog/` — OAuth tokens (isolated per user)
- `onboarding.db` — SQLite state database

---

## References

- **IMPLEMENTATION_PLAN.json** — Complete task list, file inventory, LOC counts
- **.openclaw-reference/** — OpenClaw framework docs (search via `mcp__qmd__search` or `mcp__qmd__vsearch`)
- **docs/DEPLOYMENT_CHECKLIST.md** — Production runbook with step-by-step procedures
- **CLAUDE.md** — Developer workflow and project conventions

---

## Quick Start for New Developers

1. **Read this file** (5 minutes) — Understand v2 architecture and v1 bug
2. **Read IMPLEMENTATION_PLAN.json** — See what was built, file locations, LOC
3. **Explore codebase** — See "Project Structure" section above
4. **Search OpenClaw docs:** `mcp__qmd__search(query="agent creation")` for narrow/focused terms
5. **Deploy changes:** `./scripts/deploy.sh` — WhatsApp auth survives in volume

**Gotchas:**
- OAuth must happen AFTER agent creation (timing bug from v1)
- Don't share `GOG_KEYRING_PASSWORD` between agents
- Host path `/root/.openclaw/` mounts to container `/root/.openclaw/`
- Use `execFile()` not `exec()` for CLI calls (command injection prevention)
- Never run `docker volume rm don-claudio-state` unless re-authenticating WhatsApp
