#!/usr/bin/env node
/**
 * State Reconciliation CLI
 * Standalone entry point for cron-based reconciliation
 *
 * Detects and cleans up inconsistencies between OpenClaw config and onboarding database:
 * - Orphaned agents: in config but NOT in DB
 * - Orphaned DB records: in DB but agent NOT in config
 * - Invalid bindings: bindings to non-existent agents
 * - Stale states: states stuck in non-terminal status for >24h
 *
 * Run manually: node onboarding/dist/services/reconciliation-cli.js
 * Run via cron: Configured by scripts/cron-setup.sh
 */

import { reconcileStates, cleanupOrphans } from './reconciliation.js';
import type { ReconciliationReport } from './reconciliation.js';

interface ReconciliationSummary {
  timestamp: string;
  issues: boolean;
  orphanedAgents: number;
  orphanedDbRecords: number;
  invalidBindings: number;
  staleStates: number;
  status: 'success' | 'error';
}

/**
 * Main entry point for reconciliation CLI
 * Called by cron job (hourly) or manually for debugging
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('[reconciliation] ========================================');
  console.log('[reconciliation] Starting state reconciliation...');
  console.log(`[reconciliation] Timestamp: ${new Date().toISOString()}`);
  console.log('[reconciliation] ========================================');

  const summary: ReconciliationSummary = {
    timestamp: new Date().toISOString(),
    issues: false,
    orphanedAgents: 0,
    orphanedDbRecords: 0,
    invalidBindings: 0,
    staleStates: 0,
    status: 'success',
  };

  try {
    // Step 1: Detect inconsistencies
    console.log('[reconciliation] Phase 1: Detecting inconsistencies...');
    const report: ReconciliationReport = await reconcileStates();

    // Update summary
    summary.orphanedAgents = report.orphanedAgents.length;
    summary.orphanedDbRecords = report.orphanedDbRecords.length;
    summary.invalidBindings = report.invalidBindings.length;
    summary.staleStates = report.staleStates.length;
    summary.issues =
      summary.orphanedAgents > 0 ||
      summary.orphanedDbRecords > 0 ||
      summary.invalidBindings > 0 ||
      summary.staleStates > 0;

    // Step 2: If issues found, run cleanup
    if (summary.issues) {
      console.log('[reconciliation] Phase 2: Issues detected, running cleanup...');
      console.log(`[reconciliation] - Orphaned agents: ${summary.orphanedAgents}`);
      console.log(`[reconciliation] - Orphaned DB records: ${summary.orphanedDbRecords}`);
      console.log(`[reconciliation] - Invalid bindings: ${summary.invalidBindings}`);
      console.log(`[reconciliation] - Stale states: ${summary.staleStates}`);

      await cleanupOrphans(report);
      console.log('[reconciliation] Cleanup complete');
    } else {
      console.log('[reconciliation] Phase 2: No issues found, skipping cleanup');
    }

    // Log success
    const duration = Date.now() - startTime;
    console.log('[reconciliation] ========================================');
    console.log(`[reconciliation] Completed in ${duration}ms`);
    console.log('[reconciliation] Status: OK');
    console.log('[reconciliation] ========================================');

    process.exit(0);
  } catch (error) {
    summary.status = 'error';
    const duration = Date.now() - startTime;

    console.error('[reconciliation] ========================================');
    console.error('[reconciliation] FATAL ERROR during reconciliation');
    console.error(`[reconciliation] Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error('[reconciliation] Stack trace:');
      console.error(error.stack);
    }
    console.error(`[reconciliation] Failed after ${duration}ms`);
    console.error('[reconciliation] ========================================');

    process.exit(1);
  }
}

// Execute main function
main().catch((error) => {
  console.error('[reconciliation] Unhandled error in main():', error);
  process.exit(1);
});
