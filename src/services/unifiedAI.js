import Groq from 'groq-sdk';
import { getUserContext, saveInteraction } from './contextEngine.js';
import { coachingExpertise } from '../knowledge/expertise.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Main unified AI function - handles ALL AI requests
export async function processAIRequest(userId, request) {
  try {
    // Get complete user context
    const context = await getUserContext(userId);
    
    // Build comprehensive prompt with full context
    const prompt = buildUnifiedPrompt(request, context);
    
    // Get AI response
    const response = await callUnifiedAI(prompt, request.task);
    
    // Save interaction for learning
    await saveInteraction(userId, {
      message: request.message,
      response: response,
      platform: request.platform,
      context: {
        task: request.task,
        timestamp: new Date().toISOString(),
      },
    });
    
    return {
      success: true,
      response: response,
      task: request.task,
      contextUsed: {
        conversations: context.conversations.length,
        platforms: Object.keys(context.analytics),
        scheduledPosts: context.scheduledPosts.length,
        learningInsights: context.behaviorProfile.learningInsights,
      },
    };
    
  } catch (error) {
    console.error('Error processing AI request:', error);
    throw error;
  }
}

// Build comprehensive prompt with ALL context
function buildUnifiedPrompt(request, context) {
  const { task, message, platform, additionalContext } = request;
  
  // Get relevant expertise from knowledge base
  const relevantKnowledge = findRelevantKnowledge(message, platform);
  
  // Build system prompt based on task
  const systemPrompt = getSystemPromptForTask(task);
  
  // Build context sections
  const contextSections = [];
  
  // User Profile Section
  contextSections.push(`USER PROFILE:
- Niche: ${context.profile.niche || 'general'}
- Goals: ${context.profile.goals?.join(', ') || 'Not specified'}
- Communication Style: ${context.behaviorProfile.communicationStyle}
- Key Learning Insights: ${context.behaviorProfile.learningInsights.join('; ')}`);
  
  // Recent Conversations
  if (context.conversations.length > 0) {
    const recentTopics = context.conversations.slice(0, 5).map(c => 
      `- ${c.message.substring(0, 100)}...`
    ).join('\n');
    
    contextSections.push(`RECENT CONVERSATIONS:
${recentTopics}

Top Topics User Cares About: ${context.behaviorProfile.topTopics.map(t => t.topic).join(', ')}`);
  }
  
  // Performance Data
  const perfData = context.behaviorProfile.contentPreferences;
  contextSections.push(`PERFORMANCE DATA:
- Best Platform: ${perfData.bestPlatform} (${perfData.avgEngagement}% avg engagement)
- Best Content Type: ${perfData.bestContentType}
- All Platforms Analytics Available: ${Object.keys(context.analytics).join(', ')}`);
  
  // Scheduled Posts
  if (context.scheduledPosts.length > 0) {
    contextSections.push(`SCHEDULED POSTS:
User has ${context.scheduledPosts.length} posts scheduled
Platforms: ${[...new Set(context.scheduledPosts.map(p => p.platform))].join(', ')}
Next post: ${context.scheduledPosts[0]?.scheduled_time || 'N/A'}`);
  }
  
  // Expertise Knowledge
  contextSections.push(`EXPERT KNOWLEDGE:
${relevantKnowledge}`);
  
  // Build final prompt
  return `${systemPrompt}

${contextSections.join('\n\n---\n\n')}

USER REQUEST:
${message}

${additionalContext ? `ADDITIONAL CONTEXT:\n${JSON.stringify(additionalContext, null, 2)}` : ''}

YOUR RESPONSE:
Remember: You know this user well. Reference their specific situation, past conversations, and performance data. Be direct, actionable, and personalized.`;
}

// Get system prompt based on task
function getSystemPromptForTask(task) {
  const prompts = {
    coach: `You are NEXORA, a unified AI social media strategist. You have complete knowledge of this user across all their platforms, conversations, and goals. You provide direct, actionable coaching that's 80% value and 20% context. You remember everything about this user and connect insights across all their data.`,
    
    scheduler: `You are NEXORA, analyzing this user's complete performance data to predict optimal posting times. You understand their audience behavior, past performance, and scheduled posts. Provide data-driven scheduling recommendations that avoid conflicts and maximize engagement.`,
    
    ideas: `You are NEXORA, generating viral content ideas based on this user's complete profile. You know what's worked for them, what they struggle with, their upcoming schedule, and their conversation history. Generate ideas that build on their strengths and address their concerns.`,
    
    proactive: `You are NEXORA, proactively monitoring this user's activity. Based on their complete context, you identify issues, opportunities, and patterns. You intervene when you notice something important, connecting dots across their analytics, conversations, and behavior.`,
  };
  
  return prompts[task] || prompts.coach;
}

// Find relevant knowledge from expertise base
function findRelevantKnowledge(message, platform) {
  const messageLower = message.toLowerCase();
  
  const relevantChunks = coachingExpertise.filter(chunk => {
    const platformMatch = chunk.platform === platform || chunk.platform === 'all';
    
    const keywords = ['hook', 'algorithm', 'engagement', 'strategy', 'growth', 'post', 'video', 'reel', 'short', 'tweet', 'thread', 'schedule', 'time', 'idea'];
    const hasRelevantKeyword = keywords.some(keyword => 
      messageLower.includes(keyword) && chunk.content.toLowerCase().includes(keyword)
    );
    
    return platformMatch && (hasRelevantKeyword || chunk.category === 'mistakes');
  });
  
  return relevantChunks
    .slice(0, 2)
    .map(chunk => chunk.content)
    .join('\n\n---\n\n');
}

// Call unified AI
async function callUnifiedAI(prompt, task) {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: task === 'ideas' ? 0.9 : 0.7,
      max_tokens: task === 'ideas' ? 1500 : 600,
    });
    
    return response.choices[0].message.content;
    
  } catch (error) {
    console.error('Error calling unified AI:', error);
    throw error;
  }
}

