#!/usr/bin/env node
/**
 * Dual-process launcher for DonClaudioBot
 * Spawns OpenClaw Gateway and Onboarding Service as independent processes
 *
 * Design goals:
 * - Independent restart capability (can restart one without the other)
 * - Proper signal handling (SIGTERM, SIGINT)
 * - Prefixed log output for debugging
 * - Health monitoring for both processes
 */

import { spawn } from 'child_process';

const MAX_RESTARTS = 3;
const RESTART_DELAY = 2000; // 2 seconds

// Process state
const processes = {
  gateway: null,
  onboarding: null,
  restartCount: {
    gateway: 0,
    onboarding: 0,
  },
};

// Log with prefix for easy debugging
function log(prefix, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

// Spawn a process with output forwarding
function spawnProcess(name, command, args, options = {}) {
  log('launcher', `Spawning ${name}...`);

  const proc = spawn(command, args, {
    stdio: 'pipe',
    env: process.env,
    ...options,
  });

  // Forward stdout with prefix
  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      log(name, line);
    }
  });

  // Forward stderr with prefix
  proc.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      log(name, `[ERROR] ${line}`);
    }
  });

  // Track when process started for stable-run detection
  const startedAt = Date.now();

  // Handle process exit
  proc.on('exit', (code, signal) => {
    const exitMsg = signal
      ? `terminated by signal ${signal}`
      : `exited with code ${code || 0}`;
    log(name, exitMsg);

    // Don't restart on graceful shutdown
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;

    // If process ran for >30s, it wasn't a crash loop — reset counter
    const uptimeMs = Date.now() - startedAt;
    if (uptimeMs > 30000) {
      processes.restartCount[name] = 0;
    }

    // Check if we should restart
    if (processes.restartCount[name] < MAX_RESTARTS) {
      processes.restartCount[name]++;
      log('launcher', `Restarting ${name} in ${RESTART_DELAY}ms (attempt ${processes.restartCount[name]}/${MAX_RESTARTS})`);
      setTimeout(() => {
        processes[name] = spawnProcess(name, command, args, options);
      }, RESTART_DELAY);
    } else {
      log('launcher', `${name} exceeded max restarts (${MAX_RESTARTS}), giving up`);
      shutdownAll(1);
    }
  });

  // Handle spawn errors
  proc.on('error', (err) => {
    log(name, `[FATAL] Spawn error: ${err.message}`);
    shutdownAll(1);
  });

  return proc;
}

// Start both processes
function startAll() {
  log('launcher', 'Starting DonClaudioBot v2...');

  // Start OpenClaw Gateway
  // Use npx to run openclaw from node_modules (no global install needed)
  processes.gateway = spawnProcess('gateway', 'npx', [
    'openclaw',
    'gateway',
    '--bind', process.env.OPENCLAW_GATEWAY_BIND || 'lan',
    '--port', process.env.OPENCLAW_GATEWAY_PORT || '18789',
  ]);

  // Start Onboarding Service
  processes.onboarding = spawnProcess('onboarding', 'node', [
    'onboarding/dist/index.js',
  ]);

  log('launcher', 'Both processes started. Gateway on port 18789, Onboarding on port 3000');
  log('launcher', `Use Ctrl+C to stop both processes (max restarts: ${MAX_RESTARTS})`);
}

// Shutdown all processes gracefully
function shutdownAll(exitCode = 0) {
  log('launcher', 'Shutting down...');

  const shutdownPromises = [];

  // Shutdown Gateway
  if (processes.gateway) {
    log('launcher', 'Stopping Gateway...');
    processes.gateway.kill('SIGTERM');
    shutdownPromises.push(
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          processes.gateway.kill('SIGKILL');
          resolve();
        }, 5000);
        processes.gateway.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      })
    );
  }

  // Shutdown Onboarding
  if (processes.onboarding) {
    log('launcher', 'Stopping Onboarding...');
    processes.onboarding.kill('SIGTERM');
    shutdownPromises.push(
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          processes.onboarding.kill('SIGKILL');
          resolve();
        }, 5000);
        processes.onboarding.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      })
    );
  }

  // Wait for graceful shutdown or force kill after 5s
  Promise.all(shutdownPromises).then(() => {
    log('launcher', 'All processes stopped. Exiting.');
    process.exit(exitCode);
  });
}

// Handle signals
process.on('SIGTERM', () => shutdownAll(0));
process.on('SIGINT', () => shutdownAll(0));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  log('launcher', `[FATAL] Uncaught exception: ${err.message}`);
  console.error(err);
  shutdownAll(1);
});

process.on('unhandledRejection', (reason) => {
  log('launcher', `[FATAL] Unhandled rejection: ${reason}`);
  shutdownAll(1);
});

// Start everything
startAll();
