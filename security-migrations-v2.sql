-- ============================================
-- NEXORA SECURITY MIGRATIONS v2
-- Run after security-migrations.sql.
-- Schema for the YouTube connection lifecycle (status, label, freshness).
-- ============================================

-- Connection status machine:
--   active           — usable, last call to YouTube succeeded
--   pending_channel  — Google grant accepted but the account has no
--                      YouTube channel yet. We hold the tokens and
--                      surface a "create a channel" nudge in the UI.
--   stale            — last call returned an error that *might* recover
--                      (network blip, transient 5xx). UI keeps the
--                      connection but flags it.
--   revoked          — Google said invalid_grant or 401 after a refresh
--                      attempt. User must reconnect; we keep the row
--                      (and the connection_label) so the reconnect UI
--                      stays personalized.
ALTER TABLE connected_platforms
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS connection_label TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- CHECKs added separately so re-running the migration is safe even if
-- the columns already exist from a previous partial run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'connected_platforms_status_check'
  ) THEN
    ALTER TABLE connected_platforms
      ADD CONSTRAINT connected_platforms_status_check
      CHECK (status IN ('active', 'pending_channel', 'stale', 'revoked'));
  END IF;

  -- Cap label length at the DB so a buggy or malicious client can't
  -- bloat the row (or push a 10MB string through Resend / the AI prompt
  -- if it ever gets surfaced there).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'connected_platforms_label_length'
  ) THEN
    ALTER TABLE connected_platforms
      ADD CONSTRAINT connected_platforms_label_length
      CHECK (connection_label IS NULL OR length(connection_label) <= 60);
  END IF;
END $$;

-- Index status for the cron / dashboard queries that need to find
-- non-active connections quickly.
CREATE INDEX IF NOT EXISTS idx_connected_platforms_status
  ON connected_platforms(status)
  WHERE status <> 'active';
