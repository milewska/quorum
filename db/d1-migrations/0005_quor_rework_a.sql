-- QUOR-REWORK Phase A: bug-fix schema changes
-- B1: per-slot registration URL (fixes registrationUrl collision)
-- B5: guest attendance unlock (nullable user_id + commitment_id FK)

-- ── B1: Add per-slot registration URL ────────────────────────────────────────
ALTER TABLE time_slots ADD COLUMN registration_url TEXT;

-- Backfill per-slot URL from event-level URL for any already-confirmed slots.
-- Safe even if event has no URL set (NULL → NULL).
UPDATE time_slots
   SET registration_url = (
     SELECT registration_url FROM events WHERE events.id = time_slots.event_id
   )
 WHERE status = 'confirmed'
   AND registration_url IS NULL;

-- ── B5: Guest attendance — recreate attendance table ──────────────────────────
-- SQLite cannot drop NOT NULL in-place, so rebuild the table.
-- Adds: commitment_id (nullable FK to commitments, cascade on delete)
-- Changes: user_id becomes nullable (so guest attendance rows can exist)

CREATE TABLE attendance_new (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id),
  commitment_id  TEXT REFERENCES commitments(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registered     INTEGER NOT NULL DEFAULT 0,
  marked_at      TEXT
);

INSERT INTO attendance_new (id, user_id, commitment_id, event_id, registered, marked_at)
  SELECT id, user_id, NULL, event_id, registered, marked_at FROM attendance;

DROP TABLE attendance;
ALTER TABLE attendance_new RENAME TO attendance;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_commitment ON attendance(event_id, commitment_id);
