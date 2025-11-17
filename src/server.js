import dotenv from 'dotenv';
dotenv.config();

// DEBUG: Check Groq API key
console.log('🔍 DEBUG - Groq API Key:');
console.log('  - Exists:', !!process.env.GROQ_API_KEY);
console.log('  - Length:', process.env.GROQ_API_KEY?.length);
console.log('  - First 10 chars:', process.env.GROQ_API_KEY?.substring(0, 10));

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import coachRoutes from './routes/coach.js';
import analyticsRoutes from './routes/analytics.js';
import ideasRoutes from './routes/ideas.js';
import schedulerRoutes from './routes/scheduler.js';
import feedbackRoutes from './routes/feedback.js';
import { coachingExpertise } from './knowledge/expertise.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration (MUST be before routes)
app.use(cors({
  origin: [
    'https://nexora-frontend-lac.vercel.app',
    'https://nexora-ai.org',
    'https://www.nexora-ai.org',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/coach', coachRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/feedback', feedbackRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: "Nexora backend running" });
});

// Test knowledge endpoint
app.get('/test-knowledge', (req, res) => {
  const platforms = Array.from(
    new Set(
      coachingExpertise
        .map((item) => item.platform)
        .filter((p) => p === 'instagram' || p === 'youtube' || p === 'tiktok' || p === 'twitter')
    )
  );
  res.json({ platforms });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

