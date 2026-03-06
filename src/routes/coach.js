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

const router = express.Router();

// Conversation management
router.get('/conversations', requireAuth, listConversations);
router.post('/conversations', requireAuth, createConversation);
router.get('/conversations/:conversationId/messages', requireAuth, getMessages);
router.delete('/conversations/:conversationId', requireAuth, deleteConversation);

// Chat
router.post('/chat', requireAuth, chatWithCoach);
router.post('/check-action', requireAuth, checkBeforeAction);

export default router;