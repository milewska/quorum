-- Add timezone column to events table
-- Default: Pacific/Honolulu (Hawaii Standard Time)
ALTER TABLE events ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Pacific/Honolulu';
