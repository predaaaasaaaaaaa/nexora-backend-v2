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

// Webhook — NO auth (Lemon Squeezy calls this directly)
// Signature verification happens inside the handler
router.post('/webhook', handleWebhook);

// Protected routes (require logged-in user)
router.get('/current', requireAuth, getCurrentPlan);
router.post('/checkout', requireAuth, createCheckout);
router.get('/portal', requireAuth, getPortalUrl);

export default router;