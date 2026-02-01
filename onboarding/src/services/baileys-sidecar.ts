// Baileys Sidecar Service
// Detects incoming WhatsApp messages from unknown users and triggers onboarding

import makeWASocket, { ConnectionState, DisconnectReason, WAMessage } from '@whiskeysockets/baileys';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getState } from './state-manager.js';
import { normalizePhoneNumber } from '../lib/phone-normalizer.js';

const OPENCLAW_DIR = process.env.OPENCLAW_STATE_DIR
  ? process.env.OPENCLAW_STATE_DIR
  : `${process.env.HOME || '~'}/.openclaw`;

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook/onboarding';
const HOOK_TOKEN = process.env.HOOK_TOKEN;

const WHATSAPP_ACCOUNT_ID = process.env.WHATSAPP_ACCOUNT_ID || 'default';

// Reconnect backoff (5s, exponential, max 60s)
let reconnectDelay = 5000;
const MAX_RECONNECT_DELAY = 60000;

/**
 * Extract phone from JID if it's a DM from unknown user
 * Returns undefined for groups, broadcasts, self-messages
 */
function extractPhoneFromJid(jid: string | undefined): string | undefined {
  if (!jid) return undefined;

  // Skip groups, broadcasts, and status messages
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) {
    return undefined;
  }

  // Must be a DM JID (phone@s.whatsapp.net)
  if (!jid.endsWith('@s.whatsapp.net')) {
    return undefined;
  }

  let phone = jid.split('@')[0];

  // Ensure E.164 format (must start with +)
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }

  return phone;
}

/**
 * Trigger onboarding webhook for new user
 */
async function triggerOnboarding(phone: string): Promise<void> {
  if (!HOOK_TOKEN) {
    console.error('[baileys-sidecar] HOOK_TOKEN not set');
    return;
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HOOK_TOKEN}`,
      },
      body: JSON.stringify({ phone, timestamp: new Date().toISOString() }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === 'existing') {
        console.log(`[baileys-sidecar] Existing user: ${data.agentId}`);
      } else {
        console.log(`[baileys-sidecar] Onboarding triggered: ${phone}`);
      }
    } else {
      console.error(`[baileys-sidecar] Webhook failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[baileys-sidecar] Webhook error:`, error);
  }
}

/**
 * Create and configure a new Baileys socket
 */
function createSocket(authPath: string) {
  if (!existsSync(authPath)) {
    console.error(`[baileys-sidecar] Auth file not found: ${authPath}`);
    throw new Error(`WhatsApp auth not found at ${authPath}`);
  }

  const authState = JSON.parse(readFileSync(authPath, 'utf-8'));

  return makeWASocket({
    auth: authState,
    printQRInTerminal: false,
  });
}

/**
 * Start Baileys sidecar service with auto-reconnect
 */
export function startBaileysSidecar(): void {
  const authPath = join(OPENCLAW_DIR, 'credentials/whatsapp', WHATSAPP_ACCOUNT_ID, 'creds.json');
  console.log(`[baileys-sidecar] Starting with auth: ${authPath}`);

  function connect() {
    const socket = createSocket(authPath);

    // Handle connection state
    socket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.error(`[baileys-sidecar] Connection closed:`, lastDisconnect?.error);

        if (shouldReconnect) {
          console.log(`[baileys-sidecar] Reconnecting in ${reconnectDelay}ms...`);
          setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
            connect();
          }, reconnectDelay);
        } else {
          console.error('[baileys-sidecar] Logged out - please re-link WhatsApp');
        }
      }

      if (connection === 'open') {
        console.log('[baileys-sidecar] Connected');
        reconnectDelay = 5000; // Reset backoff on success
      }
    });

    // Handle incoming messages
    socket.ev.on('messages.upsert', async ({ messages, type }: { messages: WAMessage[]; type: string }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        // Skip messages from self
        if (message.key.fromMe) continue;

        // Extract phone (returns undefined for groups/broadcasts)
        const phone = extractPhoneFromJid(message.key.remoteJid ?? undefined);
        if (!phone) continue;

        try {
          const normalizedPhone = normalizePhoneNumber(phone);

          // Check if user already exists
          const existing = getState(normalizedPhone);
          if (existing && existing.status !== 'cancelled') {
            console.log(`[baileys-sidecar] Known user: ${normalizedPhone}`);
            continue;
          }

          // Unknown user - trigger onboarding
          console.log(`[baileys-sidecar] Unknown user: ${normalizedPhone}`);
          await triggerOnboarding(normalizedPhone);
        } catch {
          // Invalid phone format - skip
          continue;
        }
      }
    });
  }

  connect();
}
