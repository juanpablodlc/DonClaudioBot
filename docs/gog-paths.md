# GOG Path Reference — The Definitive Guide

**READ THIS BEFORE touching anything related to gog, credentials, OAuth, XDG_CONFIG_HOME, workspace paths, or sandbox env vars.**

## The Core Problem (Why Bugs Keep Happening)

There are **3 execution contexts** that see the **same data** at **different paths**. Every past bug came from mixing up which context a path belongs to.

```
HOST (Hetzner)                MAIN CONTAINER              SANDBOX (per-agent)
──────────────                ──────────────              ───────────────────
/root/google-credentials/ ──► /home/node/.config/gogcli/  (bind mount, ro)
                                                    ╲
/root/google-credentials/ ─────────────────────────────► /workspace/.config/gogcli/  (bind mount, ro)
                                                          ↑ Docker daemon uses HOST path, not container path

don-claudio-state volume  ──► /home/node/.openclaw/  ───► /workspace/  (OpenClaw mounts workspace dir)
                              ├── workspace-<agentId>/     ├── .gog-config/gogcli/credentials.json  (registered copy)
                              │   └── .gog-config/         ├── .gog-config/gogcli/keyring/          (encrypted tokens)
                              │       └── gogcli/          ├── USER.md  (system context, has OAuth URL)
                              │           ├── credentials   ├── AGENTS.md, SOUL.md, MEMORY.md
                              │           └── keyring/      └── .config/gogcli/credentials.json  (bind, ro)
                              └── openclaw.json
```

## The 3 Contexts — Know Which One You're In

### CONTEXT 1: HOST (Hetzner bare metal)
- **Who**: Docker daemon, bind mount source paths
- **Credential files**: `/root/google-credentials/credentials.json` (desktop), `/root/google-credentials-web/credentials.json` (web)
- **CRITICAL**: Sandbox `binds` in agent-creator.ts use HOST paths because the Docker daemon resolves them, NOT the container

### CONTEXT 2: MAIN CONTAINER (onboarding service + gateway)
- **Who**: `token-importer.ts`, `agent-creator.ts`, `oauth.ts`, gateway process
- **State dir**: `/home/node/.openclaw/` (= `don-claudio-state` volume)
- **Agent workspace**: `/home/node/.openclaw/workspace-<agentId>/`
- **Desktop creds bind**: `/home/node/.config/gogcli/credentials.json` (read-only)
- **Web creds bind**: `/home/node/.config/gogcli-web/credentials.json` (read-only)
- **Token-importer writes to**: `/home/node/.openclaw/workspace-<agentId>/.gog-config/gogcli/keyring/`

### CONTEXT 3: SANDBOX (per-agent Docker container)
- **Who**: The AI agent's tool calls (bash, gog commands)
- **Home**: `/workspace` (OpenClaw sets HOME=/workspace during tool execution)
- **gog config**: `/workspace/.gog-config/gogcli/` (via `XDG_CONFIG_HOME=/workspace/.gog-config`)
- **Desktop creds bind**: `/workspace/.config/gogcli/credentials.json` (read-only, from HOST)
- **Keyring**: `/workspace/.gog-config/gogcli/keyring/` (encrypted tokens)

## The Two Sets of Google Credentials

| Type | Purpose | HOST path | MAIN CONTAINER path | SANDBOX path |
|------|---------|-----------|---------------------|--------------|
| **Desktop** | Original CLI OAuth client | `/root/google-credentials/credentials.json` | `/home/node/.config/gogcli/credentials.json` | `/workspace/.config/gogcli/credentials.json` |
| **Web** | HTTPS callback OAuth client | `/root/google-credentials-web/credentials.json` | `/home/node/.config/gogcli-web/credentials.json` | N/A (not in sandbox) |

Desktop = bind-mounted into every sandbox (read-only). Used as fallback.
Web = only in main container. Token-importer uses it server-side, then imports tokens into agent keyring.

## The 5 Environment Variables (and where they're set)

| Variable | Value | Set In | Context |
|----------|-------|--------|---------|
| `XDG_CONFIG_HOME` | `/workspace/.gog-config` | `agent-creator.ts:88` sandbox.docker.env | SANDBOX |
| `XDG_CONFIG_HOME` | `${workspacePath}/.gog-config` | `token-importer.ts:43` process env | MAIN CONTAINER |
| `GOG_KEYRING_PASSWORD` | random 32-byte base64url | `agent-creator.ts:87` sandbox.docker.env | BOTH (read from config) |
| `GOG_KEYRING_BACKEND` | `file` | `agent-creator.ts:89` sandbox.docker.env | BOTH |
| `GOG_ACCOUNT` | user's email | `token-importer.ts:93` (set after import) | SANDBOX (via config) |

**`XDG_CONFIG_HOME` is the keystone.** It's what makes gog look at the per-agent `.gog-config/` directory instead of the default `~/.config/gogcli/`. Without it, all agents would collide.

## Hard-Won Rules (Violations Caused Real Bugs)

### Rule 1: `XDG_CONFIG_HOME`, NOT `GOG_CONFIG_DIR`
`GOG_CONFIG_DIR` does not exist in gogcli. The env var that controls gog's config path is `XDG_CONFIG_HOME`. Using the wrong one silently falls back to `~/.config/gogcli/`.
> Bug: Phase 9, all agents shared one keyring

### Rule 2: Sandbox binds use HOST paths
The left side of a bind mount (`/root/google-credentials/...:/workspace/...`) is resolved by the Docker daemon on the HOST, not inside the main container. Writing a container path there breaks silently.
> Bug: Bind mounts pointed nowhere, gog had no credentials

### Rule 3: Don't read files from workspace in sandbox context
OpenClaw's sandbox blocks file reads outside the sandbox root. A file at `/workspace/.oauth-url.txt` can't be `cat`'d by the agent. Use `USER.md` (system context, loaded before sandboxing).
> Bug: commit feed02a — agent couldn't read OAuth URL

### Rule 4: Token-importer and sandbox see the SAME files at DIFFERENT paths
Token-importer writes to: `/home/node/.openclaw/workspace-<id>/.gog-config/gogcli/keyring/`
Sandbox reads from:       `/workspace/.gog-config/gogcli/keyring/`
These are the SAME directory via the volume mount. If you change the path on one side, you must verify it still maps on the other.

### Rule 5: setupCommand must not clobber web credentials
The sandbox setupCommand registers desktop credentials via `gog auth credentials`. But if token-importer already registered web credentials, this would overwrite them. The guard:
```bash
if [ ! -f /workspace/.gog-config/gogcli/credentials.json ]; then
  XDG_CONFIG_HOME=/workspace/.gog-config gog auth credentials /workspace/.config/gogcli/credentials.json
fi
```

### Rule 6: Sandbox env vars are injected per tool call, NOT at container creation
OpenClaw injects `docker.env` vars via `docker exec -e` on every tool call. Changing them in `openclaw.json` takes effect on the next tool call without recreating the container.

### Rule 7: `agents.defaults.sandbox.mode` MUST be `"all"`
Per-agent `sandbox.mode` is ignored when the WhatsApp flow provides an empty `sessionKey` (OpenClaw bug). Only the defaults value matters. If defaults says `"off"`, ALL agents run embedded — no sandbox container, no bind mounts, no isolation. No error logs.
> Bug: commit e556f6e — sandbox was silently disabled for all agents

## Canonical Code Locations

| What | File | Lines |
|------|------|-------|
| Sandbox env vars + binds + setupCommand | `onboarding/src/services/agent-creator.ts` | 82-107 |
| Token import (server-side, main container) | `onboarding/src/services/token-importer.ts` | 17-99 |
| Volume/bind mounts for main container | `docker/docker-compose.yml` | 16-23 |
| gog installation (main container) | `docker/Dockerfile` | 13-16 |
| gog installation (sandbox image) | `config/sandbox/Dockerfile.sandbox` | 12-17 |
| Sandbox config validation | `onboarding/src/lib/sandbox-validator.ts` | 31-35 |
| OAuth callback (exchanges code for tokens) | `onboarding/src/routes/oauth.ts` | full file |
| OAuth URL generation | `onboarding/src/services/oauth-url-generator.ts` | full file |

## Quick Debugging Checklist

If gog isn't working for an agent:

1. **Is sandbox actually running?** Check `agents.defaults.sandbox.mode` is `"all"` in live config
2. **Does the workspace exist?** `ls /home/node/.openclaw/workspace-<agentId>/` from main container
3. **Does `.gog-config/gogcli/` exist?** Check inside the workspace dir
4. **Are credentials registered?** `ls .gog-config/gogcli/credentials.json` inside workspace
5. **Are tokens imported?** `ls .gog-config/gogcli/keyring/` inside workspace
6. **Is `XDG_CONFIG_HOME` set?** Check `openclaw.json` → agent → sandbox.docker.env
7. **Is the bind mount correct?** Must use HOST path on left side: `/root/google-credentials/credentials.json`
8. **Is `GOG_ACCOUNT` set?** Required when multiple tokens exist in keyring
