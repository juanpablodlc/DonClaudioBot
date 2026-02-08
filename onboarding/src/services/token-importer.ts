// Token Importer Service
// Imports OAuth refresh tokens into an agent's gog keyring

import { execFile } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { readConfig, writeConfigAtomic } from './config-writer.js';

const execFileAsync = promisify(execFile);
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';

/**
 * Import a refresh token into an agent's gog keyring
 * Runs from main container (not sandbox) — gog is installed, volume is shared
 */
export async function importTokenToAgent(
  agentId: string,
  email: string,
  refreshToken: string,
): Promise<void> {
  const workspacePath = join(STATE_DIR, `workspace-${agentId}`);
  const gogConfigDir = join(workspacePath, '.gog-config');
  const keyringDir = join(gogConfigDir, 'gogcli', 'keyring');

  // Ensure gog config directories exist
  await mkdir(keyringDir, { recursive: true });

  // Read agent's GOG_KEYRING_PASSWORD from openclaw.json
  const config = readConfig();
  const agent = config.agents.list.find((a: { id: string }) => a.id === agentId);
  if (!agent?.sandbox?.docker?.env?.GOG_KEYRING_PASSWORD) {
    throw new Error(`No GOG_KEYRING_PASSWORD found for agent ${agentId}`);
  }
  const keyringPassword = agent.sandbox.docker.env.GOG_KEYRING_PASSWORD;

  // Register web OAuth credentials if not already done
  const webCredsPath = '/home/node/.config/gogcli-web/credentials.json';
  try {
    await execFileAsync('gog', ['auth', 'credentials', webCredsPath], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: gogConfigDir,
        GOG_KEYRING_PASSWORD: keyringPassword,
        GOG_KEYRING_BACKEND: 'file',
      },
    });
  } catch (err) {
    // May fail if already registered — non-fatal
    console.log(`[token-importer] Credentials registration (may already exist):`, (err as Error).message);
  }

  // Write temporary token file for import
  const tokenFile = join('/tmp', `oauth-token-${agentId}-${Date.now()}.json`);
  const tokenData = {
    email,
    services: ['gmail', 'calendar', 'drive'],
    scopes: [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'openid',
      'email',
    ],
    refresh_token: refreshToken,
  };

  try {
    await writeFile(tokenFile, JSON.stringify(tokenData), 'utf-8');

    // Import token into agent's gog keyring
    const { stdout, stderr } = await execFileAsync('gog', ['auth', 'tokens', 'import', tokenFile], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: gogConfigDir,
        GOG_KEYRING_PASSWORD: keyringPassword,
        GOG_KEYRING_BACKEND: 'file',
      },
    });

    if (stdout) console.log(`[token-importer] Import output: ${stdout.trim()}`);
    if (stderr) console.warn(`[token-importer] Import stderr: ${stderr.trim()}`);
  } finally {
    // Always delete temp file (contains secrets)
    try { await unlink(tokenFile); } catch { /* ignore */ }
  }

  // Set GOG_ACCOUNT in agent's sandbox env so gog auto-selects this account
  // (gog requires --account when multiple token files exist in the keyring)
  const fullConfig = readConfig();
  const agentEntry = fullConfig.agents.list.find((a: { id: string }) => a.id === agentId);
  if (agentEntry?.sandbox?.docker?.env) {
    agentEntry.sandbox.docker.env.GOG_ACCOUNT = email;
    await writeConfigAtomic(fullConfig);
    console.log(`[token-importer] Set GOG_ACCOUNT=${email} for agent ${agentId}`);
  }

  console.log(`[token-importer] Token imported for ${email} → agent ${agentId}`);
}
