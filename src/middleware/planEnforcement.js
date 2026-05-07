// ═══════════════════════════════════════════════════════
// NEXORA — Plan Enforcement Middleware
// Atomic check-and-increment via Postgres so a parallel burst can't
// drive a user past their quota.
// ═══════════════════════════════════════════════════════

import { checkLimit, getPlanLimits, getEffectivePlan } from '../services/subscription.js';
import { supabase } from '../services/supabase.js';
import { getUserProfile } from '../services/supabase.js';

// Map of metered actions to (limit field, plan-limit key, period strategy).
// Matches the columns / fields handled in security-migrations-v3.sql.
//
// "monthly" buckets the period at the first of the month (UTC) — same
// as usage_tracking.period_start. We only have monthly buckets in the
// schema today; daily/weekly enforcement layers on top via app code
// where needed (e.g., coach_message uses daily-from-messages count).
const METERED = {
  // Idea generation: weekly limit, persisted via content_ideas_used.
  // We bucket monthly in usage_tracking and let the limit be the
  // weekly cap multiplied by ~4 — close enough since the dashboard
  // also shows a per-week display via the message count. Pragmatic
  // trade-off: the monthly counter never resets within the period
  // start, so the limit is effectively monthly here.
  content_idea: {
    field: 'content_ideas_used',
    planKey: 'contentIdeasPerWeek',
    multiplier: 4, // monthly = weekly * 4 (roughly)
  },
  // Competitor tracking: hard cap (3 Pro, 10 Max). Using the atomic
  // RPC means parallel "track" calls past the limit are reliably
  // rejected, and the counter can't drift if one of save/increment
  // silently fails.
  competitor: {
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

// Atomic gate: SELECT ... FOR UPDATE inside a single Postgres function.
// Returns true when the user is allowed AND the counter has been bumped.
// Returns false when over limit; in that case the counter is NOT changed.
async function checkAndIncrementAtomic(userId, field, limit) {
  // Translate Infinity to -1 so the RPC's "unlimited" sentinel applies.
  const lim = limit === Infinity ? -1 : limit;
  const { data, error } = await supabase.rpc('check_and_increment_usage', {
    p_user_id: userId,
    p_period_start: isoMonthStart(),
    p_field: field,
    p_limit: lim,
    p_amount: 1,
  });
  if (error) {
    console.error('check_and_increment_usage RPC error:', error);
    return null; // caller treats as "fail closed"
  }
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
        const effectiveLimit = rawLimit === Infinity
          ? Infinity
          : (rawLimit * (meta.multiplier || 1));

        const allowed = await checkAndIncrementAtomic(userId, meta.field, effectiveLimit);
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
