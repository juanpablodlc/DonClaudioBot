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
Phase 1

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
- [ ] Run ./scripts/verify-prereqs.sh (SSH, Docker, disk space, clean server state)
- [ ] Run ./scripts/integration-test.sh (local dress rehearsal - requires Docker daemon running)
- [ ] Verify .env has HOOK_TOKEN and GATEWAY_TOKEN set
- [ ] Document any blockers in findings.md
- **Status:** pending

### Phase 2: Deploy to Hetzner VPS
<!--
  WHAT: Execute the deployment script and verify container is running.
  WHY: This is the main deployment event. Health checks catch failures early.
  MAPPED FROM: P0-DEPLOY-009 main deployment steps
-->
- [ ] Run ./scripts/deploy.sh (with health checks baked in)
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
- [ ] Set up SSH tunnel for Gateway UI: `ssh -i ~/.ssh/hetzner -N -L 18789:127.0.0.1:18789 root@135.181.93.227`
- [ ] Open browser: http://127.0.0.1:18789/
- [ ] Authenticate with GATEWAY_TOKEN from .env
- [ ] Navigate to Channels -> WhatsApp -> Login
- [ ] Scan QR code with phone
- [ ] Verify auth files exist: `ls -la /home/node/.openclaw/credentials/whatsapp/`
- **Status:** pending

### Phase 4: Sandbox Image Build
<!--
  WHAT: Build the sandbox image required for dedicated agent OAuth.
  WHY: Onboarding agent doesn't need sandbox (mode='off'), but dedicated agents do.
  MAPPED FROM: P1-DEPLOY-010
-->
- [ ] Verify config/sandbox/Dockerfile.sandbox exists
- [ ] Build image: `docker build -t openclaw-sandbox:bookworm-slim -f config/sandbox/Dockerfile.sandbox config/sandbox/`
- [ ] Verify gog CLI: `docker run --rm openclaw-sandbox:bookworm-slim gog --version`
- [ ] Push to Hetzner if needed (or build on Hetzner directly)
- **Status:** pending

### Phase 5: Integration Testing
<!--
  WHAT: Test webhook endpoint and verify onboarding flow works.
  WHY: Production deployment means nothing if the service doesn't work end-to-end.
  MAPPED FROM: P0-DEPLOY-009 verification steps
-->
- [ ] Test webhook without token (expect 401/403): `curl -X POST http://135.181.93.227:3000/webhook/onboarding -H 'Content-Type: application/json' -d '{"phone":"+15551234567"}'`
- [ ] Test webhook with valid token (expect 201): `curl -X POST http://135.181.93.227:3000/webhook/onboarding -H "Authorization: Bearer $HOOK_TOKEN" -H 'Content-Type: application/json' -d '{"phone":"+15551234567"}'`
- [ ] Verify agent creation in logs
- [ ] Check database state: `ssh root@135.181.93.227 'docker exec don-claudio-bot sqlite3 /home/node/.openclaw/onboarding.db "SELECT * FROM onboarding_states;"'`
- **Status:** pending

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

## Errors Encountered
<!--
  WHAT: Every error you encounter, what attempt number it was, and how you resolved it.
  WHY: Logging errors prevents repeating the same mistakes. This is critical for learning.
-->
| Error | Attempt | Resolution |
|-------|---------|------------|
| | 1 | |

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
