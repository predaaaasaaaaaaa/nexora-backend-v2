import jwt from 'jsonwebtoken';
import { verifyUser } from '../services/supabase.js';

// ─── Auth middleware ───────────────────────────────────────────────
//
// Verification strategy (from cheapest to most expensive):
//
// 1. Local HS256 verify against SUPABASE_JWT_SECRET. No network. Caches
//    nothing. Returns the JWT claims directly (sub = user id, email).
//    This is the hot path used on every authenticated request.
//
// 2. If SUPABASE_JWT_SECRET isn't set (legacy deploys), fall back to
//    the network round-trip via supabase.auth.getUser. We log loudly
//    on first use so operators know to add the env var.
//
// Revocation: a JWT signed by Supabase stays valid until natural expiry
// (usually 1h). We accept that window. After signOut, the refresh
// token is revoked so the user can't get a new JWT — but the *current*
// JWT keeps working until it expires. That's standard JWT semantics.
// To get instant revocation, set REQUIRE_AUTH_FRESH_CHECK=true and we
// add a periodic re-check via the network (every JWT_REFRESH_CHECK_MS).

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const REQUIRE_FRESH = process.env.REQUIRE_AUTH_FRESH_CHECK === 'true';
const FRESH_CHECK_MS = parseInt(process.env.JWT_REFRESH_CHECK_MS || '300000', 10); // 5 min

let warnedAboutLegacyMode = false;

// Cache: token -> { user, lastChecked, exp }
// Only used when REQUIRE_FRESH=true to avoid hammering Supabase Auth on
// every request while still re-checking periodically.
const freshCache = new Map();
const FRESH_CACHE_MAX = 10000;

function localVerify(token) {
  if (!JWT_SECRET) return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!claims.sub) return null;
    return {
      id: claims.sub,
      email: claims.email,
      email_confirmed_at: claims.email_confirmed_at,
      aud: claims.aud,
      role: claims.role,
      // Pass through for downstream consumers that need the raw claims.
      _claims: claims,
    };
  } catch {
    return null;
  }
}

async function networkVerify(token) {
  if (!warnedAboutLegacyMode && !JWT_SECRET) {
    console.warn('SUPABASE_JWT_SECRET not set — falling back to network verify on every request. Set it for a major perf win.');
    warnedAboutLegacyMode = true;
  }
  return verifyUser(token);
}

async function maybeFreshen(token, user) {
  if (!REQUIRE_FRESH) return user;
  const now = Date.now();
  const cached = freshCache.get(token);
  if (cached && cached.lastChecked + FRESH_CHECK_MS > now) {
    return cached.user;
  }
  // Time to re-verify against Supabase to catch revocation.
  const fresh = await networkVerify(token);
  if (!fresh) {
    freshCache.delete(token);
    return null;
  }
  if (freshCache.size >= FRESH_CACHE_MAX) {
    freshCache.delete(freshCache.keys().next().value);
  }
  freshCache.set(token, { user: fresh, lastChecked: now });
  return fresh;
}

// Middleware to protect routes (require authentication)
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No authorization token provided'
      });
    }

    const token = authHeader.split('Bearer ')[1];

    let user = localVerify(token);
    if (!user) {
      // Either the secret isn't configured or the JWT is malformed /
      // expired / not Supabase-issued. Fall back to a network check —
      // also catches the SUPABASE_JWT_SECRET-not-set case cleanly.
      user = await networkVerify(token);
    } else {
      user = await maybeFreshen(token, user);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Reject unverified email addresses. Without this, a botnet can
    // mint Free accounts (each with quota) without ever proving email
    // ownership. Toggle off via REQUIRE_EMAIL_VERIFICATION=false if
    // you need to support a legacy population that signed up before
    // this gate.
    if (process.env.REQUIRE_EMAIL_VERIFICATION !== 'false') {
      const verified = user.email_confirmed_at || user._claims?.email_confirmed_at;
      if (!verified) {
        return res.status(403).json({
          success: false,
          error: 'email_not_verified',
          message: 'Please confirm your email address before using Nexora.',
        });
      }
    }

    req.user = user;
    // Expose the raw JWT so controllers that need to act *as* the user
    // (e.g. signOut, user-scoped Supabase clients) can use it.
    req.userToken = token;
    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}
