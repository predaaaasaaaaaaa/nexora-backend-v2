-- ============================================
-- NEXORA SECURITY MIGRATIONS v4 — true weekly + daily quotas
-- Run after security-migrations-v3-noescape.sql.
-- No-dollar-sign variant for editor compatibility.
--
-- Why this exists:
--   v2/v3 stored content_ideas_used in a MONTHLY bucket and the app
--   approximated "weekly" by multiplying the displayed limit by 4.
--   Result: Free (3/week) was actually enforced as 12/month, so a user
--   could generate 6 ideas in one week without ever hitting the gate.
--
--   This file adds proper rolling-window columns + atomic RPCs:
--     content_ideas: per ISO week, resets every Monday UTC.
--     coach_messages: per UTC day, resets at 00:00 UTC.
--   Each RPC takes a row lock, checks the period, resets the counter
--   on rollover, and increments — all in one transaction. Truly
--   race-proof.
-- ============================================

-- ─── Schema additions ────────────────────────────────────
ALTER TABLE usage_tracking
  ADD COLUMN IF NOT EXISTS content_ideas_week_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_ideas_week_start DATE,
  ADD COLUMN IF NOT EXISTS coach_messages_day_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coach_messages_day_start DATE;


-- ─── Q1: weekly atomic gate for content_ideas ────────────
DROP FUNCTION IF EXISTS public.check_and_increment_weekly_ideas(UUID, INT);

CREATE OR REPLACE FUNCTION public.check_and_increment_weekly_ideas(
  p_user_id UUID,
  p_limit INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS '
DECLARE
  v_week_start DATE;
  v_current_week DATE;
  v_used INT;
  v_period_start DATE;
BEGIN
  -- Truncate to the start of this week (Monday) and the start of this month.
  v_period_start := date_trunc(''month'', NOW())::DATE;
  v_current_week := date_trunc(''week'', NOW())::DATE;

  -- Make sure the monthly row exists. ON CONFLICT keeps this idempotent.
  INSERT INTO public.usage_tracking (
    user_id, period_start, coach_messages_used, content_ideas_used,
    competitors_tracked, youtube_api_units_used,
    content_ideas_week_used, content_ideas_week_start
  )
  VALUES (p_user_id, v_period_start, 0, 0, 0, 0, 0, v_current_week)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  -- Lock the row for the duration of this transaction.
  SELECT content_ideas_week_used, content_ideas_week_start
    INTO v_used, v_week_start
    FROM public.usage_tracking
   WHERE user_id = p_user_id AND period_start = v_period_start
   FOR UPDATE;

  -- Roll over if we are in a new ISO week (or the column was never set).
  IF v_week_start IS NULL OR v_week_start < v_current_week THEN
    v_used := 0;
    v_week_start := v_current_week;
  END IF;

  -- p_limit < 0 means unlimited. Always allowed, but still bump so
  -- usage telemetry stays accurate for ops.
  IF p_limit < 0 OR (v_used + 1) <= p_limit THEN
    UPDATE public.usage_tracking
       SET content_ideas_week_used = v_used + 1,
           content_ideas_week_start = v_current_week,
           updated_at = NOW()
     WHERE user_id = p_user_id AND period_start = v_period_start;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END
';

GRANT EXECUTE ON FUNCTION public.check_and_increment_weekly_ideas(UUID, INT) TO service_role;


-- ─── Q2: daily atomic gate for coach_messages ────────────
DROP FUNCTION IF EXISTS public.check_and_increment_daily_coach(UUID, INT);

CREATE OR REPLACE FUNCTION public.check_and_increment_daily_coach(
  p_user_id UUID,
  p_limit INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS '
DECLARE
  v_day_start DATE;
  v_today DATE;
  v_used INT;
  v_period_start DATE;
BEGIN
  v_period_start := date_trunc(''month'', NOW())::DATE;
  v_today := date_trunc(''day'', NOW())::DATE;

  INSERT INTO public.usage_tracking (
    user_id, period_start, coach_messages_used, content_ideas_used,
    competitors_tracked, youtube_api_units_used,
    coach_messages_day_used, coach_messages_day_start
  )
  VALUES (p_user_id, v_period_start, 0, 0, 0, 0, 0, v_today)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  SELECT coach_messages_day_used, coach_messages_day_start
    INTO v_used, v_day_start
    FROM public.usage_tracking
   WHERE user_id = p_user_id AND period_start = v_period_start
   FOR UPDATE;

  IF v_day_start IS NULL OR v_day_start < v_today THEN
    v_used := 0;
    v_day_start := v_today;
  END IF;

  IF p_limit < 0 OR (v_used + 1) <= p_limit THEN
    UPDATE public.usage_tracking
       SET coach_messages_day_used = v_used + 1,
           coach_messages_day_start = v_today,
           updated_at = NOW()
     WHERE user_id = p_user_id AND period_start = v_period_start;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END
';

GRANT EXECUTE ON FUNCTION public.check_and_increment_daily_coach(UUID, INT) TO service_role;
