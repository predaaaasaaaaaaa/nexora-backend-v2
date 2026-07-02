-- ============================================================
-- TELEMETRY GUARD MIGRATIONS
-- ============================================================
-- Follow-up to the await-fix (commit e41c2ed, deployed 2026-07-01T03:15:04Z)
-- that stopped server-side trackEvent() writes being dropped when the Vercel
-- function froze on res.json() before the fire-and-forget insert landed.
--
-- This migration adds two service-role-only tables:
--
--   telemetry_meta   — documented reliability boundaries. Records, per event,
--                      the timestamp from which product_events counts can be
--                      trusted. It does NOT create event rows; history before
--                      reliable_from is understated and is intentionally left
--                      as-is (no clean 1:1 source exists to reconstruct it —
--                      see the reason column). Downstream analytics must treat
--                      counts before reliable_from as a floor, not the truth.
--
--   telemetry_health — one row per reconcile run (daily Vercel cron + any
--                      manual run). Proves the guard executed: a GREEN row
--                      every healthy run (health is provable, not assumed),
--                      a RED row whenever coach_query_sent distinct-users
--                      drifts below activated-users beyond tolerance.
--
-- Both tables have RLS enabled with NO client policies, exactly like
-- public.product_events: only the service-role client (services/supabase.js)
-- can read or write them. Safe to run more than once.
-- ============================================================

-- ─── telemetry_meta ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telemetry_meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name    text NOT NULL UNIQUE,
  -- Counts for event_name are trustworthy from this instant onward. Before
  -- it, the fire-and-forget bug means product_events UNDERCOUNTS this event.
  reliable_from timestamptz NOT NULL,
  -- Why this event is not backfilled (server/client + source-table analysis).
  reason        text NOT NULL,
  -- The 1:1 source table used to backfill, or 'none' when history is
  -- unrecoverable and the event is boundary-marked instead of backfilled.
  source        text NOT NULL DEFAULT 'none',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telemetry_meta ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role bypasses RLS, everyone else is denied.

-- ─── telemetry_health ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telemetry_health (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date      date NOT NULL,
  -- distinct users firing coach_query_sent in product_events (the canary:
  -- the only product event with a reliable cross-check).
  source_users    int  NOT NULL,
  -- distinct activated users: coach_messages role='user' joined to
  -- coach_conversations.user_id, excluding the test user. Same definition
  -- the activation metric uses.
  activated_users int  NOT NULL,
  -- activated_users - source_users. Positive == telemetry undercounts
  -- activation == the failure mode the await-fix closed.
  drift           int  NOT NULL,
  status          text NOT NULL CHECK (status IN ('green', 'red')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telemetry_health ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.

CREATE INDEX IF NOT EXISTS idx_telemetry_health_check_date
  ON public.telemetry_health (check_date DESC);

-- ─── Reliability boundaries (NO backfill — documented understatement) ─────
-- Investigated 2026-07-01. None of these three events has a clean, unambiguous
-- 1:1 source table with true per-event timestamps, so backfilling would mean
-- fabricating rows/timestamps and re-corrupting the data the await-fix just
-- made trustworthy. Each is instead marked reliable_from = await-fix deploy.
INSERT INTO public.telemetry_meta (event_name, reliable_from, reason, source) VALUES
  (
    'content_ideas_generated',
    '2026-07-01T03:15:04Z',
    'SERVER-side event (controllers/ideas.js:74 generateIdeas, :131 generateAllIdeas). '
      || 'One event per generation REQUEST with {count} (NOT one per idea). No content_ideas/ideas '
      || 'table exists — generated ideas are returned in the HTTP response and never persisted. '
      || 'usage_tracking.content_ideas_used is a cumulative, period-bucketed counter (monthly '
      || 'period_start + weekly reset) with no per-event timestamps, so it cannot reconstruct true '
      || 'created_at at per-event granularity. No clean 1:1 source -> boundary-marked, not backfilled.',
    'none'
  ),
  (
    'analytics_viewed',
    '2026-07-01T03:15:04Z',
    'CLIENT-side event (controllers/track.js CLIENT_EVENT_ALLOWLIST, emitted by the browser via '
      || 'POST /api/track). Pure UI interaction (user opened the analytics view); no source table '
      || 'records it. Unrecoverable -> boundary-marked, not backfilled.',
    'none'
  ),
  (
    'session_started',
    '2026-07-01T03:15:04Z',
    'CLIENT-side event (controllers/track.js CLIENT_EVENT_ALLOWLIST, emitted by the browser via '
      || 'POST /api/track). Pure UI interaction (session opened); no source table records it. '
      || 'Unrecoverable -> boundary-marked, not backfilled.',
    'none'
  )
ON CONFLICT (event_name) DO NOTHING;
