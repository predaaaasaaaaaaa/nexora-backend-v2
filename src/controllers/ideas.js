import { processAIRequest } from '../services/unifiedAI.js';
import { incrementUsage } from '../services/subscription.js';
import { trackEvent } from '../services/tracking.js';

// Bound user-controlled inputs that flow into the AI prompt. Without
// caps, count=10000000 + a 10MB niche string both pad the input token
// count we pay Groq for, even though max_tokens caps the output.
const MAX_IDEAS_COUNT = 50;
const MIN_IDEAS_COUNT = 1;
const MAX_NICHE_LEN = 80;

function safeCount(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(MAX_IDEAS_COUNT, Math.max(MIN_IDEAS_COUNT, n));
}
function safeNiche(raw) {
  if (typeof raw !== 'string') return null;
  // Strip ASCII control chars (charCode loop avoids regex-escape
  // pitfalls). Trim, clamp to MAX_NICHE_LEN.
  let s = '';
  for (const ch of raw) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) s += ch;
  }
  s = s.trim().slice(0, MAX_NICHE_LEN);
  return s || null;
}

export async function generateIdeas(req, res) {
  try {
    const { platform } = req.params;
    const userId = req.user.id;
    const count = safeCount(req.query.count);
    const rawNiche = safeNiche(req.query.niche);

    // Check if using user's own niche
    const isUserNiche = !rawNiche || rawNiche === 'user-niche';
    const niche = rawNiche;

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

    // The atomic check-and-increment in requirePlan('content_idea')
    // already bumped the counter, so don't double-bump here. The legacy
    // path (when the middleware mode falls through to non-atomic) still
    // needs the bump.
    if (!req.quotaAlreadyIncremented) {
      await incrementUsage(userId, 'content_ideas_used');
    }

    // Product event: ideas generated. Count only — never the idea text.
    // Awaited so the insert lands before res.json() freezes the serverless
    // function; trackEvent swallows its own errors, so awaiting can't break
    // the handler — it only guarantees the write and logs real DB errors.
    await trackEvent(userId, 'content_ideas_generated', { count });

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
      error: 'Failed to generate ideas'
    });
  }
}

export async function generateAllIdeas(req, res) {
  try {
    const userId = req.user.id;
    // Tighter cap on the multi-platform variant (prompt is bigger).
    const count = Math.min(20, safeCount(req.query.count));
    const rawNiche = safeNiche(req.query.niche);

    // Check if using user's own niche
    const isUserNiche = !rawNiche || rawNiche === 'user-niche';
    const niche = rawNiche;

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

    await incrementUsage(userId, 'content_ideas_used');

    // Product event: ideas generated (multi-platform variant). Count only.
    // Awaited so the insert lands before res.json() freezes the serverless
    // function; trackEvent swallows its own errors, so awaiting can't break
    // the handler — it only guarantees the write and logs real DB errors.
    await trackEvent(userId, 'content_ideas_generated', { count });

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
      error: 'Failed to generate ideas'
    });
  }
}
