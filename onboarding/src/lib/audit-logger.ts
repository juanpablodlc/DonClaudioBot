// Audit Logger for security events
// Logs structured JSON to stdout for Docker log capture

interface AuditLogDetails {
  timestamp: string;
  category: string;
  event: string;
  details: Record<string, unknown>;
}

/**
 * Log agent creation event (success or failure)
 */
export function logAgentCreation(
  phone: string,
  agentId: string | null,
  success: boolean,
  error?: string
): void {
  const log: AuditLogDetails = {
    timestamp: new Date().toISOString(),
    category: 'audit:agent:create',
    event: success ? 'agent_created' : 'agent_creation_failed',
    details: {
      phone: redactPhone(phone),
      agentId,
      success,
      ...(error ? { error } : {}),
    },
  };
  console.log(JSON.stringify(log));
}

/**
 * Log configuration change event
 */
export function logConfigChange(action: string, details: Record<string, unknown>): void {
  const log: AuditLogDetails = {
    timestamp: new Date().toISOString(),
    category: 'audit:config',
    event: action,
    details: redactSensitive(details),
  };
  console.log(JSON.stringify(log));
}

/**
 * Log token access event
 */
export function logTokenAccess(agentId: string): void {
  const log: AuditLogDetails = {
    timestamp: new Date().toISOString(),
    category: 'audit:token',
    event: 'access',
    details: { agentId },
  };
  console.log(JSON.stringify(log));
}

/**
 * Log authentication failure
 */
export function logAuthFailure(ip: string, reason: string): void {
  const log: AuditLogDetails = {
    timestamp: new Date().toISOString(),
    category: 'audit:auth',
    event: 'auth_failure',
    details: { ip, reason },
  };
  console.log(JSON.stringify(log));
}

/**
 * Redact sensitive values from logs
 */
function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = ['HOOK_TOKEN', 'GATEWAY_TOKEN', 'GOG_KEYRING_PASSWORD', 'password', 'token', 'secret'];

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()));

    if (isSensitive && typeof value === 'string') {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Redact phone number (show last 4 digits only)
 */
function redactPhone(phone: string): string {
  if (phone.length <= 4) return '***';
  return phone.substring(0, phone.length - 4) + '****';
}
