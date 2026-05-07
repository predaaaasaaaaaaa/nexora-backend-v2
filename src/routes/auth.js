import express from 'express';
import { signUp, signIn, signOut, getProfile, updateProfile } from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, emailAuthLimiter, writeLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

// Public routes — two limiters: per-IP (botnet protection) AND
// per-email-hash (credential stuffing from many IPs against one email).
router.post('/signup', authLimiter, emailAuthLimiter, signUp);
router.post('/signin', authLimiter, emailAuthLimiter, signIn);

// signOut needs the caller's JWT to actually invalidate the session.
router.post('/signout', requireAuth, signOut);

// Protected routes (require authentication)
router.get('/profile', requireAuth, getProfile);
router.put('/profile', requireAuth, writeLimiter, updateProfile);

export default router;

