import { searchCompetitors, analyzeCompetitor, compareWithUser, saveTrackedCompetitor, getTrackedCompetitors, removeTrackedCompetitor, fetchChannelById } from '../services/competitors.js';
import { incrementUsage, consumeYouTubeQuota, YouTubeQuotaExceededError } from '../services/subscription.js';
import { trackEvent } from '../services/tracking.js';

// Approximate YouTube API quota cost per operation. Source:
// https://developers.google.com/youtube/v3/determine_quota_cost
// search.list = 100, channels.list = 1, playlistItems.list = 1,
// videos.list = 1, youtubeAnalytics.reports.query = 1.
const QUOTA_COST = {
  search:  101,   // search.list (100) + channels.list batch (1)
  analyze:   3,   // channels.list (1) + playlistItems.list (1) + videos batch (1)
  compare:  10,   // 2× analyze + ~4 analytics queries
  track:     1,   // single channels.list
};

function quotaErrorResponse(res, err) {
  return res.status(429).json({
    success: false,
    error: 'youtube_quota_exhausted',
    message: 'You\'ve used your monthly YouTube research quota for this plan. Upgrade or wait until next month.',
    used: err.used,
    limit: err.limit,
  });
}

// Search for competitor channels
export async function search(req, res) {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, error: 'Search query is required' });

    await consumeYouTubeQuota(req.user.id, req.userPlan || 'free', QUOTA_COST.search);

    const results = await searchCompetitors(query, 5);
    res.json({ success: true, results });
  } catch (error) {
    if (error instanceof YouTubeQuotaExceededError) return quotaErrorResponse(res, error);
    console.error('Error searching competitors:', error);
    res.status(500).json({ success: false, error: 'Failed to search competitors' });
  }
}

// Deep analyze a specific channel
export async function analyze(req, res) {
  try {
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ success: false, error: 'Channel ID is required' });

    await consumeYouTubeQuota(req.user.id, req.userPlan || 'free', QUOTA_COST.analyze);

    const analysis = await analyzeCompetitor(channelId);

    // Product event: a competitor analysis ran. Platform enum only — no
    // channel identifiers or analysis content. Competitors are YouTube-only.
    // Awaited so the insert lands before res.json() freezes the serverless
    // function; trackEvent swallows its own errors, so awaiting can't break
    // the handler — it only guarantees the write and logs real DB errors.
    await trackEvent(req.user.id, 'competitor_analyzed', { platform: 'youtube' });

    res.json({ success: true, data: analysis });
  } catch (error) {
    if (error instanceof YouTubeQuotaExceededError) return quotaErrorResponse(res, error);
    console.error('Error analyzing competitor:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze competitor' });
  }
}

// Compare competitor with user's channel
export async function compare(req, res) {
  try {
    const userId = req.user.id;
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ success: false, error: 'Channel ID is required' });

    await consumeYouTubeQuota(userId, req.userPlan || 'free', QUOTA_COST.compare);

    const comparison = await compareWithUser(userId, channelId);
    res.json({ success: true, data: comparison });
  } catch (error) {
    if (error instanceof YouTubeQuotaExceededError) return quotaErrorResponse(res, error);
    console.error('Error comparing channels:', error);
    res.status(500).json({ success: false, error: 'Failed to compare channels' });
  }
}

// Track a competitor.
//
// requirePlan('competitor') already incremented competitors_tracked
// atomically (see METERED in planEnforcement.js). If the save below
// fails for any reason we decrement to keep the counter accurate —
// otherwise the user "loses" a slot to a save that never landed.
export async function track(req, res) {
  const userId = req.user.id;
  let saved = false;
  try {
    const { channel_id } = req.body;

    if (!channel_id || typeof channel_id !== 'string') {
      // Roll back the atomic increment from the middleware.
      await incrementUsage(userId, 'competitors_tracked', -1);
      return res.status(400).json({ success: false, error: 'channel_id is required' });
    }

    // Always source the public channel snapshot from YouTube. Trusting
    // subscriber/view counts from the request body let any client write
    // arbitrary numbers into tracked_competitors, which then flowed into
    // the AI's competitor comparisons and the user's UI.
    const channel = await fetchChannelById(channel_id);
    if (!channel) {
      await incrementUsage(userId, 'competitors_tracked', -1);
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const tracked = await saveTrackedCompetitor(userId, {
      channel_id: channel.channel_id,
      name: channel.name,
      handle: channel.handle,
      thumbnail: channel.thumbnail,
      subscribers: channel.subscribers,
      total_views: channel.total_views,
      total_videos: channel.total_videos,
    });
    saved = true;

    res.json({ success: true, data: tracked });
  } catch (error) {
    console.error('Error tracking competitor:', error);
    if (!saved) {
      // Roll back the atomic increment so the user keeps their slot.
      await incrementUsage(userId, 'competitors_tracked', -1).catch(() => {});
    }
    res.status(500).json({ success: false, error: 'Failed to track competitor' });
  }
}

// Get tracked competitors
export async function getTracked(req, res) {
  try {
    const userId = req.user.id;
    const competitors = await getTrackedCompetitors(userId);
    res.json({ success: true, competitors });
  } catch (error) {
    console.error('Error getting tracked competitors:', error);
    res.status(500).json({ success: false, error: 'Failed to get tracked competitors' });
  }
}

// Remove tracked competitor
export async function untrack(req, res) {
  try {
    const userId = req.user.id;
    const { channelId } = req.params;

    await removeTrackedCompetitor(userId, channelId);
    await incrementUsage(userId, 'competitors_tracked', -1);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing competitor:', error);
    res.status(500).json({ success: false, error: 'Failed to remove competitor' });
  }
}