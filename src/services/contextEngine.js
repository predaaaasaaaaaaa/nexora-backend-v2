import { supabase } from './supabase.js';
import { getYouTubeAnalytics, isYouTubeConnected } from './youtube.js';

// ─── Per-user context cache ─────────────────────────────────────────
//
// Without this, every chat / idea / scheduler AI call re-runs:
//   - 1 profile read
//   - 1 + N recent-conversation reads (N up to 5)
//   - 1 isYouTubeConnected read
//   - getYouTubeAnalytics if connected → 4-7 YouTube API calls
//
// At the AI rate limit (30/min/user) that's ~210 YouTube units/min/user
// — enough for one Pro user to drain the project's daily quota
// (~10k units) in under an hour.
//
// In-process Map; per-Vercel-instance. Good enough for day-1 — burst
// hits get cached, the next cold start picks up fresh data. Swap for
// Redis when we want cache hits across instances.
const contextCache = new Map(); // userId -> { ctx, exp }
const CONTEXT_TTL_MS = parseInt(process.env.CONTEXT_CACHE_TTL_MS || '60000', 10);
const CONTEXT_MAX_ENTRIES = 5000;

function cacheGet(userId) {
  const hit = contextCache.get(userId);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    contextCache.delete(userId);
    return null;
  }
  return hit.ctx;
}

function cacheSet(userId, ctx) {
  // Cap memory: drop the oldest entry once we're at the cap.
  if (contextCache.size >= CONTEXT_MAX_ENTRIES) {
    const firstKey = contextCache.keys().next().value;
    if (firstKey) contextCache.delete(firstKey);
  }
  contextCache.set(userId, { ctx, exp: Date.now() + CONTEXT_TTL_MS });
}

// Public: invalidate one user's cached context. Call this when we know
// the underlying state changed (e.g., user just connected YouTube,
// scheduled a new post). Cheap; safe to call freely.
export function invalidateUserContext(userId) {
  if (userId) contextCache.delete(userId);
}

// Get complete user context for AI
export async function getUserContext(userId, options = {}) {
  if (!options.bypassCache) {
    const cached = cacheGet(userId);
    if (cached) return cached;
  }

  try {
    const profile = await getUserProfile(userId);
    const recentTopics = await getRecentChatTopics(userId);
    const analytics = await getAllPlatformAnalytics(userId);

    const behaviorProfile = buildBehaviorProfile({
      recentTopics,
      analytics,
    });

    const ctx = {
      userId: userId,
      profile: profile,
      conversations: [],
      recentTopics: recentTopics,
      analytics: analytics,
      behaviorProfile: behaviorProfile,
      lastUpdated: new Date().toISOString(),
    };

    cacheSet(userId, ctx);
    return ctx;

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

// Get recent chat TOPICS (not full messages) — prevents repetition across chats
async function getRecentChatTopics(userId) {
  try {
    const { data: recentChats, error } = await supabase
      .from('coach_conversations')
      .select('id, title, platform, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    if (!recentChats || recentChats.length === 0) return [];

    const topics = [];
    for (const chat of recentChats.slice(0, 5)) {
      const { data: msgs } = await supabase
        .from('coach_messages')
        .select('role, content')
        .eq('conversation_id', chat.id)
        .order('created_at', { ascending: true })
        .limit(2);

      if (msgs && msgs.length > 0) {
        const userMsg = msgs.find(m => m.role === 'user');
        const aiMsg = msgs.find(m => m.role === 'assistant');
        topics.push({
          topic: chat.title,
          userAsked: userMsg?.content?.substring(0, 100) || '',
          aiAdvised: aiMsg?.content?.substring(0, 150) || '',
        });
      }
    }

    return topics;
  } catch (error) {
    console.error('Error fetching recent topics:', error);
    return [];
  }
}

// Get analytics for all platforms - REAL DATA ONLY, no mock fallback
async function getAllPlatformAnalytics(userId) {
  const analytics = {};

  // YouTube — real data only
  try {
    const connected = await isYouTubeConnected(userId);
    if (connected) {
      const realData = await getYouTubeAnalytics(userId);
      if (realData) {
        analytics['youtube'] = realData;
        console.log('✅ Using REAL YouTube data for AI context');
      } else {
        // Connected but no data yet
        analytics['youtube'] = { _status: 'connected_no_data' };
      }
    } else {
      // Not connected — explicitly mark as not connected, NO mock data
      analytics['youtube'] = { _status: 'not_connected' };
      console.log('ℹ️ YouTube not connected — no data injected into AI context');
    }
  } catch (err) {
    console.error('Error fetching YouTube data:', err.message);
    analytics['youtube'] = { _status: 'error' };
  }

  // Other platforms — not connected yet, no mock data
  analytics['instagram'] = { _status: 'not_connected' };
  analytics['tiktok'] = { _status: 'not_connected' };
  analytics['twitter'] = { _status: 'not_connected' };

  return analytics;
}

// Build behavioral profile from user data
function buildBehaviorProfile(data) {
  const { recentTopics, analytics } = data;
  
  const contentPreferences = analyzeContentPreferences(analytics);
  const topicsSummary = recentTopics.map(t => t.topic).join(', ');
  
  return {
    recentTopicsSummary: topicsSummary || 'No previous conversations',
    contentPreferences: contentPreferences,
    learningInsights: generateLearningInsights({ contentPreferences, recentTopics }),
  };
}

// Analyze content preferences from real analytics only
function analyzeContentPreferences(analytics) {
  const preferences = {
    bestPlatform: null,
    bestContentType: null,
    avgEngagement: 0,
  };
  
  let highestEngagement = 0;
  Object.entries(analytics).forEach(([platform, data]) => {
    // Skip status-only entries (not connected / no data)
    if (data._status) return;
    
    const engagement = parseFloat(data.insights?.avgEngagementRate || 0);
    if (engagement > highestEngagement) {
      highestEngagement = engagement;
      preferences.bestPlatform = platform;
    }
  });
  
  preferences.avgEngagement = highestEngagement;
  
  if (preferences.bestPlatform && analytics[preferences.bestPlatform]) {
    const platformData = analytics[preferences.bestPlatform];
    preferences.bestContentType = platformData.insights?.topPostType || 
                                  platformData.insights?.topVideoType ||
                                  platformData.insights?.topVideo ||
                                  'unknown';
  }
  
  return preferences;
}

// Generate learning insights
function generateLearningInsights(profiles) {
  const insights = [];
  
  if (profiles.recentTopics && profiles.recentTopics.length > 0) {
    const topics = profiles.recentTopics.map(t => t.topic).slice(0, 3).join(', ');
    insights.push(`Recent chat topics: ${topics}`);
  }
  
  if (profiles.contentPreferences && profiles.contentPreferences.bestPlatform) {
    insights.push(`Strongest performance on ${profiles.contentPreferences.bestPlatform}`);
  }
  
  if (insights.length === 0) {
    insights.push('Building user profile - more insights coming as you use NEXORA');
  }
  
  return insights;
}

// Save interaction
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
    
    if (error) {
      console.log('Legacy conversations table not available, using coach_messages instead');
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error saving interaction:', error);
    return null;
  }
}