// Language Detector
// Maps phone country codes to agent template folders via phone-language-map.json

import { readFileSync } from 'fs';
import { join } from 'path';

interface PhoneLanguageMap {
  default: string;
  mappings: Record<string, string>;
}

let cachedMap: PhoneLanguageMap | null = null;

/**
 * Load phone-language-map.json (cached after first read)
 */
function loadMap(): PhoneLanguageMap {
  if (cachedMap) return cachedMap;

  try {
    const mapPath = join(process.cwd(), 'config', 'phone-language-map.json');
    const raw = readFileSync(mapPath, 'utf-8');
    cachedMap = JSON.parse(raw) as PhoneLanguageMap;
    return cachedMap;
  } catch (error) {
    console.warn('[language-detector] Could not load phone-language-map.json, using default:', error);
    return { default: 'dedicated-es', mappings: {} };
  }
}

/**
 * Extract country code from E.164 phone number.
 * E.164 format: +<country_code><subscriber_number>
 * Country codes are 1-3 digits. We try longest match first (3, 2, 1).
 */
function extractCountryCode(phone: string): string {
  // Strip leading +
  const digits = phone.replace(/^\+/, '');

  // Try 3-digit, 2-digit, then 1-digit country codes (longest match first)
  for (const len of [3, 2, 1]) {
    const candidate = digits.substring(0, len);
    if (candidate.length === len) {
      return candidate;
    }
  }

  return digits.substring(0, 1);
}

/**
 * Detect language template folder based on phone number country code.
 * Returns the template folder name (e.g., 'dedicated-en', 'dedicated-es').
 */
export function detectLanguage(phone: string): string {
  const map = loadMap();
  const digits = phone.replace(/^\+/, '');

  // Try longest match first: 3-digit, 2-digit, 1-digit country codes
  for (const len of [3, 2, 1]) {
    const candidate = digits.substring(0, len);
    if (map.mappings[candidate]) {
      return map.mappings[candidate];
    }
  }

  return map.default;
}
