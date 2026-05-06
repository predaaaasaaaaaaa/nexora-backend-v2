import express from 'express';
import { generateIdeas, generateAllIdeas } from '../controllers/ideas.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlan } from '../middleware/planEnforcement.js';
import { aiLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// All ideas routes require authentication + content idea limit check
router.get('/all', requireAuth, aiLimiter, requirePlan('content_idea'), generateAllIdeas);
router.get('/:platform', requireAuth, aiLimiter, requirePlan('content_idea'), generateIdeas);

export default router;