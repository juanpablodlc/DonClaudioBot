// State Routes
// GET /onboarding/state/:phone - Get onboarding state by phone
// POST /onboarding/update - Update onboarding state
// POST /onboarding/handover - Mark onboarding as complete (handover to dedicated agent)

import { Router, Request, Response } from 'express';
import { webhookAuth } from '../middleware/webhook-auth.js';
import { getState, updateState, setStatus } from '../services/state-manager.js';

export const router = Router();

// Apply webhookAuth middleware to ALL routes
router.use(webhookAuth);

// GET /onboarding/state/:phone
// Returns onboarding state for a phone number
router.get('/onboarding/state/:phone', (req: Request, res: Response): void => {
  const state = getState(req.params.phone);
  if (!state) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(state);
});

// POST /onboarding/update
// Updates onboarding state with status, name, and/or email
router.post('/onboarding/update', (req: Request, res: Response): void => {
  const { status, name, email, phone } = req.body;

  // Validate: at least one field required
  if (!status && !name && !email) {
    res.status(400).json({ error: 'At least one field required' });
    return;
  }

  updateState(phone, { status, name, email });
  res.json({ success: true });
});

// POST /onboarding/handover
// Marks onboarding as complete and returns agent ID
router.post('/onboarding/handover', (req: Request, res: Response): void => {
  const { phone } = req.body;

  // Get current state to retrieve agent_id
  const state = getState(phone);
  if (!state) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Set status to 'complete' per state machine
  setStatus(phone, 'complete');

  res.json({ status: 'handed_over', agentId: state.agent_id });
});
