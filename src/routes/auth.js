import express from 'express';
import { signUp, signIn, signOut, getProfile, updateProfile } from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// Public routes — rate-limited to slow credential stuffing / signup spam.
router.post('/signup', authLimiter, signUp);
router.post('/signin', authLimiter, signIn);

// signOut needs the caller's JWT to actually invalidate the session.
router.post('/signout', requireAuth, signOut);

// Protected routes (require authentication)
router.get('/profile', requireAuth, getProfile);
router.put('/profile', requireAuth, writeLimiter, updateProfile);

export default router;

