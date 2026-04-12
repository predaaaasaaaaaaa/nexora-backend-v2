import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getPlans,
  getCurrentPlan,
  getPortalUrl,
} from '../controllers/subscription.js';
import { handleWebhook } from '../controllers/webhook.js';

const router = express.Router();

router.get('/plans', getPlans);
router.post('/webhook', handleWebhook);
router.get('/current', requireAuth, getCurrentPlan);
router.get('/portal', requireAuth, getPortalUrl);

export default router;