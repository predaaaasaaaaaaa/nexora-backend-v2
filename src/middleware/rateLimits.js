// ─── Rate limiters ──────────────────────────────────────────────────────
//
// Vercel runs each function on a single instance per cold start; the in-memory
// store here is per-instance, which is good enough to blunt brute-force and
// runaway abuse but won't share state across regions. For tighter limits,
// swap the store for a Redis/Upstash one.
//
// We always derive the key from req.user?.id when an authenticated user is
// available, falling back to IP. That stops one attacker behind NAT from
// using up the bucket of every neighbour, and makes per-user quotas honest.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// IPv6 needs to be bucketed by /64 subnet, otherwise each request looks
// like a different address and the limit is trivially bypassed. The
// library exports ipKeyGenerator to do that normalization for us.
function userOrIpKey(req, res) {
  if (req.user?.id) return `u:${req.user.id}`;
  return `ip:${ipKeyGenerator(req, res)}`;
}

// Auth — guard against credential stuffing on /signin and signup spam.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many auth attempts. Try again in a few minutes.' },
});

// AI endpoints — burns Groq tokens; cap per user.
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'You are sending requests too fast. Slow down a moment.' },
});

// Webhook — accept legitimate Paddle traffic but throttle floods of bad
// signatures (which would otherwise spam logs and cost CPU on HMAC compares).
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many webhook requests' },
});

// External-API endpoints (YouTube competitor analysis) — protect quota.
export const externalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

// Generic write limiter for everything else (profile updates, scheduler CRUD,
// feedback). Loose enough not to bother humans, tight enough to stop scripts.
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});
