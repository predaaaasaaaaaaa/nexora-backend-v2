-- ============================================
-- NEXORA SECURITY MIGRATIONS v3
-- Run after security-migrations-v2.sql.
-- Adds atomic quota gating + webhook idempotency + per-user YT quota.
-- Safe to re-run.
-- ============================================

-- ─── C2: atomic check-and-increment quota gate ─────────────
--
-- Replaces the racy "checkLimit then incrementUsage" pattern that let N
-- parallel requests all pass at count=limit-1. This RPC takes a row
-- lock (SELECT ... FOR UPDATE), checks the limit, and increments —
-- all inside one transaction. Returns true if the request is allowed
-- (and the counter has been bumped), false if over limit.
CREATE OR REPLACE FUNCTION public.check_and_increment_usage(
  p_user_id UUID,
  p_period_start DATE,
  p_field TEXT,
  p_limit INT,
  p_amount INT DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $func$
DECLARE
  current_val INT;
BEGIN
  IF p_field NOT IN ('coach_messages_used', 'content_ideas_used', 'competitors_tracked') THEN
    RAISE EXCEPTION 'check_and_increment_usage: unknown field %', p_field;
  END IF;

  -- Make sure the row exists. ON CONFLICT DO NOTHING so we don't race
  -- ourselves trying to insert.
  INSERT INTO public.usage_tracking (user_id, period_start, coach_messages_used, content_ideas_used, competitors_tracked)
  VALUES (p_user_id, p_period_start, 0, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  -- Lock the row for the duration of this transaction.
  EXECUTE format(
    'SELECT %1$I FROM public.usage_tracking WHERE user_id=$1 AND period_start=$2 FOR UPDATE',
    p_field
  )
  INTO current_val
  USING p_user_id, p_period_start;

  IF current_val IS NULL THEN current_val := 0; END IF;

  -- p_limit < 0 is an "unlimited" sentinel. Always allowed, but still
  -- bump so usage telemetry stays accurate.
  IF p_limit < 0 OR (current_val + p_amount) <= p_limit THEN
    EXECUTE format(
      'UPDATE public.usage_tracking SET %1$I = COALESCE(%1$I, 0) + $1, updated_at = NOW() WHERE user_id=$2 AND period_start=$3',
      p_field
    )
    USING p_amount, p_user_id, p_period_start;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END
$func$;

REVOKE ALL ON FUNCTION public.check_and_increment_usage(UUID, DATE, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_usage(UUID, DATE, TEXT, INT, INT) TO service_role;


-- ─── H2: webhook event idempotency ─────────────────────────
--
-- Paddle retries on 5xx — without dedupe we double-fire every side
-- effect. event_id is the natural unique key.
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_event_id_uniq
  ON subscription_events(event_id)
  WHERE event_id IS NOT NULL;


-- ─── H3: out-of-order webhook protection ───────────────────
--
-- Track the most recent occurred_at we've applied per user so a
-- delayed-retry of an older event can't downgrade a paying user.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS paddle_last_event_at TIMESTAMPTZ;


-- ─── H5: per-user YouTube API unit tracking ────────────────
--
-- One Pro user analyzing competitors at the rate limit can burn 144k
-- units/day — 14× the project's daily YouTube quota. Track usage per
-- user per day and let the app cap by plan.
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS youtube_api_units_used INT NOT NULL DEFAULT 0;

-- Add to the allowlist of fields the increment_usage / check_and_increment
-- RPCs can touch. Drop and recreate to refresh the IN list.
DROP FUNCTION IF EXISTS public.increment_usage(UUID, DATE, TEXT, INT);

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id UUID,
  p_period_start DATE,
  p_field TEXT,
  p_amount INT
) RETURNS public.usage_tracking
LANGUAGE plpgsql
AS $func$
DECLARE
  result public.usage_tracking;
BEGIN
  IF p_field NOT IN ('coach_messages_used', 'content_ideas_used', 'competitors_tracked', 'youtube_api_units_used') THEN
    RAISE EXCEPTION 'increment_usage: unknown field %', p_field;
  END IF;

  INSERT INTO public.usage_tracking (user_id, period_start, coach_messages_used, content_ideas_used, competitors_tracked, youtube_api_units_used)
  VALUES (p_user_id, p_period_start, 0, 0, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  EXECUTE format(
    'UPDATE public.usage_tracking SET %1$I = GREATEST(0, COALESCE(%1$I, 0) + $1), updated_at = NOW() WHERE user_id=$2 AND period_start=$3 RETURNING *',
    p_field
  )
  INTO result
  USING p_amount, p_user_id, p_period_start;

  RETURN result;
END
$func$;

REVOKE ALL ON FUNCTION public.increment_usage(UUID, DATE, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_usage(UUID, DATE, TEXT, INT) TO service_role;
