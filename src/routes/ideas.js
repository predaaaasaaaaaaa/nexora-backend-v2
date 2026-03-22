import express from 'express';
import { generateIdeas, generateAllIdeas } from '../controllers/ideas.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlan } from '../middleware/planEnforcement.js';

const router = express.Router();

// All ideas routes require authentication + content idea limit check
router.get('/all', requireAuth, requirePlan('content_idea'), generateAllIdeas);
router.get('/:platform', requireAuth, requirePlan('content_idea'), generateIdeas);

export default router;