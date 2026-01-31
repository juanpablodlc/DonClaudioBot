# CLAUDE.md

DonClaudioBot is a WhatsApp-based multi-user AI assistant service. Each user gets a sandboxed agent with Google OAuth (Gmail/Calendar). This is v2 — a complete redesign of Clawd4All that fixes the timing problem where OAuth happened before sandbox creation.

The key architectural fix: create agents with sandbox config FIRST, then do OAuth in that agent's context. OpenClaw is used as an npm dependency (not fork), and agents are created dynamically (no pre-provisioning). Onboarding is a deterministic Node.js service with some solution like SQLite (TBC), not solely LLM-driven instructions.

Deployment to Hetzner uses Docker with persistent volumes — so WhatsApp authentication survives code updates. The `.openclaw-reference/` folder contains OpenClaw source for docs only (gitignored). See ARCHITECTURE_REPORT.md sections 1-3 for v1 post-mortem and v2 architecture decisions. Use the QDM skill MCP below to always refer to the openclaw reference. 

## Which Doc to Read

| Question | Read This |
|----------|-----------|
| "What should I build?" | **ARCHITECTURE_REPORT.md** - Complete design (10 sections) |
| "How do I deploy?" | **DEPLOYMENT.md** - Hetzner deployment, volume persistence |
| "What's the context?" | **Git commit messages** - Run `git log -1` to see latest context |

**Context from v1:** See the ARchitecture report first sections. 

---

## Deployment Model

The Docker container runs OpenClaw Gateway and Onboarding Service together. State (WhatsApp auth, database, agent sessions) lives in a named volume `don-claudio-state` that persists across deployments. See `docker/docker-compose.yml` lines 13-16 and `DEPLOYMENT.md` sections "Code vs. State" and "What Survives Deployments".

---

## Architecture

OpenClaw Gateway handles WhatsApp routing and multi-agent sessions via `~/.openclaw/openclaw.json` (see `config/openclaw.json.template`). Onboarding Service (`onboarding/src/`) creates agents dynamically via OpenClaw CLI and tracks state in SQLite. Each user gets a sandboxed agent with isolated OAuth tokens at `~/.openclaw/agents/<id>/agent/.gog/`. See ARCHITECTURE_REPORT.md section 5 for the complete system diagram and section 7 for isolation strategy.

---

## File Index

```
onboarding/src/
├── index.ts              # Express entry point
├── routes/
│   ├── webhook.ts        # POST /webhook/onboarding (triggers agent creation)
│   └── state.ts          # GET /onboarding/state/:phone, POST /update, POST /handover
├── services/
│   ├── agent-creator.ts  # OpenClaw API wrapper (create agents via CLI or config)
│   └── state-manager.ts  # SQLite CRUD (onboarding state: phone → agent_id, status)
└── db/
    └── schema.sql        # Database schema placeholder

config/
├── openclaw.json.template  # OpenClaw config template
├── agents/
│   ├── onboarding/        # Onboarding agent templates (AGENTS.md, SOUL.md, MEMORY.md)
│   └── dedicated/         # Dedicated agent templates (same files)
└── sandbox/
    └── Dockerfile.sandbox # Sandbox image with gog CLI for Google OAuth

docker/
├── Dockerfile             # Main container (OpenClaw + Onboarding Service)
└── docker-compose.yml     # Defines don-claudio-state volume (preserves WhatsApp auth)

scripts/
├── setup.sh               # Initial setup
├── build.sh               # Build TypeScript + Docker image
└── deploy.sh              # Deploy to Hetzner (preserves volume)
```

---

## Gotchas

**Deploy freely:** Code updates don't affect WhatsApp auth (it's in volume `don-claudio-state`). Never run `docker volume rm don-claudio-state` unless you want to re-authenticate.

**Isolation:** Each agent has unique `GOG_KEYRING_PASSWORD` and token path. Never share `agentDir`. See ARCHITECTURE_REPORT.md section 7.

**Paths:** Host `/root/.openclaw/` mounts to container `/root/.openclaw/`. See `docker/docker-compose.yml` lines 13-19.

---

## Tools

**MCP: QMD** — Search Clawd4All v1 context: `mcp__qmd__vsearch(query="...", minScore=0.8)` (semantic) or `mcp__qmd__search(query="...")` (keyword).

**Skill: Karpathy** — Use before writing code to avoid over-engineering, ensure surgical changes, and define verifiable success criteria.

```bash
# Deploy code changes (WhatsApp stays authenticated)
./scripts/deploy.sh

# SSH to Hetzner
ssh root@135.181.93.227

# View logs
cd /root/don-claudio-bot && docker compose logs -f

# Check volume (where WhatsApp auth lives)
docker volume inspect don-claudio-state

# Re-authenticate WhatsApp (only if volume was deleted)
docker exec -it don-claudio-bot npx openclaw channels login
```
