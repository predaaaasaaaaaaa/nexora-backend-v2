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

// Trust the platform proxy (Vercel) so rate limiters key on the real
// client IP from X-Forwarded-For instead of the proxy IP.
app.set('trust proxy', 1);

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
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  ...PROD_ORIGINS,
  ...(process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS),
  ...extraOrigins,
]);

app.use(cors({
  origin(origin, cb) {
    // Allow non-browser requests (curl, server-to-server) which omit Origin.
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
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