// State Manager Service
// SQLite database operations for onboarding state

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

// Schema path: use source file since it's available in container
const SCHEMA_PATH = join(process.cwd(), 'onboarding', 'src', 'db', 'schema.sql');

// DB path: /home/node/.openclaw/onboarding.db or env override
const DB_PATH_BASE = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';
// DB path: /home/node/.openclaw/onboarding.db or env override
export const DB_PATH = `${DB_PATH_BASE}/onboarding.db`;

let db: Database.Database | null = null;

// Onboarding state interface matching schema
export interface OnboardingState {
  id: number;
  phone_number: string;
  agent_id: string;
  status: string;
  name?: string;
  email?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

/**
 * Initialize SQLite database
 * Opens ~/.openclaw/onboarding.db and executes schema.sql
 */
export function initDatabase(): void {
  db = new Database(DB_PATH, { timeout: 5000 });

  // Read and execute schema
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
}

/**
 * Get onboarding state by phone number
 * Returns null if not found
 */
export function getState(phone: string): OnboardingState | null {
  if (!db) initDatabase();
  const stmt = db!.prepare('SELECT * FROM onboarding_states WHERE phone_number = ?');
  return stmt.get(phone) as OnboardingState | null;
}

/**
 * Create new onboarding record with 24h expiration
 */
export function createState(phone: string, agentId: string, status: string = 'new'): void {
  if (!db) initDatabase();

  const insertStmt = db!.transaction(() => {
    const stmt = db!.prepare(
      `INSERT INTO onboarding_states (phone_number, agent_id, status, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))`
    );
    stmt.run(phone, agentId, status);
  });

  insertStmt();
}

/**
 * Update onboarding state with partial fields
 */
export function updateState(phone: string, updates: Partial<Omit<OnboardingState, 'id' | 'phone_number' | 'agent_id' | 'created_at'>>): void {
  if (!db) initDatabase();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.expires_at !== undefined) {
    fields.push('expires_at = ?');
    values.push(updates.expires_at);
  }

  if (fields.length === 0) return;

  values.push(phone);
  const stmt = db!.prepare(`UPDATE onboarding_states SET ${fields.join(', ')} WHERE phone_number = ?`);
  stmt.run(...values);
}

/**
 * Set onboarding status with audit trail entry
 */
export function setStatus(phone: string, status: string): void {
  if (!db) initDatabase();

  const current = getState(phone);
  const fromStatus = current?.status || null;

  const setStmt = db!.transaction(() => {
    // Update main state
    const updateStmt = db!.prepare('UPDATE onboarding_states SET status = ? WHERE phone_number = ?');
    updateStmt.run(status, phone);

    // Log transition
    const logStmt = db!.prepare(
      'INSERT INTO state_transitions (phone_number, from_status, to_status) VALUES (?, ?, ?)'
    );
    logStmt.run(phone, fromStatus, status);
  });

  setStmt();
}

/**
 * Get onboarding state by agent ID
 */
export function getByAgentId(agentId: string): OnboardingState | null {
  if (!db) initDatabase();
  const stmt = db!.prepare('SELECT * FROM onboarding_states WHERE agent_id = ?');
  return stmt.get(agentId) as OnboardingState | null;
}

/**
 * Close database connection (for cleanup/shutdown)
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
