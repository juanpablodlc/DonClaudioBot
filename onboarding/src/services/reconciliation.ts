// State Reconciliation Service
// Detects and cleans up inconsistencies between OpenClaw config and onboarding database

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readConfig, writeConfigAtomic } from './config-writer.js';
import { updateState, initDatabase } from './state-manager.js';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

// CLI timeout: 30 seconds
const CLI_TIMEOUT = 30000;

// Stale threshold: 24 hours
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Reconciliation report interface
 */
export interface ReconciliationReport {
  orphanedAgents: string[];      // Agent IDs in config but NOT in DB
  orphanedDbRecords: string[];    // Phone numbers in DB (non-cancelled) but agent NOT in config
  invalidBindings: string[];      // Bindings to non-existent agents
  staleStates: string[];          // Phone numbers with stale states (>24h, non-terminal status)
}

/**
 * Reconcile OpenClaw config with onboarding database
 * Detects orphaned agents, orphaned DB records, and stale states
 */
export async function reconcileStates(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    orphanedAgents: [],
    orphanedDbRecords: [],
    invalidBindings: [],
    staleStates: [],
  };

  // Read OpenClaw config to get all agent IDs and bindings
  const config = readConfig();
  const configAgentIds = new Set(config.agents.list.map(agent => agent.id));
  const boundAgentIds = new Set(config.bindings.map(b => b.agentId));

  // Query all onboarding states from database
  const db = initDatabaseForQuery();
  const states = db!.prepare('SELECT phone_number, agent_id, status, updated_at FROM onboarding_states').all() as Array<{
    phone_number: string;
    agent_id: string;
    status: string;
    updated_at: string;
  }>;

  const dbAgentIds = new Set(states.map(s => s.agent_id));
  const dbPhonesByAgentId = new Map<string, string>();
  states.forEach(s => dbPhonesByAgentId.set(s.agent_id, s.phone_number));

  // Detect orphaned agents: in config but NOT in DB
  for (const agentId of configAgentIds) {
    if (!dbAgentIds.has(agentId)) {
      report.orphanedAgents.push(agentId);
      console.log(`[reconciliation] Found orphaned agent: ${agentId}`);
    }
  }

  // Detect invalid bindings: bindings to non-existent agents
  for (const agentId of boundAgentIds) {
    if (!configAgentIds.has(agentId)) {
      report.invalidBindings.push(agentId);
      console.log(`[reconciliation] Found invalid binding to agent: ${agentId}`);
    }
  }

  // Detect orphaned DB records and stale states
  const now = Date.now();
  for (const state of states) {
    // Skip cancelled records
    if (state.status === 'cancelled') continue;

    // Orphaned DB record: non-cancelled but agent NOT in config
    if (!configAgentIds.has(state.agent_id)) {
      report.orphanedDbRecords.push(state.phone_number);
      console.log(`[reconciliation] Found orphaned DB record: ${state.phone_number} -> ${state.agent_id}`);
    }

    // Stale state: updated more than 24h ago AND in non-terminal status
    const updatedAt = new Date(state.updated_at).getTime();
    const isStale = (now - updatedAt) > STALE_THRESHOLD_MS;
    const isNonTerminal = ['new', 'pending_welcome', 'collecting_info'].includes(state.status);

    if (isStale && isNonTerminal) {
      report.staleStates.push(state.phone_number);
      console.log(`[reconciliation] Found stale state: ${state.phone_number} (status: ${state.status}, updated: ${state.updated_at})`);
    }
  }

  console.log(`[reconciliation] Report: ${report.orphanedAgents.length} orphaned agents, ${report.orphanedDbRecords.length} orphaned DB records, ${report.staleStates.length} stale states`);

  return report;
}

/**
 * Clean up orphaned agents and DB records
 * - Removes orphaned agents via OpenClaw CLI
 * - Marks orphaned DB records as cancelled
 * - Removes invalid bindings from config
 * - Cancels stale states
 */
export async function cleanupOrphans(report: ReconciliationReport): Promise<void> {
  // Clean up orphaned agents
  for (const agentId of report.orphanedAgents) {
    try {
      console.log(`[reconciliation] Removing orphaned agent: ${agentId}`);
      await execFileAsync('openclaw', ['agents', 'remove', agentId], { timeout: CLI_TIMEOUT });
      console.log(`[reconciliation] Successfully removed agent: ${agentId}`);
    } catch (error) {
      console.error(`[reconciliation] Failed to remove agent ${agentId}:`, error);
    }
  }

  // Clean up orphaned DB records
  for (const phone of report.orphanedDbRecords) {
    try {
      console.log(`[reconciliation] Cancelling orphaned DB record: ${phone}`);
      updateState(phone, { status: 'cancelled' });
      console.log(`[reconciliation] Successfully cancelled record: ${phone}`);
    } catch (error) {
      console.error(`[reconciliation] Failed to cancel record ${phone}:`, error);
    }
  }

  // Remove invalid bindings from config
  if (report.invalidBindings.length > 0) {
    const config = readConfig();
    const invalidAgentIds = new Set(report.invalidBindings);
    const originalCount = config.bindings.length;
    config.bindings = config.bindings.filter(b => !invalidAgentIds.has(b.agentId));
    const removedCount = originalCount - config.bindings.length;
    await writeConfigAtomic(config);
    console.log(`[reconciliation] Removed ${removedCount} invalid bindings from config`);
  }

  // Cancel stale states for fresh onboarding
  for (const phone of report.staleStates) {
    try {
      console.log(`[reconciliation] Cancelling stale state: ${phone}`);
      updateState(phone, { status: 'cancelled' });
      console.log(`[reconciliation] Successfully cancelled stale state: ${phone}`);
    } catch (error) {
      console.error(`[reconciliation] Failed to cancel stale state ${phone}:`, error);
    }
  }
}

/**
 * Initialize database for query operations
 * Returns the database instance for direct queries
 */
function initDatabaseForQuery(): Database.Database {
  // Reuse state-manager's initDatabase
  initDatabase();
  // Get the raw db instance by requiring better-sqlite3 directly
  const dbPath = process.env.OPENCLAW_STATE_DIR
    ? `${process.env.OPENCLAW_STATE_DIR}/onboarding.db`
    : `${process.env.HOME || '~'}/.openclaw/onboarding.db`;
  return new Database(dbPath, { timeout: 5000 });
}
