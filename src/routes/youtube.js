import express from 'express';
import {
  connectYouTube,
  youtubeCallback,
  getYouTubeData,
  checkYouTubeConnection,
  removeYouTube,
} from '../controllers/youtube.js';
import { requireAuth } from '../middleware/auth.js';
import { webhookLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// OAuth flow (requires auth). writeLimiter is fine here — it's a low
// frequency button click.
router.post('/connect', requireAuth, writeLimiter, connectYouTube);
// Backwards compat: the old GET endpoint is still wired but moves to
// POST in the M6 commit. Both are limited.
router.get('/connect', requireAuth, writeLimiter, connectYouTube);

// OAuth callback from Google (NO auth - Google redirects here directly).
// Rate-limited per-IP because anyone on the internet can hit this URL
// — without a limit a flood of fake state tokens forces HMAC verifies
// (cheap) and on a valid-looking state forces a paid Google token
// exchange (network call). Reuse webhookLimiter (120/min) — Google's
// own retries fit easily under that.
router.get('/callback', webhookLimiter, youtubeCallback);

// Get real YouTube analytics (requires auth)
router.get('/analytics', requireAuth, getYouTubeData);

// Check if YouTube is connected (requires auth)
router.get('/status', requireAuth, checkYouTubeConnection);

// Disconnect YouTube (requires auth)
router.delete('/disconnect', requireAuth, writeLimiter, removeYouTube);

export default router;