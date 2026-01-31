# DonClaudioBot v2: Design Review Summary

**Date:** 2026-01-31
**Status:** ✅ DESIGN COMPLETE — Ready for implementation task breakdown

---

## Background: What is DonClaudioBot?

A WhatsApp-based multi-user AI assistant service. Each user gets their own sandboxed agent with Google OAuth (Gmail, Calendar).

**v1 (Clawd4All) failed** because OAuth happened BEFORE the sandbox existed — tokens were stored in the wrong agent directory and couldn't be accessed.

**v2 fix:** Create agent WITH sandbox config FIRST, then do OAuth in that agent's context.

---

## Executive Summary

5-agent parallel analysis (codebase-analyzer, architecture, strategic-code-planner, reviewer, planner) using QMD for v1 context and OpenClaw reference docs (296 docs indexed).

**Finding:** Architecture is sound. All 7 design questions resolved. Implementation is 0% — all files are placeholders.

**Recommendation:** Proceed to implementation task breakdown.

---

## Decision Points (DP1-7): Questions & Answers

### DP1: How does Onboarding Service talk to OpenClaw?

**Options:** Direct HTTP API? CLI wrapper? Config file manipulation?

**Decision:** CLI wrapper
```bash
openclaw agents add user_<phone>  # Create agent
openclaw gateway reload            # Apply config changes
```

**Why:** Simple, matches v1's proven pattern, uses documented interface.

---

### DP2: How does WhatsApp trigger agent creation?

**Options:** Internal hook? External webhook? Polling?

**Decision:** `command:new` hook → calls external webhook → onboarding service creates agent

**Why:** `message:received` event not yet implemented in OpenClaw. `command:new` works.

---

### DP3: What's the database schema?

**Question:** SQLite structure for onboarding state?

**Decision:** Full schema designed with:
- WAL mode for concurrent readers
- UNIQUE constraints on `phone_number` and `agent_id`
- State transitions audit log
- Indexes for performance
- 24h expiration on incomplete states

**Reference:** ARCHITECTURE_REPORT.md §11.3

---

### DP4: Does OAuth work inside a Docker sandbox?

**Question:** Can gog CLI run in sandbox and access Google APIs?

**Concern:** Need to install gog binary, reach external APIs, store tokens in isolated location.

**Decision:** ✅ Yes — validated via OpenClaw framework docs

**Evidence:**
```json5
{
  sandbox: {
    docker: {
      network: "bridge",              // External API access
      setupCommand: "apt-get update && apt-get install -y git curl jq"  // Binary install
    }
  }
}
```

**Reference:** [gateway/sandboxing.md:124-128]

---

### DP5: How do we handle concurrent onboarding?

**Question:** What if 2 users onboard simultaneously? Race conditions?

**Decision:** Resolved by DP3 — SQLite WAL mode + UNIQUE constraints + 5s lock timeout

---

### DP6: What if agent creation fails halfway?

**Question:** Rollback strategy when CLI succeeds but config write fails?

**Decision:** Transactional pattern designed:
1. Create agent via CLI
2. Update config atomically (temp file + mv)
3. Reload gateway
4. Write to DB last (persistent state)
5. If any step fails, rollback in reverse order

**Reference:** ERROR_HANDLING_STRATEGY.md

---

### DP7: Security decisions

**Question:** Webhook auth? Docker socket? Token encryption? Rate limiting?

| Decision | Choice | Why |
|----------|--------|-----|
| Webhook auth | Shared secret token | Follows OpenClaw's `hooks.token` pattern |
| Docker socket | **Do not mount** | Not needed for sandbox ops |
| Token encryption | File perms (700/600) | OpenClaw's approach + FDE |
| Rate limiting | **Skip** | Access control via pairing sufficient |

**Reference:** [gateway/security/index.md]

---

## Summary Table: All Decisions

| DP | Question | Answer | Reference |
|----|----------|--------|-----------|
| **DP1** | Onboarding → OpenClaw? | CLI wrapper | [.openclaw-reference/cli/agents.md] |
| **DP2** | WhatsApp → trigger? | `command:new` hook | [docs/hooks.md] |
| **DP3** | DB schema? | SQLite + WAL + UNIQUE | ARCHITECTURE_REPORT.md §11.3 |
| **DP4** | OAuth in sandbox? | Yes (setupCommand + bridge) | [gateway/sandboxing.md:124-128] |
| **DP5** | Concurrency? | DB locking (DP3 covers it) | — |
| **DP6** | Rollback on failure? | Transactional pattern | ERROR_HANDLING_STRATEGY.md |
| **DP7** | Security? | Shared token, no docker.sock, file perms | [gateway/security/index.md] |

---

## Pending Implementation (TODOs)

Design complete. Remaining work is coding:

| Priority | Task | Design Reference |
|----------|------|------------------|
| **P0** | Implement config-writer service (atomic file writes) | DP1, DP3 |
| **P0** | Add Zod validation schemas (E.164 phone, agent ID) | DP7 |
| **P0** | Implement webhook auth middleware (`Authorization: Bearer`) | DP7 |
| **P1** | Implement transactional agent creation with rollback | DP6 |
| **P1** | Add phone number normalization (E.164 format) | DP7 |
| **P1** | Implement OAuth refresh failure handling | ERROR_HANDLING_STRATEGY.md |
| **P2** | Define sandbox resource limits (CPU, memory) | Implementation detail |

---

## Risk Register

| Risk | Probability | Impact | Status |
|------|-------------|--------|--------|
| Config hot-reload too slow | Low | High | ⚠️ Measure during impl (~300ms acceptable) |
| Single gateway bottleneck | Low | High | ⚠️ Monitor at 1,000+ users; scale later if needed |

**All other risks mitigated** via design decisions. See ARCHITECTURE_REPORT.md §13 for full details.

---

## Success Criteria

How to verify implementation works:

1. ✅ **Agent created BEFORE OAuth** — Check `openclaw.json` has binding before gog auth runs
2. ✅ **Tokens in agent directory** — Verify `~/.openclaw/agents/<id>/agent/.gog/` contains tokens
3. ✅ **No shared token paths** — Verify no `/root/.gog/shared/` or similar
4. ✅ **Binding routes correctly** — User's second message goes to dedicated agent (not onboarding)
5. ✅ **Sandbox can access tokens** — Run `gog auth list` inside container, works

**Integration test:** Create 2 users, authenticate both, prove User A cannot read User B's email.

---

## Design Phase: Definition of Done

| Item | Status |
|------|--------|
| DP1-7: All decision points | ✅ Resolved |
| Database schema | ✅ Designed (DP3) |
| Error handling strategy | ✅ Designed (DP6) |
| Security decisions | ✅ Resolved (DP7) |
| Transactional rollback pattern | ✅ Designed (DP6) |

**Completion:** All design decisions resolved. Ready for implementation task breakdown.

---

## Next Actions

1. **[LEAD]** Approve transition to implementation phase
2. **[PLANNER]** Break down into granular implementation tasks

---

## Documentation Index

| Document | Purpose | Location |
|----------|---------|----------|
| `ARCHITECTURE_REPORT.md` | Complete system architecture, v1 post-mortem, v2 design | Project root |
| `ERROR_HANDLING_STRATEGY.md` | Transactional rollback pattern, failure modes | Project root |
| `DEPLOYMENT.md` | Hetzner deployment, Docker volume persistence | Project root |
| `.openclaw-reference/` | OpenClaw framework docs (296 indexed) | Project root (gitignored) |

---

## Quick Reference: OpenClaw Commands Used

```bash
# Agent management
openclaw agents add <name>           # Create new agent
openclaw agents list --bindings      # List agents with bindings
openclaw gateway reload              # Reload config after changes

# Channel setup
openclaw channels login              # Authenticate WhatsApp
openclaw channels status             # Check channel status

# Sandbox
openclaw sandbox list                # List sandbox containers
openclaw sandbox recreate <id>       # Recreate sandbox
```

---

*End of Design Review*
