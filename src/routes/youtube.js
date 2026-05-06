import express from 'express';
import {
  connectYouTube,
  youtubeCallback,
  getYouTubeData,
  checkYouTubeConnection,
  removeYouTube,
} from '../controllers/youtube.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// OAuth flow (requires auth)
router.get('/connect', requireAuth, connectYouTube);

// OAuth callback from Google (NO auth - Google redirects here directly)
router.get('/callback', youtubeCallback);

// Get real YouTube analytics (requires auth)
router.get('/analytics', requireAuth, getYouTubeData);

// Check if YouTube is connected (requires auth)
router.get('/status', requireAuth, checkYouTubeConnection);

// Disconnect YouTube (requires auth)
router.delete('/disconnect', requireAuth, removeYouTube);

export default router;