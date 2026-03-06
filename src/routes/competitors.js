import express from 'express';
import { search, analyze, compare, track, getTracked, untrack } from '../controllers/competitors.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Search for competitors (public data, but auth required for rate limiting)
router.get('/search', requireAuth, search);

// Deep analyze a channel
router.get('/analyze/:channelId', requireAuth, analyze);

// Compare competitor with user's channel
router.get('/compare/:channelId', requireAuth, compare);

// Track/untrack competitors
router.get('/tracked', requireAuth, getTracked);
router.post('/track', requireAuth, track);
router.delete('/track/:channelId', requireAuth, untrack);

export default router;