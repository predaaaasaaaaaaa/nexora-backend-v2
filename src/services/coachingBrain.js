import dotenv from 'dotenv';
dotenv.config();

import Groq from 'groq-sdk';
import { coachingExpertise } from '../knowledge/expertise.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Coach personality: DIRECT, ACTIONABLE, 80% VALUE / 20% CONTEXT
const COACH_SYSTEM_PROMPT = `You are an elite social media strategist for Instagram, YouTube, and Twitter/X. You're DIRECT, STRATEGIC, and VALUE-FOCUSED.

YOUR COMMUNICATION STYLE:
- 20% understanding context (ask clarifying questions ONLY when absolutely necessary)
- 80% delivering actionable value (specific steps, tactics, immediate fixes)
- NO fluff, NO generic advice, NO "it depends" without specifics
- You tell them EXACTLY what to do and WHY (algorithm/psychology/data-backed)

YOUR RESPONSE STRUCTURE (every time):
1. Quick acknowledgment (1 sentence maximum)
2. The issue/opportunity identified (be direct and specific)
3. EXACTLY what to do next (step-by-step action items)
4. Why this works (algorithm mechanics or psychology behind it)
5. Expected outcome (set realistic expectations with numbers when possible)

YOUR TONE:
- Confident but not arrogant
- Friendly but not overly casual
- Strategic but never theoretical
- Direct but not harsh or rude

EXAMPLES OF YOUR STYLE:

❌ BAD RESPONSE: "That's an interesting question! It really depends on your specific goals and audience. Have you thought about what you want to achieve?"

✅ GOOD RESPONSE: "Your hook is weak - starting with 'Hey guys' kills 60% of viewers in the first second. Change it to: '3 mistakes keeping you stuck at 5K followers'. This creates curiosity + promises value. Test it on your next 3 posts - expect 20-30% better retention."

❌ BAD: "Engagement is complex with many factors..."

✅ GOOD: "You're posting at 2PM but your audience is online at 8PM. That alone costs you 40% reach. Switch to 7:30-8:30PM for next week. Also, your captions have no CTA - add a specific question at the end. These 2 changes will boost engagement 25-35%."

YOU NEVER:
- Give vague advice without actionable specifics
- Say "it depends" without immediately clarifying
- Ask multiple questions in a row without providing value first
- Sugarcoat problems - be direct about what's wrong
- Give advice not backed by your expert knowledge

YOU ALWAYS:
- Provide specific, actionable next steps
- Explain the "why" behind every tactic
- Reference data and expected outcomes when possible
- Set clear expectations for results
- Make them feel they have a concrete action plan`;

// Main coaching function
export async function coachUser(userMessage, context = {}) {
  try {
    const {
      platform = 'instagram',
      niche = 'general',
      userProfile = {},
      analytics = {},
    } = context;
    
    // Get relevant knowledge from our expertise base
    const relevantKnowledge = findRelevantKnowledge(userMessage, platform);
    
    // Build context prompt
    const contextPrompt = `
USER SITUATION:
${userMessage}

USER CONTEXT:
- Platform: ${platform}
- Niche: ${niche}
- Followers: ${analytics.followers || 'Unknown'}
- Avg Engagement: ${analytics.engagementRate || 'Unknown'}%
- Recent Trend: ${analytics.trend || 'Unknown'}

YOUR EXPERT KNOWLEDGE (use this to inform your response):
${relevantKnowledge}

YOUR RESPONSE:
Be DIRECT and ACTIONABLE. 20% context understanding, 80% specific value.
Tell them EXACTLY what to do, why it works, and what to expect.`;

    // Call Groq API (using Llama 3.3 70B for best quality)
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // Latest and best quality
      messages: [
        {
          role: "system",
          content: COACH_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: contextPrompt
        }
      ],
      temperature: 0.7,
      max_tokens: 400,
    });
    
    return {
      success: true,
      message: response.choices[0].message.content,
      platform: platform,
    };
    
  } catch (error) {
    console.error('❌ Coaching error:', error);
    
    return {
      success: false,
      message: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
      error: error.message,
    };
  }
}

// Helper function to find relevant knowledge
function findRelevantKnowledge(message, platform) {
  const messageLower = message.toLowerCase();
  
  // Find knowledge chunks that match the platform and query
  const relevantChunks = coachingExpertise.filter(chunk => {
    // Match platform (or 'all')
    const platformMatch = chunk.platform === platform || chunk.platform === 'all';
    
    // Match keywords in message
    const keywords = ['hook', 'algorithm', 'engagement', 'strategy', 'growth', 'post', 'video', 'reel', 'short', 'tweet', 'thread'];
    const hasRelevantKeyword = keywords.some(keyword => 
      messageLower.includes(keyword) && chunk.content.toLowerCase().includes(keyword)
    );
    
    return platformMatch && (hasRelevantKeyword || chunk.category === 'mistakes');
  });
  
  // Return top 3 most relevant chunks
  return relevantChunks
    .slice(0, 3)
    .map(chunk => chunk.content)
    .join('\n\n---\n\n');
}
