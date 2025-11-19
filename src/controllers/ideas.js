import { processAIRequest } from '../services/unifiedAI.js';

export async function generateIdeas(req, res) {
  try {
    const { platform } = req.params;
    const { count = 10, niche } = req.query;
    const userId = req.user.id;
    
    // Check if using user's own niche
    const isUserNiche = !niche || niche === "user-niche";
    
    // Build message based on niche type
    let message;
    if (isUserNiche) {
      // User's own niche - use their actual data
      message = `Generate ${count} viral content ideas for my ${platform} based on my performance data and what you know about me`;
    } else {
      // Different niche - generic ideas
      message = `Generate ${count} viral content ideas for ${platform} in the ${niche} niche. Create trending, engaging content ideas that would perform well for creators in this niche. Do NOT use any personal user data. Generate generic but high-quality ideas for this niche.`;
    }
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: message,
      platform: platform,
      additionalContext: {
        niche: isUserNiche ? "My Niche (Fitness & Health)" : niche,
        isUserNiche: isUserNiche,
        count: parseInt(count),
      },
    });
    
    res.json({
      success: true,
      platform: platform,
      niche: isUserNiche ? "My Niche (Fitness & Health)" : niche,
      ideas: aiResponse.response,
      contextUsed: aiResponse.contextUsed,
    });
    
  } catch (error) {
    console.error('Error generating ideas:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

export async function generateAllIdeas(req, res) {
  try {
    const { count = 5, niche } = req.query;
    const userId = req.user.id;
    
    // Check if using user's own niche
    const isUserNiche = !niche || niche === "user-niche";
    
    // Build message based on niche type
    let message;
    if (isUserNiche) {
      // User's own niche - use their actual data
      message = `Generate ${count} content ideas for each of my platforms based on my complete profile and performance data`;
    } else {
      // Different niche - generic ideas
      message = `Generate ${count} content ideas for each platform (Instagram, YouTube, TikTok, Twitter) in the ${niche} niche. Create trending, engaging content ideas that would perform well for creators in this niche. Do NOT use any personal user data. Generate generic but high-quality ideas for this niche.`;
    }
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: message,
      platform: 'all',
      additionalContext: {
        niche: isUserNiche ? "My Niche (Fitness & Health)" : niche,
        isUserNiche: isUserNiche,
        count: parseInt(count),
      },
    });
    
    res.json({
      success: true,
      niche: isUserNiche ? "My Niche (Fitness & Health)" : niche,
      ideas: aiResponse.response,
      contextUsed: aiResponse.contextUsed,
    });
    
  } catch (error) {
    console.error('Error generating all ideas:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
