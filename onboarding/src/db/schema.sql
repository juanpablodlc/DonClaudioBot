-- ============================================================
-- DonClaudioBot v2: Onboarding State Database Schema
-- ============================================================
-- File: ~/.openclaw/onboarding.db

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000; -- 5 second lock timeout

-- Core onboarding states table
CREATE TABLE IF NOT EXISTS onboarding_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,          -- E.164 format: +15551234567
  agent_id TEXT NOT NULL UNIQUE,              -- OpenClaw agent ID: user_abc123
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,                            -- NULL = never expires
  CHECK(phone_number LIKE '+%')               -- E.164 validation
);

-- Status transitions log (audit trail)
CREATE TABLE IF NOT EXISTS state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  transitioned_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (phone_number) REFERENCES onboarding_states(phone_number) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_phone_lookup
  ON onboarding_states(phone_number)
  WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_agent_lookup
  ON onboarding_states(agent_id);

CREATE INDEX IF NOT EXISTS idx_expiration
  ON onboarding_states(expires_at)
  WHERE expires_at IS NOT NULL;

-- Auto-update timestamp trigger
CREATE TRIGGER IF NOT EXISTS update_updated_at
  AFTER UPDATE ON onboarding_states
  FOR EACH ROW
BEGIN
  UPDATE onboarding_states
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;
