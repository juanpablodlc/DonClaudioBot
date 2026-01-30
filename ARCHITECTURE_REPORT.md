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

OpenClaw supports multiple isolated agents in one gateway:

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

**Key insight:** Each agent has its own workspace, auth, and sessions. Routing is deterministic via bindings.

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

**For DonClaudioBot:** Each user's agent gets a sandbox with unique OAuth tokens.

#### 4.2.3 Per-Agent Auth

Each agent has its own auth directory:

```
~/.openclaw/agents/<agentId>/agent/auth-profiles.json
```

**For DonClaudioBot:** Each user's Google OAuth tokens are isolated in their agent's auth dir.

#### 4.2.4 Dynamic Agent Creation

Agents can be added via CLI:

```bash
openclaw agents add <name>
```

**For DonClaudioBot:** Create agents on-demand during onboarding, no pre-provisioning.

#### 4.2.5 Hooks and Webhooks

- **Hooks:** Event-driven automation inside gateway
- **Webhooks:** External HTTP triggers for agent execution

**For DonClaudioBot:** Use hooks to trigger onboarding service on first message.

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

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ONBOARDING FLOW                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 1: Initial Contact                                                 │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ User sends WhatsApp message                                        │ │
│  │ ↓                                                                  │ │
│  │ Routes to onboarding agent (user001) via channel-level binding    │ │
│  │ ↓                                                                  │ │
│  │ Hook triggers: POST /webhook/onboarding                            │ │
│  │   Payload: { phone: "+15551234567" }                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 2: Check State                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Onboarding service checks SQLite:                                  │ │
│  │ - Is this phone number already onboarded?                         │ │
│  │ - If yes: return existing agent ID                                 │ │
│  │ - If no: proceed to Step 3                                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 3: Create Dedicated Agent                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Generate agent ID: user_<uuid_short>                               │ │
│  │ ↓                                                                  │ │
│  │ Call OpenClaw API: openclaw agents add <id>                       │ │
│  │ ↓                                                                  │ │
│  │ Update openclaw.json:                                              │ │
│  │   - Add agent to agents.list                                       │ │
│  │   - Add binding: phone → agent                                     │ │
│  │   - Configure sandbox:                                             │ │
│  │     * mode: "all"                                                  │ │
│  │     * scope: "agent"                                               │ │
│  │     * workspace: ~/.openclaw/workspace-<id>                       │ │
│  │     * agentDir: ~/.openclaw/agents/<id>/agent                     │ │
│  │ ↓                                                                  │ │
│  │ Reload gateway config                                              │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 4: Store State                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Insert into SQLite:                                                 │ │
│  │   phone_number: "+15551234567"                                     │ │
│  │   agent_id: "user_abc123"                                          │ │
│  │   status: "pending_welcome"                                        │ │
│  │   created_at: timestamp                                            │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 5: Send Welcome Message                                           │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Onboarding agent sends:                                            │ │
│  │ "Welcome to DonClaudioBot! Your personal AI agent is ready.        │ │
│  │  I'm user001, the onboarding assistant. Your dedicated agent      │ │
│  │  will take over after this conversation."                          │ │
│  │ ↓                                                                  │ │
│  │ Collect: name, email                                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 6: Trigger Handover                                               │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Update SQLite status: "ready_for_handover"                         │ │
│  │ ↓                                                                  │ │
│  │ Send message: "Your agent is ready! Send any message to           │ │
│  │               continue chatting with your personal assistant."     │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 7: User's Next Message                                            │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ User sends message                                                 │ │
│  │ ↓                                                                  │ │
│  │ Routes to dedicated agent via binding (not user001)               │ │
│  │ ↓                                                                  │
│  │ Dedicated agent responds with personalized greeting               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Step 8: OAuth (Optional, in Dedicated Agent)                           │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ User requests Google access                                        │ │
│  │ ↓                                                                  │ │
│  │ Dedicated agent runs gog OAuth flow                                │ │
│  │ ↓                                                                  │ │
│  │ Tokens stored in: ~/.openclaw/agents/<id>/agent/                  │ │
│  │ ↓                                                                  │
│  │ Agent can now access Gmail, Calendar                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 State Transitions

```
[NEW] → [PENDING_WELCOME] → [COLLECTING_INFO] → [READY_FOR_HANDOVER] → [COMPLETE] → [ACTIVE]
  ↓                                    ↓
[ALREADY_ONBOARDED]            [CANCELLED]
```

### 6.3 Onboarding Service API

```
POST /webhook/onboarding
  Request: { phone: "+15551234567" }
  Response: { status: "new" | "existing", agentId?: string }

GET /onboarding/state/:phone
  Response: { agentId, status, name, email, createdAt }

POST /onboarding/update
  Request: { phone, name?, email? }
  Response: { success: boolean }

POST /onboarding/handover
  Request: { phone }
  Response: { success: boolean, agentId }
```

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
    "better-sqlite3": "^9.0.0",
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

## Appendix A: OpenClaw Reference

### A.1 Documentation Links

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

## Document Metadata

| Property | Value |
|----------|-------|
| **Author** | AI (Claude) + User (juanpablodlc) |
| **Date** | 2026-01-30 |
| **Version** | 1.0 |
| **Status** | Ready for implementation |
| **Next Review** | After Phase 1 completion |

---

## Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-01-30 | 1.0 | Initial document | AI |

---

*End of Report*
