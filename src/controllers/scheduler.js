import { supabase } from '../services/supabase.js';
import { processAIRequest } from '../services/unifiedAI.js';

// ============================================================
// AI RECOMMENDATIONS
// ============================================================

// Initial recommendations (on page load)
export async function getAllSchedules(req, res) {
  try {
    const userId = req.user.id;

    // Fetch user's existing scheduled posts
    const { data: existingPosts } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true });

    const scheduledContext = formatScheduledPostsForAI(existingPosts || []);

    const aiResponse = await processAIRequest(userId, {
      task: 'scheduler',
      message: `Give quick scheduling tips for my YouTube channel. Max 2-3 bullet points, each 1 sentence. No long paragraphs. No timezone math — just use the times from my analytics data directly.

Current schedule: ${scheduledContext || 'Nothing scheduled yet.'}

Rules:
- If schedule looks good, say "Looks solid ✅" and give ONE quick tip
- If empty, suggest best days/times from my analytics
- MAX 3 short bullet points, that's it
- Never mention UTC or timezone conversions`,
      platform: 'youtube',
    });

    res.json({
      success: true,
      recommendations: aiResponse.response,
      contextUsed: aiResponse.contextUsed,
    });

  } catch (error) {
    console.error('Error getting schedules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Reactive recommendations (after user schedules/removes content)
export async function getReactiveRecommendations(req, res) {
  try {
    const userId = req.user.id;
    const { action, post } = req.body;
    // action: 'added' | 'removed' | 'updated'
    // post: the post that was just added/removed/updated

    // Fetch ALL current scheduled posts
    const { data: allPosts } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true });

    const scheduledContext = formatScheduledPostsForAI(allPosts || []);

    let actionContext = '';
    if (action === 'added' && post) {
      const postDate = new Date(post.scheduled_at);
      actionContext = `The creator just scheduled: "${post.title}" (${post.content_type}) on ${post.platform} for ${postDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} at ${postDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`;
    } else if (action === 'removed' && post) {
      actionContext = `The creator just removed: "${post.title}" from their schedule.`;
    } else if (action === 'updated' && post) {
      actionContext = `The creator just updated: "${post.title}" in their schedule.`;
    }

    const message = `${actionContext}

Current full schedule: ${scheduledContext || 'Nothing scheduled.'}

Respond in MAX 2-3 bullet points, each 1 sentence. Rules:
- If the schedule choice is good, say so: "Good pick ✅" then ONE quick improvement
- If not optimal, suggest a specific better time/day with a short reason
- Never mention UTC or do timezone math
- Never contradict yourself — if a time matches their best posting hours, confirm it's good
- No long paragraphs. Keep total response under 80 words.`;

    const aiResponse = await processAIRequest(userId, {
      task: 'scheduler',
      message,
      platform: 'youtube',
    });

    res.json({
      success: true,
      recommendations: aiResponse.response,
    });

  } catch (error) {
    console.error('Error getting reactive recommendations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Format scheduled posts into readable context for AI
function formatScheduledPostsForAI(posts) {
  if (!posts || posts.length === 0) return '';

  return posts.map((p, i) => {
    const date = new Date(p.scheduled_at);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${i + 1}. "${p.title}" — ${p.platform} ${p.content_type} — ${dayName} ${dateStr} at ${timeStr}`;
  }).join('\n');
}


// ============================================================
// SCHEDULED POSTS CRUD
// ============================================================

// Get all scheduled posts for user
export async function getScheduledPosts(req, res) {
  try {
    const userId = req.user.id;
    const { month, year } = req.query;

    let query = supabase
      .from('scheduled_posts')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_at', { ascending: true });

    // Filter by month/year if provided
    if (month && year) {
      const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1).toISOString();
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59).toISOString();
      query = query.gte('scheduled_at', startOfMonth).lte('scheduled_at', endOfMonth);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ success: true, posts: data || [] });

  } catch (error) {
    console.error('Error fetching scheduled posts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Create a scheduled post
export async function createScheduledPost(req, res) {
  try {
    const userId = req.user.id;
    const { title, description, platform, content_type, scheduled_at, timezone } = req.body;

    // Validation
    if (!title || !platform || !scheduled_at) {
      return res.status(400).json({
        success: false,
        error: 'Title, platform, and scheduled time are required.',
      });
    }

    // Check the scheduled time is in the future
    if (new Date(scheduled_at) <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Scheduled time must be in the future.',
      });
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .insert({
        user_id: userId,
        title: title.trim(),
        description: description?.trim() || null,
        platform,
        content_type: content_type || 'video',
        scheduled_at,
        timezone: timezone || 'UTC',
        status: 'scheduled',
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, post: data });

  } catch (error) {
    console.error('Error creating scheduled post:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Update a scheduled post
export async function updateScheduledPost(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const updates = req.body;

    // Only allow updating certain fields
    const allowedFields = ['title', 'description', 'platform', 'content_type', 'scheduled_at', 'timezone', 'status'];
    const cleanUpdates = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        cleanUpdates[key] = updates[key];
      }
    }

    if (Object.keys(cleanUpdates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update.' });
    }

    // If rescheduling, validate future time
    if (cleanUpdates.scheduled_at && new Date(cleanUpdates.scheduled_at) <= new Date()) {
      return res.status(400).json({ success: false, error: 'Scheduled time must be in the future.' });
    }

    // Reset reminder if time changed
    if (cleanUpdates.scheduled_at) {
      cleanUpdates.reminder_sent = false;
    }

    const { data, error } = await supabase
      .from('scheduled_posts')
      .update(cleanUpdates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Post not found.' });

    res.json({ success: true, post: data });

  } catch (error) {
    console.error('Error updating scheduled post:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Delete a scheduled post
export async function deleteScheduledPost(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Post not found.' });

    res.json({ success: true, deleted: data });

  } catch (error) {
    console.error('Error deleting scheduled post:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}


// ============================================================
// NOTIFICATION PREFERENCES
// ============================================================

// Get notification preferences
export async function getNotificationPreferences(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    // No prefs yet is fine — return defaults
    if (error && error.code === 'PGRST116') {
      return res.json({
        success: true,
        preferences: null,
        defaults: {
          reminder_minutes: 60,
          enabled: true,
        },
      });
    }

    if (error) throw error;

    res.json({ success: true, preferences: data });

  } catch (error) {
    console.error('Error fetching notification prefs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Create or update notification preferences
export async function upsertNotificationPreferences(req, res) {
  try {
    const userId = req.user.id;
    const { notification_email, reminder_minutes, enabled } = req.body;

    if (!notification_email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    // Validate reminder_minutes (min 5 minutes, max 7 days)
    if (reminder_minutes !== undefined) {
      const mins = parseInt(reminder_minutes);
      if (isNaN(mins) || mins < 5 || mins > 10080) {
        return res.status(400).json({
          success: false,
          error: 'Reminder time must be between 5 minutes and 7 days.',
        });
      }
    }

    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        notification_email: notification_email.trim(),
        reminder_minutes: reminder_minutes || 60,
        enabled: enabled !== undefined ? enabled : true,
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, preferences: data });

  } catch (error) {
    console.error('Error updating notification prefs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}