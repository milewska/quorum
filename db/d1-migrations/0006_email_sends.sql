-- QUOR-REWORK Phase C6: email send log table
-- Tracks every outgoing email for transparency and troubleshooting.

CREATE TABLE IF NOT EXISTS email_sends (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  subject         TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  error_msg       TEXT,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_sends_event ON email_sends(event_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_sent_at ON email_sends(sent_at);
