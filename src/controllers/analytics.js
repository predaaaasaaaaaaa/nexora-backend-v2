import { generateMockAnalytics } from '../services/mockData.js';

// Get analytics for specific platform
export async function getAnalyticsByPlatform(req, res) {
  try {
    const { platform } = req.params;
    const userId = req.user.id;
    
    const validPlatforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`
      });
    }
    
    // Generate mock data
    const analytics = generateMockAnalytics(platform, userId);
    
    res.json({
      success: true,
      platform: platform,
      data: analytics
    });
    
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get combined analytics from all platforms
export async function getCombinedAnalytics(req, res) {
  try {
    const userId = req.user.id;
    
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    const allAnalytics = {};
    
    platforms.forEach(platform => {
      allAnalytics[platform] = generateMockAnalytics(platform, userId);
    });
    
    // Calculate combined metrics
    const combined = {
      totalFollowers: 
        allAnalytics.instagram.followers +
        allAnalytics.youtube.subscribers +
        allAnalytics.tiktok.followers +
        allAnalytics.twitter.followers,
      
      totalPosts:
        allAnalytics.instagram.posts.length +
        allAnalytics.youtube.videos.length +
        allAnalytics.tiktok.videos.length +
        allAnalytics.twitter.tweets.length,
      
      avgEngagement: (
        (parseFloat(allAnalytics.instagram.insights.avgEngagementRate) +
         parseFloat(allAnalytics.youtube.insights.avgEngagementRate) +
         parseFloat(allAnalytics.tiktok.insights.avgEngagementRate) +
         parseFloat(allAnalytics.twitter.insights.avgEngagementRate)) / 4
      ).toFixed(2),
      
      platforms: allAnalytics
    };
    
    res.json({
      success: true,
      data: combined
    });
    
  } catch (error) {
    console.error('Error fetching combined analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
