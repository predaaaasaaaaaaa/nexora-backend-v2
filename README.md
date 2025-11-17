# NEXORA Backend

AI-powered social media coaching platform backend with unified AI system.

## Project Overview

NEXORA is an AI coach for social media creators that:
- Provides strategic coaching on content optimization across 4 platforms
- Monitors and intervenes before users make mistakes
- Understands platform algorithms (Instagram, YouTube, TikTok, Twitter/X)
- Gives direct, actionable advice (80% value, 20% questions)
- Uses unified AI brain with shared memory and continuous learning

## Features

✨ **Unified AI System**
- ONE intelligent brain powers all features
- Shared memory across all interactions
- Continuous learning from user feedback
- Context-aware personalized responses

🎯 **4-Platform Support**
- Instagram (Reels, posts, engagement)
- YouTube (Shorts, long-form, analytics)
- TikTok (FYP optimization, viral strategies)
- Twitter/X (threads, engagement velocity)

📊 **AI-Powered Features**
- Real-time coaching chat
- Auto-scheduler with optimal posting times
- Viral content idea generator
- Performance analytics across all platforms
- Proactive intervention system

🔐 **Authentication & Security**
- Supabase authentication
- JWT token-based API protection
- Row-level security on all data

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Supabase account
- Groq API key (free tier available)

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/nexora-backend.git
cd nexora-backend
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment template:
```bash
cp env.example .env
```

4. Update `.env` with your API keys:
```env
GROQ_API_KEY=your-groq-key
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
PORT=3001
NODE_ENV=development
```

5. Run database migrations in Supabase SQL Editor:
```bash
# Run database-migrations.sql
# Run unified-ai-migrations.sql
```

### Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on port 3001 by default.

## API Endpoints

### Authentication (`/api/auth`)
- `POST /signup` - Create new user account
- `POST /signin` - Sign in user
- `POST /signout` - Sign out user
- `GET /profile` - Get user profile (protected)
- `PUT /profile` - Update user profile (protected)

### AI Coach (`/api/coach`)
- `POST /chat` - Chat with AI coach (protected)
- `POST /check-action` - Check before posting (protected)

### Analytics (`/api/analytics`)
- `GET /combined` - Get combined analytics for all platforms (protected)
- `GET /:platform` - Get analytics for specific platform (protected)

### Scheduler (`/api/scheduler`)
- `GET /all` - Get optimal schedules for all platforms (protected)
- `GET /:platform` - Get optimal schedule for specific platform (protected)

### Ideas Generator (`/api/ideas`)
- `GET /all` - Generate ideas for all platforms (protected)
- `GET /:platform` - Generate ideas for specific platform (protected)

### Feedback (`/api/feedback`)
- `POST /submit` - Submit user feedback (protected)

### Utility Endpoints
- `GET /health` - Health check
- `GET /test-knowledge` - Test knowledge base

## Project Structure

```
nexora-backend/
├── src/
│   ├── server.js              # Main Express server
│   ├── controllers/           # API request handlers
│   │   ├── auth.js           # Authentication
│   │   ├── coach.js          # AI coaching
│   │   ├── analytics.js      # Analytics data
│   │   ├── scheduler.js      # Optimal scheduling
│   │   ├── ideas.js          # Content generation
│   │   └── feedback.js       # User feedback
│   ├── services/             # Business logic
│   │   ├── unifiedAI.js      # Unified AI brain
│   │   ├── contextEngine.js  # User context & memory
│   │   ├── coachingBrain.js  # Coaching logic
│   │   ├── schedulerAI.js    # Scheduling AI
│   │   ├── contentGeneratorAI.js  # Content ideas
│   │   ├── mockData.js       # Mock analytics data
│   │   └── supabase.js       # Database client
│   ├── routes/               # API route definitions
│   │   ├── auth.js
│   │   ├── coach.js
│   │   ├── analytics.js
│   │   ├── scheduler.js
│   │   ├── ideas.js
│   │   └── feedback.js
│   ├── middleware/           # Express middleware
│   │   └── auth.js           # Authentication middleware
│   ├── knowledge/            # AI knowledge base
│   │   └── expertise.js      # Platform expertise
│   ├── models/               # Data models
│   │   └── User.js
│   └── utils/                # Helper functions
│       └── helpers.js
├── database-migrations.sql   # Database setup
├── unified-ai-migrations.sql # AI system tables
├── env.example              # Environment template
├── vercel.json              # Vercel deployment config
├── .gitignore
├── package.json
└── README.md
```

## Technology Stack

- **Runtime:** Node.js + Express
- **AI:** Groq (Llama 3.3 70B)
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **Deployment:** Vercel (Serverless)

## Development Status

✅ **Production Ready**
- Unified AI system with memory
- 4-platform support
- Mock data for MVP demo
- Authentication & security
- Ready for Vercel deployment

## Testing

Run test suites:
```bash
node test-auth.js           # Test authentication
node test-unified-ai.js     # Test unified AI system
node test-all-platforms.js  # Test 4 platforms
node test-scheduler.js      # Test auto-scheduler
node test-feedback.js       # Test feedback collection
```

## License

ISC
