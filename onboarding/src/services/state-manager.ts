// State Manager Service
// SQLite database operations for onboarding state

interface OnboardingState {
  phone_number: string;
  agent_id: string;
  status: 'pending' | 'welcome_sent' | 'collecting_info' | 'ready_for_handover' | 'complete' | 'active';
  name?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Initialize SQLite database
 * TODO: Implement with better-sqlite3
 */
export function initDatabase(): void {
  throw new Error('Not implemented');
}

/**
 * Get onboarding state by phone number
 */
export async function getState(phone: string): Promise<OnboardingState | null> {
  throw new Error('Not implemented');
}

/**
 * Create new onboarding record
 */
export async function createState(phone: string, agentId: string): Promise<void> {
  throw new Error('Not implemented');
}

/**
 * Update onboarding state
 */
export async function updateState(
  phone: string,
  updates: Partial<Omit<OnboardingState, 'phone_number' | 'agent_id' | 'created_at'>>
): Promise<void> {
  throw new Error('Not implemented');
}

/**
 * Set onboarding status
 */
export async function setStatus(
  phone: string,
  status: OnboardingState['status']
): Promise<void> {
  throw new Error('Not implemented');
}
