import express from 'express';
import { trackClientEvent } from '../controllers/track.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Authenticated client-event sink. user_id is derived from the verified
// JWT in requireAuth, never from the request body.
router.post('/', requireAuth, trackClientEvent);

export default router;
