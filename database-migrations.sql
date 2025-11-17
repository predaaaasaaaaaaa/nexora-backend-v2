-- ============================================
-- NEXORA DATABASE MIGRATIONS
-- Run these in Supabase SQL Editor
-- ============================================

-- TikTok analytics table
CREATE TABLE IF NOT EXISTS analytics_tiktok (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Video info
  video_id TEXT NOT NULL,
  description TEXT,
  
  -- Metrics
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2),
  
  -- Timestamps
  posted_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, video_id)
);

-- Twitter analytics table
CREATE TABLE IF NOT EXISTS analytics_twitter (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Tweet info
  tweet_id TEXT NOT NULL,
  tweet_text TEXT,
  tweet_type TEXT, -- 'tweet', 'thread', 'reply'
  
  -- Metrics
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  bookmarks INTEGER DEFAULT 0,
  engagement_rate DECIMAL(5,2),
  
  -- Timestamps
  posted_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, tweet_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_analytics_tiktok_user_id ON analytics_tiktok(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_tiktok_posted_at ON analytics_tiktok(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_twitter_user_id ON analytics_twitter(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_twitter_posted_at ON analytics_twitter(posted_at DESC);

-- Enable RLS
ALTER TABLE analytics_tiktok ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_twitter ENABLE ROW LEVEL SECURITY;

-- RLS Policies for TikTok
CREATE POLICY "Users can view own tiktok analytics" ON analytics_tiktok 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tiktok analytics" ON analytics_tiktok 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for Twitter
CREATE POLICY "Users can view own twitter analytics" ON analytics_twitter 
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own twitter analytics" ON analytics_twitter 
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- UPDATE PROFILES TABLE FOR TIKTOK & TWITTER
-- ============================================

ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS tiktok_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiktok_username TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_user_id TEXT,
  
  ADD COLUMN IF NOT EXISTS twitter_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS twitter_username TEXT,
  ADD COLUMN IF NOT EXISTS twitter_user_id TEXT;

