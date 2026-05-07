-- ============================================
-- NEXORA SECURITY MIGRATIONS v3 — NO-DOLLAR-SIGN VARIANT
-- Use this if your SQL editor escapes $ characters on paste.
-- Pure single-quoted function bodies, internal quotes doubled.
-- Same logic as security-migrations-v3.sql, just paste-safe.
-- ============================================

DROP FUNCTION IF EXISTS public.check_and_increment_usage(UUID, DATE, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.check_and_increment_usage(
  p_user_id UUID,
  p_period_start DATE,
  p_field TEXT,
  p_limit INT,
  p_amount INT DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS '
DECLARE
  current_val INT;
BEGIN
  IF p_field NOT IN (''coach_messages_used'', ''content_ideas_used'', ''competitors_tracked'', ''youtube_api_units_used'') THEN
    RAISE EXCEPTION ''unknown field %'', p_field;
  END IF;

  INSERT INTO public.usage_tracking (user_id, period_start, coach_messages_used, content_ideas_used, competitors_tracked, youtube_api_units_used)
  VALUES (p_user_id, p_period_start, 0, 0, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  CASE p_field
    WHEN ''coach_messages_used'' THEN
      SELECT coach_messages_used INTO current_val FROM public.usage_tracking
       WHERE user_id = p_user_id AND period_start = p_period_start FOR UPDATE;
    WHEN ''content_ideas_used'' THEN
      SELECT content_ideas_used INTO current_val FROM public.usage_tracking
       WHERE user_id = p_user_id AND period_start = p_period_start FOR UPDATE;
    WHEN ''competitors_tracked'' THEN
      SELECT competitors_tracked INTO current_val FROM public.usage_tracking
       WHERE user_id = p_user_id AND period_start = p_period_start FOR UPDATE;
    WHEN ''youtube_api_units_used'' THEN
      SELECT youtube_api_units_used INTO current_val FROM public.usage_tracking
       WHERE user_id = p_user_id AND period_start = p_period_start FOR UPDATE;
  END CASE;

  IF current_val IS NULL THEN current_val := 0; END IF;

  IF p_limit < 0 OR (current_val + p_amount) <= p_limit THEN
    CASE p_field
      WHEN ''coach_messages_used'' THEN
        UPDATE public.usage_tracking SET coach_messages_used = COALESCE(coach_messages_used, 0) + p_amount, updated_at = NOW()
         WHERE user_id = p_user_id AND period_start = p_period_start;
      WHEN ''content_ideas_used'' THEN
        UPDATE public.usage_tracking SET content_ideas_used = COALESCE(content_ideas_used, 0) + p_amount, updated_at = NOW()
         WHERE user_id = p_user_id AND period_start = p_period_start;
      WHEN ''competitors_tracked'' THEN
        UPDATE public.usage_tracking SET competitors_tracked = COALESCE(competitors_tracked, 0) + p_amount, updated_at = NOW()
         WHERE user_id = p_user_id AND period_start = p_period_start;
      WHEN ''youtube_api_units_used'' THEN
        UPDATE public.usage_tracking SET youtube_api_units_used = COALESCE(youtube_api_units_used, 0) + p_amount, updated_at = NOW()
         WHERE user_id = p_user_id AND period_start = p_period_start;
    END CASE;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END
';

GRANT EXECUTE ON FUNCTION public.check_and_increment_usage(UUID, DATE, TEXT, INT, INT) TO service_role;


DROP FUNCTION IF EXISTS public.increment_usage(UUID, DATE, TEXT, INT);

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id UUID,
  p_period_start DATE,
  p_field TEXT,
  p_amount INT
) RETURNS public.usage_tracking
LANGUAGE plpgsql
AS '
DECLARE
  result public.usage_tracking;
BEGIN
  IF p_field NOT IN (''coach_messages_used'', ''content_ideas_used'', ''competitors_tracked'', ''youtube_api_units_used'') THEN
    RAISE EXCEPTION ''unknown field %'', p_field;
  END IF;

  INSERT INTO public.usage_tracking (user_id, period_start, coach_messages_used, content_ideas_used, competitors_tracked, youtube_api_units_used)
  VALUES (p_user_id, p_period_start, 0, 0, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  CASE p_field
    WHEN ''coach_messages_used'' THEN
      UPDATE public.usage_tracking SET coach_messages_used = GREATEST(0, COALESCE(coach_messages_used, 0) + p_amount), updated_at = NOW()
       WHERE user_id = p_user_id AND period_start = p_period_start RETURNING * INTO result;
    WHEN ''content_ideas_used'' THEN
      UPDATE public.usage_tracking SET content_ideas_used = GREATEST(0, COALESCE(content_ideas_used, 0) + p_amount), updated_at = NOW()
       WHERE user_id = p_user_id AND period_start = p_period_start RETURNING * INTO result;
    WHEN ''competitors_tracked'' THEN
      UPDATE public.usage_tracking SET competitors_tracked = GREATEST(0, COALESCE(competitors_tracked, 0) + p_amount), updated_at = NOW()
       WHERE user_id = p_user_id AND period_start = p_period_start RETURNING * INTO result;
    WHEN ''youtube_api_units_used'' THEN
      UPDATE public.usage_tracking SET youtube_api_units_used = GREATEST(0, COALESCE(youtube_api_units_used, 0) + p_amount), updated_at = NOW()
       WHERE user_id = p_user_id AND period_start = p_period_start RETURNING * INTO result;
  END CASE;

  RETURN result;
END
';

GRANT EXECUTE ON FUNCTION public.increment_usage(UUID, DATE, TEXT, INT) TO service_role;
