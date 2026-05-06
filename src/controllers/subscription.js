// ═══════════════════════════════════════════════════════
// NEXORA — Subscription Controller
// Checkout URLs, plan info, usage data
// ═══════════════════════════════════════════════════════

import crypto from 'crypto';
import {
  PLANS,
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


// GET /api/subscription/checkout-token — short-lived signed user_id the
// frontend embeds as custom_data.user_id_signed when opening Paddle checkout.
// The webhook verifies this so an attacker can't substitute another user's id.
export async function getCheckoutToken(req, res) {
  try {
    const secret = process.env.CHECKOUT_USER_ID_SECRET;
    if (!secret || secret.length < 32) {
      console.error('CHECKOUT_USER_ID_SECRET missing or too short');
      return res.status(500).json({ success: false, error: 'Checkout misconfigured' });
    }

    const payload = {
      userId: req.user.id,
      exp: Date.now() + 30 * 60 * 1000, // 30 minutes
    };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');

    res.json({ success: true, token: `${b64}.${sig}`, expiresAt: payload.exp });
  } catch (error) {
    console.error('Error minting checkout token:', error);
    res.status(500).json({ success: false, error: 'Failed to mint checkout token' });
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