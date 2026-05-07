import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getPlans,
  getCurrentPlan,
  getPortalUrl,
  getCheckoutToken,
} from '../controllers/subscription.js';
import { handleWebhook } from '../controllers/webhook.js';
import { readLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

router.get('/plans', readLimiter, getPlans);
router.post('/webhook', handleWebhook); // already wrapped in webhookLimiter at server.js
router.get('/current', requireAuth, readLimiter, getCurrentPlan);
router.get('/portal', requireAuth, writeLimiter, getPortalUrl);
router.get('/checkout-token', requireAuth, readLimiter, getCheckoutToken);

export default router;