// ═══════════════════════════════════════════════════════
// NEXORA — Subscription Routes
// ═══════════════════════════════════════════════════════

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getPlans,
  getCurrentPlan,
  createCheckout,
  getPortalUrl,
} from '../controllers/subscription.js';
import { handleWebhook } from '../controllers/webhook.js';

const router = express.Router();

// Public routes
router.get('/plans', getPlans);

// Webhook — NO auth (Paddle calls this directly)
router.post('/webhook', handleWebhook);

// Protected routes
router.get('/current', requireAuth, getCurrentPlan);
router.get('/portal', requireAuth, getPortalUrl);

export default router;