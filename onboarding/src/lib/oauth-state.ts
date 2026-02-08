// OAuth State Token Management
// Uses a short opaque nonce as the state parameter (32 hex chars).
// The full payload (agentId, phone) is stored server-side in SQLite.
// This avoids long base64 URLs that WhatsApp can corrupt during rendering.

import { randomBytes } from 'crypto';

/**
 * Generate a random nonce for use as OAuth state parameter.
 * The nonce is stored in the DB alongside agentId and phone.
 * On callback, we look up the nonce to recover the full context.
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
