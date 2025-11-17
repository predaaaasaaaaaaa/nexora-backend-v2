import { processAIRequest } from '../services/unifiedAI.js';

export async function generateIdeas(req, res) {
  try {
    const { platform } = req.params;
    const { count = 10 } = req.query;
    const userId = req.user.id;
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: `Generate ${count} viral content ideas for my ${platform} based on my performance data and what you know about me`,
      platform: platform,
    });
    
    res.json({
      success: true,
      platform: platform,
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
    const { count = 5 } = req.query;
    const userId = req.user.id;
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: `Generate ${count} content ideas for each of my platforms based on my complete profile and performance data`,
      platform: 'all',
    });
    
    res.json({
      success: true,
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
