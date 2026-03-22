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
import { incrementUsage } from '../services/subscription.js';

const router = express.Router();

// Conversation management — requires conversation_history feature
router.get('/conversations', requireAuth, requireFeature('conversation_history'), listConversations);
router.post('/conversations', requireAuth, requireFeature('conversation_history'), createConversation);
router.get('/conversations/:conversationId/messages', requireAuth, requireFeature('conversation_history'), getMessages);
router.delete('/conversations/:conversationId', requireAuth, requireFeature('conversation_history'), deleteConversation);

// Chat — check daily message limit, then increment usage after success
router.post('/chat', requireAuth, requirePlan('coach_message'), chatWithCoach);
router.post('/check-action', requireAuth, checkBeforeAction);

export default router;