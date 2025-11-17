import Groq from 'groq-sdk';
import { generateMockAnalytics } from './mockData.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Generate content ideas based on user's performance
export async function generateContentIdeas(userId, platform, count = 10) {
  try {
    // Get user's analytics
    const analytics = generateMockAnalytics(platform, userId);
    
    // Analyze top-performing content
    const topContent = analyzeTopContent(analytics, platform);
    
    // Get AI-generated ideas
    const ideas = await getAIContentIdeas(platform, topContent, count);
    
    return {
      success: true,
      platform: platform,
      analysis: topContent,
      ideas: ideas,
      generatedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('Error generating content ideas:', error);
    throw error;
  }
}

// Analyze user's top-performing content
function analyzeTopContent(analytics, platform) {
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
  
  // Sort by engagement rate
  const sortedPosts = posts.sort((a, b) => 
    parseFloat(b.engagement_rate) - parseFloat(a.engagement_rate)
  );
  
  // Get top 5 posts
  const topPosts = sortedPosts.slice(0, 5);
  
  // Analyze patterns
  const patterns = {
    avgEngagementTop5: (
      topPosts.reduce((sum, p) => sum + parseFloat(p.engagement_rate), 0) / topPosts.length
    ).toFixed(2),
    avgEngagementOverall: analytics.insights.avgEngagementRate,
    topPostTypes: getTopPostTypes(topPosts, platform),
    engagementDrivers: identifyEngagementDrivers(topPosts, platform),
  };
  
  return {
    topPosts: topPosts.map(p => ({
      id: p.post_id || p.video_id || p.tweet_id,
      type: p.post_type || p.video_type || p.tweet_type,
      engagement: p.engagement_rate,
      views: p.views,
      posted: p.posted_at,
    })),
    patterns: patterns,
  };
}

// Identify post types that perform best
function getTopPostTypes(posts, platform) {
  const typeCounts = {};
  
  posts.forEach(post => {
    const type = post.post_type || post.video_type || post.tweet_type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  
  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
}

// Identify what drives engagement
function identifyEngagementDrivers(posts, platform) {
  const drivers = [];
  
  // Analyze based on platform
  if (platform === 'instagram') {
    const hasHighSaves = posts.some(p => p.saves > p.likes * 0.2);
    const hasHighShares = posts.some(p => p.shares > p.likes * 0.1);
    
    if (hasHighSaves) drivers.push('save-worthy_educational_content');
    if (hasHighShares) drivers.push('shareable_relatable_content');
  }
  
  if (platform === 'youtube') {
    const hasHighWatchTime = posts.some(p => p.watch_time_minutes > 30000);
    if (hasHighWatchTime) drivers.push('high_retention_content');
  }
  
  if (platform === 'tiktok') {
    const avgViews = posts.reduce((sum, p) => sum + p.views, 0) / posts.length;
    if (avgViews > 100000) drivers.push('viral_potential');
  }
  
  if (platform === 'twitter') {
    const hasHighReplies = posts.some(p => p.replies > p.likes * 0.3);
    if (hasHighReplies) drivers.push('conversation_starting_content');
  }
  
  if (drivers.length === 0) drivers.push('consistent_quality');
  
  return drivers;
}

// Get AI-generated content ideas
async function getAIContentIdeas(platform, topContent, count) {
  try {
    const prompt = `You are a viral content strategist. Generate ${count} specific, actionable content ideas for ${platform}.

USER'S TOP PERFORMING CONTENT ANALYSIS:
- Top post types: ${topContent.patterns.topPostTypes.map(t => t.type).join(', ')}
- Average engagement on best posts: ${topContent.patterns.avgEngagementTop5}%
- Overall average engagement: ${topContent.patterns.avgEngagementOverall}%
- Engagement drivers: ${topContent.patterns.engagementDrivers.join(', ')}

Generate ${count} content ideas that:
1. Build on what's already working for this user
2. Are specific and actionable (not generic)
3. Have viral potential based on current ${platform} trends
4. Match the engagement patterns identified above

Format each idea as:
**[Number]. [Hook/Title]**
Format: [content type]
Why it works: [1 sentence]
Expected engagement: [percentage estimate]

Be creative but data-driven. Make each idea unique.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a viral content strategist who creates data-driven content ideas that perform exceptionally well."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.9, // Higher creativity
      max_tokens: 1500,
    });
    
    // Parse the AI response into structured ideas
    const rawIdeas = response.choices[0].message.content;
    const parsedIdeas = parseContentIdeas(rawIdeas, platform);
    
    return parsedIdeas;
    
  } catch (error) {
    console.error('Error getting AI content ideas:', error);
    throw error;
  }
}

// Parse AI response into structured format
function parseContentIdeas(rawText, platform) {
  const ideas = [];
  const lines = rawText.split('\n');
  
  let currentIdea = null;
  
  lines.forEach(line => {
    const trimmed = line.trim();
    
    // Check if it's a new idea (starts with number)
    if (/^\*?\*?\d+\./.test(trimmed)) {
      if (currentIdea) {
        ideas.push(currentIdea);
      }
      
      currentIdea = {
        id: ideas.length + 1,
        title: trimmed.replace(/^\*?\*?\d+\.\s*/, '').replace(/\*\*/g, ''),
        format: 'Unknown',
        reasoning: '',
        expectedEngagement: 'N/A',
        platform: platform,
      };
    }
    // Parse format
    else if (trimmed.toLowerCase().startsWith('format:')) {
      if (currentIdea) {
        currentIdea.format = trimmed.replace(/format:/i, '').trim();
      }
    }
    // Parse reasoning
    else if (trimmed.toLowerCase().startsWith('why it works:') || trimmed.toLowerCase().startsWith('why:')) {
      if (currentIdea) {
        currentIdea.reasoning = trimmed.replace(/why (it works)?:/i, '').trim();
      }
    }
    // Parse expected engagement
    else if (trimmed.toLowerCase().startsWith('expected engagement:') || trimmed.toLowerCase().startsWith('engagement:')) {
      if (currentIdea) {
        currentIdea.expectedEngagement = trimmed.replace(/expected engagement:|engagement:/i, '').trim();
      }
    }
  });
  
  // Add last idea
  if (currentIdea) {
    ideas.push(currentIdea);
  }
  
  // If parsing failed, create simple structure
  if (ideas.length === 0) {
    const simpleParse = rawText.split(/\d+\./).filter(text => text.trim());
    simpleParse.forEach((text, index) => {
      if (text.trim()) {
        ideas.push({
          id: index + 1,
          title: text.trim().split('\n')[0].replace(/\*\*/g, ''),
          format: 'Content',
          reasoning: text.trim(),
          expectedEngagement: 'High potential',
          platform: platform,
        });
      }
    });
  }
  
  return ideas;
}

// Generate ideas for all platforms
export async function generateAllPlatformIdeas(userId, countPerPlatform = 5) {
  try {
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    const allIdeas = {};
    
    for (const platform of platforms) {
      allIdeas[platform] = await generateContentIdeas(userId, platform, countPerPlatform);
    }
    
    return {
      success: true,
      totalIdeas: Object.values(allIdeas).reduce((sum, p) => sum + p.ideas.length, 0),
      platforms: allIdeas,
      generatedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('Error generating all platform ideas:', error);
    throw error;
  }
}

