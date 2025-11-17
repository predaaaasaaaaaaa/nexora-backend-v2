import { processAIRequest } from '../services/unifiedAI.js';
import { analyzeOptimalTimes } from '../services/schedulerAI.js';

export async function getOptimalSchedule(req, res) {
  try {
    const { platform } = req.params;
    const userId = req.user.id;
    
    // Get data analysis
    const analysis = await analyzeOptimalTimes(userId, platform);
    
    // Get AI recommendations using unified brain
    const aiResponse = await processAIRequest(userId, {
      task: 'scheduler',
      message: `Analyze my ${platform} posting schedule and provide recommendations`,
      platform: platform,
      additionalContext: { analysis: analysis.analysis },
    });
    
    res.json({
      ...analysis,
      aiInsights: aiResponse.response,
      contextUsed: aiResponse.contextUsed,
    });
    
  } catch (error) {
    console.error('Error getting optimal schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

export async function getAllSchedules(req, res) {
  try {
    const userId = req.user.id;
    
    const aiResponse = await processAIRequest(userId, {
      task: 'scheduler',
      message: `Analyze my posting schedule across all platforms and provide comprehensive recommendations`,
      platform: 'all',
    });
    
    res.json({
      success: true,
      recommendations: aiResponse.response,
      contextUsed: aiResponse.contextUsed,
    });
    
  } catch (error) {
    console.error('Error getting all schedules:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
