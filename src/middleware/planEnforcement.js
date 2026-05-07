// ═══════════════════════════════════════════════════════
// NEXORA — Plan Enforcement Middleware
// Atomic check-and-increment via Postgres so a parallel burst can't
// drive a user past their quota.
// ═══════════════════════════════════════════════════════

import { checkLimit, getPlanLimits, getEffectivePlan } from '../services/subscription.js';
import { supabase } from '../services/supabase.js';
import { getUserProfile } from '../services/supabase.js';

// Map of metered actions to (limit field, plan-limit key, period
// strategy). Each entry is dispatched to the RIGHT atomic RPC at gate
// time — see callAtomicGate below.
//
// Period semantics:
//   weekly  → check_and_increment_weekly_ideas (resets every Mon UTC)
//   daily   → check_and_increment_daily_coach (resets at 00:00 UTC)
//   total   → check_and_increment_usage on a counter column with no
//             time bucket (lifetime cap; for tracked competitors)
const METERED = {
  // Free 3/week, Pro 30/week, Max unlimited.
  content_idea: {
    period: 'weekly',
    planKey: 'contentIdeasPerWeek',
  },
  // Free 5/day, Pro 15/day, Max unlimited.
  coach_message: {
    period: 'daily',
    planKey: 'coachMessagesPerDay',
  },
  // Hard total cap (3 Pro, 10 Max). Parallel "track" calls past the
  // limit are reliably rejected by the atomic RPC.
  competitor: {
    period: 'total',
    field: 'competitors_tracked',
    planKey: 'maxCompetitors',
  },
};

function isoMonthStart() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

// Atomic gate dispatcher. Routes each METERED action to the right
// Postgres RPC for its period strategy. Each RPC takes a row lock,
// resets the counter on period rollover (week/day), and increments —
// all in one transaction. Truly race-proof.
//
// Returns true when allowed (and counter bumped), false when over
// limit (counter NOT bumped), null when the RPC errored (caller fails closed).
async function callAtomicGate(userId, meta, limit) {
  const lim = limit === Infinity ? -1 : limit;

  if (meta.period === 'weekly') {
    const { data, error } = await supabase.rpc('check_and_increment_weekly_ideas', {
      p_user_id: userId,
      p_limit: lim,
    });
    if (error) { console.error('weekly_ideas RPC error:', error); return null; }
    return Boolean(data);
  }

  if (meta.period === 'daily') {
    const { data, error } = await supabase.rpc('check_and_increment_daily_coach', {
      p_user_id: userId,
      p_limit: lim,
    });
    if (error) { console.error('daily_coach RPC error:', error); return null; }
    return Boolean(data);
  }

  // total: hard lifetime cap on a counter column (e.g. competitors_tracked).
  const { data, error } = await supabase.rpc('check_and_increment_usage', {
    p_user_id: userId,
    p_period_start: isoMonthStart(),
    p_field: meta.field,
    p_limit: lim,
    p_amount: 1,
  });
  if (error) { console.error('check_and_increment_usage RPC error:', error); return null; }
  return Boolean(data);
}

// Factory function: creates middleware for a specific action.
//
// Two enforcement modes:
//   1. Action present in METERED above — use the atomic RPC. The
//      counter is incremented inside the same transaction as the check
//      so concurrent requests can't bypass.
//   2. Otherwise — fall back to the old read-then-allow check via
//      checkLimit (still useful for time-window things like coach
//      messages where the count comes from another table).
export function requirePlan(action) {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const profile = await getUserProfile(userId);
      const plan = getEffectivePlan(profile);
      req.userPlan = plan;

      const meta = METERED[action];

      if (meta) {
        const limits = getPlanLimits(plan);
        const rawLimit = limits[meta.planKey];

        const allowed = await callAtomicGate(userId, meta, rawLimit);
        if (allowed === null) {
          // RPC failed — fail closed.
          return res.status(503).json({
            success: false,
            error: 'plan_check_failed',
            message: 'Could not verify your plan. Please try again shortly.',
          });
        }
        if (!allowed) {
          return blockResponse(res, plan);
        }
        // Tell the controller "don't double-bump" via incrementUsage
        // (legacy callers still do it — see ideas.js).
        req.quotaAlreadyIncremented = true;
        return next();
      }

      // Non-atomic path (coach_message, competitor, etc.) — read-only
      // check. Suitable when the count comes from a row-by-row table
      // we don't increment (e.g., counting coach_messages by day).
      const result = await checkLimit(userId, plan, action);
      if (!result.allowed) {
        return blockResponse(res, plan, result);
      }
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

function blockResponse(res, plan, result) {
  const upgradeMessage = plan === 'free'
    ? 'Upgrade to Nexora Pro to unlock this feature!'
    : 'Upgrade to Nexora Max for unlimited access!';
  return res.status(403).json({
    success: false,
    error: 'limit_reached',
    message: upgradeMessage,
    usage: result ? {
      used: result.used,
      limit: result.limit,
      remaining: result.remaining,
    } : null,
    currentPlan: plan,
    upgradeTo: plan === 'free' ? 'pro' : 'max',
  });
}

// Simple plan check (no usage limit, just checks feature access)
export function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const profile = await getUserProfile(userId);
      const plan = getEffectivePlan(profile);

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
