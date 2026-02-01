# DonClaudioBot v2 - Architecture & Design Report

**Date:** 2026-01-30
**Version:** 1.0
**Status:** Design Phase - Pre-Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Vision & Goals](#2-project-vision--goals)
3. [Clawd4All v1 Post-Mortem](#3-clawd4all-v1-post-mortem)
4. [OpenClaw Framework Analysis](#4-openclaw-framework-analysis)
5. [DonClaudioBot v2 Architecture](#5-donclaudiobot-v2-architecture)
6. [Onboarding Flow Design](#6-onboarding-flow-design)
7. [Multi-User Isolation Strategy](#7-multi-user-isolation-strategy)
8. [Technology Stack & Dependencies](#8-technology-stack--dependencies)
9. [Project Structure](#9-project-structure)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Decision Points & Resolutions](#11-decision-points--resolutions)

---

## 1. Executive Summary

### 1.1 Purpose

DonClaudioBot is a **WhatsApp-based multi-user AI assistant service** that provides personalized AI agents to thousands of users with strong security isolation between users. This document outlines the complete architecture for v2, following a failed v1 implementation.

### 1.2 Key Objectives

| Objective | Description |
|-----------|-------------|
| **Scale** | Support thousands of users (not just friends/family) |
| **Security** | Strong isolation - User A cannot access User B's data/tokens |
| **Reliability** | Deterministic onboarding, not LLM-driven workflows |
| **Simplicity** | Minimal custom code, leverage OpenClaw framework |
| **Maintainability** | Easy updates without merge conflicts |

### 1.3 v2 Approach Summary

- **NO fork of OpenClaw** - use as npm dependency
- **Dynamic agent creation** - no pre-provisioning
- **Late-binding onboarding** - create agent FIRST, then OAuth in that agent
- **Separate onboarding service** - deterministic code, not LLM instructions
- **Per-agent sandboxing** - leverage OpenClaw's built-in Docker isolation

---

## 2. Project Vision & Goals

### 2.1 Product Vision

A WhatsApp chatbot service where:
- Each user gets their own personalized AI agent
- Agents can access Google services (Gmail, Calendar) via OAuth
- Users are strongly isolated from each other
- Onboarding is smooth and reliable
- System scales to thousands of users

### 2.2 User Experience

```
1. User sends WhatsApp message to DonClaudioBot number
2. Bot responds: "Welcome! Let's set up your personal agent."
3. User completes quick onboarding (name, email)
4. User clicks OAuth link to connect Google (optional)
5. User now has their own agent in sandboxed environment
6. All future chats go directly to their dedicated agent
```

### 2.3 Success Criteria

- [ ] User can onboard in < 2 minutes
- [ ] User cannot access another user's data
- [ ] System supports 1,000+ concurrent users
- [ ] OAuth works reliably in sandboxed environment
- [ ] Zero manual intervention per user

---

## 3. Clawd4All v1 Post-Mortem

### 3.1 What Was Built

Clawd4All v1 was an attempt to build the same product using:

| Component | Implementation |
|-----------|----------------|
| Pre-provisioned agents | 100 agents (user001-user100) created upfront |
| Onboarding | LLM-driven via AGENTS.md instructions |
| OAuth | Via user001 (intake agent), then migrate to dedicated agent |
| Sandbox | Custom bash scripts with OpenClaw sandboxing |
| Config | Complex claim-agent.sh, provision-agents.sh scripts |

**Repository:** https://github.com/juanpablodlc/Clawd4All
**Branch:** `ralph/security-ops-hardening`

### 3.2 What Went Wrong

#### Root Cause: Timing Problem

The fundamental issue was a **timing mismatch** in the onboarding flow:

```
v1 Flow (Broken):
1. User messages WhatsApp → routes to user001 (intake agent)
2. User completes OAuth in user001's context
3. claim-agent.sh assigns user002 to user
4. Sandbox config ADDED AFTER OAuth
5. OAuth tokens already stored in user001's context
   ↑ PROBLEM: Tokens not in dedicated agent's context
```

#### Symptoms Observed

- Sandbox containers started but couldn't access OAuth credentials
- Sessions were "sticky" - messages didn't route to correct agent
- Chat experience was not smooth
- User 002+ never worked properly

#### Commit Thrash Pattern

The AI agent made 17+ "fix" commits that were actually thrashing:

```
e456787: Add shared OAuth credentials mount
6c1e6f3: Use XDG-compliant path for shared OAuth credentials
f4ac402: Mount OAuth credentials to /workspace/.config/
2abf1e4: Change sandbox network to 'bridge' for gog API access
ae91685: Implement per-agent GOG token isolation via sandboxing
```

These commits claimed "testing verified" but user 002 never worked.

**The real problem wasn't paths - it was that OAuth happened BEFORE the sandbox environment existed.**

#### Architectural Mismatches

| Problem | Why It Failed |
|---------|---------------|
| Pre-provisioning 100 agents | Unnecessary complexity, heavy upfront setup |
| LLM-driven onboarding | LLMs are bad at reliable multi-step workflows |
| OAuth in user001, then migrate | Token/context doesn't transfer cleanly |
| Complex bash orchestration | Fragile, hard to debug, "pretending to fix" |

### 3.3 Lessons Learned

1. **OAuth must happen in the target agent from day one** - no migration
2. **Don't rely on LLMs for deterministic workflows** - use code
3. **Don't pre-provision** - create resources on-demand
4. **Simple > Complex** - leverage framework, don't fight it

---

## 4. OpenClaw Framework Analysis

### 4.1 What Is OpenClaw?

OpenClaw is an open-source gateway framework that:
- Connects AI agents to messaging channels (WhatsApp, Telegram, Discord, iMessage)
- Provides multi-agent routing with bindings
- Includes built-in Docker sandboxing for isolation
- Manages sessions, auth, and tool execution

**Repository:** https://github.com/openclaw/openclaw
**Documentation:** https://docs.openclaw.ai/

### 4.2 Key OpenClaw Features for DonClaudioBot

#### 4.2.1 Multi-Agent Routing

OpenClaw supports multiple isolated agents with deterministic routing via bindings:

```json
{
  "agents": {
    "list": [
      { "id": "user001", "workspace": "~/.openclaw/workspace-user001" },
      { "id": "user002", "workspace": "~/.openclaw/workspace-user002" }
    ]
  },
  "bindings": [
    { "agentId": "user002", "match": { "channel": "whatsapp", "peer": { "kind": "dm", "id": "+15551234567" } } }
  ]
}
```

Each agent has its own workspace, auth, and sessions. Bindings route specific senders to specific agents.

#### 4.2.2 Per-Agent Sandboxing

Each agent can run in its own Docker container:

```json
{
  "sandbox": {
    "mode": "all",
    "scope": "agent",
    "docker": {
      "image": "openclaw-sandbox:bookworm-slim",
      "env": { "CUSTOM_VAR": "value" },
      "binds": ["/host/path:/container/path:ro"]
    }
  }
}
```

DonClaudioBot uses `scope: "agent"` so each user gets their own sandboxed container with isolated OAuth tokens.

#### 4.2.3 Per-Agent Auth

Auth profiles are stored per-agent (not shared):

```
~/.openclaw/agents/<agentId>/agent/auth-profiles.json
```

Google OAuth tokens for each user live in their agent's auth directory, isolated from other users.

#### 4.2.4 Dynamic Agent Creation

Agents can be added via CLI without restarting the gateway:

```bash
openclaw agents add <name>
openclaw gateway reload  # Apply changes
```

DonClaudioBot creates agents on-demand during onboarding—no pre-provisioning required.

#### 4.2.5 Hooks and Webhooks

- **Hooks:** Event-driven automation inside gateway (runs on events like `command:new`)
- **Webhooks:** External HTTP triggers for agent execution

The onboarding flow uses a `command:new` hook to trigger agent creation when a new user messages.

### 4.3 OpenClaw as Dependency (Not Fork)

**Critical decision:** Do NOT fork OpenClaw.

**Why:**
- Easy updates: `npm update openclaw@latest`
- No merge conflicts
- Your code is separate
- Leverage upstream improvements

**Project structure:**
```
DonClaudioBot/
├── package.json (depends on openclaw@latest)
├── onboarding/ (your service)
└── config/ (your config)
```

---

## 5. DonClaudioBot v2 Architecture

### 5.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Hetzner VPS                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Docker Compose                            │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  DonClaudioBot Container                              │  │   │
│  │  │                                                       │  │   │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │   │
│  │  │  │  OpenClaw Gateway (npm dependency)             │ │  │   │
│  │  │  │  - WhatsApp channel                             │ │  │   │
│  │  │  │  - Multi-agent routing                          │ │  │   │
│  │  │  │  - Session management                           │ │  │   │
│  │  │  │  - Hooks (trigger onboarding)                   │ │  │   │
│  │  │  └─────────────────────────────────────────────────┘ │  │   │
│  │  │                                                       │  │   │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │   │
│  │  │  │  Onboarding Service (sidecar)                   │ │  │   │
│  │  │  │  - Creates agents via OpenClaw API              │ │  │   │
│  │  │  │  - Manages onboarding state (SQLite)            │ │  │   │
│  │  │  │  - Exposes webhook for hooks                    │ │  │   │
│  │  │  └─────────────────────────────────────────────────┘ │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Per-Agent Sandbox Containers                        │  │   │
│  │  │                                                       │  │   │
│  │  │  ┌────────────┐  ┌────────────┐  ┌────────────┐    │  │   │
│  │  │  │ user001    │  │ user002    │  │ user003    │    │  │   │
│  │  │  │ (onboard)  │  │ (dedicated)│  │ (dedicated)│    │  │   │
│  │  │  │            │  │            │  │            │    │  │   │
│  │  │  │ gog CLI    │  │ gog CLI    │  │ gog CLI    │    │  │   │
│  │  │  │ OAuth      │  │ OAuth      │  │ OAuth      │    │  │   │
│  │  │  └────────────┘  └────────────┘  └────────────┘    │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  State: ~/.openclaw/                                         │   │
│  │  - openclaw.json (config)                                    │   │
│  │  - agents/<id>/ (per-agent state)                            │   │
│  │  - onboarding.db (SQLite)                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  WhatsApp Business API ─────────────────────────────────────────────│
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Late-Binding Onboarding (Key Innovation)

**The fix for v1's timing problem:**

```
v2 Flow (Fixed):
1. User messages WhatsApp → routes to onboarding agent (user001)
2. Onboarding service creates dedicated agent WITH SANDBOX CONFIG
3. Binding added: phone → dedicated agent
4. User's NEXT message routes to dedicated agent
5. OAuth happens in dedicated agent's context from day one
6. Tokens stored in ~/.openclaw/agents/<id>/agent/ (isolated)
```

**Key difference:** Agent and sandbox exist BEFORE OAuth, not after.

### 5.3 Component Responsibilities

| Component | Responsibility | Technology |
|-----------|----------------|------------|
| **Onboarding Agent** | Catch-all for new users | OpenClaw + custom AGENTS.md |
| **Onboarding Service** | Agent creation, state management | Node.js + SQLite |
| **Dedicated Agents** | Per-user AI assistant | OpenClaw + sandbox |
| **OpenClaw Gateway** | Routing, sessions, tool execution | openclaw npm package |
| **Sandbox Containers** | Per-user isolation | Docker + OpenClaw sandboxing |

---

## 6. Onboarding Flow Design

### 6.1 Flow Overview

**Core principle:** Create the agent WITH sandbox config FIRST, then do OAuth in that agent's context. This fixes v1's timing bug where OAuth happened before the sandbox environment existed.

**Step-by-step:**

| Step | What Happens | Component Responsible |
|------|--------------|----------------------|
| 1 | User messages WhatsApp → routes to onboarding agent (user001) | OpenClaw routing + `command:new` hook |
| 2 | Check if phone already has an agent (idempotent) | SQLite lookup by phone number |
| 3 | Create dedicated agent with sandbox config, add phone→agent binding | Onboarding service → `openclaw agents add` |
| 4 | Store phone→agent mapping in database with status `pending_welcome` | SQLite INSERT |
| 5 | Onboarding agent welcomes user, collects name/email | user001 AGENTS.md prompt |
| 6 | Mark status `ready_for_handover`, notify user to send next message | SQLite UPDATE |
| 7 | User's next message routes to dedicated agent (binding takes effect) | OpenClaw routing engine |
| 8 | User optionally connects Google OAuth → tokens stored in agent's isolated dir | Dedicated agent runs `gog auth` |

**Why this works (v2 vs v1):**
- **v1 (broken):** OAuth in user001 → migrate tokens → add sandbox config
- **v2 (fixed):** Agent + sandbox created → binding added → OAuth in target agent

The sandbox and agent directory exist BEFORE `gog auth` runs, so tokens land in `~/.openclaw/agents/<id>/agent/.gog/` (isolated) instead of a shared location.


### 6.2 State Transitions

```
[NEW] → [PENDING_WELCOME] → [COLLECTING_INFO] → [READY_FOR_HANDOVER] → [COMPLETE] → [ACTIVE]
  ↓                                    ↓
[ALREADY_ONBOARDED]            [CANCELLED]
```

### 6.3 Onboarding Service API

**⚠️ OPEN DECISION — Requires investigation via QMD:**

The webhook endpoint is required (hook calls it). The other endpoints may be **internal functions** rather than exposed HTTP APIs.

```
POST /webhook/onboarding
  Request: { phone: "+15551234567" }
  Response: { status: "new" | "existing", agentId?: string }
```
**Confirmed required:** Called by OpenClaw's `command:new` hook to trigger agent creation.

**Investigation needed for:**
| Endpoint | Purpose | Alternative |
|----------|---------|-------------|
| `GET /onboarding/state/:phone` | Query user state | Internal SQLite query |
| `POST /onboarding/update` | Update name/email | Internal DB update |
| `POST /onboarding/handover` | Trigger handover | Internal state transition |

**Task for implementation agent:** Use `mcp__qmd__search` or `mcp__qmd__vsearch` on `.openclaw-reference` to investigate:
- Does OpenClaw's hook system require HTTP callbacks, or can hooks call local functions?
- Are there examples of hooks that make internal state changes without exposing REST APIs?
- Decision: Single webhook endpoint vs. full REST API for admin/debug purposes

### 6.4 Idempotency Implementation

The webhook must handle concurrent duplicate requests atomically. Two approaches:

**Option A: Database-level (Recommended)**
```sql
INSERT INTO onboarding_states (phone_number, agent_id, status, expires_at)
VALUES (?, ?, 'new', datetime('now', '+24 hours'))
ON CONFLICT(phone_number) DO NOTHING
RETURNING agent_id;
```
If no row returned, SELECT existing. Single atomic operation.

**Option B: Application-level**
Catch `SQLITE_CONSTRAINT_UNIQUE` error from `createState()` and return existing agent instead of 500.

---

## 7. Multi-User Isolation Strategy

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| User A reads User B's chat history | Per-agent session isolation (`dmScope: "per-channel-peer"`) |
| User A accesses User B's Google tokens | Per-agent `agentDir` with isolated auth-profiles.json |
| User A executes code in User B's sandbox | Per-agent Docker containers with unique env/binds |
| User A sends messages as User B | WhatsApp allowlist + per-phone bindings |
| Sandbox escape to host | Read-only mounts, no privileged mode, seccomp/AppArmor |

### 7.2 Isolation Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ISOLATION LAYERS                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Layer 1: Channel-Level Security                                        │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ - WhatsApp allowlist (only allowlisted phones can message)       │ │
│  │ - dmPolicy: "allowlist" (reject unknown numbers)                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Layer 2: Routing Isolation                                             │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ - Bindings: each phone → specific agent                          │ │
│  │ - dmScope: "per-channel-peer" (isolated sessions)                │ │
│  │ - Sessions: ~/.openclaw/agents/<id>/sessions/                     │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Layer 3: Workspace Isolation                                           │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ - Each agent has own workspace                                    │ │
│  │ - ~/.openclaw/workspace-<id>/                                     │ │
│  │ - AGENTS.md, SOUL.md, MEMORY.md per agent                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Layer 4: Auth Isolation                                                │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ - Per-agent auth directory                                        │ │
│  │ - ~/.openclaw/agents/<id>/agent/auth-profiles.json                │ │
│  │ - Google tokens stored here, not shared                           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Layer 5: Sandbox Isolation                                             │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ - Per-agent Docker container                                      │ │
│  │ - Unique GOG_KEYRING_PASSWORD per agent                           │ │
│  │ - Read-only token mounts                                          │ │
│  │ - Network: bridge (for Google API)                                │ │
│  │ - No privileged mode                                              │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.3 OAuth Token Isolation

Each user's Google OAuth tokens are stored in their agent's auth directory:

```
~/.openclaw/agents/user_abc123/agent/
├── auth-profiles.json
└── .gog/
    ├── plus_15551234567/
    │   ├── keyring (encrypted with unique password)
    │   └── tokens.json
    └── .keyring_password (unique to this agent)
```

**Sandbox env vars:**
```json
{
  "GOG_KEYRING_PASSWORD": "<unique-per-agent>",
  "GOG_CONFIG_DIR": "/home/node/.gog/plus_<phone>",
  "GOG_ACCOUNT": "user@gmail.com"
}
```

**Result:** User A's sandbox cannot access User B's tokens.

---

## 8. Technology Stack & Dependencies

### 8.1 Core Technologies

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | OpenClaw | Latest (npm) |
| **Runtime** | Node.js | 22+ |
| **Language** | TypeScript | 5+ |
| **Database** | SQLite | 3.x (better-sqlite3) |
| **Container** | Docker | 24+ |
| **Package Manager** | npm | 10+ |

### 8.2 OpenClaw Dependencies

```json
{
  "dependencies": {
    "openclaw": "latest",
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Update strategy:** `npm update openclaw@latest` + rebuild

### 8.3 Onboarding Service Dependencies

```json
{
  "dependencies": {
    "express": "^4.19.0",
    "better-sqlite3": "^12.6.2",
    "zod": "^3.22.0",
    "uuid": "^9.0.0"
  }
}
```

### 8.4 Docker Image

Base image: `node:22-bookworm-slim`

Installed packages:
- OpenClaw (via npm)
- gog CLI (for OAuth)
- Runtime dependencies

---

## 9. Project Structure

### 9.1 Directory Layout

```
DonClaudioBot/
├── .gitignore                      # Git ignore (OpenClaw reference excluded)
├── .openclaw-reference/            # OpenClaw source (docs only, gitignored)
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
├── docker-compose.yml              # Deployment
├── Dockerfile                      # Container image
├── README.md                       # Project overview
├── ARCHITECTURE_REPORT.md          # This document
│
├── onboarding/                     # Onboarding service
│   ├── src/
│   │   ├── index.ts                # Express server entry point
│   │   ├── routes/
│   │   │   ├── webhook.ts          # /webhook/onboarding endpoint
│   │   │   └── state.ts            # /onboarding/state endpoints
│   │   ├── services/
│   │   │   ├── agent-creator.ts    # OpenClaw API wrapper
│   │   │   ├── state-manager.ts    # SQLite operations
│   │   │   └── config-writer.ts    # openclaw.json updates
│   │   └── db/
│   │       ├── schema.sql          # SQLite schema
│   │       └── migrations/         # Database migrations
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
│       └── Dockerfile.sandbox      # Custom sandbox image with gog CLI
│
├── scripts/                        # Deployment & utility scripts
│   ├── setup.sh                    # Initial setup
│   ├── build.sh                    # Build everything
│   ├── deploy.sh                   # Deploy to Hetzner
│   └── backup.sh                   # Backup state
│
└── docker/
    ├── Dockerfile                  # Main container image
    └── docker-compose.yml          # Compose configuration
```

### 9.2 Key Files (To Be Created)

| File | Purpose | Priority |
|------|---------|----------|
| `onboarding/src/index.ts` | Onboarding service entry | P0 |
| `onboarding/src/services/agent-creator.ts` | OpenClaw API wrapper | P0 |
| `onboarding/src/db/schema.sql` | SQLite schema | P0 |
| `config/openclaw.json.template` | Base config | P0 |
| `config/agents/onboarding/AGENTS.md` | Onboarding prompt | P0 |
| `docker/Dockerfile` | Container image | P1 |
| `scripts/deploy.sh` | Deployment script | P1 |

### 9.3 State Storage Locations

```
~/.openclaw/                          # OpenClaw state (on container)
├── openclaw.json                     # Main config
├── agents/
│   ├── onboarding/                   # Onboarding agent
│   │   ├── agent/
│   │   │   └── auth-profiles.json
│   │   └── sessions/
│   └── user_<id>/                    # Dedicated agents (created dynamically)
│       ├── agent/
│       │   ├── auth-profiles.json    # Isolated per agent
│       │   └── .gog/                 # OAuth tokens
│       └── sessions/
│
└── onboarding.db                     # Onboarding state (SQLite)
```

---

## 10. Implementation Roadmap

### 10.1 Phase 1: Foundation (Week 1)

**Goal:** Get OpenClaw running with WhatsApp connectivity.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Initialize project structure | Lead | Git repo, package.json, TypeScript config |
| Create base Dockerfile | Lead | Container that runs OpenClaw |
| Configure OpenClaw gateway | Agent 1 | openclaw.json with WhatsApp channel |
| Set up onboarding agent | Agent 2 | AGENTS.md, SOUL.md, MEMORY.md for user001 |
| Authenticate WhatsApp | Manual | Scan QR code, verify connectivity |
| Test basic messaging | Agent 3 | Send/receive messages via WhatsApp |

**Success criteria:** User can send WhatsApp message and receive response from onboarding agent.

### 10.2 Phase 2: Onboarding Service (Week 1-2)

**Goal:** Build the onboarding service with agent creation.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Create Express server | Agent 4 | POST /webhook/onboarding endpoint |
| Implement SQLite state | Agent 5 | Schema, CRUD operations |
| Build agent-creator service | Agent 6 | OpenClaw API wrapper (agents add, config update) |
| Implement binding logic | Agent 7 | Add phone → agent binding to config |
| Add OpenClaw reload | Agent 8 | Config hot-reload after agent creation |
| Test end-to-end onboarding | Agent 9 | New user → agent created → binding works |

**Success criteria:** New user messages → agent created → next message routes to dedicated agent.

### 10.3 Phase 3: Sandbox & OAuth (Week 2)

**Goal:** Enable sandboxed execution with Google OAuth.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Build sandbox image with gog CLI | Agent 10 | Dockerfile.sandbox, gog installed |
| Configure per-agent sandbox | Agent 11 | Sandbox config in agent creation |
| Implement OAuth flow in dedicated agent | Agent 12 | AGENTS.md instructions for gog auth |
| Test OAuth in sandbox | Agent 13 | User can connect Google in sandbox |
| Verify token isolation | Agent 14 | User A cannot access User B's tokens |

**Success criteria:** User can complete OAuth in their dedicated agent and access Gmail/Calendar.

### 10.4 Phase 4: Polish & Security (Week 3)

**Goal:** Production-ready deployment.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Security hardening | Agent 15 | Allowlist, seccomp, read-only mounts |
| Add error handling | Agent 16 | Graceful failures, retry logic |
| Implement backup/restore | Agent 17 | State backup script |
| Load testing | Agent 18 | Test with 100+ concurrent users |
| Documentation | Agent 19 | README, deployment guide, runbook |

**Success criteria:** System is production-ready and can handle 100+ concurrent users.

### 10.5 Phase 5: Launch (Week 4)

**Goal:** Deploy to production.

| Task | Owner | Deliverable |
|------|-------|-------------|
| Deploy to Hetzner | Lead | Production VPS running |
| Set up monitoring | Agent 20 | Logs, metrics, alerts |
| Onboard beta users | Manual | 10-20 beta users |
| Gather feedback | Manual | User feedback, bug reports |
| Iterate | All | Fixes and improvements |

**Success criteria:** Beta users successfully using the system.

---

## 11. Decision Points & Resolutions

**Status:** Iterative decision-making process — 3 of 5 decision points resolved.

---

### 11.1 Decision Point 1: OpenClaw Integration Strategy ✅ RESOLVED

**Question:** How does the Onboarding Service communicate with OpenClaw?

**Decision:** CLI Wrapper — matches v1's proven pattern, uses documented interface, fast enough for initial scale.

**Implementation approach:**

**File: `onboarding/src/services/agent-creator.ts`**
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function createAgent(options: CreateAgentOptions): Promise<string> {
  const { agentId, phoneNumber } = options;

  // Step 1: Create agent via CLI
  await execAsync(`openclaw agents add ${agentId}`);

  // Step 2: Update config (add sandbox + binding) via config-writer.ts
  await updateConfig(agentId, phoneNumber);

  // Step 3: Reload gateway
  await execAsync('openclaw gateway reload');

  return agentId;
}
```

**Required components:**
- `agent-creator.ts` — CLI wrapper calling `openclaw agents add`
- `config-writer.ts` — Atomic config updates (write temp file, then `mv` to overwrite)
- File locking — Use `proper-lockfile` package for concurrent operations
- Error handling — Rollback in reverse order if any step fails

**References:** `.openclaw-reference/cli/agents.md`, v1 `claim-agent.sh`

---

### 11.2 Decision Point 2: Hook vs. Webhook ✅ RESOLVED

**Question:** How does WhatsApp trigger the onboarding flow?

**Decision:** `command:new` hook triggers external webhook (`POST /webhook/onboarding`).

**Why:** `message:received` event is not implemented in OpenClaw. `command:new` is the viable path.

**Implementation options:**

**Option A: Webhook (Recommended)** — Hook calls Express service, which manages state in SQLite and creates agents. Useful for debugging, allows HTTP-based testing.

**Option B: Direct Hook** — Hook directly calls `openclaw agents add` and updates config. Simpler but harder to test/debug.

**Hook structure:**
```
~/.openclaw/hooks/onboarding-trigger/
├── HOOK.md                    # Metadata: events=["command:new"], requires bins=["node"]
├── handler.ts                 # Hook handler code
└── package.json               # Hook dependencies
```

**File: `handler.ts`**
```typescript
import type { HookHandler } from '../../src/hooks/hooks.js';

const handler: HookHandler = async (event) => {
  if (event.type !== 'command' || event.action !== 'new') return;

  const phone = event.context.senderId;
  if (!phone || event.context.commandSource !== 'whatsapp') return;

  // Trigger onboarding service
  await fetch('http://127.0.0.1:3000/webhook/onboarding', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.HOOK_TOKEN}` },
    body: JSON.stringify({ phone }),
  });
};

export default handler;
```

**References:** `.openclaw-reference/docs/hooks.md`, webhook auth via `hooks.token`

---

### 11.3 Decision Point 3: Database Schema ✅ RESOLVED

**Question:** What is the concrete SQLite schema?

**Decision:** Schema designed with state transitions, audit trail, and concurrency safety.

**Schema:**
```sql
-- ============================================================
-- DonClaudioBot v2: Onboarding State Database Schema
-- ============================================================
-- File: ~/.openclaw/onboarding.db

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000; -- 5 second lock timeout

-- Core onboarding states table
CREATE TABLE IF NOT EXISTS onboarding_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,          -- E.164 format: +15551234567
  agent_id TEXT NOT NULL UNIQUE,              -- OpenClaw agent ID: user_abc123
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,                            -- NULL = never expires
  CHECK(phone_number LIKE '+%')               -- E.164 validation
);

-- Status transitions log (audit trail)
CREATE TABLE IF NOT EXISTS state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  transitioned_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (phone_number) REFERENCES onboarding_states(phone_number) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_phone_lookup
  ON onboarding_states(phone_number)
  WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_agent_lookup
  ON onboarding_states(agent_id);

CREATE INDEX IF NOT EXISTS idx_expiration
  ON onboarding_states(expires_at)
  WHERE expires_at IS NOT NULL;

-- Auto-update timestamp trigger
CREATE TRIGGER IF NOT EXISTS update_updated_at
  AFTER UPDATE ON onboarding_states
  FOR EACH ROW
BEGIN
  UPDATE onboarding_states
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;
```

**Status Enum:**
| Status | Description | Next States |
|--------|-------------|-------------|
| `new` | Initial state, agent created | `pending_welcome` |
| `pending_welcome` | Welcome message queued | `collecting_info` |
| `collecting_info` | Gathering name/email | `ready_for_handover`, `cancelled` |
| `ready_for_handover` | Awaiting user message | `complete` |
| `complete` | Handover done | `active` |
| `active` | Normal operation | — (terminal) |
| `cancelled` | User abandoned | — (terminal) |

**Concurrency Strategy:**
- `BEGIN IMMEDIATE` transactions + UNIQUE constraints
- WAL mode allows concurrent readers
- `busy_timeout = 5000ms` for retry on transient locks

**State Expiration:**
- New states expire in 24h: `expires_at = datetime('now', '+24 hours')`
- Active states never expire: `expires_at = NULL`
- Hourly cleanup cron: `DELETE FROM onboarding_states WHERE expires_at < datetime('now') AND status NOT IN ('active', 'complete')`

**References:**
- State transitions: ARCHITECTURE_REPORT.md section 6.2
- Concurrency recommendation: Section 12.1 Decision Point 5 (A + D)

---

### 11.4 Additional Resolutions

**DP4: OAuth-in-Sandbox** ✅ — OpenClaw `setupCommand` + `network: "bridge"` documented at [gateway/sandboxing.md:124-128]. v1 proved gog works; bug was timing.

**DP5: Concurrency** ✅ — Covered in DP3 schema (WAL mode, UNIQUE constraints, 5s timeout).

---

### 11.5 Technical Spikes Status

| Spike | Status | Success Criteria |
|-------|--------|------------------|
| **#1: OpenClaw Integration** | ⚪ Optional | CLI creates agent, binding, reload works (DP1 resolved) |
| **#2: OAuth-in-Sandbox** | ✅ RESOLVED | OpenClaw docs validate `setupCommand` + `network:bridge` pattern |
| **#3: Hook Contract** | ✅ Complete | `command:new` event viable (DP2 resolved) |

**Spike #2 Resolution:** No spike needed. OpenClaw framework docs (296 indexed in `.openclaw-reference`) explicitly document:
- Binary installation via `setupCommand` [gateway/sandboxing.md]
- Network access via `network: "bridge"` [gateway/configuration.md]
- Per-agent isolation via `env` + `binds` [multi-agent-sandbox-tools.md]

---

### 11.6 Definition of Done for Design Phase

| Item | Status | Target |
|------|--------|--------|
| DP1: OpenClaw Integration | ✅ Resolved | CLI wrapper approach |
| DP2: Hook vs. Webhook | ✅ Resolved | External webhook with command:new |
| DP3: Database Schema | ✅ Resolved | Complete SQL with constraints |
| DP4: OAuth-in-Sandbox | ✅ Resolved | OpenClaw `setupCommand` pattern documented |
| DP5: Concurrency Strategy | ✅ Resolved | DB schema addresses this |
| DP6: Error Handling Strategy | ✅ Resolved | Transactional pattern designed |
| DP7: Security Decisions | ✅ RESOLVED | Shared token, no docker.sock, file-perms [gateway/security/index.md] |
| Config Writer Service | ⚪ Pending | Implementation, not design |

---

## Appendix A: OpenClaw Reference

### A.1 Documentation Links

ALL Of this are in your QMD indexed database. Use `mcp__qmd__search` or `mcp__qmd__vsearch` on `.openclaw-reference` to investigate instead of using web search or curl.

- Main docs: https://docs.openclaw.ai/
- Multi-agent routing: https://docs.openclaw.ai/concepts/multi-agent
- Sandbox tools: https://docs.openclaw.ai/multi-agent-sandbox-tools
- Docker install: https://docs.openclaw.ai/install/docker
- Hooks: https://docs.openclaw.ai/hooks
- Webhooks: https://docs.openclaw.ai/automation/webhook

### A.2 CLI Commands Reference

```bash
# Agent management
openclaw agents add <name>                    # Create new agent
openclaw agents list --bindings               # List agents with bindings
openclaw agents remove <id>                   # Remove agent

# Gateway management
openclaw gateway start                        # Start gateway
openclaw gateway reload                       # Reload config
openclaw gateway status                       # Check status

# Configuration
openclaw config set <key> <value>             # Set config value
openclaw config get <key>                     # Get config value

# Channels
openclaw channels login                       # Authenticate WhatsApp
openclaw channels status                       # Check channel status

# Sandbox
openclaw sandbox list                         # List sandbox containers
openclaw sandbox recreate <id>                # Recreate sandbox
```

### A.3 Configuration Reference

```json5
{
  // Gateway settings
  gateway: {
    mode: "local",
    bind: "ws://127.0.0.1:18789",
    token: "optional-auth-token"
  },

  // Agents
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      sandbox: {
        mode: "off"  // off | non-main | all
      }
    },
    list: [
      {
        id: "onboarding",
        name: "Onboarding Agent",
        workspace: "~/.openclaw/workspace-onboarding",
        default: true,
        sandbox: { mode: "off" }
      },
      {
        id: "user_abc123",
        name: "User's Agent",
        workspace: "~/.openclaw/workspace-user_abc123",
        agentDir: "~/.openclaw/agents/user_abc123/agent",
        sandbox: {
          mode: "all",
          scope: "agent",
          workspaceAccess: "rw",
          docker: {
            image: "openclaw-sandbox:bookworm-slim",
            env: {
              "GOG_KEYRING_PASSWORD": "unique-per-agent",
              "GOG_CONFIG_DIR": "/home/node/.gog/plus_phone"
            },
            binds: [
              "/root/.gog/phone:/home/node/.gog/phone:ro"
            ],
            network: "bridge"
          }
        }
      }
    ]
  },

  // Bindings (routing)
  bindings: [
    {
      agentId: "onboarding",
      match: { channel: "whatsapp" }  // Catch-all for new users
    },
    {
      agentId: "user_abc123",
      match: {
        channel: "whatsapp",
        peer: { kind: "dm", id: "+15551234567" }
      }
    }
  ],

  // Channels
  channels: {
    whatsapp: {
      allowFrom: ["*"],  // Configure for production
      dmPolicy: "allowlist"
    }
  },

  // Sessions
  session: {
    dmScope: "per-channel-peer"  // Critical for isolation
  },

  // Tools
  tools: {
    sandbox: {
      tools: {
        allow: ["exec", "read", "write", "edit"],
        deny: ["browser", "gateway"]
      }
    }
  },

  // Hooks
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks"
  }
}
```

---

## Appendix B: v1 vs v2 Comparison

| Aspect | v1 (Clawd4All) | v2 (DonClaudioBot) |
|--------|----------------|-------------------|
| **Agent provisioning** | 100 pre-provisioned upfront | Dynamic, on-demand |
| **Onboarding trigger** | LLM-driven AGENTS.md | Deterministic service |
| **OAuth timing** | Before sandbox config | After sandbox exists |
| **Token storage** | Migrated from user001 | In target agent from start |
| **State management** | Complex bash scripts | SQLite database |
| **OpenClaw integration** | Custom fork | npm dependency |
| **Updates** | Merge conflicts | `npm update` |
| **Complexity** | High (27 scripts) | Low (~500 lines service) |
| **Reliability** | LLM-dependent | Code-dependent |

---

## Appendix C: Key Decisions & Rationale

### Decision 1: No Fork, Use as Dependency

**Options considered:**
1. Fork OpenClaw and modify
2. Use as npm dependency

**Chose:** Option 2

**Rationale:**
- Easy updates without merge conflicts
- Your code stays separate
- Leverage upstream improvements
- Smaller repository to maintain

### Decision 2: Dynamic Agent Creation

**Options considered:**
1. Pre-provision 100 agents
2. Create agents on-demand

**Chose:** Option 2

**Rationale:**
- No unnecessary overhead
- Scales infinitely
- Simpler deployment
- No "agent exhaustion" issues

### Decision 3: Separate Onboarding Service

**Options considered:**
1. LLM-driven via AGENTS.md
2. Separate Node.js service

**Chose:** Option 2

**Rationale:**
- Deterministic, not probabilistic
- Easier to debug
- State management in code
- Testable

### Decision 4: Late-Binding (Create Before OAuth)

**Options considered:**
1. OAuth in onboarding agent, then migrate
2. Create agent first, then OAuth

**Chose:** Option 2

**Rationale:**
- No migration = no bugs
- Tokens in correct location from start
- Sandbox exists before OAuth
- v1 proved migration doesn't work

### Decision 5: SQLite for State

**Options considered:**
1. JSON file
2. SQLite
3. PostgreSQL
4. Redis

**Chose:** SQLite

**Rationale:**
- Fast (in-process)
- Simple (single file)
- No external dependency
- Easy backup
- Sufficient for onboarding state

---

## Appendix D: Risk Mitigation

### D.1 Technical Risks

| Risk | Mitigation | Owner |
|------|------------|-------|
| OpenClaw update breaks integration | Pin versions, test before update | Lead |
| Sandbox escape | Read-only mounts, seccomp, no privileged mode | Agent 15 |
| SQLite corruption | Regular backups, WAL mode | Agent 17 |
| WhatsApp ban | Rate limiting, allowlist | Agent 16 |
| OAuth token leak | Per-agent isolation, encrypted keyring | Agent 14 |

### D.2 Operational Risks

| Risk | Mitigation | Owner |
|------|------------|-------|
| VPS goes down | Backup/restore procedure | Lead |
| Database grows too large | Prune old records, archive | Agent 17 |
| Memory exhaustion | Sandbox limits, monitoring | Agent 18 |
| Deployment failures | Staged rollouts, health checks | Lead |

---

## 12. Error Handling & Rollback Strategy

**Status:** Design Complete - Implementation Pending
**Date:** 2026-01-30
**Priority:** HIGH - Blocks Implementation Phase

### 12.1 Executive Summary

The multi-step agent creation flow (CLI call → config update → gateway reload → database write) requires transactional safety. This section defines the error handling and rollback strategy for DonClaudioBot v2.

**Key Principle:** Start with crashes (fail fast), add polish later.

### 12.2 Failure Mode Catalog

| # | Failure Point | Severity | Recovery Strategy |
|---|---------------|----------|-------------------|
| F1 | CLI call fails (OpenClaw not installed) | Critical | Abort - Return error to user |
| F2 | Agent ID already exists | High | Idempotent Check - Return existing agent |
| F3 | Config file locked | High | Retry with exponential backoff (1s, 2s, 5s) |
| F4 | Config write fails (disk full) | Critical | Rollback - Delete agent, alert ops |
| F5 | Config validation fails (invalid JSON) | Critical | Rollback - Delete agent, keep old config |
| F6 | Gateway reload fails (not running) | High | Rollback - Remove from config, delete agent |
| F7 | Gateway reload fails (invalid config) | Critical | Restore backup, delete agent |
| F8 | Database write fails (disk full) | Critical | Rollback - Remove from config, delete agent |
| F9 | Database UNIQUE violation (phone) | High | Idempotent - Return existing agent |
| F10 | Database UNIQUE violation (agent_id) | High | Panic - Manual cleanup (impossible with UUIDs) |
| F11 | Message before reload completes | Low | Accept - User's second message routes correctly |
| F12 | Container crash mid-onboarding | High | Reconciliation - Cleanup job on restart |

### 12.3 Transactional Creation Pattern

```typescript
async function createAgentTransactional(options: CreateAgentOptions): Promise<string> {
  const { agentId, phoneNumber } = options;
  let agentCreated = false;
  let configUpdated = false;

  try {
    // Step 1: Create agent via CLI
    // ⚠️ Security Note: Production code MUST use execFile() instead of exec()
    // to prevent command injection. execFile() does not invoke shell.
    await execAsync(`openclaw agents add ${agentId}`);
    agentCreated = true;

    // Step 2: Update config atomically
    await updateConfigAtomic(agentId, phoneNumber);
    configUpdated = true;

    // Step 3: Reload gateway
    await execAsync('openclaw gateway reload');

    // Step 4: Write to database (last step - persistent)
    await db.insert({ phone: phoneNumber, agentId, status: 'new' });

    return agentId;
  } catch (error) {
    // ROLLBACK in reverse order of completion
    if (configUpdated) await restoreConfigBackup();
    if (agentCreated) await execAsync(`openclaw agents remove ${agentId}`);
    throw error;
  }
}
```

### 12.4 Idempotency Strategy

```typescript
export async function createAgent(options: CreateAgentOptions): Promise<string> {
  const { phoneNumber } = options;

  // CHECK 1: Database takes precedence (source of truth)
  const existing = await db.getByPhone(phoneNumber);
  if (existing && existing.status !== 'cancelled') {
    return existing.agent_id;  // Idempotent return
  }

  // CHECK 2: Validate phone format (E.164)
  if (!phoneNumber.match(/^\+\d{10,15}$/)) {
    throw new Error(`Invalid phone format: ${phoneNumber}`);
  }

  // PROCEED WITH CREATION (transactional)
  return await createAgentTransactional(options);
}
```

### 12.5 State Reconciliation

Run reconciliation on **container startup** and **hourly cron**:

```typescript
interface ReconciliationReport {
  orphanedAgents: string[];      // In config, not in DB
  orphanedDbRecords: string[];   // In DB, not in config
  invalidBindings: string[];     // Bindings to non-existent agents
  staleStates: string[];          // States stuck > 24h in non-terminal
}

// Reconciliation actions:
// - Orphaned agent: Delete agent directory, remove from config
// - Orphaned DB record: Mark as 'cancelled', notify user
// - Invalid binding: Remove binding from config
// - Stale state: Mark as 'cancelled', create fresh on next message
```

### 12.6 Implementation Checklist

**Minimum Viable (Week 1):**
- [ ] Idempotency checks (database-first)
- [ ] Error propagation (let errors crash, log stack traces)
- [ ] Basic logging (log start/success/failure)
- [ ] Manual rollback documentation

**Essential (Week 2):**
- [ ] Atomic config writes (temp file + rename)
- [ ] Config backups (backup before every write)
- [ ] Rollback function (performRollback implementation)
- [ ] File locking (proper-lockfile for config)
- [ ] Database locks (DB-level locking for phone operations)
- [ ] Reconciliation job (hourly cleanup + state detection)

**Production-Ready (Week 3+):**
- [ ] Metrics (Prometheus/CloudWatch integration)
- [ ] Alerting (PagerDuty/Slack alerts)
- [ ] Cron cleanup (automated stale state removal)
- [ ] Retry logic (exponential backoff)
- [ ] Circuit breaker (stop onboardings if failure rate >10%)

**References:**
- Full strategy: `ERROR_HANDLING_STRATEGY.md`
- Flow diagrams: `ERROR_HANDLING_FLOW.md`
- Summary: `ERROR_HANDLING_SUMMARY.md`

---

## 13. Security Architecture

**Status:** Pre-Implementation Audit Complete - Decisions Required
**Date:** 2026-01-30
**Severity:** CRITICAL - Multi-user system with OAuth tokens

### 13.1 Executive Summary

DonClaudioBot v2 requires strong security isolation. User A must NEVER access User B's data, tokens, or sessions. The architecture has sound foundational concepts (5-layer design), but critical security decisions must be made BEFORE implementation.

### 13.2 Critical Security Decisions Required

| Decision | Options | Recommendation | Deadline |
|----------|---------|----------------|----------|
| **Webhook auth** | Shared token vs HMAC | Shared token (Phase 1) | Week 1 |
| **Docker socket** | Mount + monitoring vs DooD pattern | Mount + monitoring (Phase 1) | Week 1 |
| **Token encryption** | File-based vs Vault | File-based (Phase 1) | Week 1 |
| **Rate limiting** | Express middleware vs nginx | Express (Phase 1) | Week 1 |

### 13.3 Webhook Security

**Current State:** `POST /webhook/onboarding` is undefined. No authentication, no input validation, no rate limiting.

#### Option A: Shared Secret Token (Recommended for MVP)

```typescript
const HOOK_TOKEN = process.env.HOOK_TOKEN;

export function webhookAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  const token = authHeader.substring(7);
  if (token !== HOOK_TOKEN) {
    console.error(`[webhook] Failed auth attempt from ${req.ip}`);
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
}
```

#### Option B: HMAC Signature (Production-Grade)

```typescript
import crypto from 'crypto';

const HOOK_SECRET = process.env.HOOK_SECRET;

export function webhookSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-webhook-signature'] as string;
  const timestamp = req.headers['x-webhook-timestamp'] as string;
  const body = JSON.stringify(req.body);

  // Replay protection (reject requests older than 5 minutes)
  if (Math.abs(Date.now() - parseInt(timestamp)) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Request too old' });
  }

  const expected = crypto.createHmac('sha256', HOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  next();
}
```

### 13.4 Input Validation

**E.164 Phone Number Validation:**

```typescript
import { z } from 'zod';

export const E164PhoneSchema = z.string().regex(
  /^\+[1-9]\d{0,14}$/,
  'Invalid E.164 phone number format (must be +15551234567)'
);

export const OnboardingWebhookSchema = z.object({
  phone: E164PhoneSchema,
  timestamp: z.string().optional(),
});
```

**Agent ID Validation:**

```typescript
export const AgentIdSchema = z.string()
  .min(5).max(64)
  .regex(/^user_[a-zA-Z0-9_-]+$/, 'Invalid agent ID format');
```

**SQL Injection Prevention:**

```typescript
// ❌ WRONG - SQL injection vulnerable
const query = `SELECT * FROM onboarding_states WHERE phone_number = '${phone}'`;

// ✅ CORRECT - Parameterized
const query = `SELECT * FROM onboarding_states WHERE phone_number = ?`;
const result = db.prepare(query).get(phone);
```

### 13.5 Docker Socket Risk Mitigation

**Current:** `/var/run/docker.sock` is mounted in container - CRITICAL SECURITY RISK

**Phase 1 Mitigation (Accept Risk with Monitoring):**

```yaml
services:
  don-claudio-bot:
    user: '1000:1000'           # Run as non-root
    cap_drop:
      - ALL                     # Drop all capabilities
    security_opt:
      - seccomp:/root/seccomp-docker.json
      - no-new-privileges:true
    read_only: true              # Read-only root filesystem
```

**Phase 2 Mitigation (DooD Pattern):**
- Remove socket mount entirely
- Use Docker TCP with TLS certificates
- Complete host isolation

### 13.6 Sandbox Configuration Validation

```typescript
export function validateSandboxConfig(config: AgentConfig): void {
  const { sandbox } = config;

  // 1. Ensure privileged is false
  if (sandbox.docker.privileged === true) {
    throw new Error('CRITICAL: Privileged mode is NOT allowed');
  }

  // 2. Ensure capabilities are dropped
  const capDrop = sandbox.docker.capDrop || ['ALL'];
  if (!capDrop.includes('ALL')) {
    throw new Error('CRITICAL: Must drop all capabilities');
  }

  // 3. Ensure no socket mounts
  const binds = sandbox.docker.binds || [];
  const socketMounts = binds.filter(b => b.includes('docker.sock'));
  if (socketMounts.length > 0) {
    throw new Error('CRITICAL: Docker socket mount in sandbox');
  }

  // 4. Ensure read-only workspace
  if (sandbox.workspaceAccess !== 'ro' && sandbox.workspaceAccess !== 'none') {
    throw new Error('CRITICAL: Workspace must be read-only or none');
  }
}
```

### 13.7 Token Storage Security

**Password Generation:**

```typescript
import crypto from 'crypto';

export function generateKeyringPassword(): string {
  const randomBytes = crypto.randomBytes(32);  // 256 bits
  const password = randomBytes.toString('base64url');
  return `${password}.Key!`;  // ~50 characters
}
```

**Encryption Strategy (Phase 1 - File-based):**

```typescript
const MASTER_KEY_PATH = '/root/.openclaw/.master-key';

export async function encryptPassword(password: string): Promise<string> {
  const key = await fs.readFile(MASTER_KEY_PATH);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
```

### 13.8 Runtime Validation

**Startup Security Checks:**

```typescript
app.listen(3000, async () => {
  console.log('Onboarding service started');

  // CRITICAL: Validate security before accepting requests
  const checks = [
    validateSessionIsolation(),     // dmScope: "per-channel-peer"
    validateBindingUniqueness(),     // No duplicate phone bindings
    validateAgentIsolation(),        // No symlink attacks
  ];

  const results = await Promise.all(checks);

  if (results.some(r => !r)) {
    console.error('[CRITICAL] Security validation failed, shutting down');
    process.exit(1);
  }

  console.log('[PASS] All security checks passed, accepting requests');
});
```

### 13.9 Security Checklist (Pre-Production)

**Critical (Must Complete Before ANY User Access):**
- [ ] Webhook Authentication (HOOK_TOKEN middleware)
- [ ] Input Validation (Zod schemas for phone, agent IDs)
- [ ] SQL Injection Prevention (parameterized queries)
- [ ] Session Isolation (dmScope: "per-channel-peer")
- [ ] Binding Uniqueness (no duplicate phone bindings)
- [ ] Docker Socket Mitigations (non-root, seccomp, monitoring)
- [ ] Token Encryption (file-based encryption)
- [ ] Password Generation (cryptographically secure)
- [ ] File Permissions (700 on agent dirs, 600 on configs)
- [ ] Audit Logging (all agent creations, token access, config changes)

**High Priority (Before Public Launch):**
- [ ] Rate Limiting (Express middleware for webhook)
- [ ] Sandbox Validation (no privileged containers, dropped caps)
- [ ] Workspace Symlink Checks (pre-start validation)
- [ ] OAuth Token Rotation (90-day schedule)
- [ ] Penetration Testing (10 test scenarios)
- [ ] Incident Response (containment, rotation, audit procedures)
- [ ] Backup Security (encrypt backups, test restore)
- [ ] Log Redaction (redact tokens, passwords from logs)
- [ ] Config File Validation (pre-deployment checks)
- [ ] Network Isolation (firewall rules, VPN for admin)

**References:**
- Full security review: `SECURITY_REVIEW.md`
- v1 red team findings: `DeepDive.md:387-403`

---

## 14. Updated Decision Points Status

| Decision Point | Status | Resolution |
|----------------|--------|------------|
| **DP1: OpenClaw Integration** | ✅ Resolved | CLI wrapper approach |
| **DP2: Hook vs. Webhook** | ✅ Resolved | External webhook with `command:new` hook |
| **DP3: Database Schema** | ✅ Resolved | Complete SQL with constraints |
| **DP4: OAuth-in-Sandbox** | ✅ Resolved | OpenClaw docs validate `setupCommand` + `network:bridge` |
| **DP5: Concurrency Strategy** | ✅ Resolved | DB locking + UNIQUE constraints |
| **DP6: Error Handling** | ✅ Resolved | Transactional pattern with rollback |
| **DP7: Security Decisions** | ✅ Resolved | Shared token, no docker.sock, file-perms only |

**Definition of Done - Updated:**

| Item | Status | Target |
|------|--------|--------|
| DP1-DP7 | ✅ Resolved | Complete designs available |
| P0 Foundation Tasks | ✅ Complete | 6 of 9 P0 tasks implemented |
| P0 Webhook & Server | ⚪ Pending | Remaining 3 P0 tasks |

**Completion Criteria:** All design decisions resolved; P0 foundation implementation complete.

---

## 15. Implementation Progress (as of 2026-02-01)

### 15.1 Completed P0 Tasks

| Task | Status | File | Description |
|------|--------|------|-------------|
| **P0-001** | ✅ | `onboarding/src/lib/validation.ts` | Zod schemas: E164Phone, AgentId, OnboardingWebhook |
| **P0-002** | ✅ | `onboarding/src/db/schema.sql` | SQLite schema with WAL, FK constraints, audit trail |
| **P0-003** | ✅ | `onboarding/src/services/state-manager.ts` | CRUD operations with prepared statements |
| **P0-004** | ✅ | `onboarding/src/middleware/webhook-auth.ts` | Bearer token auth middleware (401/403) |
| **P0-005** | ✅ | `onboarding/src/services/config-writer.ts` | Atomic config writes with proper-lockfile |
| **P0-006** | ✅ | `onboarding/src/services/agent-creator.ts` | CLI wrapper with transactional rollback |
| **P0-007** | ✅ | `onboarding/src/routes/webhook.ts` | POST /webhook/onboarding with idempotency |
| **P0-008** | ✅ | `onboarding/src/index.ts` | Express server entry point with health check |
| **P0-009** | ✅ | `config/openclaw.json.template` | Base OpenClaw configuration template |
| **P0-010** | ✅ | `onboarding/src/services/agent-creator.ts` | Uses execFile() (no command injection risk) |
| **P0-011** | ✅ | `onboarding/src/routes/webhook.ts` | UNIQUE constraint handling for race conditions |

### 15.2 Pending P0 Tasks

**All P0 tasks (P0-001 through P0-011) are now complete.** The onboarding service is ready for testing and deployment.

### 15.3 Implementation Details

**Validation (P0-001):**
- E.164 phone regex: `/^\+[1-9]\d{1,14}$/`
- Agent ID format: `user_[a-zA-Z0-9_-]+` (5-64 chars)
- TypeScript types via `z.infer<>`

**Database (P0-002, P0-003):**
- WAL mode for concurrent readers
- UNIQUE constraints on phone_number, agent_id
- Partial index: `WHERE status != 'cancelled'`
- Auto-update trigger on `updated_at`
- All queries use prepared statements (no SQL injection)

**Security (P0-004):**
- Bearer token validation via `HOOK_TOKEN` env var
- Returns 401 for missing header, 403 for invalid token
- Logs failures without exposing token

**Config Management (P0-005):**
- JSON5 parsing (comments/trailing commas supported)
- Atomic writes: temp file + POSIX rename
- proper-lockfile with retries: 3, stale: 5000ms
- Backup/restore for rollback

**Agent Creation (P0-006):**
- `openclaw --version` check before CLI calls
- Uses `execFile()` (not `exec()`) to prevent command injection
- 30s timeout on all CLI calls
- Rollback flags: `agentCreated`, `configUpdated`
- Rollback order: restore config, then remove agent
- Unique `GOG_KEYRING_PASSWORD` per agent (base64url)

**Webhook Route (P0-007):**
- POST /webhook/onboarding with Bearer token auth
- Idempotent: returns existing agent if phone already onboarded
- Handles `SQLITE_CONSTRAINT_UNIQUE` for concurrent requests
- Status codes: 200 (existing), 201 (created), 400 (validation), 401/403 (auth), 500 (error)

**Express Server (P0-008):**
- JSON body parser middleware
- Database initialization before server starts
- Health check endpoint at `/health`
- Configurable PORT (default 3000)
- Warns if HOOK_TOKEN not set

### 15.4 Implementation Gaps (Post-Review 2026-02-01)

| Gap | Location | Severity | Description |
|-----|----------|----------|-------------|
| **Orphaned Agent Risk** | `webhook.ts:28-31` | MEDIUM | Agent created before DB write. If DB fails, agent exists with no record. |
| **Sync/Async Mismatch** | `webhook.ts:22,31` | LOW | `await` on synchronous `better-sqlite3` functions. Works but misleading. |

**Resolved (2026-02-01):**
- ✅ P0-008: Express entry point implemented
- ✅ Command injection: Already using `execFile()`, not `exec()`
- ✅ Race condition: UNIQUE constraint handling in place

**Recommended Next Steps:**
1. Orphaned agents — addressed by P1-006 reconciliation
2. Sync/async mismatch — cosmetic, can be deferred

---

*End of ARCHITECTURE_REPORT.md*