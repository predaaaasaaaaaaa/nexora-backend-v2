import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import coachRoutes from './routes/coach.js';
import analyticsRoutes from './routes/analytics.js';
import ideasRoutes from './routes/ideas.js';
import schedulerRoutes from './routes/scheduler.js';
import feedbackRoutes from './routes/feedback.js';
import youtubeRoutes from './routes/youtube.js';
import competitorsRoutes from './routes/competitors.js';
import subscriptionRoutes from './routes/subscription.js';
import { webhookLimiter } from './middleware/rateLimits.js';

const app = express();

// Trust the platform proxy. Configurable via TRUST_PROXY_HOPS — set to
// the number of trusted proxies in front of this app:
//   - Vercel direct: 1
//   - Vercel + Cloudflare in front: 2
//   - Override with TRUST_PROXY_HOPS=2
//
// Setting this WRONG enables IP spoofing via X-Forwarded-For (an
// attacker can prepend any IP and bypass per-IP rate limits). Don't
// guess — confirm by checking logs.
const TRUST_PROXY_HOPS = parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
app.set('trust proxy', TRUST_PROXY_HOPS);

// One-shot warning if X-Forwarded-For is longer than we trust. Catches
// misconfigured TRUST_PROXY_HOPS in production logs.
let warnedAboutXFF = false;
app.use((req, _res, next) => {
  if (!warnedAboutXFF && req.headers['x-forwarded-for']) {
    const hops = String(req.headers['x-forwarded-for']).split(',').length;
    if (hops > TRUST_PROXY_HOPS + 1) {
      console.warn(`X-Forwarded-For has ${hops} entries but TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS}. Per-IP limits may key on a spoofable address.`);
      warnedAboutXFF = true;
    }
  }
  next();
});

// Security headers. We're a JSON API with no rendered HTML, so the
// permissive default CSP is fine; HSTS / nosniff / frame-deny are the
// useful ones.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Build the CORS allowlist from the environment so localhost origins
// never ship to production. Add extra prod origins via CORS_EXTRA_ORIGINS
// (comma-separated) without code changes.
const PROD_ORIGINS = ['https://nexora-ai.org', 'https://www.nexora-ai.org'];
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = new Set([...PROD_ORIGINS, ...extraOrigins]);

// In dev, accept any http://localhost or http://127.0.0.1 port — Next
// shuffles to 3001/3002 when 3000 is busy, and our CORS check shouldn't
// be the thing that breaks the workflow. In prod this regex is never
// consulted.
const DEV_LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

app.use(cors({
  origin(origin, cb) {
    // Allow non-browser requests (curl, server-to-server) which omit Origin.
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    if (!isProd && DEV_LOCALHOST_RE.test(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Webhook route needs raw body for Paddle signature verification
// This MUST come BEFORE express.json()
app.use('/api/subscription/webhook', webhookLimiter, express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body.toString('utf8');
  try {
    req.body = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next();
});

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/coach', coachRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/competitors', competitorsRoutes);
app.use('/api/subscription', subscriptionRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'Nexora backend running' });
});

// Bind a real port when running directly (npm run dev / docker / VPS).
// Skip on Vercel — there the file is imported by the serverless wrapper
// and calling listen() would fight the platform.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Nexora backend listening on http://localhost:${PORT}`);
  });
}

export default app;