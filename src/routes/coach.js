import express from 'express';
import {
  chatWithCoach,
  checkBeforeAction,
  listConversations,
  createConversation,
  getMessages,
  deleteConversation
} from '../controllers/coach.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlan, requireFeature } from '../middleware/planEnforcement.js';
import { aiLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// Conversation management — requires conversation_history feature
router.get('/conversations', requireAuth, requireFeature('conversation_history'), listConversations);
router.post('/conversations', requireAuth, writeLimiter, requireFeature('conversation_history'), createConversation);
router.get('/conversations/:conversationId/messages', requireAuth, requireFeature('conversation_history'), getMessages);
router.delete('/conversations/:conversationId', requireAuth, writeLimiter, requireFeature('conversation_history'), deleteConversation);

// Chat — burst-limit on top of the daily plan quota to stop scripted abuse
// from burning Groq tokens between resets.
router.post('/chat', requireAuth, aiLimiter, requirePlan('coach_message'), chatWithCoach);
router.post('/check-action', requireAuth, checkBeforeAction);

export default router;