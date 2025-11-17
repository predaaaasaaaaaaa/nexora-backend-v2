import Groq from 'groq-sdk';
import { generateMockAnalytics } from './mockData.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Analyze user's data and predict optimal posting times
export async function analyzeOptimalTimes(userId, platform) {
  try {
    // Get user's mock analytics
    const analytics = generateMockAnalytics(platform, userId);
    
    // Analyze posting patterns
    const postingAnalysis = analyzePosts(analytics, platform);
    
    // Get AI recommendations
    const aiRecommendations = await getAIScheduleRecommendations(
      platform,
      postingAnalysis
    );
    
    return {
      success: true,
      platform: platform,
      analysis: postingAnalysis,
      recommendations: aiRecommendations,
      optimalTimes: postingAnalysis.bestTimes,
      optimalDays: postingAnalysis.bestDays,
    };
    
  } catch (error) {
    console.error('Error analyzing optimal times:', error);
    throw error;
  }
}

// Analyze user's posting patterns
function analyzePosts(analytics, platform) {
  let posts;
  
  // Get posts based on platform
  switch(platform) {
    case 'instagram':
      posts = analytics.posts;
      break;
    case 'youtube':
      posts = analytics.videos;
      break;
    case 'tiktok':
      posts = analytics.videos;
      break;
    case 'twitter':
      posts = analytics.tweets;
      break;
    default:
      posts = [];
  }
  
  // Analyze by time of day
  const timeSlots = {};
  const dayOfWeek = {};
  
  posts.forEach(post => {
    const date = new Date(post.posted_at);
    const hour = date.getHours();
    const day = date.toLocaleDateString('en-US', { weekday: 'long' });
    
    // Categorize by time slot
    let timeSlot;
    if (hour >= 6 && hour < 12) timeSlot = 'morning';
    else if (hour >= 12 && hour < 17) timeSlot = 'afternoon';
    else if (hour >= 17 && hour < 21) timeSlot = 'evening';
    else timeSlot = 'night';
    
    // Track engagement by time slot
    if (!timeSlots[timeSlot]) {
      timeSlots[timeSlot] = { count: 0, totalEngagement: 0, posts: [] };
    }
    timeSlots[timeSlot].count++;
    timeSlots[timeSlot].totalEngagement += parseFloat(post.engagement_rate || 0);
    timeSlots[timeSlot].posts.push(post);
    
    // Track engagement by day
    if (!dayOfWeek[day]) {
      dayOfWeek[day] = { count: 0, totalEngagement: 0, posts: [] };
    }
    dayOfWeek[day].count++;
    dayOfWeek[day].totalEngagement += parseFloat(post.engagement_rate || 0);
    dayOfWeek[day].posts.push(post);
  });
  
  // Calculate averages
  Object.keys(timeSlots).forEach(slot => {
    timeSlots[slot].avgEngagement = (
      timeSlots[slot].totalEngagement / timeSlots[slot].count
    ).toFixed(2);
  });
  
  Object.keys(dayOfWeek).forEach(day => {
    dayOfWeek[day].avgEngagement = (
      dayOfWeek[day].totalEngagement / dayOfWeek[day].count
    ).toFixed(2);
  });
  
  // Find best times and days
  const bestTimeSlot = Object.entries(timeSlots)
    .sort((a, b) => parseFloat(b[1].avgEngagement) - parseFloat(a[1].avgEngagement))[0];
  
  const bestDays = Object.entries(dayOfWeek)
    .sort((a, b) => parseFloat(b[1].avgEngagement) - parseFloat(a[1].avgEngagement))
    .slice(0, 3)
    .map(([day, data]) => ({ day, avgEngagement: data.avgEngagement }));
  
  // Generate specific time recommendations based on best slot
  const bestTimes = generateTimeRecommendations(bestTimeSlot[0], platform);
  
  return {
    totalPosts: posts.length,
    timeSlotAnalysis: timeSlots,
    dayAnalysis: dayOfWeek,
    bestTimeSlot: bestTimeSlot[0],
    bestTimeSlotEngagement: bestTimeSlot[1].avgEngagement,
    bestDays: bestDays,
    bestTimes: bestTimes,
    currentPostingFrequency: calculatePostingFrequency(posts),
  };
}

// Generate specific time recommendations
function generateTimeRecommendations(timeSlot, platform) {
  const recommendations = {
    morning: {
      instagram: ['8:00 AM', '9:30 AM', '11:00 AM'],
      youtube: ['7:00 AM', '9:00 AM', '10:30 AM'],
      tiktok: ['7:00 AM', '8:30 AM', '11:00 AM'],
      twitter: ['8:00 AM', '9:00 AM', '10:00 AM'],
    },
    afternoon: {
      instagram: ['12:30 PM', '2:00 PM', '4:00 PM'],
      youtube: ['2:00 PM', '3:00 PM', '4:30 PM'],
      tiktok: ['12:00 PM', '1:30 PM', '3:00 PM'],
      twitter: ['12:00 PM', '1:00 PM', '3:00 PM'],
    },
    evening: {
      instagram: ['6:00 PM', '7:30 PM', '9:00 PM'],
      youtube: ['6:00 PM', '7:00 PM', '8:00 PM'],
      tiktok: ['7:00 PM', '8:30 PM', '9:30 PM'],
      twitter: ['5:00 PM', '6:30 PM', '8:00 PM'],
    },
    night: {
      instagram: ['9:00 PM', '10:00 PM'],
      youtube: ['9:00 PM', '10:30 PM'],
      tiktok: ['9:00 PM', '10:00 PM', '11:00 PM'],
      twitter: ['9:00 PM', '10:00 PM'],
    }
  };
  
  return recommendations[timeSlot][platform] || ['9:00 AM', '3:00 PM', '8:00 PM'];
}

// Calculate posting frequency
function calculatePostingFrequency(posts) {
  if (posts.length < 2) return 'Insufficient data';
  
  const sortedPosts = posts.sort((a, b) => 
    new Date(a.posted_at) - new Date(b.posted_at)
  );
  
  const firstPost = new Date(sortedPosts[0].posted_at);
  const lastPost = new Date(sortedPosts[sortedPosts.length - 1].posted_at);
  
  const daysDiff = Math.ceil((lastPost - firstPost) / (1000 * 60 * 60 * 24));
  const postsPerDay = (posts.length / daysDiff).toFixed(1);
  
  return `${postsPerDay} posts/day (${posts.length} posts over ${daysDiff} days)`;
}

// Get AI recommendations for schedule
async function getAIScheduleRecommendations(platform, analysis) {
  try {
    const prompt = `You are a social media scheduling expert. Analyze this data and provide strategic posting schedule recommendations.

PLATFORM: ${platform}
BEST TIME SLOT: ${analysis.bestTimeSlot} (${analysis.bestTimeSlotEngagement}% avg engagement)
BEST DAYS: ${analysis.bestDays.map(d => d.day).join(', ')}
CURRENT FREQUENCY: ${analysis.currentPostingFrequency}

Provide:
1. Optimal posting frequency for this platform (how many times per week)
2. Best specific times to post (from the data above)
3. Best days to post
4. Why this schedule works for this platform's algorithm
5. One warning about what to avoid

Keep response under 300 words, be direct and actionable.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a data-driven social media scheduling expert. Provide direct, actionable recommendations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 400,
    });
    
    return response.choices[0].message.content;
    
  } catch (error) {
    console.error('Error getting AI recommendations:', error);
    return 'Unable to generate AI recommendations at this time.';
  }
}

// Get schedule for all platforms
export async function analyzeAllPlatforms(userId) {
  try {
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    const schedules = {};
    
    for (const platform of platforms) {
      schedules[platform] = await analyzeOptimalTimes(userId, platform);
    }
    
    return {
      success: true,
      schedules: schedules,
      summary: generateScheduleSummary(schedules),
    };
    
  } catch (error) {
    console.error('Error analyzing all platforms:', error);
    throw error;
  }
}

// Generate summary of all schedules
function generateScheduleSummary(schedules) {
  const totalOptimalSlots = Object.values(schedules)
    .flatMap(s => s.optimalTimes)
    .length;
  
  const bestOverallPlatform = Object.entries(schedules)
    .sort((a, b) => 
      parseFloat(b[1].analysis.bestTimeSlotEngagement) - 
      parseFloat(a[1].analysis.bestTimeSlotEngagement)
    )[0];
  
  return {
    totalOptimalSlots: totalOptimalSlots,
    bestPerformingPlatform: bestOverallPlatform[0],
    bestEngagementRate: bestOverallPlatform[1].analysis.bestTimeSlotEngagement + '%',
  };
}

