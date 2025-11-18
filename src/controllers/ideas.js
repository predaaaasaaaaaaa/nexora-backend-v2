import { processAIRequest } from '../services/unifiedAI.js';

// Allowed niches list
const ALLOWED_NICHES = [
  "My Niche (Fitness & Health)",
  "Fashion & Style",
  "Food & Cooking",
  "Travel & Adventure",
  "Technology & Gadgets",
  "Business & Entrepreneurship",
  "Education & Learning",
  "Gaming & Entertainment",
  "Beauty & Skincare",
  "Home & DIY",
  "Parenting & Family",
  "Finance & Investing",
  "Photography & Art",
  "Music & Dance",
  "Sports & Athletics",
];

export async function generateIdeas(req, res) {
  try {
    const { platform } = req.params;
    const { count = 10, niche } = req.query;
    const userId = req.user.id;
    
    // Validate niche if provided
    let selectedNiche = niche;
    if (niche && !ALLOWED_NICHES.includes(niche)) {
      return res.status(400).json({
        success: false,
        error: `Invalid niche. Allowed niches: ${ALLOWED_NICHES.join(', ')}`
      });
    }
    
    // Default to user's niche if not provided
    const isUserNiche = !niche || niche === "My Niche (Fitness & Health)";
    
    // Build message based on niche type
    let message;
    if (isUserNiche) {
      message = `Generate ${count} viral content ideas for my ${platform} based on my performance data and what you know about me`;
    } else {
      message = `Generate ${count} viral content ideas for ${platform} in the ${niche} niche. Create trending, engaging content ideas that would perform well for creators in this niche. Do NOT use any personal user data. Generate generic but high-quality ideas for this niche.`;
    }
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: message,
      platform: platform,
      additionalContext: {
        niche: selectedNiche,
        isUserNiche: isUserNiche,
        count: parseInt(count),
      },
    });
    
    res.json({
      success: true,
      platform: platform,
      niche: selectedNiche || "My Niche (Fitness & Health)",
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
    
    // Validate niche if provided
    let selectedNiche = niche;
    if (niche && !ALLOWED_NICHES.includes(niche)) {
      return res.status(400).json({
        success: false,
        error: `Invalid niche. Allowed niches: ${ALLOWED_NICHES.join(', ')}`
      });
    }
    
    // Default to user's niche if not provided
    const isUserNiche = !niche || niche === "My Niche (Fitness & Health)";
    
    // Build message based on niche type
    let message;
    if (isUserNiche) {
      message = `Generate ${count} content ideas for each of my platforms based on my complete profile and performance data`;
    } else {
      message = `Generate ${count} content ideas for each platform (Instagram, YouTube, TikTok, Twitter) in the ${niche} niche. Create trending, engaging content ideas that would perform well for creators in this niche. Do NOT use any personal user data. Generate generic but high-quality ideas for this niche.`;
    }
    
    const aiResponse = await processAIRequest(userId, {
      task: 'ideas',
      message: message,
      platform: 'all',
      additionalContext: {
        niche: selectedNiche,
        isUserNiche: isUserNiche,
        count: parseInt(count),
      },
    });
    
    res.json({
      success: true,
      niche: selectedNiche || "My Niche (Fitness & Health)",
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
