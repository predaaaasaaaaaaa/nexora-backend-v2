import express from 'express';
import { generateIdeas, generateAllIdeas } from '../controllers/ideas.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All ideas routes require authentication
router.get('/all', requireAuth, generateAllIdeas);
router.get('/:platform', requireAuth, generateIdeas);

export default router;
