# OpenClaw PR Draft: Fix Bindings Hot-Reload

## PR Title
`fix: Make bindings routing dynamic by calling loadConfig() per-message`

## PR Body

### Problem

When `bindings` are added or changed in `openclaw.json` while the gateway is running, the config watcher correctly detects the change and logs `"config change applied (dynamic reads: bindings)"`. However, **messages continue routing to the old/default agent** until the gateway is fully restarted.

This is a bug affecting **all channels** (WhatsApp, Telegram, Discord) that use multi-agent routing via bindings.

**Related issues:** #6602, #9351, #10576

### Root Cause (3 layers)

The `config-reload.ts` reload rules classify `bindings` as `kind: "none"`, which means "this section is read dynamically per-request, no reload action needed." This classification would be correct **if** channel monitors actually called `loadConfig()` per-message. But they don't — they call it once at startup and capture it in a closure.

**Layer 1: Incorrect assumption in config-reload.ts:72**
```typescript
// BASE_RELOAD_RULES_TAIL
{ prefix: "bindings", kind: "none" }  // assumes dynamic reads, but monitors don't do that
```

**Layer 2: Config captured once at startup**

Each channel monitor calls `loadConfig()` exactly once and passes the result into message handlers:

| Channel | File | Line | Pattern |
|---------|------|------|---------|
| WhatsApp | `src/web/auto-reply/monitor.ts` | 65 | `const baseCfg = loadConfig()` → passed to `createWebOnMessageHandler({ cfg, ... })` |
| Telegram | `src/telegram/bot.ts` | 117 | `const cfg = opts.config ?? loadConfig()` → used in `buildTelegramMessageContext({ cfg, ... })` |
| Discord | `src/discord/monitor/provider.ts` | 133 | `const cfg = opts.config ?? loadConfig()` → passed to `createDiscordMessageHandler({ cfg, ... })` |

**Layer 3: Routing uses stale snapshot**

`resolveAgentRoute({ cfg: params.cfg, ... })` in each channel's message handler uses the startup-time config, never seeing new bindings:

| Channel | File | Line |
|---------|------|------|
| WhatsApp | `src/web/auto-reply/monitor/on-message.ts` | 66-67 |
| Telegram | `src/telegram/bot-message-context.ts` | 166-174 |
| Telegram | `src/telegram/bot.ts` | 424-425 (reaction handler) |
| Discord | `src/discord/monitor/message-handler.preflight.ts` | 169-178 |

### The Fix

The `loadConfig()` function (in `src/config/io.ts:557`) already has a **200ms TTL cache** (`DEFAULT_CONFIG_CACHE_MS = 200` at line 532). It was designed for exactly this use case — per-request dynamic reads with minimal disk I/O overhead.

The fix is to call `loadConfig()` at the point of routing instead of using the captured startup config:

```typescript
// BEFORE (all channels):
const route = resolveAgentRoute({ cfg: params.cfg, channel: "whatsapp", ... });

// AFTER:
const route = resolveAgentRoute({ cfg: loadConfig(), channel: "whatsapp", ... });
```

### Files Changed

1. **`src/web/auto-reply/monitor/on-message.ts`** (line 66-67)
   - Change `cfg: params.cfg` to `cfg: loadConfig()` in `resolveAgentRoute()` call
   - Add import: `import { loadConfig } from "../../../config/config.js";`

2. **`src/telegram/bot-message-context.ts`** (line 166)
   - Change `cfg` to `loadConfig()` in `resolveAgentRoute()` call
   - Add import: `import { loadConfig } from "../config/config.js";`

3. **`src/telegram/bot.ts`** (line 424-425)
   - Change `cfg` to `loadConfig()` in reaction handler's `resolveAgentRoute()` call
   - `loadConfig` already imported at line 16

4. **`src/discord/monitor/message-handler.preflight.ts`** (line 169-170)
   - Change `cfg: params.cfg` to `cfg: loadConfig()` in `resolveAgentRoute()` call
   - Add import: `import { loadConfig } from "../../config/config.js";`

**Total diff: ~4 lines changed + 3 import additions across 4 files.**

### Why This Is Safe

1. **Performance:** `loadConfig()` has a 200ms cache. Under sustained load of 100 messages/second, it reads from disk at most 5 times/second. The JSON5 parse + validation is fast (<1ms for typical configs).

2. **Backward compatibility:** The `kind: "none"` classification in `config-reload.ts` **becomes correct** after this fix — bindings truly are dynamically read now, so no reload action is needed.

3. **Thread safety:** Node.js is single-threaded. `loadConfig()` reads synchronously. No race conditions possible.

4. **Corrupted config:** `loadConfig()` already handles invalid configs by returning the last valid cached config (the cache is only updated on successful parse).

5. **200ms staleness window:** After writing a new binding, routing may use the old binding for up to 200ms. This is acceptable — the alternative (gateway restart) causes 2-5 seconds of downtime.

6. **No new abstractions:** Uses existing `loadConfig()` infrastructure. No new APIs, events, or patterns introduced.

### Edge Cases Analyzed

| Scenario | Behavior |
|----------|----------|
| Config written mid-message-processing | Next message (after 200ms cache expiry) picks up new config. Current message completes with old routing. |
| Config file deleted | `loadConfig()` returns last cached valid config. Gateway continues working. |
| Config file corrupted (invalid JSON5) | `loadConfig()` returns last cached valid config. Config watcher logs warning. |
| `OPENCLAW_DISABLE_CONFIG_CACHE=1` | Cache disabled. Every `resolveAgentRoute()` call reads from disk. Still fast (~1ms) but not recommended for high-throughput. |
| `OPENCLAW_CONFIG_CACHE_MS=0` | Same as above — cache disabled. |
| `OPENCLAW_CONFIG_CACHE_MS=5000` | Bindings changes take up to 5 seconds to take effect. User-configurable tradeoff. |
| Multiple bindings changed simultaneously | Single `loadConfig()` call returns entire config including all bindings. Atomic read. |

### Test Plan

1. **Manual test:**
   - Start gateway with one agent and no bindings
   - Send message → routes to default agent
   - Add binding for a specific peer to a second agent (via `openclaw config set` or direct file edit)
   - Send message from that peer → should route to second agent WITHOUT restart
   - Verify config watcher log says `"config change applied (dynamic reads: bindings)"` (same as before)

2. **Automated test suggestion:**
   - In `on-message.test.ts`: create handler, mutate config file, verify next `resolveAgentRoute()` picks up new bindings
   - In `config-reload.test.ts`: verify `buildGatewayReloadPlan` still classifies bindings as `noopPaths` (no regression)

### Why Not Alternative Approaches

**PR B — Hot action for bindings:** Would change `bindings` to `kind: "hot"` with a new `actions: ["refresh-routing"]` action. Requires adding a mutable config reference or event system for routing updates in all channels. ~50-100 lines, more review surface, more risk. The "none" classification is correct once routing reads dynamically.

**PR C — Route override in plugin hooks:** Would let `message_received` return `{ routeTo: "agentId" }`. Major API change, different design philosophy. Out of scope for a bug fix.

**`gateway.reload.mode: "restart"`:** User-facing workaround that restarts the entire gateway on ANY config change. Heavy-handed — restarts on plugin changes, model changes, etc. Causes unnecessary downtime.

### Impact

This fix resolves a class of bugs where runtime binding changes are invisible to message routing:
- **#6602** — Multi-agent routing bindings ignored (Signal, WhatsApp)
- **#9351** — Telegram bot routing broken with accountId bindings
- **#10576** — Would unblock per-topic agent routing (bindings would take effect immediately)
- Any multi-agent setup that adds/removes bindings at runtime

### Notes for Reviewers

- The `cfg` parameter is still used for non-routing purposes (channel config, media limits, etc.) in all handlers. Only the `resolveAgentRoute()` call needs fresh config, because that's where `listBindings(cfg)` reads the bindings array.
- The `loadConfig()` function is already imported in `telegram/bot.ts`. The other 3 files need a new import.
- This change is safe to cherry-pick into patch releases.
