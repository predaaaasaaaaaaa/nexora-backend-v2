import express from 'express';
import { signUp, signIn, signOut, getProfile, updateProfile } from '../controllers/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/signup', signUp);
router.post('/signin', signIn);

// signOut needs the caller's JWT to actually invalidate the session.
router.post('/signout', requireAuth, signOut);

// Protected routes (require authentication)
router.get('/profile', requireAuth, getProfile);
router.put('/profile', requireAuth, updateProfile);

export default router;

