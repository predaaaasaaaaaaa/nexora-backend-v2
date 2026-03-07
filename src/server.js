import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import coachRoutes from './routes/coach.js';
import analyticsRoutes from './routes/analytics.js';
import ideasRoutes from './routes/ideas.js';
import schedulerRoutes from './routes/scheduler.js';
import feedbackRoutes from './routes/feedback.js';
import youtubeRoutes from './routes/youtube.js';
import competitorsRoutes from './routes/competitors.js';

const app = express();

app.use(cors({
  origin: [
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

app.use('/api/auth', authRoutes);
app.use('/api/coach', coachRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/competitors', competitorsRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'Nexora backend running' });
});

export default app;