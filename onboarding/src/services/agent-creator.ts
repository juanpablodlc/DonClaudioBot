// Agent Creator Service
// Wrapper around OpenClaw CLI for dynamic agent creation with transactional rollback

import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { E164PhoneSchema } from '../lib/validation.js';
import { logAgentCreation } from '../lib/audit-logger.js';
import { validateSandboxConfig } from '../lib/sandbox-validator.js';
import type { AgentConfig as ConfigWriterAgentConfig } from './config-writer.js';

const execFileAsync = promisify(execFile);

// CLI timeout: 30 seconds
const CLI_TIMEOUT = 30000;

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
      cpus?: string;
      pids_limit?: number;
      privileged?: boolean;
      capDrop?: string[];
      binds?: string[];
    };
  };
}

/**
 * Verify OpenClaw CLI is installed before any operations
 */
async function verifyOpenClawInstalled(): Promise<void> {
  try {
    await execFileAsync('openclaw', ['--version'], { timeout: 5000 });
  } catch {
    throw new Error('OpenClaw CLI not found. Install with: npm install -g openclaw');
  }
}

/**
 * Create a new dedicated agent with transactional rollback
 * Steps: 1) Validate phone, 2) Generate agentId, 3) Run CLI, 4) Backup config, 5) Update config, 6) Reload
 * On failure: Restore backup, remove agent, re-throw
 */
export async function createAgent(options: CreateAgentOptions): Promise<string> {
  // Verify OpenClaw is installed
  await verifyOpenClawInstalled();

  // Validate phone format
  const { phoneNumber } = options;
  E164PhoneSchema.parse(phoneNumber);

  // Generate unique agent ID: user_<16 hex chars>
  const agentId = `user_${randomBytes(8).toString('hex')}`;

  // Track state for rollback
  let agentCreated = false;
  let configUpdated = false;
  let backupPath: string | null = null;

  try {
    // Step 1: Create agent via CLI (using execFile to prevent command injection)
    await execFileAsync('openclaw', ['agents', 'add', agentId], { timeout: CLI_TIMEOUT });
    agentCreated = true;

    // Step 2: Backup config
    const { backupConfig } = await import('./config-writer.js');
    backupPath = await backupConfig();

    // Step 3: Build agent config and add to openclaw.json
    const agentConfig: AgentConfig = {
      id: agentId,
      name: 'User Agent',
      workspace: `~/.openclaw/workspace-${agentId}`,
      agentDir: `~/.openclaw/agents/${agentId}/agent`,
      sandbox: {
        mode: 'all',
        scope: 'agent',
        workspaceAccess: 'ro',
        docker: {
          image: 'openclaw-sandbox:bookworm-slim',
          env: {
            GOG_KEYRING_PASSWORD: randomBytes(32).toString('base64url'),
            GOG_CONFIG_DIR: `/home/node/.gog/plus_${phoneNumber.replace('+', '')}`,
          },
          network: 'bridge',
          // Sandbox resource limits: 512MB RAM, 0.5 CPU, 100 PIDs - sufficient for Node.js + gog CLI, prevents host exhaustion
          memory: '512m',
          cpus: '0.5',
          pids_limit: 100,
        },
      },
    };

    // Step 3: Validate sandbox config before adding (security check)
    validateSandboxConfig(agentConfig);

    const { addAgentToConfig } = await import('./config-writer.js');
    await addAgentToConfig(agentConfig as unknown as ConfigWriterAgentConfig, phoneNumber);
    configUpdated = true;

    // Step 4: Reload gateway (using execFile to prevent command injection)
    await execFileAsync('openclaw', ['gateway', 'reload'], { timeout: CLI_TIMEOUT });

    // Audit log: agent created successfully
    logAgentCreation(phoneNumber, agentId, true);

    return agentId;
  } catch (error) {
    // ROLLBACK in reverse order of operations
    if (configUpdated && backupPath) {
      try {
        const { restoreBackup } = await import('./config-writer.js');
        await restoreBackup(backupPath);
      } catch (rollbackError) {
        console.error('[agent-creator] Failed to restore config backup:', rollbackError);
      }
    }

    if (agentCreated) {
      try {
        await execFileAsync('openclaw', ['agents', 'remove', agentId], { timeout: CLI_TIMEOUT });
      } catch (removeError) {
        console.error(`[agent-creator] Failed to remove agent ${agentId}:`, removeError);
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
