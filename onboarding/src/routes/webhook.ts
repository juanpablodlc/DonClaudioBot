// Webhook Routes
// POST /webhook/onboarding - Triggered by OpenClaw hook for new users

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import rateLimit from 'express-rate-limit';
import { webhookAuth } from '../middleware/webhook-auth.js';
import { OnboardingWebhookSchema } from '../lib/validation.js';
import { getState, createState, setOAuthNonce } from '../services/state-manager.js';
import { createAgent } from '../services/agent-creator.js';
import { logAgentCreation } from '../lib/audit-logger.js';

export const router = Router();

// Rate limiter for webhook endpoint
// 10 requests per 15 minutes per IP
const webhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  handler: (req: Request, res: Response) => {
    const retryAfter = Math.ceil(15 * 60); // 15 minutes in seconds
    res.status(429).json({
      error: 'Too many requests',
      retryAfter,
    });
  },
});

// POST /webhook/onboarding
// Auth: Bearer token (webhookAuth middleware)
// Rate limit: 10 requests per 15 minutes per IP
router.post('/webhook/onboarding', webhookAuth, webhookRateLimiter, async (req, res) => {
  let phone: string | null = null;
  try {
    // Step 1: Validate input
    const validated = OnboardingWebhookSchema.parse(req.body);
    phone = validated.phone;
    console.log('[webhook] Processing onboarding for phone: ' + phone);

    // Step 2: Check if already onboarded (idempotent)
    // Note: getState is synchronous (better-sqlite3)
    const existing = getState(phone);
    if (existing && existing.status !== 'cancelled') {
      return res.status(200).json({ status: 'existing', agentId: existing.agent_id });
    }

    // Step 3: Create agent (returns nonce but does NOT store it — DB row doesn't exist yet)
    const { agentId, oauthNonce } = await createAgent({ phoneNumber: phone });
    logAgentCreation(phone, agentId, true);

    // Step 4: Store state (with race condition handling)
    try {
      createState(phone, agentId, 'new');
    } catch (dbError: unknown) {
      // Handle race condition: concurrent request already created state
      // better-sqlite3 throws SqliteError with code property
      if (
        dbError &&
        typeof dbError === 'object' &&
        'code' in dbError &&
        (dbError as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        console.log('[webhook] Concurrent request detected for phone: ' + phone);
        const existingState = getState(phone);
        if (existingState) {
          return res.status(200).json({ status: 'existing', agentId: existingState.agent_id });
        }
      }
      throw dbError;
    }

    // Step 5: Store OAuth nonce AFTER the DB row exists
    // (Previously this ran inside createAgent() before createState(), so the
    // UPDATE hit 0 rows and the nonce was silently lost)
    if (oauthNonce) {
      setOAuthNonce(phone, oauthNonce);
      console.log('[webhook] OAuth nonce stored for ' + phone);
    }

    // Step 6: Return success
    return res.status(201).json({ status: 'created', agentId, phone });
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid phone format', details: error.errors });
    }

    // Handle other errors
    const message = error instanceof Error ? error.message : 'Unknown error';
    logAgentCreation(phone || 'unknown', null, false, message);
    return res.status(500).json({ error: message });
  }
});
