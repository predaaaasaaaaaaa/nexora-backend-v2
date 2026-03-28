// ═══════════════════════════════════════════════════════
// NEXORA — Subscription Controller
// Checkout URLs, plan info, usage data
// ═══════════════════════════════════════════════════════

import {
  PLANS,
  createCheckoutUrl,
  getUserSubscription,
  getUsage,
  checkLimit,
  getPlanLimits,
} from '../services/subscription.js';
import { getUserProfile } from '../services/supabase.js';

// GET /api/subscription/plans
export async function getPlans(req, res) {
  try {
    const plans = Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      priceId: plan.priceId,
      limits: {
        ...plan.limits,
        coachMessagesPerDay: plan.limits.coachMessagesPerDay === Infinity ? 'unlimited' : plan.limits.coachMessagesPerDay,
        contentIdeasPerWeek: plan.limits.contentIdeasPerWeek === Infinity ? 'unlimited' : plan.limits.contentIdeasPerWeek,
      },
    }));

    res.json({ success: true, plans });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch plans' });
  }
}

// GET /api/subscription/current
export async function getCurrentPlan(req, res) {
  try {
    const userId = req.user.id;
    const subscription = await getUserSubscription(userId);
    const usage = await getUsage(userId);
    const plan = subscription?.plan || 'free';
    const limits = getPlanLimits(plan);

    let effectivePlan = plan;
    if (subscription?.subscription_status === 'cancelled' && subscription?.subscription_ends_at) {
      const endsAt = new Date(subscription.subscription_ends_at);
      if (endsAt > new Date()) {
        effectivePlan = plan;
      } else {
        effectivePlan = 'free';
      }
    }

    const coachCheck = await checkLimit(userId, effectivePlan, 'coach_message');
    const ideasCheck = await checkLimit(userId, effectivePlan, 'content_idea');

    res.json({
      success: true,
      subscription: {
        plan: effectivePlan,
        planName: PLANS[effectivePlan]?.name || 'Free',
        status: subscription?.subscription_status || 'inactive',
        trialEndsAt: subscription?.trial_ends_at,
        subscriptionEndsAt: subscription?.subscription_ends_at,
        activatedAt: subscription?.plan_activated_at,
      },
      usage: {
        coachMessages: {
          used: coachCheck.used || 0,
          limit: coachCheck.limit,
          remaining: coachCheck.remaining,
        },
        contentIdeas: {
          used: ideasCheck.used || 0,
          limit: ideasCheck.limit,
          remaining: ideasCheck.remaining,
        },
        competitors: {
          used: usage?.competitors_tracked || 0,
          limit: limits.maxCompetitors,
        },
      },
      limits: {
        ...limits,
        coachMessagesPerDay: limits.coachMessagesPerDay === Infinity ? 'unlimited' : limits.coachMessagesPerDay,
        contentIdeasPerWeek: limits.contentIdeasPerWeek === Infinity ? 'unlimited' : limits.contentIdeasPerWeek,
      },
    });
  } catch (error) {
    console.error('Error fetching current plan:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch plan' });
  }
}

// POST /api/subscription/checkout
export async function createCheckout(req, res) {
  try {
    const userId = req.user.id;
    const { plan } = req.body;

    if (!plan || !PLANS[plan] || plan === 'free') {
      return res.status(400).json({ success: false, error: 'Invalid plan' });
    }

    const profile = await getUserProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const priceId = PLANS[plan].priceId;
    const checkoutUrl = await createCheckoutUrl(priceId, profile.email, userId);

    res.json({ success: true, checkoutUrl });
  } catch (error) {
    console.error('Error creating checkout:', error);
    res.status(500).json({ success: false, error: 'Failed to create checkout' });
  }
}

// GET /api/subscription/portal — Paddle cancel/update URL
export async function getPortalUrl(req, res) {
  try {
    const userId = req.user.id;
    const subscription = await getUserSubscription(userId);

    if (!subscription?.paddle_subscription_id) {
      return res.status(400).json({ success: false, error: 'No active subscription' });
    }

    const API_KEY = process.env.PADDLE_API_KEY;
    const baseUrl = process.env.PADDLE_ENV === 'sandbox'
      ? 'https://sandbox-api.paddle.com'
      : 'https://api.paddle.com';

    const response = await fetch(
      `${baseUrl}/subscriptions/${subscription.paddle_subscription_id}/update-payment-method-transaction`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const result = await response.json();
    const portalUrl = result?.data?.checkout?.url;

    if (!portalUrl) {
      return res.status(404).json({ success: false, error: 'Portal URL not found' });
    }

    res.json({ success: true, portalUrl });
  } catch (error) {
    console.error('Error fetching portal URL:', error);
    res.status(500).json({ success: false, error: 'Failed to get portal URL' });
  }
}