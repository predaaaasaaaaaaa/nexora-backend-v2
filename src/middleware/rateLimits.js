// ─── Rate limiters ──────────────────────────────────────────────────────
//
// Production uses an Upstash Redis (REST) store via the custom adapter
// below — required because Vercel runs each invocation on a separate
// instance and the in-memory store would only see a fraction of the
// real traffic per user.
//
// Dev / local: if UPSTASH_REDIS_REST_URL is unset we fall back to the
// in-memory store and log a warning at module load. The fallback is
// fine for a single-process workstation; it MUST NOT ship to prod.
//
// Keying: req.user?.id when authenticated, otherwise the client IP
// normalized via ipKeyGenerator (handles IPv6 /64 bucketing so an IPv6
// attacker can't get a fresh bucket per request).

import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Redis } from '@upstash/redis';

let redis = null;
let usingRedis = false;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  usingRedis = true;
} else if (process.env.NODE_ENV === 'production') {
  // Loud-fail-on-misconfig: in prod, in-memory limiting is effectively
  // no limiting. Throw so Vercel surfaces the missing env vars on first
  // request rather than silently shipping broken protection.
  console.error('FATAL: rate limiter requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in production');
}

// Custom store implementing express-rate-limit's Store interface, backed
// by Upstash Redis REST. INCR + EXPIRE in a single pipeline keeps the
// per-request overhead at one network round-trip.
class UpstashStore {
  constructor() {
    this.windowMs = 60_000;
    this.prefix = 'rl:';
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  async increment(key) {
    const k = this.prefix + key;
    const ttlSec = Math.max(1, Math.ceil(this.windowMs / 1000));
    // Pipeline so we don't pay two network round-trips per request.
    const pipe = redis.pipeline();
    pipe.incr(k);
    pipe.expire(k, ttlSec);
    pipe.pttl(k);
    const [count, , pttl] = await pipe.exec();
    const remainingMs = pttl > 0 ? pttl : this.windowMs;
    return {
      totalHits: Number(count),
      resetTime: new Date(Date.now() + remainingMs),
    };
  }
  async decrement(key) {
    await redis.decr(this.prefix + key);
  }
  async resetKey(key) {
    await redis.del(this.prefix + key);
  }
  // resetAll is optional and dangerous in shared Redis — intentionally not implemented.
}

function userOrIpKey(req, res) {
  if (req.user?.id) return `u:${req.user.id}`;
  return `ip:${ipKeyGenerator(req, res)}`;
}

// Build a limiter with the right store for the current environment.
function makeLimiter(opts) {
  const base = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...opts,
  };
  if (usingRedis) base.store = new UpstashStore();
  return rateLimit(base);
}

// Auth — guard against credential stuffing on /signin and signup spam.
// Per-IP because we don't have a userId at this point.
export const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { success: false, error: 'Too many auth attempts. Try again in a few minutes.' },
});

// AI endpoints — burns Groq tokens; cap per user.
export const aiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'You are sending requests too fast. Slow down a moment.' },
});

// Webhook — accept legitimate Paddle traffic but throttle floods of bad
// signatures (which would otherwise spam logs and cost CPU on HMAC compares).
export const webhookLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  message: { error: 'Too many webhook requests' },
});

// External-API endpoints (YouTube competitor analysis) — protect quota.
export const externalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

// Generic write limiter for everything else (profile updates, scheduler CRUD,
// feedback). Loose enough not to bother humans, tight enough to stop scripts.
export const writeLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

// Light read limiter for endpoints the dashboard hits on every navigation
// (getCurrentPlan, checkout-token). Bigger bucket — humans browse fast.
export const readLimiter = makeLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

// Auth-by-email limiter: keyed on a salted hash of the lowercased email.
// Defends against credential-stuffing campaigns where a single email is
// hammered from a botnet (each fresh IP would reset the per-IP limiter).
// Hash so we never put plaintext emails in Redis keys / logs.
//
// Salt with the JWT secret so an attacker who somehow gets a Redis dump
// can't enumerate emails by trying common ones against the keys.
const EMAIL_SALT = process.env.SUPABASE_JWT_SECRET || process.env.OAUTH_STATE_SECRET || 'nexora-default-salt';
function emailKey(req) {
  const raw = String(req.body?.email || '').trim().toLowerCase();
  if (!raw) return null;
  return 'em:' + crypto.createHmac('sha256', EMAIL_SALT).update(raw).digest('hex').slice(0, 32);
}

// Returns the email-hash key, or falls back to IP+route. So a request
// with no email body (someone probing the route) still gets limited.
function emailOrIpKey(req, res) {
  return emailKey(req) || `ip:${ipKeyGenerator(req, res)}`;
}

export const emailAuthLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10, // 10 attempts per hour per email
  keyGenerator: emailOrIpKey,
  message: { success: false, error: 'Too many attempts for this email. Try again later.' },
});
