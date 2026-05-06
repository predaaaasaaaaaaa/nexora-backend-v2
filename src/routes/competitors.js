import express from 'express';
import { search, analyze, compare, track, getTracked, untrack } from '../controllers/competitors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFeature, requirePlan } from '../middleware/planEnforcement.js';
import { externalApiLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// All competitor routes require the competitor feature (Pro+)
// Search for competitors
router.get('/search', requireAuth, externalApiLimiter, requireFeature('competitor'), search);

// Deep analyze a channel
router.get('/analyze/:channelId', requireAuth, externalApiLimiter, requireFeature('competitor'), analyze);

// Compare competitor with user's channel
router.get('/compare/:channelId', requireAuth, externalApiLimiter, requireFeature('competitor'), compare);

// Track/untrack competitors — tracking checks the competitor limit
router.get('/tracked', requireAuth, requireFeature('competitor'), getTracked);
router.post('/track', requireAuth, writeLimiter, requirePlan('competitor'), track);
router.delete('/track/:channelId', requireAuth, writeLimiter, requireFeature('competitor'), untrack);

export default router;