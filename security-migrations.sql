-- ============================================
-- NEXORA SECURITY MIGRATIONS
-- Run after database-migrations.sql / unified-ai-migrations.sql.
-- These add defense-in-depth around the audit fixes.
-- ============================================

-- ─── M6: atomic usage increment ─────────────────────────────────
--
-- The previous Node-side incrementUsage() did read-modify-write, so
-- two concurrent requests could both read N and both write N+1, letting
-- a user squeeze through a quota by racing the calls. This RPC moves
-- the +/- into Postgres so it's atomic.
--
-- We also create the row on the fly with ON CONFLICT, so callers don't
-- have to upsert a zero row first.
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id UUID,
  p_period_start DATE,
  p_field TEXT,
  p_amount INT
) RETURNS public.usage_tracking
LANGUAGE plpgsql
AS $$
DECLARE
  result public.usage_tracking;
BEGIN
  -- Allowlist columns we'll touch — never trust p_field directly in dynamic SQL.
  IF p_field NOT IN ('coach_messages_used', 'content_ideas_used', 'competitors_tracked') THEN
    RAISE EXCEPTION 'increment_usage: unknown field %', p_field;
  END IF;

  INSERT INTO public.usage_tracking (user_id, period_start, coach_messages_used, content_ideas_used, competitors_tracked)
  VALUES (p_user_id, p_period_start, 0, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  EXECUTE format(
    'UPDATE public.usage_tracking
        SET %1$I = GREATEST(0, COALESCE(%1$I, 0) + $1),
            updated_at = NOW()
      WHERE user_id = $2 AND period_start = $3
      RETURNING *',
    p_field
  )
  INTO result
  USING p_amount, p_user_id, p_period_start;

  RETURN result;
END;
$$;

-- Lock the function down so only authenticated server roles can call it.
REVOKE ALL ON FUNCTION public.increment_usage(UUID, DATE, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_usage(UUID, DATE, TEXT, INT) TO service_role;
