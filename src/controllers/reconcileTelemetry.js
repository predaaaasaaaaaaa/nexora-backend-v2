import { supabase } from '../services/supabase.js';
import { sendTelemetryAlert } from '../services/notificationService.js';

// ============================================================
// TELEMETRY RECONCILE GUARD
// ============================================================
// Closes the silent-failure hole the await-fix (commit e41c2ed) patched:
// nothing ALERTED when server-side trackEvent() writes were being dropped on
// serverless freeze. This guard runs daily (Vercel cron) and cross-checks the
// one product event that HAS a reliable source of truth.
//
//   canary  = distinct users firing `coach_query_sent` in product_events
//   truth   = distinct activated users = coach_messages role='user' joined to
//             coach_conversations.user_id, excluding the test user (the same
//             definition the activation metric uses).
//
// Every real coach query writes a coach_messages row AND emits coach_query_sent,
// so in steady state canary == truth. We alert on divergence in EITHER
// direction beyond tolerance: canary BELOW truth is the undercount the await
// bug caused; canary ABOVE truth is over-firing / double-emit — also a
// telemetry failure a reconcile guard must catch. Post-backfill baseline: 12 == 12.

// Same test user the activation metric excludes.
const TEST_USER_ID = '89211a20-b4ba-47cd-94a9-07b4450c7c9c';

// PostgREST caps a single select near 1000 rows. Page through so distinct-user
// counts stay correct as the tables grow — a guard that undercounts at scale
// would manufacture the very false-green it exists to prevent.
const PAGE = 1000;

async function fetchAllRows(table, columns, filter) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Tolerance: allow a tiny lag (e.g. an in-flight query whose two writes race
// across the reconcile instant) without paging anyone, but catch a systematic
// regression like the await bug (which dropped many users at once) or an
// over-firing regression. Applied to abs(drift) below, so it bounds divergence
// in either direction. At the 12-user baseline this evaluates to 1, i.e. alert
// as soon as more than 1 user diverges — matching the ">1 user" tolerance in
// the spec, and scaling to 5% of activated users beyond that.
function driftTolerance(activatedUsers) {
  return Math.max(1, Math.ceil(0.05 * activatedUsers));
}

// Core check. Pure-ish: returns a result object and (optionally) persists a
// telemetry_health row + alerts. `_test` is NOT reachable over HTTP — it exists
// only so the verification harness can force a controlled drift.
export async function runReconcileCheck({ persist = true, _test = {} } = {}) {
  // --- canary: distinct coach_query_sent users in product_events ---
  const canaryRows = await fetchAllRows(
    'product_events',
    'user_id',
    (q) => q.eq('event_name', 'coach_query_sent'),
  );
  const sourceUserSet = new Set(canaryRows.map((r) => r.user_id));

  // Controlled-drift hooks for the alert-path test only (never reachable over
  // HTTP). dropSourceUsers simulates the await bug undercounting; addSourceUsers
  // simulates over-firing / double-emit (canary above truth).
  if (Number.isInteger(_test.dropSourceUsers) && _test.dropSourceUsers > 0) {
    for (const uid of [...sourceUserSet].slice(0, _test.dropSourceUsers)) {
      sourceUserSet.delete(uid);
    }
  }
  if (Number.isInteger(_test.addSourceUsers) && _test.addSourceUsers > 0) {
    for (let i = 0; i < _test.addSourceUsers; i++) {
      sourceUserSet.add(`__synthetic_overfire_${i}__`);
    }
  }
  const sourceUsers = sourceUserSet.size;

  // --- truth: distinct activated users (coach_messages role='user') ---
  const userMsgRows = await fetchAllRows(
    'coach_messages',
    'conversation_id',
    (q) => q.eq('role', 'user'),
  );
  const activeConvIds = new Set(userMsgRows.map((r) => r.conversation_id));

  const convRows = await fetchAllRows('coach_conversations', 'id,user_id');
  const convToUser = new Map(convRows.map((c) => [c.id, c.user_id]));

  const activatedSet = new Set();
  for (const cid of activeConvIds) {
    const uid = convToUser.get(cid);
    if (uid && uid !== TEST_USER_ID) activatedSet.add(uid);
  }
  const activatedUsers = activatedSet.size;

  // --- verdict ---
  const drift = activatedUsers - sourceUsers; // signed: +ve == undercount, -ve == over-firing
  const tolerance = driftTolerance(activatedUsers);
  // Bidirectional: divergence either way beyond tolerance is a telemetry
  // failure. The signed `drift` above is kept in the row/log to show direction.
  const status = Math.abs(drift) > tolerance ? 'red' : 'green';
  const checkDate = new Date().toISOString().slice(0, 10);

  const result = {
    checkDate,
    sourceUsers,
    activatedUsers,
    drift,
    tolerance,
    status,
    forcedDrift: (_test.addSourceUsers || 0) - (_test.dropSourceUsers || 0),
    persisted: false,
    persistError: null,
    alerted: false,
    alertError: null,
  };

  if (!persist) return result;

  // Heartbeat FIRST, always — green or red. A guard whose own storage is
  // missing must shout, not silently pass, so a failed write is itself
  // escalated below.
  const detail = {
    tolerance,
    forced_drift: result.forcedDrift,
    definition: 'source=coach_query_sent distinct users; activated=coach_messages role=user via coach_conversations.user_id excl test user',
  };
  const { error: writeError } = await supabase.from('telemetry_health').insert({
    check_date: checkDate,
    source_users: sourceUsers,
    activated_users: activatedUsers,
    drift,
    status,
    detail,
  });
  result.persisted = !writeError;
  result.persistError = writeError ? writeError.message : null;

  // A red verdict OR a failed heartbeat write both mean "the guard cannot vouch
  // for telemetry" — escalate both.
  const mustAlert = status === 'red' || !!writeError;
  if (mustAlert) {
    // (a) structured CRITICAL log — a bare log alone would repeat the original
    //     silent-failure sin, so this is paired with the row + email below.
    console.error('[CRITICAL] telemetry_reconcile_drift', JSON.stringify({
      severity: 'critical',
      check_date: checkDate,
      source_users: sourceUsers,
      activated_users: activatedUsers,
      drift,
      tolerance,
      status,
      persist_error: result.persistError,
    }));

    // (b) notify via the channel the backend already has (Resend email).
    try {
      await sendTelemetryAlert({
        checkDate,
        sourceUsers,
        activatedUsers,
        drift,
        tolerance,
        status: writeError ? 'red (health-write failed)' : status,
        persistError: result.persistError,
      });
      result.alerted = true;
    } catch (err) {
      result.alertError = err?.message || String(err);
      console.error('[CRITICAL] telemetry_reconcile_alert_send_failed', result.alertError);
    }
  }

  return result;
}

// ─── HTTP handler: GET/POST /api/internal/reconcile-telemetry ───
// Cron-only. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is set on the project; we accept nothing else, so the
// endpoint can't be triggered publicly.
export async function reconcileTelemetry(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: without a secret the guard is unprotected, so refuse to run
    // rather than expose it.
    console.error('[CRITICAL] reconcile-telemetry called but CRON_SECRET is not configured');
    return res.status(500).json({ success: false, error: 'guard_misconfigured' });
  }

  const auth = req.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  try {
    const result = await runReconcileCheck({ persist: true });
    // Always 200 for a completed check (green or red) — the row/alert carry the
    // verdict; a red result is not an HTTP error. Only a thrown compute/DB
    // failure is a 500.
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[CRITICAL] telemetry_reconcile_failed', err?.message || err);
    return res.status(500).json({ success: false, error: 'reconcile_failed' });
  }
}
