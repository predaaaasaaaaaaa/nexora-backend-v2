import express from 'express';
import { getAnalyticsByPlatform, getCombinedAnalytics } from '../controllers/analytics.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All analytics routes require authentication
router.get('/combined', requireAuth, getCombinedAnalytics);
router.get('/:platform', requireAuth, getAnalyticsByPlatform);

export default router;
