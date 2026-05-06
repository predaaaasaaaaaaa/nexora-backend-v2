import express from 'express';
import { submitFeedback } from '../controllers/feedback.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

router.post('/submit', requireAuth, writeLimiter, submitFeedback);

export default router;

