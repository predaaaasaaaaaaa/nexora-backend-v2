import express from 'express';
import { chatWithCoach, checkBeforeAction } from '../controllers/coach.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All coach routes now require authentication
router.post('/chat', requireAuth, chatWithCoach);
router.post('/check-action', requireAuth, checkBeforeAction);

export default router;
