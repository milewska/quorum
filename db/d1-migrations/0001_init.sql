-- Quorum D1 schema — SQLite-compatible
-- Migrated from Neon Postgres to Cloudflare D1

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  avatar_url      TEXT,
  reputation_score REAL NOT NULL DEFAULT 100.0,
  workos_user_id  TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  organizer_id      TEXT NOT NULL REFERENCES users(id),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  location          TEXT NOT NULL,
  image_key         TEXT,
  visibility        TEXT NOT NULL DEFAULT 'public',
  threshold         INTEGER NOT NULL,
  deadline          TEXT NOT NULL,
  registration_url  TEXT,
  cost_tiers_json   TEXT,
  price_quorum_cents INTEGER,
  status            TEXT NOT NULL DEFAULT 'draft',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_slots (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  commitment_count  INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS commitments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  time_slot_id  TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at  TEXT,
  tier_label    TEXT,
  tier_amount   INTEGER
);

CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registered  INTEGER NOT NULL DEFAULT 0,
  marked_at   TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_organizer ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_visibility_status ON events(visibility, status);
CREATE INDEX IF NOT EXISTS idx_timeslots_event ON time_slots(event_id);
CREATE INDEX IF NOT EXISTS idx_commitments_event ON commitments(event_id);
CREATE INDEX IF NOT EXISTS idx_commitments_user ON commitments(user_id);
CREATE INDEX IF NOT EXISTS idx_commitments_slot ON commitments(time_slot_id);
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
