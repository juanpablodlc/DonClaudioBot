// OAuth URL Generator
// Builds Google OAuth consent URL with opaque nonce as state parameter
// The nonce is short (32 hex chars) to prevent WhatsApp URL corruption

import { generateNonce } from '../lib/oauth-state.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'openid',
  'email',
].join(' ');

interface OAuthUrlResult {
  url: string;
  nonce: string;
}

/**
 * Generate Google OAuth consent URL with opaque nonce as state
 * The nonce is stored server-side (SQLite) alongside agentId and phone.
 */
export function generateOAuthUrl(agentId: string, phone: string): OAuthUrlResult {
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const redirectUri = process.env.OAUTH_REDIRECT_URI;

  if (!clientId) throw new Error('GOOGLE_WEB_CLIENT_ID not set');
  if (!redirectUri) throw new Error('OAUTH_REDIRECT_URI not set');

  const nonce = generateNonce();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: nonce,
  });

  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, nonce };
}
