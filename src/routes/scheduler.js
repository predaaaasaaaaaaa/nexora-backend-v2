import express from 'express';
import { getOptimalSchedule, getAllSchedules } from '../controllers/scheduler.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All scheduler routes require authentication
router.get('/all', requireAuth, getAllSchedules);
router.get('/:platform', requireAuth, getOptimalSchedule);

export default router;

