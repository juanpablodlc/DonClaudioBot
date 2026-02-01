# Onboarding Trigger Mechanism Research

**Task**: P1-003 - Investigate and document onboarding trigger mechanism
**Date**: 2026-02-01
**Status**: Research Complete

## Executive Summary

The original architecture assumed `command:new` would trigger on new WhatsApp messages. **This assumption is incorrect.** OpenClaw hooks fire on **agent commands** (`/new`, `/reset`, `/stop`) and **lifecycle events**, NOT on incoming messages.

The `message:received` event is listed as "Planned" but **NOT IMPLEMENTED** in OpenClaw as of this research.

## Key Findings

### 1. Current Hook Events (Implemented)

Source: `openclaw-reference/hooks.md`

**Command Events** (agent commands issued by users):
- `command` - All command events (general listener)
- `command:new` - When `/new` command is issued
- `command:reset` - When `/reset` command is issued
- `command:stop` - When `/stop` command is issued

**Agent Events**:
- `agent:bootstrap` - Before workspace bootstrap files are injected

**Gateway Events**:
- `gateway:startup` - After channels start and hooks are loaded

### 2. Planned Events (NOT Implemented)

From `hooks.md` "Future Events" section:
- `session:start` - When a new session begins
- `session:end` - When a session ends
- `agent:error` - When an agent encounters an error
- `message:sent` - When a message is sent
- **`message:received`** - When a message is received

**`message:received` is NOT available for use.**

### 3. WhatsApp Message Flow

Source: `openclaw-reference/channels/whatsapp.md`

WhatsApp inbound flow is handled via Baileys library directly:

```
WhatsApp events come from `messages.upsert` (Baileys).
Inbox listeners are detached on shutdown to avoid accumulating event handlers.
Status/broadcast chats are ignored.
```

The `messages.upsert` event is a **Baileys library event**, NOT an OpenClaw hook event. It is handled internally by the Gateway's inbox listener system.

### 4. Why Hooks Cannot Trigger on Incoming Messages

The hook system is designed for **command and lifecycle automation**, not message routing:
- Hooks run **inside the Gateway process**
- They are triggered by explicit actions (commands, startup, bootstrap)
- The Gateway's inbox system handles `messages.upsert` internally
- No hook event exists for "any incoming message"

## Recommended Approach

### Option 1: Direct Webhook Trigger (RECOMMENDED)

Use the Onboarding Service's webhook endpoint (`POST /webhook/onboarding`) triggered by:

1. **WhatsApp Gateway Middleware**: Extend OpenClaw Gateway to call the webhook on first-time DM
2. **External Trigger**: Baileys custom middleware in a separate process
3. **Manual Testing**: Direct curl request

**Manual webhook test command**:
```bash
curl -X POST \
  -H 'Authorization: Bearer $HOOK_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+15551234567"}' \
  http://127.0.0.1:3000/webhook/onboarding
```

### Option 2: First-Mount Hook with State Check

Create a custom hook that runs on `gateway:startup` to check for pending onboarding requests, but this requires:
- Persistent state outside OpenClaw (SQLite already exists in Onboarding Service)
- Polling mechanism
- More complex coordination

### Option 3: Extend OpenClaw (Future)

Wait for or implement `message:received` event in OpenClaw core. This would require:
- Forking OpenClaw or contributing upstream
- Adding new hook type
- Testing and validation

## Alternative Approaches Considered

| Approach | Feasibility | Notes |
|----------|-------------|-------|
| Baileys `messages.upsert` directly | High | Requires separate process or Gateway extension |
| OpenClaw `message:received` hook | LOW | Not implemented; "Planned" only |
| Gmail Pub/Sub pattern | Medium | Would work for email, not WhatsApp |
| Polling onboarding state | Medium | Adds latency; not event-driven |
| First-command detection (`/new`) | HIGH | User must type `/new` first |

## Implementation Recommendation

**Use Option 1 (Direct Webhook)** with one of these triggers:

1. **Short-term**: Manual curl / WhatsApp Business API webhook
2. **Mid-term**: Custom Baileys middleware process listening to `messages.upsert`
3. **Long-term**: Contribute `message:received` hook to OpenClaw upstream

## Technical Context

### Baileys `messages.upsert` Event

```typescript
// Baileys event (NOT OpenClaw hook)
sock.ev.on('messages.upsert', ({ messages, type }) => {
  // messages is an array of WhatsApp message objects
  // type is 'notify' or 'replace'
});
```

This event is **internal to OpenClaw Gateway** and not exposed via the hook system.

### Webhook Payload

```bash
curl -X POST \
  -H 'Authorization: Bearer $HOOK_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+15551234567"}' \
  http://127.0.0.1:3000/webhook/onboarding
```

- **Endpoint**: `POST /webhook/onboarding`
- **Auth**: Bearer token in `Authorization` header
- **Payload**: `{ "phone": "+15551234567" }` (E.164 format)

## References

- `openclaw-reference/hooks.md` - Hook events documentation
- `openclaw-reference/channels/whatsapp.md` - WhatsApp inbound flow
- `openclaw-reference/automation/webhook.md` - Webhook endpoint patterns

## Conclusion

The `message:received` hook event does not exist. The onboarding trigger must use a direct webhook call (`POST /webhook/onboarding`) from an external source that listens to incoming WhatsApp messages via Baileys `messages.upsert` or another mechanism.

**Do not rely on OpenClaw hooks for incoming message triggers.**

---

**Verification** (run to confirm documentation exists):
```bash
test -f /Users/jp/CodingProjects/DonClaudioBot/docs/ONBOARDING_TRIGGER.md
grep -q 'curl.*webhook/onboarding' /Users/jp/CodingProjects/DonClaudioBot/docs/ONBOARDING_TRIGGER.md
grep -qi 'messages.upsert\|message:received\|hook\|trigger' /Users/jp/CodingProjects/DonClaudioBot/docs/ONBOARDING_TRIGGER.md
```
