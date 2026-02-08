// Session Watcher Service
// Polls welcome agent's sessions.json for new phone numbers and triggers agent creation
// Replaces Baileys sidecar (which can't coexist with Gateway's WhatsApp connection)

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { getState, createState, setOAuthNonce } from './state-manager.js';
import { createAgent } from './agent-creator.js';

const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';
const SESSIONS_PATH = `${OPENCLAW_STATE_DIR}/agents/welcome/sessions/sessions.json`;
const POLL_INTERVAL = parseInt(process.env.SESSION_POLL_INTERVAL || '5000', 10);

// Session key format (per-channel-peer): agent:welcome:whatsapp:dm:+1234567890
const SESSION_KEY_REGEX = /^agent:welcome:whatsapp:dm:(\+\d+)$/;

// Track known session keys to detect only NEW sessions
const knownKeys = new Set<string>();

// Prevent concurrent processing of the same phone
const processingSet = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Extract phone number from a welcome agent session key
 * Returns null if key doesn't match expected format
 */
export function extractPhoneFromSessionKey(key: string): string | null {
  const match = key.match(SESSION_KEY_REGEX);
  return match ? match[1] : null;
}

/**
 * Read and parse sessions.json, returning session keys
 * Returns empty array if file doesn't exist or is invalid
 */
function readSessionKeys(): string[] {
  try {
    if (!existsSync(SESSIONS_PATH)) return [];
    const content = readFileSync(SESSIONS_PATH, 'utf-8');
    const sessions = JSON.parse(content);
    return Object.keys(sessions);
  } catch {
    return [];
  }
}

/**
 * Process a single new phone number: create agent + store state
 */
async function processNewPhone(phone: string): Promise<void> {
  if (processingSet.has(phone)) return;
  processingSet.add(phone);

  try {
    // Idempotent check: already in SQLite?
    const existing = getState(phone);
    if (existing) {
      console.log(`[session-watcher] Already onboarded: ${phone} (agent: ${existing.agent_id})`);
      return;
    }

    console.log(`[session-watcher] New phone detected: ${phone}`);

    // Create dedicated agent (writes config, creates workspace, copies templates)
    const { agentId, oauthNonce } = await createAgent({ phoneNumber: phone });

    // Record in SQLite, then store nonce (must be AFTER row exists)
    createState(phone, agentId, 'active');
    if (oauthNonce) setOAuthNonce(phone, oauthNonce);

    console.log(`[session-watcher] Agent created: ${agentId} for ${phone}`);

    // OpenClaw bug: binding changes are classified as "none" (no-op) in config-reload.ts,
    // but monitorWebChannel captures config in a closure at startup and never refreshes it.
    // The only way to pick up new bindings is to restart the Gateway process.
    // Launcher.js will auto-restart it within 2 seconds.
    restartGateway();
  } catch (error) {
    console.error(`[session-watcher] Failed to create agent for ${phone}:`, error);
  } finally {
    processingSet.delete(phone);
  }
}

/**
 * Restart the Gateway process so it picks up new bindings.
 * Sends SIGUSR1 to the launcher (our parent process), which owns the gateway
 * child process handle and can do a clean SIGTERM → respawn cycle.
 */
function restartGateway(): void {
  try {
    process.kill(process.ppid, 'SIGUSR1');
    console.log('[session-watcher] Sent SIGUSR1 to launcher (requesting gateway restart)');
  } catch (error) {
    console.error('[session-watcher] Failed to signal launcher:', error);
  }
}

/**
 * Single poll cycle: read sessions, find new phones, trigger creation
 */
async function poll(): Promise<void> {
  const keys = readSessionKeys();

  for (const key of keys) {
    // Skip already-known keys
    if (knownKeys.has(key)) continue;
    knownKeys.add(key);

    const phone = extractPhoneFromSessionKey(key);
    if (!phone) continue;

    // Fire and forget (don't block poll loop)
    processNewPhone(phone);
  }
}

/**
 * Start polling for new sessions
 */
export function startSessionWatcher(): void {
  console.log(`[session-watcher] Starting (poll interval: ${POLL_INTERVAL}ms)`);
  console.log(`[session-watcher] Watching: ${SESSIONS_PATH}`);

  // Initial scan: populate knownKeys with existing sessions (don't trigger for pre-existing)
  const existingKeys = readSessionKeys();
  for (const key of existingKeys) {
    knownKeys.add(key);
  }
  console.log(`[session-watcher] Found ${existingKeys.length} existing session(s), skipping`);

  pollTimer = setInterval(poll, POLL_INTERVAL);
}

/**
 * Stop polling (for graceful shutdown)
 */
export function stopSessionWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[session-watcher] Stopped');
  }
}
