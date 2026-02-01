import { z } from 'zod';

// E.164 phone number format: +[country code 1-9][subscriber number 1-14 digits]
// ITU-T E.164 standard: max 15 digits after leading +
export const E164PhoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone format');

// Agent ID format: user_ prefix followed by alphanumeric, underscore, or hyphen
// Min 5, max 64 characters
export const AgentIdSchema = z.string()
  .min(5, 'Agent ID must be at least 5 characters')
  .max(64, 'Agent ID must be at most 64 characters')
  .regex(/^user_[a-zA-Z0-9_-]+$/, 'Agent ID must start with "user_" and contain only alphanumeric, underscore, or hyphen');

// Webhook payload schema for onboarding trigger
export const OnboardingWebhookSchema = z.object({
  phone: E164PhoneSchema,
  timestamp: z.string().optional(),
});

// TypeScript types inferred from schemas
export type E164Phone = z.infer<typeof E164PhoneSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type OnboardingWebhook = z.infer<typeof OnboardingWebhookSchema>;
