// Config Writer Service
// Atomic openclaw.json updates with file locking

import { readFileSync, writeFileSync, renameSync, copyFileSync, constants as fsConstants } from 'fs';
import { dirname } from 'path';
import lockfile from 'proper-lockfile';
import JSON5 from 'json5';

// OpenClaw config path
export function getConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH || `${process.env.HOME || '~'}/.openclaw/openclaw.json`;
}

// Read and parse openclaw.json (JSON5 format - allows comments)
export function readConfig(): OpenClawConfig {
  const path = getConfigPath();
  const content = readFileSync(path, 'utf-8');
  return JSON5.parse(content) as OpenClawConfig;
}

// Write config atomically: temp file + rename
export async function writeConfigAtomic(config: OpenClawConfig): Promise<void> {
  const path = getConfigPath();
  const tmpPath = `${path}.tmp_${Date.now()}`;

  // Acquire lock
  const release = await lockfile.lock(path, {
    retries: 3,
    stale: 5000,
  });

  try {
    // Write temp file in same directory (for atomic rename)
    writeFileSync(tmpPath, JSON5.stringify(config, null, 2));
    // Atomic rename
    renameSync(tmpPath, path);
  } finally {
    await release();
  }
}

// Add agent to config (agents.list + bindings)
export async function addAgentToConfig(
  agentConfig: AgentConfig,
  phoneNumber: string
): Promise<void> {
  const config = readConfig();

  // Add agent to list
  config.agents.list.push(agentConfig);

  // Add binding: phone -> agent
  config.bindings.push({
    agentId: agentConfig.id,
    match: {
      channel: 'whatsapp',
      peer: { kind: 'dm', id: phoneNumber }
    }
  });

  await writeConfigAtomic(config);
}

// Backup config to ./openclaw.json.backup_<timestamp>
export async function backupConfig(): Promise<string> {
  const path = getConfigPath();
  const backupPath = `${path}.backup_${Date.now()}`;

  const release = await lockfile.lock(path, {
    retries: 3,
    stale: 5000,
  });

  try {
    copyFileSync(path, backupPath, fsConstants.COPYFILE_EXCL);
  } finally {
    await release();
  }

  return backupPath;
}

// Restore backup: moves backup to config
export async function restoreBackup(backupPath: string): Promise<void> {
  const path = getConfigPath();

  const release = await lockfile.lock(path, {
    retries: 3,
    stale: 5000,
  });

  try {
    // Atomic rename: backup -> config
    renameSync(backupPath, path);
  } finally {
    await release();
  }
}

// Type definitions for OpenClaw config structure
export interface OpenClawConfig {
  gateway: { mode: string; bind: string };
  agents: {
    defaults: { workspace: string; sandbox: { mode: string } };
    list: AgentConfig[];
  };
  bindings: Binding[];
  channels: { whatsapp: { allowFrom: string[]; dmPolicy: string } };
  session: { dmScope: string };
  hooks?: { enabled: boolean; token: string };
}

export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  agentDir?: string;
  default?: boolean;
  sandbox?: {
    mode: string;
    scope: string;
    workspaceAccess: string;
    docker: {
      image: string;
      env: Record<string, string>;
      network?: string;
    };
  };
}

export interface Binding {
  agentId: string;
  match: {
    channel: string;
    peer?: { kind: string; id: string };
  };
}
