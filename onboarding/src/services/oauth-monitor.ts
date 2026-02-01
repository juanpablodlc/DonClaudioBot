// OAuth Monitor Service
// Monitors OAuth token health and marks failures in onboarding state

import { promises as fs } from 'fs';
import { join } from 'path';
import { updateState } from './state-manager.js';

const OPENCLAW_DIR = process.env.OPENCLAW_STATE_DIR
  ? process.env.OPENCLAW_STATE_DIR
  : `${process.env.HOME || '~'}/.openclaw`;

const TOKEN_PATH = 'agent/.gog/tokens.json';
const EXPIRY_DAYS = 90;
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * OAuth health check result
 */
export interface OAuthHealthResult {
  healthy: boolean;
  error?: string;
}

/**
 * Token file structure
 */
interface TokenFile {
  expiry?: number;
}

/**
 * Check if OAuth token is healthy for an agent
 * Validates token file exists and is not expired (>90 days)
 */
export async function checkOAuthHealth(agentId: string): Promise<OAuthHealthResult> {
  const tokenPath = join(OPENCLAW_DIR, 'agents', agentId, TOKEN_PATH);

  try {
    // Check if token file exists
    await fs.access(tokenPath);

    // Read token file
    const tokenContent = await fs.readFile(tokenPath, 'utf-8');
    const tokens: TokenFile = JSON.parse(tokenContent);

    // Check expiry field if present
    if (tokens.expiry) {
      const now = Date.now();
      const expiryTime = tokens.expiry;

      if (expiryTime <= now) {
        return { healthy: false, error: 'Token expired' };
      }

      // Check if token will expire within 90 days
      if (expiryTime - now < EXPIRY_MS) {
        return { healthy: false, error: 'Token expires soon' };
      }
    } else {
      // No expiry field, check file mtime
      const stats = await fs.stat(tokenPath);
      const fileAge = Date.now() - stats.mtime.getTime();

      if (fileAge >= EXPIRY_MS) {
        return { healthy: false, error: 'Token expired' };
      }
    }

    return { healthy: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { healthy: false, error: 'Token file not found' };
    }
    return { healthy: false, error: 'Failed to read token file' };
  }
}

/**
 * Mark OAuth failure for a phone number
 * Updates state status to 'oauth_failed' and logs error
 */
export async function markOAuthFailed(phone: string, error: string): Promise<void> {
  console.log(`[oauth-failed] Phone: ${phone}, Error: ${error}`);

  // Update state to oauth_failed status
  updateState(phone, { status: 'oauth_failed' });
}

/**
 * Scan all agents for expired OAuth tokens
 * Returns array of agent IDs with expired tokens
 */
export async function cleanupExpiredTokens(): Promise<string[]> {
  const agentsDir = join(OPENCLAW_DIR, 'agents');
  const expiredAgents: string[] = [];

  try {
    // List all agent directories
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentId = entry.name;
      const health = await checkOAuthHealth(agentId);

      if (!health.healthy) {
        expiredAgents.push(agentId);
        console.log(`[oauth-monitor] Found expired tokens for agent: ${agentId}`);
      }
    }
  } catch (error) {
    console.error('[oauth-monitor] Failed to scan agents:', error);
  }

  return expiredAgents;
}
