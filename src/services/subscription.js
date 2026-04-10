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

export async function incrementUsage(userId, field, amount = 1) {
  const usage = await getUsage(userId);
  if (!usage) return null;

  const { data, error } = await supabase
    .from('usage_tracking')
    .update({
      [field]: usage[field] + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', usage.id)
    .select()
    .single();

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

async function getDailyCoachMessages(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('coach_messages')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
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

// ─── Paddle Checkout URL Creation ─────────────────────

export async function createCheckoutUrl(priceId, userEmail, userId) {
  const API_KEY = process.env.PADDLE_API_KEY;

  const response = await fetch('https://api.paddle.com/transactions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [
        {
          price_id: priceId,
          quantity: 1,
        },
      ],
      custom_data: {
        user_id: userId,
      },
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Paddle checkout error:', result);
    throw new Error('Failed to create checkout');
  }

  const checkoutUrl = result.data?.checkout?.url;
  if (!checkoutUrl) {
    console.error('Paddle: No checkout URL in response:', result);
    throw new Error('No checkout URL returned');
  }

  return checkoutUrl;
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