import { generateMockAnalytics } from '../services/mockData.js';
import { getYouTubeAnalytics, isYouTubeConnected } from '../services/youtube.js';

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

    // Check for real data first
    if (platform === 'youtube') {
      const connected = await isYouTubeConnected(userId);
      if (connected) {
        const realData = await getYouTubeAnalytics(userId);
        if (realData) {
          return res.json({
            success: true,
            platform: platform,
            data: realData,
            source: 'live',
          });
        }
      }
    }

    // Fallback to mock data for unconnected platforms
    const analytics = generateMockAnalytics(platform, userId);
    
    res.json({
      success: true,
      platform: platform,
      data: analytics,
      source: 'mock',
    });
    
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load analytics'
    });
  }
}

// Get combined analytics from all platforms
export async function getCombinedAnalytics(req, res) {
  try {
    const userId = req.user.id;
    
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    const allAnalytics = {};
    const sources = {};

    for (const platform of platforms) {
      // Check for real YouTube data
      if (platform === 'youtube') {
        const connected = await isYouTubeConnected(userId);
        if (connected) {
          const realData = await getYouTubeAnalytics(userId);
          if (realData) {
            allAnalytics[platform] = realData;
            sources[platform] = 'live';
            continue;
          }
        }
      }

      // Fallback to mock for other platforms
      allAnalytics[platform] = generateMockAnalytics(platform, userId);
      sources[platform] = 'mock';
    }

    // Calculate combined metrics
    const getFollowers = (data) => data.followers || data.subscribers || 0;
    const getPosts = (data) => data.posts?.length || data.videos?.length || data.tweets?.length || 0;
    const getEngagement = (data) => parseFloat(data.insights?.avgEngagementRate || 0);

    const combined = {
      totalFollowers: Object.values(allAnalytics).reduce((sum, data) => sum + getFollowers(data), 0),
      totalPosts: Object.values(allAnalytics).reduce((sum, data) => sum + getPosts(data), 0),
      avgEngagement: (
        Object.values(allAnalytics).reduce((sum, data) => sum + getEngagement(data), 0) / platforms.length
      ).toFixed(2),
      platforms: allAnalytics,
      sources: sources,
    };
    
    res.json({
      success: true,
      data: combined
    });
    
  } catch (error) {
    console.error('Error fetching combined analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load analytics'
    });
  }
}