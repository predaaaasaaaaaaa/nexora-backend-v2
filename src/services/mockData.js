// Mock analytics data for all 4 platforms
export const generateMockAnalytics = (platform, userId) => {
  const baseDate = new Date();
  
  const platforms = {
    instagram: generateInstagramMock(userId, baseDate),
    youtube: generateYouTubeMock(userId, baseDate),
    tiktok: generateTikTokMock(userId, baseDate),
    twitter: generateTwitterMock(userId, baseDate),
  };
  
  return platforms[platform] || null;
};

function generateInstagramMock(userId, baseDate) {
  const posts = [];
  
  for (let i = 0; i < 20; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    
    posts.push({
      post_id: `ig_${userId}_${i}`,
      post_type: i % 3 === 0 ? 'reel' : i % 3 === 1 ? 'carousel' : 'image',
      caption: `Mock Instagram post ${i + 1}`,
      views: Math.floor(Math.random() * 50000) + 5000,
      likes: Math.floor(Math.random() * 2000) + 200,
      comments: Math.floor(Math.random() * 150) + 20,
      shares: Math.floor(Math.random() * 100) + 10,
      saves: Math.floor(Math.random() * 500) + 50,
      engagement_rate: (Math.random() * 8 + 2).toFixed(2),
      posted_at: date.toISOString(),
    });
  }
  
  return {
    platform: 'instagram',
    username: 'demo_user_ig',
    followers: 12500,
    following: 450,
    posts: posts,
    insights: {
      avgEngagementRate: 5.2,
      topPostType: 'reel',
      bestPostingTimes: ['9:00 AM', '3:00 PM', '8:00 PM'],
      audienceGrowth: '+340 this week',
    }
  };
}

function generateYouTubeMock(userId, baseDate) {
  const videos = [];
  
  for (let i = 0; i < 15; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i * 2);
    
    videos.push({
      video_id: `yt_${userId}_${i}`,
      video_type: i % 4 === 0 ? 'short' : 'long-form',
      title: `Mock YouTube Video ${i + 1}`,
      views: Math.floor(Math.random() * 100000) + 10000,
      watch_time_minutes: Math.floor(Math.random() * 50000) + 5000,
      likes: Math.floor(Math.random() * 3000) + 300,
      comments: Math.floor(Math.random() * 200) + 30,
      shares: Math.floor(Math.random() * 150) + 20,
      engagement_rate: (Math.random() * 6 + 3).toFixed(2),
      posted_at: date.toISOString(),
    });
  }
  
  return {
    platform: 'youtube',
    channel_name: 'Demo Channel',
    subscribers: 45200,
    total_views: 1250000,
    videos: videos,
    insights: {
      avgEngagementRate: 4.8,
      avgViewDuration: '6:30',
      topVideoType: 'long-form',
      bestPostingDays: ['Tuesday', 'Thursday', 'Saturday'],
      subscriberGrowth: '+1,200 this month',
    }
  };
}

function generateTikTokMock(userId, baseDate) {
  const videos = [];
  
  for (let i = 0; i < 25; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - Math.floor(i / 2));
    
    videos.push({
      video_id: `tt_${userId}_${i}`,
      description: `Mock TikTok video ${i + 1}`,
      views: Math.floor(Math.random() * 500000) + 50000,
      likes: Math.floor(Math.random() * 25000) + 2500,
      comments: Math.floor(Math.random() * 1000) + 100,
      shares: Math.floor(Math.random() * 500) + 50,
      saves: Math.floor(Math.random() * 800) + 80,
      engagement_rate: (Math.random() * 12 + 4).toFixed(2),
      posted_at: date.toISOString(),
    });
  }
  
  return {
    platform: 'tiktok',
    username: 'demo_user_tt',
    followers: 85400,
    total_likes: 2100000,
    videos: videos,
    insights: {
      avgEngagementRate: 8.5,
      avgWatchTime: '45%',
      fypRate: '68%',
      bestPostingTimes: ['7:00 AM', '12:00 PM', '9:00 PM'],
      followerGrowth: '+2,500 this week',
    }
  };
}

function generateTwitterMock(userId, baseDate) {
  const tweets = [];
  
  for (let i = 0; i < 30; i++) {
    const date = new Date(baseDate);
    date.setHours(date.getHours() - i * 8);
    
    tweets.push({
      tweet_id: `tw_${userId}_${i}`,
      tweet_text: `Mock tweet ${i + 1} - sharing valuable insights about social media strategy`,
      tweet_type: i % 5 === 0 ? 'thread' : 'tweet',
      views: Math.floor(Math.random() * 50000) + 5000,
      likes: Math.floor(Math.random() * 500) + 50,
      retweets: Math.floor(Math.random() * 100) + 10,
      replies: Math.floor(Math.random() * 80) + 8,
      bookmarks: Math.floor(Math.random() * 200) + 20,
      engagement_rate: (Math.random() * 5 + 1).toFixed(2),
      posted_at: date.toISOString(),
    });
  }
  
  return {
    platform: 'twitter',
    username: 'demo_user_x',
    followers: 15800,
    following: 320,
    tweets: tweets,
    insights: {
      avgEngagementRate: 3.2,
      topTweetType: 'thread',
      bestPostingTimes: ['8:00 AM', '1:00 PM', '6:00 PM'],
      followerGrowth: '+180 this week',
    }
  };
}

