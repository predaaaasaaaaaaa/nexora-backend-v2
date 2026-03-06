import { searchCompetitors, analyzeCompetitor, compareWithUser, saveTrackedCompetitor, getTrackedCompetitors, removeTrackedCompetitor } from '../services/competitors.js';

// Search for competitor channels
export async function search(req, res) {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ success: false, error: 'Search query is required' });

    const results = await searchCompetitors(query, 5);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error searching competitors:', error);
    res.status(500).json({ success: false, error: 'Failed to search competitors' });
  }
}

// Deep analyze a specific channel
export async function analyze(req, res) {
  try {
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ success: false, error: 'Channel ID is required' });

    const analysis = await analyzeCompetitor(channelId);
    res.json({ success: true, data: analysis });
  } catch (error) {
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

    const comparison = await compareWithUser(userId, channelId);
    res.json({ success: true, data: comparison });
  } catch (error) {
    console.error('Error comparing channels:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to compare channels' });
  }
}

// Track a competitor
export async function track(req, res) {
  try {
    const userId = req.user.id;
    const { channel_id, name, handle, thumbnail, subscribers, total_views, total_videos } = req.body;

    if (!channel_id || !name) return res.status(400).json({ success: false, error: 'Channel data is required' });

    const tracked = await saveTrackedCompetitor(userId, {
      channel_id, name, handle, thumbnail, subscribers, total_views, total_videos,
    });

    res.json({ success: true, data: tracked });
  } catch (error) {
    console.error('Error tracking competitor:', error);
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
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing competitor:', error);
    res.status(500).json({ success: false, error: 'Failed to remove competitor' });
  }
}