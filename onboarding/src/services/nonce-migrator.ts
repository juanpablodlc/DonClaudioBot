// Nonce Migrator — one-time fix for the nonce ordering bug
// Bug: setOAuthNonce() (UPDATE) ran before createState() (INSERT),
// so the UPDATE hit 0 rows and all users got oauth_nonce=NULL.
// This regenerates nonces + OAuth URLs for affected users at startup.

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { DB_PATH, setOAuthNonce } from './state-manager.js';
import { generateOAuthUrl } from './oauth-url-generator.js';

interface NullNonceRow {
  phone_number: string;
  agent_id: string;
}

export function migrateNullNonces(): void {
  // Skip if OAuth isn't configured
  if (!process.env.GOOGLE_WEB_CLIENT_ID || !process.env.OAUTH_REDIRECT_URI) {
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    "SELECT phone_number, agent_id FROM onboarding_states WHERE oauth_nonce IS NULL AND (oauth_status = 'pending' OR oauth_status IS NULL)"
  ).all() as NullNonceRow[];
  db.close();

  if (rows.length === 0) return;

  console.log(`[nonce-migrator] Found ${rows.length} user(s) with NULL nonces, regenerating...`);

  const stateDir = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';

  for (const row of rows) {
    try {
      const { url, nonce } = generateOAuthUrl(row.agent_id, row.phone_number);
      const workspace = join(stateDir, `workspace-${row.agent_id}`);

      writeFileSync(join(workspace, '.oauth-url.txt'), url, 'utf-8');
      setOAuthNonce(row.phone_number, nonce);

      console.log(`[nonce-migrator] Regenerated nonce for ${row.agent_id}`);
    } catch (err) {
      console.warn(`[nonce-migrator] Failed for ${row.agent_id}:`, err);
    }
  }

  console.log(`[nonce-migrator] Migration complete`);
}
