import { processAIRequest } from '../services/unifiedAI.js';

export async function chatWithCoach(req, res) {
  try {
    const { message, platform, niche, analytics } = req.body;
    const userId = req.user.id;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }
    
    const response = await processAIRequest(userId, {
      task: 'coach',
      message: message,
      platform: platform || 'instagram',
      additionalContext: { niche, analytics },
    });
    
    res.json(response);
    
  } catch (error) {
    console.error('Error in chatWithCoach:', error);
    res.status(500).json({
      success: false,
      error: 'AI coach is temporarily unavailable.'
    });
  }
}

export async function checkBeforeAction(req, res) {
  res.json({
    success: true,
    message: "Intervention system ready"
  });
}
