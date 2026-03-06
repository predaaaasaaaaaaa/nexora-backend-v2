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

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// AI recommendations (reactive — takes current scheduled posts into account)
router.get('/recommendations', getAllSchedules);
router.post('/recommendations/reactive', getReactiveRecommendations);

// Scheduled posts CRUD
router.get('/posts', getScheduledPosts);
router.post('/posts', createScheduledPost);
router.put('/posts/:id', updateScheduledPost);
router.delete('/posts/:id', deleteScheduledPost);

// Notification preferences
router.get('/notifications', getNotificationPreferences);
router.put('/notifications', upsertNotificationPreferences);

export default router;
