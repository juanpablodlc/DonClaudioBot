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
    };
  };
}

/**
 * Create a new dedicated agent with transactional rollback
 * Steps: 1) Validate phone, 2) Generate agentId, 3) Backup config, 4) Update config, 5) Create workspace, 6) Create state dir
 * On failure: Restore backup, re-throw
 */
export async function createAgent(options: CreateAgentOptions): Promise<string> {
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
          env: {
            GOG_KEYRING_PASSWORD: randomBytes(32).toString('base64url'),
            GOG_CONFIG_DIR: `/home/node/.gog/plus_${phoneNumber.replace('+', '')}`,
          },
          network: 'bridge',
          memory: '512m',
          cpus: 0.5,
          pidsLimit: 100,
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

    // Step 7: Copy Spanish "Don Claudio" template files to workspace
    // Templates are located at config/agents/dedicated-es/ relative to project root
    const { join } = await import('path');
    const templateDir = join(process.cwd(), 'config', 'agents', 'dedicated-es');
    const templateFiles = ['AGENTS.md', 'SOUL.md', 'MEMORY.md'];

    for (const file of templateFiles) {
      try {
        await copyFile(join(templateDir, file), join(agentConfig.workspace, file));
      } catch (error) {
        // Log warning but don't fail agent creation if templates are missing
        console.warn(`[agent-creator] Could not copy template file ${file}:`, error);
      }
    }

    // Gateway auto-reloads via fs.watch() - no manual reload needed

    // Audit log: agent created successfully
    logAgentCreation(phoneNumber, agentId, true);

    return agentId;
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
