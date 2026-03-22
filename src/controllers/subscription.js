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
  
  // GET /api/subscription/plans — return available plans
  export async function getPlans(req, res) {
    try {
      const plans = Object.entries(PLANS).map(([key, plan]) => ({
        id: key,
        name: plan.name,
        variantId: plan.variantId,
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
  
  // GET /api/subscription/current — get user's current plan + usage
  export async function getCurrentPlan(req, res) {
    try {
      const userId = req.user.id;
      const subscription = await getUserSubscription(userId);
      const usage = await getUsage(userId);
      const plan = subscription?.plan || 'free';
      const limits = getPlanLimits(plan);
  
      // Check if cancelled but still has access
      let effectivePlan = plan;
      if (subscription?.subscription_status === 'cancelled' && subscription?.subscription_ends_at) {
        const endsAt = new Date(subscription.subscription_ends_at);
        if (endsAt > new Date()) {
          effectivePlan = plan; // Still has access
        } else {
          effectivePlan = 'free'; // Access expired
        }
      }
  
      // Get daily coach messages used
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
  
  // POST /api/subscription/checkout — create checkout URL
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
  
      const variantId = PLANS[plan].variantId;
      const checkoutUrl = await createCheckoutUrl(variantId, profile.email, userId);
  
      res.json({ success: true, checkoutUrl });
    } catch (error) {
      console.error('Error creating checkout:', error);
      res.status(500).json({ success: false, error: 'Failed to create checkout' });
    }
  }
  
  // GET /api/subscription/portal — get customer portal URL (manage subscription)
  export async function getPortalUrl(req, res) {
    try {
      const userId = req.user.id;
      const subscription = await getUserSubscription(userId);
  
      if (!subscription?.ls_subscription_id) {
        return res.status(400).json({ success: false, error: 'No active subscription' });
      }
  
      // Lemon Squeezy provides a customer portal via the subscription
      const API_KEY = process.env.LEMONSQUEEZY_API_KEY;
      const response = await fetch(
        `https://api.lemonsqueezy.com/v1/subscriptions/${subscription.ls_subscription_id}`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/vnd.api+json',
          },
        }
      );
  
      const result = await response.json();
      const portalUrl = result?.data?.attributes?.urls?.customer_portal;
  
      if (!portalUrl) {
        return res.status(404).json({ success: false, error: 'Portal URL not found' });
      }
  
      res.json({ success: true, portalUrl });
    } catch (error) {
      console.error('Error fetching portal URL:', error);
      res.status(500).json({ success: false, error: 'Failed to get portal URL' });
    }
  }