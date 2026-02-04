// Onboarding Service Entry Point
// Express server for webhook-based agent creation

import express from 'express';
import { initDatabase } from './services/state-manager.js';
import { router as webhookRouter } from './routes/webhook.js';
import { router as stateRouter } from './routes/state.js';
import { startBaileysSidecar } from './services/baileys-sidecar.js';

const app = express();

// JSON body parser
app.use(express.json());

// Initialize database before starting server
initDatabase();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount webhook routes
app.use('/', webhookRouter);

// Mount state routes
app.use('/', stateRouter);

// Configuration
const PORT = process.env.PORT || 3000;

// Security check: warn if HOOK_TOKEN not set
if (!process.env.HOOK_TOKEN) {
  console.warn('[WARN] HOOK_TOKEN not set - webhook endpoint is insecure!');
}

// Start Baileys sidecar if enabled
if (process.env.BAILEYS_SIDECAR_ENABLED === 'true') {
  console.log('[baileys-sidecar] Starting sidecar service...');
  try {
    startBaileysSidecar();
  } catch (error) {
    console.error('[baileys-sidecar] Failed to start:', error);
  }
} else {
  console.log('[baileys-sidecar] Disabled (set BAILEYS_SIDECAR_ENABLED=true to enable)');
}

// Start server
app.listen(PORT, () => {
  console.log('Onboarding service listening on port', PORT);
});

// Export app for testing
export default app;
