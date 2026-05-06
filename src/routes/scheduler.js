import express from 'express';
import {
  getAllSchedules,
  getScheduledPosts,
  createScheduledPost,
  updateScheduledPost,
  deleteScheduledPost,
  getNotificationPreferences,
  upsertNotificationPreferences,
  getReactiveRecommendations,
} from '../controllers/scheduler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFeature } from '../middleware/planEnforcement.js';
import { aiLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// All scheduler routes require scheduler feature (Pro+)
router.use(requireFeature('scheduler'));

// AI recommendations
router.get('/recommendations', aiLimiter, getAllSchedules);
router.post('/recommendations/reactive', aiLimiter, getReactiveRecommendations);

// Scheduled posts CRUD
router.get('/posts', getScheduledPosts);
router.post('/posts', writeLimiter, createScheduledPost);
router.put('/posts/:id', writeLimiter, updateScheduledPost);
router.delete('/posts/:id', writeLimiter, deleteScheduledPost);

// Notification preferences
router.get('/notifications', getNotificationPreferences);
router.put('/notifications', writeLimiter, upsertNotificationPreferences);

export default router;