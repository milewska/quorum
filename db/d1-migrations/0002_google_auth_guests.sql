-- QUOR-SSO + QUOR-OPEN: Google OAuth sessions + guest commitments
-- Replaces WorkOS auth with CF-native Google OAuth
-- Adds guest commitment support (name + email, no login required)

-- Sessions table for Google OAuth
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Guest commitment fields + make user_id nullable
-- SQLite doesn't support ALTER COLUMN, so we recreate the table

-- Step 1: Rename old table
ALTER TABLE commitments RENAME TO commitments_old;

-- Step 2: Create new table with nullable user_id + guest fields
CREATE TABLE commitments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  time_slot_id  TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at  TEXT,
  tier_label    TEXT,
  tier_amount   INTEGER,
  guest_name    TEXT,
  guest_email   TEXT
);

-- Step 3: Copy existing data
INSERT INTO commitments (id, user_id, time_slot_id, event_id, created_at, withdrawn_at, tier_label, tier_amount)
  SELECT id, user_id, time_slot_id, event_id, created_at, withdrawn_at, tier_label, tier_amount
  FROM commitments_old;

-- Step 4: Drop old table
DROP TABLE commitments_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_commitments_event ON commitments(event_id);
CREATE INDEX IF NOT EXISTS idx_commitments_user ON commitments(user_id);
CREATE INDEX IF NOT EXISTS idx_commitments_slot ON commitments(time_slot_id);

-- Rename workos_user_id column to google_id
ALTER TABLE users RENAME COLUMN workos_user_id TO google_id;
