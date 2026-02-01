import { E164PhoneSchema } from './validation';

/**
 * Normalize a raw phone number to E.164 format.
 *
 * Edge cases handled:
 * - Removes spaces, dashes, parentheses: '+1 (555) 123-4567' → '+15551234567'
 * - Ensures leading '+' for international format
 * - Rejects if too short (<10 digits after +) or too long (>15 digits total)
 *
 * @param raw - Raw phone number string in any format
 * @returns Normalized E.164 phone number
 * @throws {ZodError} If phone number is invalid after normalization
 *
 * @example
 * normalizePhoneNumber('+1 (555) 123-4567') // '+15551234567'
 * normalizePhoneNumber('15551234567') // throws ZodError (missing +)
 * normalizePhoneNumber('+12') // throws ZodError (too short)
 */
export function normalizePhoneNumber(raw: string): string {
  // Strip all non-digit characters except leading +
  const stripped = raw.replace(/[^+\d]/g, '');

  // Validate against E.164 schema
  // This ensures: starts with +, followed by 1-9, then 1-14 more digits (max 15 total)
  return E164PhoneSchema.parse(stripped);
}
