// Agent Creator Service
// Wrapper around OpenClaw CLI for dynamic agent creation with transactional rollback

import { randomBytes } from 'crypto';
import { E164PhoneSchema } from '../lib/validation.js';
import { logAgentCreation } from '../lib/audit-logger.js';
import { validateSandboxConfig } from '../lib/sandbox-validator.js';
import type { AgentConfig as ConfigWriterAgentConfig } from './config-writer.js';

export interface CreateAgentOptions {
  phoneNumber: string;
}

// Agent config matching OpenClaw spec
export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
  sandbox: {
    mode: string;
    scope: string;
    workspaceAccess: string;
    docker: {
      image: string;
      env: Record<string, string>;
      network: string;
      memory?: string;
      cpus?: number;
      pidsLimit?: number;
      privileged?: boolean;
      capDrop?: string[];
      binds?: string[];
      setupCommand?: string;
    };
  };
}

export interface CreateAgentResult {
  agentId: string;
  oauthNonce?: string;
}

/**
 * Create a new dedicated agent with transactional rollback
 * Steps: 1) Validate phone, 2) Generate agentId, 3) Backup config, 4) Update config, 5) Create workspace, 6) Create state dir
 * On failure: Restore backup, re-throw
 *
 * NOTE: Returns oauthNonce but does NOT store it in the DB. The caller must call
 * setOAuthNonce() AFTER creating the DB row (createState), otherwise the UPDATE
 * silently affects 0 rows and the nonce is lost.
 */
export async function createAgent(options: CreateAgentOptions): Promise<CreateAgentResult> {
  // Validate phone format
  const { phoneNumber } = options;
  E164PhoneSchema.parse(phoneNumber);

  // Generate unique agent ID: user_<16 hex chars>
  const agentId = `user_${randomBytes(8).toString('hex')}`;

  // Track state for rollback
  let configUpdated = false;
  let backupPath: string | null = null;

  try {
    // Step 1: Backup config before making changes
    const { backupConfig } = await import('./config-writer.js');
    backupPath = await backupConfig();

    // Step 2: Build agent config and add to openclaw.json
    const gogKeyringPassword = randomBytes(32).toString('base64url');

    const agentConfig: AgentConfig = {
      id: agentId,
      name: 'User Agent',
      workspace: `${process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw'}/workspace-${agentId}`,
      agentDir: `${process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw'}/agents/${agentId}/agent`,
      sandbox: {
        mode: 'all',
        scope: 'agent',
        workspaceAccess: 'rw',  // Allow agents to write memory and users to edit their agent files
        docker: {
          image: 'openclaw-sandbox:bookworm-slim',
          // OpenClaw sets HOME=/workspace during tool execution, so all paths are workspace-relative
          // docker.env vars are injected via docker exec -e at every tool call (not at container creation)
          env: {
            GOG_KEYRING_PASSWORD: gogKeyringPassword,
            XDG_CONFIG_HOME: '/workspace/.gog-config',
            GOG_KEYRING_BACKEND: 'file',
          },
          network: 'bridge',
          memory: '512m',
          cpus: 0.5,
          pidsLimit: 100,
          binds: [
            '/root/google-credentials/credentials.json:/workspace/.config/gogcli/credentials.json:ro',
          ],
          // setupCommand: Create isolated gog config with credentials as DEFAULT
          // This prevents agents from seeing the read-only bind mount ("poison pill")
          // XDG_CONFIG_HOME isolates gog to /workspace/.gog-config/gogcli/
          // We copy credentials to credentials.json (default) so agents don't need --client flag
          // NOTE: gogcli v0.8.0 doesn't support --client flag, so we use the default client
          setupCommand: [
            '# Create isolated gog config directory',
            'mkdir -p /workspace/.gog-config/gogcli/keyring',
            '',
            '# Store OAuth client credentials as DEFAULT client',
            '# XDG_CONFIG_HOME must be set (setupCommand runs with different HOME)',
            `XDG_CONFIG_HOME=/workspace/.gog-config gog auth credentials /workspace/.config/gogcli/credentials.json`,
          ].join('\n'),
        },
      },
    };

    // Step 3: Validate sandbox config before adding (security check)
    validateSandboxConfig(agentConfig);

    // Step 4: Add agent to config (writes to openclaw.json, Gateway auto-reloads via fs.watch())
    const { addAgentToConfig } = await import('./config-writer.js');
    await addAgentToConfig(agentConfig as unknown as ConfigWriterAgentConfig, phoneNumber);
    configUpdated = true;

    // Step 5: Create agent workspace directory structure (what CLI would have done)
    const { mkdir, copyFile } = await import('fs/promises');
    await mkdir(agentConfig.workspace, { recursive: true });

    // Step 6: Create agent state directory
    await mkdir(agentConfig.agentDir!, { recursive: true });

    // Step 7: Copy language-appropriate template files to workspace
    const { join } = await import('path');
    const { detectLanguage } = await import('../lib/language-detector.js');
    const languageFolder = detectLanguage(phoneNumber);
    console.log(`[agent-creator] Using template: ${languageFolder} for ${phoneNumber}`);
    const templateDir = join(process.cwd(), 'config', 'agents', languageFolder);
    const templateFiles = ['AGENTS.md', 'SOUL.md', 'MEMORY.md'];

    for (const file of templateFiles) {
      try {
        await copyFile(join(templateDir, file), join(agentConfig.workspace, file));
      } catch (error) {
        // Log warning but don't fail agent creation if templates are missing
        console.warn(`[agent-creator] Could not copy template file ${file}:`, error);
      }
    }

    // Step 8: Generate OAuth URL and write to workspace (if web OAuth is configured)
    // NOTE: We return the nonce but do NOT call setOAuthNonce() here — the DB row
    // doesn't exist yet. The caller (webhook.ts) stores it after createState().
    let oauthNonce: string | undefined;
    if (process.env.GOOGLE_WEB_CLIENT_ID && process.env.OAUTH_REDIRECT_URI) {
      try {
        const { generateOAuthUrl } = await import('./oauth-url-generator.js');
        const { writeFile } = await import('fs/promises');

        const { url, nonce } = generateOAuthUrl(agentId, phoneNumber);
        await writeFile(join(agentConfig.workspace, '.oauth-url.txt'), url, 'utf-8');
        oauthNonce = nonce;
        console.log(`[agent-creator] OAuth URL generated for ${agentId}`);
      } catch (oauthError) {
        // Non-fatal: agent works without OAuth, user can set up later
        console.warn('[agent-creator] OAuth URL generation failed (non-fatal):', oauthError);
      }
    }

    // Gateway auto-reloads via fs.watch() - no manual reload needed

    // Audit log: agent created successfully
    logAgentCreation(phoneNumber, agentId, true);

    return { agentId, oauthNonce };
  } catch (error) {
    // ROLLBACK: restore config if it was updated
    if (configUpdated && backupPath) {
      try {
        const { restoreBackup } = await import('./config-writer.js');
        await restoreBackup(backupPath);
      } catch (rollbackError) {
        console.error('[agent-creator] Failed to restore config backup:', rollbackError);
      }
    }

    throw error;
  }
}

/**
 * Check if agent exists in OpenClaw config
 */
export async function agentExists(agentId: string): Promise<boolean> {
  const { readConfig } = await import('./config-writer.js');
  const config = readConfig() as { agents: { list: { id: string }[] } };
  return config.agents.list.some(agent => agent.id === agentId);
}

/**
 * Get existing agent ID for a phone number from bindings
 */
export async function getAgentByPhone(phoneNumber: string): Promise<string | null> {
  const { readConfig } = await import('./config-writer.js');
  const config = readConfig() as { bindings: { agentId: string; match: { peer?: { id: string } } }[] };

  const binding = config.bindings.find(
    b => b.match?.peer?.id === phoneNumber
  );

  return binding?.agentId || null;
}
