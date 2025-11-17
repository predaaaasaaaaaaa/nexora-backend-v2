import { supabase } from './supabase.js';
import { generateMockAnalytics } from './mockData.js';

// Get complete user context for AI
export async function getUserContext(userId) {
  try {
    // Fetch user profile
    const profile = await getUserProfile(userId);
    
    // Fetch conversation history (last 20 interactions)
    const conversations = await getConversationHistory(userId, 20);
    
    // Fetch analytics for all platforms
    const analytics = await getAllPlatformAnalytics(userId);
    
    // Fetch scheduled posts
    const scheduledPosts = await getScheduledPosts(userId);
    
    // Fetch generated ideas (last 30 days)
    const generatedIdeas = await getGeneratedIdeas(userId);
    
    // Fetch feedback history
    const feedback = await getFeedbackHistory(userId);
    
    // Build behavioral profile
    const behaviorProfile = buildBehaviorProfile({
      conversations,
      analytics,
      feedback,
      scheduledPosts,
    });
    
    return {
      userId: userId,
      profile: profile,
      conversations: conversations,
      analytics: analytics,
      scheduledPosts: scheduledPosts,
      generatedIdeas: generatedIdeas,
      feedback: feedback,
      behaviorProfile: behaviorProfile,
      lastUpdated: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('Error getting user context:', error);
    throw error;
  }
}

// Get user profile
async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    
    return data || {
      niche: 'general',
      goals: [],
      preferences: {},
    };
  } catch (error) {
    console.error('Error fetching profile:', error);
    return { niche: 'general', goals: [], preferences: {} };
  }
}

// Get conversation history
async function getConversationHistory(userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

// Get analytics for all platforms
async function getAllPlatformAnalytics(userId) {
  const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
  const analytics = {};
  
  platforms.forEach(platform => {
    analytics[platform] = generateMockAnalytics(platform, userId);
  });
  
  return analytics;
}

// Get scheduled posts
async function getScheduledPosts(userId) {
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', userId)
      .gte('scheduled_time', new Date().toISOString())
      .order('scheduled_time', { ascending: true });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching scheduled posts:', error);
    return [];
  }
}

// Get generated ideas (from conversation history for now)
async function getGeneratedIdeas(userId) {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .ilike('message', '%idea%')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching generated ideas:', error);
    return [];
  }
}

// Get feedback history
async function getFeedbackHistory(userId) {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return [];
  }
}

// Build behavioral profile from user data
function buildBehaviorProfile(data) {
  const { conversations, analytics, feedback, scheduledPosts } = data;
  
  // Analyze conversation patterns
  const topTopics = analyzeConversationTopics(conversations);
  const communicationStyle = analyzeCommunicationStyle(conversations);
  
  // Analyze content preferences
  const contentPreferences = analyzeContentPreferences(analytics);
  
  // Analyze feedback patterns
  const feedbackPatterns = analyzeFeedbackPatterns(feedback);
  
  // Analyze posting behavior
  const postingBehavior = analyzePostingBehavior(scheduledPosts, analytics);
  
  return {
    topTopics: topTopics,
    communicationStyle: communicationStyle,
    contentPreferences: contentPreferences,
    feedbackPatterns: feedbackPatterns,
    postingBehavior: postingBehavior,
    learningInsights: generateLearningInsights({
      topTopics,
      contentPreferences,
      feedbackPatterns,
      postingBehavior,
    }),
  };
}

// Analyze what user talks about most
function analyzeConversationTopics(conversations) {
  const topics = {
    engagement: 0,
    growth: 0,
    content_ideas: 0,
    timing: 0,
    algorithm: 0,
    hooks: 0,
  };
  
  conversations.forEach(conv => {
    const message = (conv.message || '').toLowerCase();
    
    if (message.includes('engagement') || message.includes('interact')) topics.engagement++;
    if (message.includes('grow') || message.includes('follower')) topics.growth++;
    if (message.includes('idea') || message.includes('content')) topics.content_ideas++;
    if (message.includes('time') || message.includes('when')) topics.timing++;
    if (message.includes('algorithm')) topics.algorithm++;
    if (message.includes('hook') || message.includes('caption')) topics.hooks++;
  });
  
  return Object.entries(topics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, count]) => ({ topic, count }));
}

// Analyze how user communicates
function analyzeCommunicationStyle(conversations) {
  if (conversations.length === 0) return 'unknown';
  
  const avgLength = conversations.reduce((sum, c) => 
    sum + (c.message || '').length, 0
  ) / conversations.length;
  
  const hasQuestions = conversations.some(c => 
    (c.message || '').includes('?')
  );
  
  if (avgLength > 100 && hasQuestions) return 'detailed_inquisitive';
  if (avgLength > 100) return 'detailed_thorough';
  if (avgLength < 50 && hasQuestions) return 'brief_direct';
  return 'conversational';
}

// Analyze content preferences from analytics
function analyzeContentPreferences(analytics) {
  const preferences = {
    bestPlatform: null,
    bestContentType: null,
    avgEngagement: 0,
  };
  
  // Find best performing platform
  let highestEngagement = 0;
  Object.entries(analytics).forEach(([platform, data]) => {
    const engagement = parseFloat(data.insights?.avgEngagementRate || 0);
    if (engagement > highestEngagement) {
      highestEngagement = engagement;
      preferences.bestPlatform = platform;
    }
  });
  
  preferences.avgEngagement = highestEngagement;
  
  // Find best content type on best platform
  if (preferences.bestPlatform && analytics[preferences.bestPlatform]) {
    const platformData = analytics[preferences.bestPlatform];
    preferences.bestContentType = platformData.insights?.topPostType || 
                                  platformData.insights?.topVideoType ||
                                  platformData.insights?.topTweetType ||
                                  'unknown';
  }
  
  return preferences;
}

// Analyze feedback patterns
function analyzeFeedbackPatterns(feedback) {
  if (feedback.length === 0) {
    return { helpful_rate: 0, avg_rating: 0, total_feedback: 0 };
  }
  
  const helpful = feedback.filter(f => f.helpful === true).length;
  const totalRatings = feedback.filter(f => f.rating).length;
  const avgRating = totalRatings > 0
    ? feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / totalRatings
    : 0;
  
  return {
    helpful_rate: ((helpful / feedback.length) * 100).toFixed(1) + '%',
    avg_rating: avgRating.toFixed(1),
    total_feedback: feedback.length,
  };
}

// Analyze posting behavior
function analyzePostingBehavior(scheduledPosts, analytics) {
  const behavior = {
    scheduled_count: scheduledPosts.length,
    platforms_using: [],
    posting_consistency: 'unknown',
  };
  
  // Check which platforms they schedule for
  const platformCounts = {};
  scheduledPosts.forEach(post => {
    platformCounts[post.platform] = (platformCounts[post.platform] || 0) + 1;
  });
  
  behavior.platforms_using = Object.keys(platformCounts);
  
  // Determine consistency
  if (scheduledPosts.length > 10) behavior.posting_consistency = 'highly_consistent';
  else if (scheduledPosts.length > 5) behavior.posting_consistency = 'moderately_consistent';
  else if (scheduledPosts.length > 0) behavior.posting_consistency = 'starting_out';
  
  return behavior;
}

// Generate learning insights
function generateLearningInsights(profiles) {
  const insights = [];
  
  // Topic-based insights
  if (profiles.topTopics && profiles.topTopics.length > 0) {
    const topTopic = profiles.topTopics[0].topic || '';
    insights.push(`User frequently asks about: ${topTopic.replace(/_/g, ' ')}`);
  }
  
  // Performance insights
  if (profiles.contentPreferences && profiles.contentPreferences.bestPlatform) {
    insights.push(`Strongest performance on ${profiles.contentPreferences.bestPlatform}`);
  }
  
  // Behavior insights
  if (profiles.postingBehavior && profiles.postingBehavior.posting_consistency === 'highly_consistent') {
    insights.push('User is highly consistent with scheduling');
  }
  
  // Communication insights
  if (profiles.communicationStyle && profiles.communicationStyle !== 'unknown') {
    insights.push(`Communication style: ${profiles.communicationStyle.replace(/_/g, ' ')}`);
  }
  
  // Always return at least one insight
  if (insights.length === 0) {
    insights.push('Building user profile - more insights coming as you use NEXORA');
  }
  
  return insights;
}

// Save interaction to build learning loop
export async function saveInteraction(userId, interaction) {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        message: interaction.message,
        response: interaction.response,
        platform: interaction.platform || 'general',
        context: interaction.context || {},
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('Error saving interaction:', error);
    throw error;
  }
}

// Save feedback
export async function saveFeedback(userId, conversationId, feedbackData) {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        helpful: feedbackData.helpful,
        rating: feedbackData.rating,
        notes: feedbackData.notes,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('Error saving feedback:', error);
    throw error;
  }
}

