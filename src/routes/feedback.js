import express from 'express';
import { submitFeedback } from '../controllers/feedback.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/submit', requireAuth, submitFeedback);

export default router;

