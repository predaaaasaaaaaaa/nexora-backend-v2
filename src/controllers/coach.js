import { processAIRequest } from '../services/unifiedAI.js';
import { supabase, supabaseAsUser } from '../services/supabase.js';
import { searchCompetitors, analyzeCompetitor, compareWithUser, formatCompetitorForAI } from '../services/competitors.js';

// List all conversations for a user
export async function listConversations(req, res) {
  try {
    const userId = req.user.id;

    const db = supabaseAsUser(req.userToken);
    const { data, error } = await db
      .from('coach_conversations')
      .select('id, title, platform, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ success: true, conversations: data || [] });
  } catch (error) {
    console.error('Error listing conversations:', error);
    res.status(500).json({ success: false, error: 'Failed to load conversations' });
  }
}

// Create a new conversation
export async function createConversation(req, res) {
  try {
    const userId = req.user.id;
    const { platform } = req.body;

    const db = supabaseAsUser(req.userToken);
    const { data, error } = await db
      .from('coach_conversations')
      .insert({
        user_id: userId,
        platform: platform || 'youtube',
        title: 'New Chat',
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, conversation: data });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to create conversation' });
  }
}

// Get messages for a conversation
export async function getMessages(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const db = supabaseAsUser(req.userToken);

    // Verify ownership
    const { data: conv, error: convError } = await db
      .from('coach_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (convError || !conv) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const { data, error } = await db
      .from('coach_messages')
      .select('id, role, content, context_used, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, messages: data || [] });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ success: false, error: 'Failed to load messages' });
  }
}

// Delete a conversation
export async function deleteConversation(req, res) {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const db = supabaseAsUser(req.userToken);
    const { error } = await db
      .from('coach_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ success: false, error: 'Failed to delete conversation' });
  }
}

// ============================================================
// COMPETITOR INTENT DETECTION
// ============================================================
function detectCompetitorIntent(message) {
  const msg = message.toLowerCase();

  // Keywords that signal competitor analysis
  const competitorKeywords = [
    'competitor', 'competitors', 'rival', 'rivals', 'compete',
    'compare', 'comparison', 'vs', 'versus',
    'their channel', 'their videos', 'their content',
    'other channels', 'similar channels', 'channels like',
    'spy', 'spying', 'research', 'benchmark',
  ];

  // Check for direct competitor keywords
  const hasCompetitorKeyword = competitorKeywords.some(kw => msg.includes(kw));

  // Check for YouTube channel references (@handle or URL)
  const hasChannelRef = /@[\w.-]+/.test(message) ||
    /youtube\.com\/(channel|c|user|@)/.test(msg) ||
    /youtu\.be/.test(msg);

  // Check for "find channels" or "search for" patterns
  const hasSearchIntent = /(?:find|search|look up|check out|analyze|analyse|show me)\s+(?:channels?|youtubers?|creators?)/.test(msg);

  // Check for comparison patterns
  const hasCompareIntent = /(?:compare|how do i stack up|how am i doing vs|difference between)/.test(msg);

  if (!hasCompetitorKeyword && !hasChannelRef && !hasSearchIntent && !hasCompareIntent) {
    return null;
  }

  // Determine intent type
  let intent = 'general'; // default: user is talking about competitors generally

  if (hasChannelRef) {
    // Extract ALL channel references (multiple handles)
    const handleMatches = [...message.matchAll(/@([\w.-]+)/g)].map(m => `@${m[1]}`);
    const urlMatches = [...message.matchAll(/youtube\.com\/(?:channel|c|user|@)\/?([^\s,|]+)/g)].map(m => m[1]);
    const allRefs = [...handleMatches, ...urlMatches.filter(u => !handleMatches.includes(`@${u}`))];

    if (hasCompareIntent || msg.includes('compare') || msg.includes('vs')) {
      intent = 'compare';
    } else {
      intent = 'analyze';
    }

    // Single or multiple
    if (allRefs.length > 1) {
      return { intent, channelRef: allRefs[0], allChannelRefs: allRefs, multi: true };
    }
    return { intent, channelRef: allRefs[0] || null };
  }

  if (hasSearchIntent) {
    // Extract what they want to search for
    const searchMatch = msg.match(/(?:find|search|look up|check out|show me)\s+(?:\d+\s+)?(?:of\s+)?(?:my\s+)?(?:competitors?|channels?|youtubers?|creators?)\s*(?:in|for|about|like)?\s*(.*)/i);
    const searchQuery = searchMatch ? searchMatch[1].trim() : null;
    return { intent: 'search', searchQuery };
  }

  if (hasCompareIntent) {
    return { intent: 'compare', channelRef: null };
  }

  return { intent: 'general' };
}

// Extract channel name/reference from message for search
function extractChannelQuery(message) {
  // Try @handle first
  const handleMatch = message.match(/@([\w.-]+)/);
  if (handleMatch) return `@${handleMatch[1]}`;

  // Try YouTube URL
  const urlMatch = message.match(/(https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user|@)[\w./-]+)/i);
  if (urlMatch) return urlMatch[1];

  // Try quoted channel name
  const quotedMatch = message.match(/["'「]([^"'」]+)["'」]/);
  if (quotedMatch) return quotedMatch[1];

  // Try "channel called X" or "channel named X"
  const namedMatch = message.match(/(?:channel|youtuber|creator)\s+(?:called|named|is)\s+["']?([^"',.\n]+)/i);
  if (namedMatch) return namedMatch[1].trim();

  return null;
}

// Fetch competitor data based on detected intent
async function fetchCompetitorData(userId, message, intent) {
  try {
    const channelQuery = intent.channelRef || extractChannelQuery(message);

    switch (intent.intent) {
      case 'analyze': {
        if (!channelQuery && !intent.allChannelRefs) return null;

        // Multiple competitors
        if (intent.multi && intent.allChannelRefs) {
          const allFormatted = [];
          for (const ref of intent.allChannelRefs.slice(0, 5)) {
            try {
              const results = await searchCompetitors(ref, 1);
              if (results.length > 0) {
                const analysis = await analyzeCompetitor(results[0].channel_id);
                allFormatted.push(formatCompetitorForAI(analysis));
              } else {
                allFormatted.push(`[Competitor "${ref}"] — Channel not found.`);
              }
            } catch (err) {
              allFormatted.push(`[Competitor "${ref}"] — Error fetching data.`);
            }
          }
          return {
            type: 'multi_analysis',
            formatted: allFormatted.join('\n\n---\n\n'),
          };
        }

        // Single competitor
        const results = await searchCompetitors(channelQuery, 1);
        if (results.length === 0) return { error: `Could not find a YouTube channel matching "${channelQuery}".` };

        const analysis = await analyzeCompetitor(results[0].channel_id);
        return {
          type: 'analysis',
          data: analysis,
          formatted: formatCompetitorForAI(analysis),
        };
      }

      case 'compare': {
        if (!channelQuery) return { type: 'compare_no_channel' };
        const results = await searchCompetitors(channelQuery, 1);
        if (results.length === 0) return { error: `Could not find a YouTube channel matching "${channelQuery}".` };

        const comparison = await compareWithUser(userId, results[0].channel_id);
        const analysis = await analyzeCompetitor(results[0].channel_id);
        return {
          type: 'comparison',
          data: comparison,
          competitorAnalysis: analysis,
          formatted: formatCompetitorForAI(analysis),
          comparisonFormatted: formatComparisonForAI(comparison),
        };
      }

      case 'search': {
        const query = intent.searchQuery || channelQuery || extractSearchTopic(message);
        if (!query) return null;
        const results = await searchCompetitors(query, 5);
        if (results.length === 0) return { error: `No channels found for "${query}".` };
        return {
          type: 'search',
          data: results,
          formatted: formatSearchResultsForAI(results),
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error('Error fetching competitor data:', error);
    return { error: 'Failed to fetch competitor data. Try again or be more specific.' };
  }
}

// Extract search topic from general competitor messages
function extractSearchTopic(message) {
  const msg = message.toLowerCase();
  // "find competitors in gaming" → "gaming"
  const topicMatch = msg.match(/(?:competitors?|channels?|creators?)\s+(?:in|for|about)\s+(.+?)(?:\s+niche|\s+space|\s*$)/i);
  if (topicMatch) return topicMatch[1].trim();
  // "find gaming channels" → "gaming"
  const typeMatch = msg.match(/(?:find|search|show)\s+(.+?)\s+(?:channels?|creators?|youtubers?)/i);
  if (typeMatch) return typeMatch[1].trim();
  return null;
}

// Format comparison data for AI context
function formatComparisonForAI(data) {
  const u = data.comparison.user;
  const c = data.comparison.competitor;
  const lines = [
    `[COMPARISON: Your Channel vs ${c.name}]`,
    `             | YOU               | ${c.name}`,
    `Subscribers  | ${u.subscribers.toLocaleString().padEnd(17)} | ${c.subscribers.toLocaleString()}`,
    `Total views  | ${u.total_views.toLocaleString().padEnd(17)} | ${c.total_views.toLocaleString()}`,
    `Avg views    | ${u.avgViews.toLocaleString().padEnd(17)} | ${c.avgViews.toLocaleString()}`,
    `Engagement   | ${u.avgEngagement}%${' '.repeat(15 - String(u.avgEngagement).length)} | ${c.avgEngagement}%`,
    `Long videos  | ${u.longVideos}${' '.repeat(17 - String(u.longVideos).length)} | ${c.longVideos}`,
    `Shorts       | ${u.shorts}${' '.repeat(17 - String(u.shorts).length)} | ${c.shorts}`,
  ];

  if (data.comparison.gaps.length > 0) {
    lines.push(`[GAPS — Where they beat you]`);
    data.comparison.gaps.forEach(g => lines.push(`- ${g}`));
  }

  if (data.comparison.opportunities.length > 0) {
    lines.push(`[OPPORTUNITIES — Where you have advantage]`);
    data.comparison.opportunities.forEach(o => lines.push(`- ${o}`));
  }

  return lines.join('\n');
}

// Format search results for AI context
function formatSearchResultsForAI(results) {
  const lines = [`[COMPETITOR SEARCH RESULTS — ${results.length} channels found]`];
  results.forEach((ch, i) => {
    lines.push(`${i + 1}. "${ch.name}" (@${ch.handle}) | Subs: ${ch.subscribers.toLocaleString()} | Views: ${ch.total_views.toLocaleString()} | Videos: ${ch.total_videos}`);
  });
  return lines.join('\n');
}

// ============================================================
// CHAT — Main endpoint with competitor intent detection
// ============================================================
export async function chatWithCoach(req, res) {
  try {
    const { message, platform, conversationId, niche, analytics } = req.body;
    const userId = req.user.id;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    let activeConversationId = conversationId;

    // If a conversationId was supplied, prove the caller owns it before
    // writing into it. Without this check any user could inject messages
    // into another user's conversation and overwrite its title.
    if (activeConversationId) {
      const { data: ownedConv, error: ownErr } = await supabase
        .from('coach_conversations')
        .select('id')
        .eq('id', activeConversationId)
        .eq('user_id', userId)
        .single();

      if (ownErr || !ownedConv) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
      }
    } else {
      // If no conversation provided, create one
      const { data: newConv, error: createError } = await supabase
        .from('coach_conversations')
        .insert({
          user_id: userId,
          platform: platform || 'youtube',
          title: 'New Chat',
        })
        .select()
        .single();

      if (createError) throw createError;
      activeConversationId = newConv.id;
    }

    // Save user message
    await supabase.from('coach_messages').insert({
      conversation_id: activeConversationId,
      role: 'user',
      content: message,
    });

    // ---- LOAD RECENT CHAT MESSAGES FOR CONTEXT ----
    let recentChatMessages = [];
    if (activeConversationId) {
      const { data: recentMsgs } = await supabase
        .from('coach_messages')
        .select('role, content')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: false })
        .limit(6);
      
      if (recentMsgs) {
        recentChatMessages = recentMsgs.reverse();
      }
    }

    // ---- COMPETITOR INTENT DETECTION ----
    let competitorContext = null;
    const competitorIntent = detectCompetitorIntent(message);

    if (competitorIntent) {
      console.log('🔍 Competitor intent detected:', competitorIntent);
      competitorContext = await fetchCompetitorData(userId, message, competitorIntent);
      if (competitorContext) {
        console.log('📊 Competitor data fetched:', competitorContext.type || 'error');
      }
    }

    // Get AI response — pass competitor context + chat history
    const response = await processAIRequest(userId, {
      task: 'coach',
      message: message,
      platform: platform || 'youtube',
      additionalContext: {
        niche,
        analytics,
        competitorData: competitorContext,
        chatHistory: recentChatMessages,
      },
    });

    // Save assistant message
    await supabase.from('coach_messages').insert({
      conversation_id: activeConversationId,
      role: 'assistant',
      content: response.response,
      context_used: response.contextUsed || null,
    });

    // Auto-title: use first user message as title (trimmed)
    if (!conversationId) {
      const title = message.length > 50 ? message.substring(0, 50) + '...' : message;
      await supabase
        .from('coach_conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    } else {
      await supabase
        .from('coach_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    }

    res.json({
      ...response,
      conversationId: activeConversationId,
    });

  } catch (error) {
    console.error('Error in chatWithCoach:', error);
    res.status(500).json({ success: false, error: 'AI coach is temporarily unavailable.' });
  }
}

export async function checkBeforeAction(req, res) {
  res.json({ success: true, message: "Intervention system ready" });
}