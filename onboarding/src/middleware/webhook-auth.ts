import type { Request, Response, NextFunction } from 'express';
import { logAuthFailure } from '../lib/audit-logger.js';

const HOOK_TOKEN = process.env.HOOK_TOKEN;

/**
 * Webhook authentication middleware
 * Validates Bearer token against HOOK_TOKEN environment variable
 */
export function webhookAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Check authorization header exists and starts with 'Bearer '
  if (!authHeader?.startsWith('Bearer ')) {
    logAuthFailure(req.ip || 'unknown', 'missing_authorization_header');
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  // Extract token (after 'Bearer ')
  const token = authHeader.substring(7);

  // Validate token
  if (token !== HOOK_TOKEN) {
    logAuthFailure(req.ip || 'unknown', 'invalid_token');
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  // Token valid - proceed
  next();
}
