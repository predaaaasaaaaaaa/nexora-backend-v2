<<<<<<< HEAD
# NEXORA Backend

AI-powered social media coaching platform backend.

## Project Overview

NEXORA is an AI coach for social media creators that:
- Provides strategic coaching on content optimization
- Monitors and intervenes before users make mistakes
- Understands platform algorithms (Instagram, TikTok, LinkedIn)
- Gives direct, actionable advice (80% value, 20% questions)

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment template:
   ```bash
   cp env.example .env
   ```

4. Update `.env` with your API keys

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

### API Endpoints

#### Health Check
- `GET /health` - Returns server status

#### Coach Routes (`/api/coach`)
- `POST /chat` - Chat with AI coach
- `POST /check-action` - Check before posting
- `GET /profile` - Get user coaching profile
- `POST /feedback` - Submit coaching feedback

#### Analytics Routes (`/api/analytics`)
- `GET /performance` - Get content performance analytics
- `GET /trends` - Get platform trends
- `POST /track` - Track content metrics
- `GET /insights` - Get AI-generated insights

#### Ideas Routes (`/api/ideas`)
- `GET /generate` - Generate content ideas
- `POST /optimize` - Optimize existing content
- `GET /trending` - Get trending content ideas
- `POST /save` - Save content ideas

## Project Structure

```
nexora-backend/
├── src/
│   ├── server.js              # Main Express server
│   ├── controllers/           # API handlers
│   │   ├── coach.js
│   │   ├── analytics.js
│   │   └── ideas.js
│   ├── services/             # Business logic
│   │   ├── coachingBrain.js
│   │   ├── interventionSystem.js
│   │   └── userProfile.js
│   ├── routes/               # API routes
│   │   ├── coach.js
│   │   ├── analytics.js
│   │   └── ideas.js
│   ├── models/               # Data models
│   │   └── User.js
│   └── utils/                # Helper functions
│       └── helpers.js
├── env.example               # Environment template
├── .gitignore
├── package.json
└── README.md
```

## Development Status

🚧 **Currently in development** - This is the basic foundation structure with placeholder functions. Actual AI implementation and business logic will be added in subsequent phases.

## License

ISC

=======
# NEXORA Backend

AI-powered social media coaching platform backend.

## Project Overview

NEXORA is an AI coach for social media creators that:
- Provides strategic coaching on content optimization
- Monitors and intervenes before users make mistakes
- Understands platform algorithms (Instagram, TikTok, LinkedIn)
- Gives direct, actionable advice (80% value, 20% questions)

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment template:
   ```bash
   cp env.example .env
   ```

4. Update `.env` with your API keys

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

### API Endpoints

#### Health Check
- `GET /health` - Returns server status

#### Coach Routes (`/api/coach`)
- `POST /chat` - Chat with AI coach
- `POST /check-action` - Check before posting
- `GET /profile` - Get user coaching profile
- `POST /feedback` - Submit coaching feedback

#### Analytics Routes (`/api/analytics`)
- `GET /performance` - Get content performance analytics
- `GET /trends` - Get platform trends
- `POST /track` - Track content metrics
- `GET /insights` - Get AI-generated insights

#### Ideas Routes (`/api/ideas`)
- `GET /generate` - Generate content ideas
- `POST /optimize` - Optimize existing content
- `GET /trending` - Get trending content ideas
- `POST /save` - Save content ideas

## Project Structure

```
nexora-backend/
├── src/
│   ├── server.js              # Main Express server
│   ├── controllers/           # API handlers
│   │   ├── coach.js
│   │   ├── analytics.js
│   │   └── ideas.js
│   ├── services/             # Business logic
│   │   ├── coachingBrain.js
│   │   ├── interventionSystem.js
│   │   └── userProfile.js
│   ├── routes/               # API routes
│   │   ├── coach.js
│   │   ├── analytics.js
│   │   └── ideas.js
│   ├── models/               # Data models
│   │   └── User.js
│   └── utils/                # Helper functions
│       └── helpers.js
├── env.example               # Environment template
├── .gitignore
├── package.json
└── README.md
```

## Development Status

🚧 **Currently in development** - This is the basic foundation structure with placeholder functions. Actual AI implementation and business logic will be added in subsequent phases.

## License

ISC

>>>>>>> 5a44428052f69c23cf36edb825632f5bf40359e3
