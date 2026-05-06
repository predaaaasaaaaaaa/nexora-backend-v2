// ═══════════════════════════════════════════════════════
// NEXORA — Plan Enforcement Middleware
// Checks user's plan limits before allowing actions
// ═══════════════════════════════════════════════════════

import { checkLimit } from '../services/subscription.js';
import { getUserProfile } from '../services/supabase.js';

// Factory function: creates middleware for a specific action
export function requirePlan(action) {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;

      // Get user's current plan
      const profile = await getUserProfile(userId);
      const plan = profile?.plan || 'free';

      // Check if cancelled but still has access
      if (profile?.subscription_status === 'cancelled' && profile?.subscription_ends_at) {
        const endsAt = new Date(profile.subscription_ends_at);
        if (endsAt < new Date()) {
          // Access expired — treat as free
          req.userPlan = 'free';
        } else {
          req.userPlan = plan;
        }
      } else {
        req.userPlan = plan;
      }

      // Check the specific limit
      const result = await checkLimit(userId, req.userPlan, action);

      if (!result.allowed) {
        const upgradeMessage = req.userPlan === 'free'
          ? 'Upgrade to Nexora Pro to unlock this feature!'
          : 'Upgrade to Nexora Max for unlimited access!';

        return res.status(403).json({
          success: false,
          error: 'limit_reached',
          message: upgradeMessage,
          usage: {
            used: result.used,
            limit: result.limit,
            remaining: result.remaining,
          },
          currentPlan: req.userPlan,
          upgradeTo: req.userPlan === 'free' ? 'pro' : 'max',
        });
      }

      // Attach plan info to request for downstream use
      req.userPlan = req.userPlan;
      req.planLimits = result;
      next();

    } catch (error) {
      console.error('Plan enforcement error:', error);
      // Fail closed — refuse the request rather than silently bypass the limit.
      return res.status(503).json({
        success: false,
        error: 'plan_check_failed',
        message: 'Could not verify your plan. Please try again shortly.',
      });
    }
  };
}

// Simple plan check (no usage limit, just checks feature access)
export function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const profile = await getUserProfile(userId);
      const plan = profile?.plan || 'free';

      const result = await checkLimit(userId, plan, feature);

      if (!result.allowed) {
        const featureNames = {
          scheduler: 'Content Scheduler',
          conversation_history: 'Conversation History',
          competitor: 'Competitor Analysis',
        };

        return res.status(403).json({
          success: false,
          error: 'feature_locked',
          message: `${featureNames[feature] || feature} is available on Nexora Pro and above.`,
          currentPlan: plan,
          upgradeTo: 'pro',
        });
      }

      req.userPlan = plan;
      next();

    } catch (error) {
      console.error('Feature check error:', error);
      // Fail closed — gating a paid feature must never silently allow access.
      return res.status(503).json({
        success: false,
        error: 'feature_check_failed',
        message: 'Could not verify your plan. Please try again shortly.',
      });
    }
  };
}