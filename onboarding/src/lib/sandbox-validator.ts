// Sandbox Configuration Validator
// Runtime validation that prevents insecure sandbox configurations per ARCHITECTURE_REPORT.md section 13.6

import type { AgentConfig } from '../services/agent-creator.js';

/**
 * Validate sandbox configuration for security issues
 * Throws errors with 'CRITICAL:' prefix for security violations
 * @param config - Agent configuration to validate
 * @throws Error with 'CRITICAL:' prefix if security issues found
 */
export function validateSandboxConfig(config: AgentConfig): void {
  const { sandbox } = config;

  // 1. Ensure privileged is false
  if (sandbox.docker.privileged === true) {
    const error = 'CRITICAL: Privileged mode is NOT allowed';
    console.error(`[sandbox-validator] ${error}`);
    throw new Error(error);
  }

  // 2. Ensure capabilities are dropped
  const capDrop = sandbox.docker.capDrop || ['ALL'];
  if (!capDrop.includes('ALL')) {
    const error = 'CRITICAL: Must drop all capabilities';
    console.error(`[sandbox-validator] ${error}`);
    throw new Error(error);
  }

  // 3. Ensure no socket mounts
  const binds = sandbox.docker.binds || [];
  const socketMounts = binds.filter(b => b.includes('docker.sock'));
  if (socketMounts.length > 0) {
    const error = 'CRITICAL: Docker socket mount in sandbox';
    console.error(`[sandbox-validator] ${error}`);
    throw new Error(error);
  }

  // 4. Validate workspace access (rw allowed for memory flush and user edits - Phase 8)
  const validAccess = ['none', 'ro', 'rw'];
  if (!validAccess.includes(sandbox.workspaceAccess)) {
    const error = `CRITICAL: Invalid workspaceAccess: ${sandbox.workspaceAccess}`;
    console.error(`[sandbox-validator] ${error}`);
    throw new Error(error);
  }

}
