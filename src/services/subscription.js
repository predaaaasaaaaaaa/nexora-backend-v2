// ═══════════════════════════════════════════════════════
// NEXORA — Paddle Subscription Service
// Handles checkout creation, plan mapping, usage limits
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// ─── Plan Configuration ───────────────────────────────
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
    },
  },
};

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

// ─── Usage Tracking ───────────────────────────────────

export async function getUsage(userId) {
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const periodStr = periodStart.toISOString().split('T')[0];

  let { data, error } = await supabase
    .from('usage_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('period_start', periodStr)
    .single();

  if (error || !data) {
    const { data: newData, error: insertError } = await supabase
      .from('usage_tracking')
      .upsert({
        user_id: userId,
        period_start: periodStr,
        coach_messages_used: 0,
        content_ideas_used: 0,
        competitors_tracked: 0,
      }, { onConflict: 'user_id,period_start' })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating usage record:', insertError);
      return null;
    }
    data = newData;
  }

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

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodStr = periodStart.toISOString().split('T')[0];

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
      const dailyUsed = await getDailyCoachMessages(userId);
      const limit = limits.coachMessagesPerDay;
      return {
        allowed: limit === Infinity || dailyUsed < limit,
        remaining: limit === Infinity ? 999 : Math.max(0, limit - dailyUsed),
        limit: limit === Infinity ? 'unlimited' : limit,
        used: dailyUsed,
      };
    }
    case 'content_idea': {
      const weeklyUsed = await getWeeklyContentIdeas(userId);
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

// coach_messages has no user_id column — it's joined through
// coach_conversations.user_id. The previous query .eq('user_id', userId)
// silently failed with an empty error, so the daily quota was effectively
// 0/day for everyone. Fix: get the user's conversation IDs first, then
// count messages in those conversations. Two queries, but each is
// indexed on (user_id) and (conversation_id, created_at) respectively.
async function getDailyCoachMessages(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: convs, error: convErr } = await supabase
    .from('coach_conversations')
    .select('id')
    .eq('user_id', userId);

  if (convErr) {
    console.error('Error loading conversations for quota:', convErr);
    return 0;
  }
  const ids = (convs || []).map(c => c.id);
  if (ids.length === 0) return 0;

  const { count, error } = await supabase
    .from('coach_messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('role', 'user')
    .gte('created_at', today.toISOString());

  if (error) {
    console.error('Error counting daily messages:', error);
    return 0;
  }
  return count || 0;
}

async function getWeeklyContentIdeas(userId) {
  const usage = await getUsage(userId);
  return usage?.content_ideas_used || 0;
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