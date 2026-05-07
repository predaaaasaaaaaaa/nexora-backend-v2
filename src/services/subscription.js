// ═══════════════════════════════════════════════════════
// NEXORA — Paddle Subscription Service
// Handles checkout creation, plan mapping, usage limits
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// ─── Plan Configuration ───────────────────────────────
//
// youtubeApiUnitsPerMonth — caps per-user YouTube quota use (search,
// analyze, compare). Sized so all paying users together stay well under
// the project's 10k/day default. Tune via env if you raise the
// project quota at Google.
export const PLANS = {
  free: {
    name: 'Free',
    priceId: null,
    limits: {
      coachMessagesPerDay: 5,
      contentIdeasPerWeek: 3,
      maxCompetitors: 0,
      hasScheduler: false,
      hasConversationHistory: false,
      dashboardDays: 7,
      youtubeApiUnitsPerMonth: 0,
    },
  },
  pro: {
    name: 'Nexora Pro',
    priceId: process.env.PADDLE_PRO_PRICE_ID,
    limits: {
      coachMessagesPerDay: 15,
      contentIdeasPerWeek: 30,
      maxCompetitors: 3,
      hasScheduler: true,
      hasConversationHistory: true,
      dashboardDays: 90,
      youtubeApiUnitsPerMonth: parseInt(process.env.YT_QUOTA_PRO || '2000', 10),
    },
  },
  max: {
    name: 'Nexora Max',
    priceId: process.env.PADDLE_MAX_PRICE_ID,
    limits: {
      coachMessagesPerDay: Infinity,
      contentIdeasPerWeek: Infinity,
      maxCompetitors: 10,
      hasScheduler: true,
      hasConversationHistory: true,
      dashboardDays: 3650,
      youtubeApiUnitsPerMonth: parseInt(process.env.YT_QUOTA_MAX || '10000', 10),
    },
  },
};

// ─── YouTube quota helper ───────────────────────────────────────
//
// Atomic check-and-increment via the existing RPC, sized in YouTube
// API "units" (per https://developers.google.com/youtube/v3/determine_quota_cost).
// Returns true if the call is allowed; throws YouTubeQuotaExceededError
// otherwise so the caller can return a clean 429.
export class YouTubeQuotaExceededError extends Error {
  constructor(used, limit) {
    super(`YouTube quota for this user exhausted (${used}/${limit} units used this month)`);
    this.name = 'YouTubeQuotaExceededError';
    this.used = used;
    this.limit = limit;
  }
}

export async function consumeYouTubeQuota(userId, plan, units) {
  const limits = getPlanLimits(plan);
  const limit = limits.youtubeApiUnitsPerMonth || 0;
  if (limit <= 0) {
    throw new YouTubeQuotaExceededError(0, 0);
  }

  const periodStr = utcMonthStartIso();

  const { data, error } = await supabase.rpc('check_and_increment_usage', {
    p_user_id: userId,
    p_period_start: periodStr,
    p_field: 'youtube_api_units_used',
    p_limit: limit,
    p_amount: units,
  });
  if (error) {
    console.error('consumeYouTubeQuota RPC error:', error);
    return false; // fail closed
  }
  if (!data) {
    // Get current value for the error message — best-effort.
    const usage = await getUsage(userId);
    throw new YouTubeQuotaExceededError(usage?.youtube_api_units_used || 0, limit);
  }
  return true;
}

// Map Paddle price ID to plan name
export function getPlanFromPriceId(priceId) {
  const id = String(priceId);
  if (id === String(PLANS.pro.priceId)) return 'pro';
  if (id === String(PLANS.max.priceId)) return 'max';
  return 'free';
}

// Get plan limits for a user
export function getPlanLimits(plan) {
  return PLANS[plan]?.limits || PLANS.free.limits;
}

// Resolve the plan a user currently has *access* to, accounting for
// cancellation grace and past_due states. Centralized so every gate
// sees the same semantics.
//
// past_due grace: PAST_DUE_GRACE_DAYS (default 3) — after that we treat
// the user as free. Set to 0 to downgrade immediately on payment failure.
const PAST_DUE_GRACE_DAYS = parseInt(process.env.PAST_DUE_GRACE_DAYS || '3', 10);

export function getEffectivePlan(profile) {
  if (!profile) return 'free';
  const plan = profile.plan || 'free';
  const status = profile.subscription_status;

  if (status === 'cancelled' && profile.subscription_ends_at) {
    const endsAt = new Date(profile.subscription_ends_at);
    return endsAt > new Date() ? plan : 'free';
  }

  if (status === 'past_due') {
    const since = profile.updated_at ? new Date(profile.updated_at) : new Date(0);
    const ageDays = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays <= PAST_DUE_GRACE_DAYS ? plan : 'free';
  }

  return plan;
}

// ─── Usage Tracking ───────────────────────────────────

// Compute the start of the current month in UTC, matching what the
// Postgres RPCs use (date_trunc('month', NOW())::DATE in a default-UTC
// session). The previous local-time setDate(1) drifted by a day for
// any non-UTC server (CET/CEST in dev), causing getUsage to query a
// row at e.g. '2025-04-30' while the gate wrote to '2025-05-01' —
// the display ended up reading a different row than the gate enforced.
function utcMonthStartIso() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

export async function getUsage(userId) {
  const periodStr = utcMonthStartIso();

  const { data, error } = await supabase
    .from('usage_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('period_start', periodStr)
    .maybeSingle();

  if (error) {
    console.error('Error reading usage record:', error);
    return null;
  }

  // Intentionally do NOT auto-create the row from a display read.
  //   - Display callers (getCurrentPlan, dashboard) just want to show
  //     "0/3" when there's nothing yet — null is fine, the bucket
  //     readers handle it.
  //   - Mutating callers (incrementUsage / check_and_increment_usage)
  //     create the row inside their own atomic RPC, with the right
  //     period_start and the right defaults for the new weekly/daily
  //     columns. Letting THIS function upsert was overwriting those
  //     gate-managed columns at unpredictable times.
  return data;
}

// Allowlist the columns we'll touch so a caller bug can't write into
// arbitrary fields on usage_tracking. Mirrored in the increment_usage
// Postgres function (see security-migrations.sql).
const USAGE_FIELDS = new Set([
  'coach_messages_used',
  'content_ideas_used',
  'competitors_tracked',
]);

export async function incrementUsage(userId, field, amount = 1) {
  if (!USAGE_FIELDS.has(field)) {
    console.error(`incrementUsage: refusing unknown field "${field}"`);
    return null;
  }

  const periodStr = utcMonthStartIso();

  // Atomic increment via Postgres RPC. Replaces the previous
  // read-modify-write sequence which raced when two requests landed at
  // the same time and let a user occasionally exceed their quota.
  const { data, error } = await supabase.rpc('increment_usage', {
    p_user_id: userId,
    p_period_start: periodStr,
    p_field: field,
    p_amount: amount,
  });

  if (error) {
    console.error(`Error incrementing ${field}:`, error);
    return null;
  }
  return data;
}

export async function checkLimit(userId, plan, action) {
  const limits = getPlanLimits(plan);
  const usage = await getUsage(userId);

  if (!usage) {
    return { allowed: true, remaining: 0 };
  }

  switch (action) {
    case 'coach_message': {
      const dailyUsed = await getDailyCoachMessagesFromBucket(userId);
      const limit = limits.coachMessagesPerDay;
      return {
        allowed: limit === Infinity || dailyUsed < limit,
        remaining: limit === Infinity ? 999 : Math.max(0, limit - dailyUsed),
        limit: limit === Infinity ? 'unlimited' : limit,
        used: dailyUsed,
      };
    }
    case 'content_idea': {
      const weeklyUsed = await getWeeklyContentIdeasFromBucket(userId);
      const limit = limits.contentIdeasPerWeek;
      return {
        allowed: limit === Infinity || weeklyUsed < limit,
        remaining: limit === Infinity ? 999 : Math.max(0, limit - weeklyUsed),
        limit: limit === Infinity ? 'unlimited' : limit,
        used: weeklyUsed,
      };
    }
    case 'competitor': {
      const used = usage.competitors_tracked;
      const limit = limits.maxCompetitors;
      return {
        allowed: used < limit,
        remaining: Math.max(0, limit - used),
        limit,
        used,
      };
    }
    case 'scheduler': {
      return {
        allowed: limits.hasScheduler,
        remaining: limits.hasScheduler ? 999 : 0,
        limit: limits.hasScheduler ? 'unlimited' : 0,
      };
    }
    case 'conversation_history': {
      return { allowed: limits.hasConversationHistory };
    }
    default:
      return { allowed: true };
  }
}

// Read from the atomic-bucket columns added in migration v4. These are
// the SAME counters the gate increments, so the UI and the gate can
// never disagree (no more "you've used 4/3" weirdness).
//
// Returns 0 if the user has no row yet, OR if the stored bucket-start
// is older than the current period (in which case the next gate call
// will reset it to 0 anyway, so showing 0 is honest).
async function getDailyCoachMessagesFromBucket(userId) {
  const usage = await getUsage(userId);
  if (!usage) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const stored = usage.coach_messages_day_start ? new Date(usage.coach_messages_day_start) : null;
  if (!stored || stored < today) return 0;
  return usage.coach_messages_day_used || 0;
}

async function getWeeklyContentIdeasFromBucket(userId) {
  const usage = await getUsage(userId);
  if (!usage) return 0;
  // Compute Monday-of-this-week the same way Postgres date_trunc('week') does.
  const now = new Date();
  const day = now.getUTCDay() || 7; // Sunday = 0 → 7
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - (day - 1));
  monday.setUTCHours(0, 0, 0, 0);
  const stored = usage.content_ideas_week_start ? new Date(usage.content_ideas_week_start) : null;
  if (!stored || stored < monday) return 0;
  return usage.content_ideas_week_used || 0;
}

// ─── Subscription Management ──────────────────────────

export async function getUserSubscription(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, subscription_status, paddle_subscription_id, paddle_customer_id, trial_ends_at, subscription_ends_at, plan_activated_at')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching subscription:', error);
    return null;
  }
  return data;
}

export async function updateSubscription(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating subscription:', error);
    return null;
  }
  return data;
}

export async function logSubscriptionEvent(eventType, payload, userId = null, plan = null) {
  const { error } = await supabase
    .from('subscription_events')
    .insert({
      user_id: userId,
      event_type: eventType,
      paddle_subscription_id: payload?.data?.id || null,
      paddle_customer_id: payload?.data?.customer_id || null,
      price_id: payload?.data?.items?.[0]?.price?.id || null,
      plan,
      payload,
    });

  if (error) {
    console.error('Error logging subscription event:', error);
  }
}