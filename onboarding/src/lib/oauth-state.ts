// OAuth State Token Management
// HMAC-SHA256 signed state parameter for CSRF protection

import { createHmac, randomBytes } from 'crypto';

const STATE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours (URL generated at agent creation, may not be used for hours)

interface StatePayload {
  agentId: string;
  phone: string;
  nonce: string;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.HOOK_TOKEN;
  if (!secret) throw new Error('HOOK_TOKEN required for OAuth state signing');
  return secret;
}

/**
 * Encode state payload with HMAC-SHA256 signature
 * Returns base64url string: <payload>.<signature>
 */
export function encodeState(agentId: string, phone: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const payload: StatePayload = {
    agentId,
    phone,
    nonce,
    exp: Date.now() + STATE_EXPIRY_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return { state: `${payloadB64}.${sig}`, nonce };
}

/**
 * Decode and validate state parameter
 * Throws on invalid signature, expiry, or malformed data
 */
export function decodeState(stateParam: string): StatePayload {
  const parts = stateParam.split('.');
  if (parts.length !== 2) throw new Error('Invalid state format');

  const [payloadB64, sig] = parts;
  const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');

  if (sig !== expectedSig) throw new Error('Invalid state signature');

  const payload: StatePayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  if (Date.now() > payload.exp) throw new Error('State token expired');
  if (!payload.agentId || !payload.phone || !payload.nonce) throw new Error('Incomplete state payload');

  return payload;
}
