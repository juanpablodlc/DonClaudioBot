// Webhook Routes
// POST /webhook/onboarding - Triggered by OpenClaw hook for new users

import { Router } from 'express';
import { ZodError } from 'zod';
import { webhookAuth } from '../middleware/webhook-auth.js';
import { OnboardingWebhookSchema } from '../lib/validation.js';
import { getState, createState } from '../services/state-manager.js';
import { createAgent } from '../services/agent-creator.js';

export const router = Router();

// POST /webhook/onboarding
// Auth: Bearer token (webhookAuth middleware)
router.post('/webhook/onboarding', webhookAuth, async (req, res) => {
  try {
    // Step 1: Validate input
    const { phone } = OnboardingWebhookSchema.parse(req.body);
    console.log('[webhook] Processing onboarding for phone: ' + phone);

    // Step 2: Check if already onboarded (idempotent)
    const existing = await getState(phone);
    if (existing && existing.status !== 'cancelled') {
      return res.status(200).json({ status: 'existing', agentId: existing.agent_id });
    }

    // Step 3: Create agent
    const agentId = await createAgent({ phoneNumber: phone });

    // Step 4: Store state
    await createState(phone, agentId, 'new');

    // Step 5: Return success
    return res.status(201).json({ status: 'created', agentId, phone });
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid phone format', details: error.errors });
    }

    // Handle other errors
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});
