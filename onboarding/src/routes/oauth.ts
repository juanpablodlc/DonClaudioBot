// OAuth Callback Route
// Handles Google OAuth redirect after user grants consent
// State parameter is a short opaque nonce (32 hex chars) that maps to
// a server-side record in SQLite. This avoids long base64 URLs that
// WhatsApp corrupts during link rendering.

import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { lookupOAuthNonce, setOAuthStatus } from '../services/state-manager.js';
import { importTokenToAgent } from '../services/token-importer.js';

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';

export const router = Router();

/**
 * GET /oauth/callback?code=AUTH_CODE&state=NONCE
 * Google redirects here after user grants consent
 */
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle Google OAuth errors
  if (error) {
    console.error(`[oauth] Google returned error: ${error}`);
    return res.status(400).send(errorPage('Google denied access. Please try again from WhatsApp.'));
  }

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).send(errorPage('Missing authorization code or state parameter.'));
  }

  try {
    // Step 1: Look up nonce in DB to get phone and agentId
    const record = lookupOAuthNonce(state);
    if (!record) {
      console.warn(`[oauth] Invalid or already-used nonce: ${state}`);
      return res.status(400).send(errorPage('This link has already been used or has expired. Please request a new one from your assistant.'));
    }

    const { phone, agentId } = record;

    // Step 2: Exchange auth code for tokens
    const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_WEB_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('OAuth environment variables not configured');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error(`[oauth] Token exchange failed: ${err}`);
      setOAuthStatus(phone, 'failed');
      return res.status(500).send(errorPage('Failed to exchange authorization code. Please try again.'));
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      scope: string;
    };

    if (!tokens.refresh_token) {
      console.error('[oauth] No refresh_token in response (user may have already granted access)');
      setOAuthStatus(phone, 'failed');
      return res.status(500).send(errorPage('No refresh token received. Please revoke app access in your Google Account settings and try again.'));
    }

    // Step 3: Extract email from id_token (JWT decode, no verification — trusted source)
    let email = 'unknown';
    if (tokens.id_token) {
      try {
        const payloadPart = tokens.id_token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payloadPart, 'base64url').toString());
        email = decoded.email || email;
      } catch { /* fall back to 'unknown' */ }
    }

    // Step 4: Import token into agent's gog keyring
    await importTokenToAgent(agentId, email, tokens.refresh_token);

    // Step 5: Update USER.md — replace OAuth link with "Connected" status
    try {
      const userMdPath = join(STATE_DIR, `workspace-${agentId}`, 'USER.md');
      const userMd = await readFile(userMdPath, 'utf-8');
      const updated = userMd.replace(
        /## Google OAuth Link[\s\S]*?(?=\n## |\n*$)/,
        `## Google Account Connected\n\nGoogle account connected: ${email}\nYou can now use gog commands (gmail, calendar, drive).\n`,
      );
      if (updated !== userMd) {
        await writeFile(userMdPath, updated, 'utf-8');
        console.log(`[oauth] Updated USER.md for agent ${agentId}`);
      }
    } catch (err) {
      // Non-fatal — token is already imported
      console.warn(`[oauth] Could not update USER.md (non-fatal):`, err);
    }

    console.log(`[oauth] Successfully completed OAuth for ${email} → agent ${agentId}`);
    return res.status(200).send(successPage(email));

  } catch (err) {
    console.error('[oauth] Callback error:', err);
    return res.status(500).send(errorPage('Something went wrong. Please try again from WhatsApp.'));
  }
});

function successPage(email: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connected!</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0fdf4}
.card{text-align:center;padding:2rem;max-width:400px}
.check{font-size:4rem;margin-bottom:1rem}h1{color:#166534;margin:0.5rem 0}p{color:#4b5563}</style>
</head><body><div class="card">
<div class="check">&#10003;</div>
<h1>Connected!</h1>
<p>Your Google account (${email}) is now linked.</p>
<p>You can close this tab and return to WhatsApp.</p>
</div></body></html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Error</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fef2f2}
.card{text-align:center;padding:2rem;max-width:400px}
.x{font-size:4rem;margin-bottom:1rem;color:#dc2626}h1{color:#991b1b;margin:0.5rem 0}p{color:#4b5563}</style>
</head><body><div class="card">
<div class="x">&#10007;</div>
<h1>Something went wrong</h1>
<p>${message}</p>
</div></body></html>`;
}
