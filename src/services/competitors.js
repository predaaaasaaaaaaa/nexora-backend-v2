import { google } from 'googleapis';
import { supabase } from './supabase.js';

// Create YouTube client with API key (no OAuth needed for public data)
function getYouTubeClient() {
  return google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY,
  });
}

// Parse ISO 8601 duration to seconds
function parseDuration(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return parseInt(match[1] || 0) * 3600 + parseInt(match[2] || 0) * 60 + parseInt(match[3] || 0);
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// ============================================================
// SEARCH — Find channels by keyword, URL, or handle
// ============================================================
export async function searchCompetitors(query, maxResults = 5) {
  const youtube = getYouTubeClient();

  // Check if query is a channel URL or handle
  const channelId = await resolveChannelId(youtube, query);
  if (channelId) {
    // Direct channel lookup
    const channel = await fetchChannelData(youtube, channelId);
    return channel ? [channel] : [];
  }

  // Keyword search for channels
  try {
    const searchResponse = await youtube.search.list({
      part: 'snippet',
      q: query,
      type: 'channel',
      maxResults: Math.min(maxResults, 10),
    });

    const channels = searchResponse.data.items || [];
    if (channels.length === 0) return [];

    // Get full stats for found channels
    const channelIds = channels.map(c => c.snippet.channelId);
    const statsResponse = await youtube.channels.list({
      part: 'snippet,statistics,brandingSettings',
      id: channelIds.join(','),
    });

    return (statsResponse.data.items || []).map(ch => ({
      channel_id: ch.id,
      name: ch.snippet.title,
      handle: ch.snippet.customUrl || '',
      description: ch.snippet.description?.substring(0, 300),
      thumbnail: ch.snippet.thumbnails?.medium?.url,
      subscribers: parseInt(ch.statistics.subscriberCount || 0),
      total_views: parseInt(ch.statistics.viewCount || 0),
      total_videos: parseInt(ch.statistics.videoCount || 0),
      country: ch.snippet.country || 'Unknown',
      keywords: ch.brandingSettings?.channel?.keywords || '',
    }));
  } catch (error) {
    console.error('Error searching competitors:', error.message);
    throw error;
  }
}

// Resolve a query to a channel ID (handles URLs, @handles, channel IDs)
async function resolveChannelId(youtube, query) {
  // Direct channel ID (starts with UC)
  if (query.startsWith('UC') && query.length === 24) return query;

  // YouTube URL patterns
  const urlPatterns = [
    /youtube\.com\/channel\/(UC[\w-]{22})/,
    /youtube\.com\/@([\w.-]+)/,
    /youtube\.com\/c\/([\w.-]+)/,
    /youtube\.com\/user\/([\w.-]+)/,
  ];

  for (const pattern of urlPatterns) {
    const match = query.match(pattern);
    if (match) {
      const identifier = match[1];
      // If it's already a channel ID
      if (identifier.startsWith('UC')) return identifier;
      // Otherwise resolve handle/username
      return await resolveHandle(youtube, identifier);
    }
  }

  // @handle format
  if (query.startsWith('@')) {
    return await resolveHandle(youtube, query);
  }

  return null; // Not a direct channel reference, use search
}

// Resolve a handle to channel ID
async function resolveHandle(youtube, handle) {
  try {
    const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
    const response = await youtube.channels.list({
      part: 'id',
      forHandle: cleanHandle.replace('@', ''),
    });
    return response.data.items?.[0]?.id || null;
  } catch {
    // Fallback: search for the handle
    try {
      const response = await youtube.search.list({
        part: 'snippet',
        q: handle,
        type: 'channel',
        maxResults: 1,
      });
      return response.data.items?.[0]?.snippet?.channelId || null;
    } catch {
      return null;
    }
  }
}

// Public wrapper — fetch a single channel's public stats by id, used by
// the track endpoint so we never trust subscriber/view counts from a client.
export async function fetchChannelById(channelId) {
  const youtube = getYouTubeClient();
  return fetchChannelData(youtube, channelId);
}

// Fetch basic channel data
async function fetchChannelData(youtube, channelId) {
  try {
    const response = await youtube.channels.list({
      part: 'snippet,statistics,brandingSettings,contentDetails',
      id: channelId,
    });
    const ch = response.data.items?.[0];
    if (!ch) return null;

    return {
      channel_id: ch.id,
      name: ch.snippet.title,
      handle: ch.snippet.customUrl || '',
      description: ch.snippet.description?.substring(0, 300),
      thumbnail: ch.snippet.thumbnails?.medium?.url,
      subscribers: parseInt(ch.statistics.subscriberCount || 0),
      total_views: parseInt(ch.statistics.viewCount || 0),
      total_videos: parseInt(ch.statistics.videoCount || 0),
      country: ch.snippet.country || 'Unknown',
      keywords: ch.brandingSettings?.channel?.keywords || '',
      uploads_playlist: ch.contentDetails?.relatedPlaylists?.uploads,
    };
  } catch (error) {
    console.error('Error fetching channel:', error.message);
    return null;
  }
}

// ============================================================
// DEEP ANALYSIS — Full competitor breakdown
// ============================================================
export async function analyzeCompetitor(channelId) {
  const youtube = getYouTubeClient();

  // Get channel info
  const channelResponse = await youtube.channels.list({
    part: 'snippet,statistics,contentDetails,brandingSettings',
    id: channelId,
  });

  const channel = channelResponse.data.items?.[0];
  if (!channel) throw new Error('Channel not found');

  // Get videos from uploads playlist
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
  const videosPage = await youtube.playlistItems.list({
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: 50,
  });

  const videoItems = videosPage.data.items || [];
  const videoIds = videoItems.map(v => v.contentDetails.videoId);

  // Get video stats + durations
  let videoStats = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const statsResponse = await youtube.videos.list({
      part: 'statistics,contentDetails',
      id: batch.join(','),
    });
    videoStats.push(...(statsResponse.data.items || []));
  }

  // Build video data
  const videos = videoItems.map(item => {
    const statsItem = videoStats.find(v => v.id === item.contentDetails.videoId);
    const stats = statsItem?.statistics || {};
    const durationSeconds = parseDuration(statsItem?.contentDetails?.duration || '');

    const views = parseInt(stats.viewCount || 0);
    const likes = parseInt(stats.likeCount || 0);
    const comments = parseInt(stats.commentCount || 0);
    const engagement = views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00';
    const isShort = durationSeconds > 0 && durationSeconds <= 60;

    return {
      video_id: item.contentDetails.videoId,
      title: item.snippet.title,
      published_at: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url,
      views,
      likes,
      comments,
      engagement_rate: parseFloat(engagement),
      duration_seconds: durationSeconds,
      duration_formatted: formatDuration(durationSeconds),
      is_short: isShort,
      type: isShort ? 'short' : 'video',
    };
  });

  // Separate content types
  const longVideos = videos.filter(v => !v.is_short);
  const shorts = videos.filter(v => v.is_short);

  // Calculate stats
  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likes, 0);
  const totalComments = videos.reduce((s, v) => s + v.comments, 0);
  const avgViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
  const avgEngagement = videos.length > 0
    ? parseFloat((videos.reduce((s, v) => s + v.engagement_rate, 0) / videos.length).toFixed(2))
    : 0;

  const longAvgViews = longVideos.length > 0 ? Math.round(longVideos.reduce((s, v) => s + v.views, 0) / longVideos.length) : 0;
  const shortAvgViews = shorts.length > 0 ? Math.round(shorts.reduce((s, v) => s + v.views, 0) / shorts.length) : 0;

  // Top performers
  const topByViews = [...videos].sort((a, b) => b.views - a.views).slice(0, 10);
  const topByEngagement = [...videos].sort((a, b) => b.engagement_rate - a.engagement_rate).slice(0, 5);

  // Posting frequency
  let avgPostingGapDays = 0;
  let postingConsistency = 'unknown';
  if (videos.length >= 3) {
    const dates = videos.map(v => new Date(v.published_at)).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24));
    }
    avgPostingGapDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const maxGap = Math.round(Math.max(...gaps));
    postingConsistency = maxGap > avgPostingGapDays * 3 ? 'inconsistent' : avgPostingGapDays <= 7 ? 'very_consistent' : 'moderate';
  }

  // Title analysis
  const avgTitleLength = videos.length > 0 ? Math.round(videos.reduce((s, v) => s + v.title.length, 0) / videos.length) : 0;
  const hasEmojis = videos.filter(v => /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(v.title)).length;
  const emojiUsagePercent = videos.length > 0 ? Math.round((hasEmojis / videos.length) * 100) : 0;

  // Content themes (from top video titles)
  const topTitles = topByViews.slice(0, 10).map(v => v.title).join(' | ');

  // Upload schedule analysis
  const uploadDays = {};
  const uploadHours = {};
  videos.forEach(v => {
    const date = new Date(v.published_at);
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()];
    const hour = date.getUTCHours();
    uploadDays[day] = (uploadDays[day] || 0) + 1;
    uploadHours[hour] = (uploadHours[hour] || 0) + 1;
  });

  const bestUploadDay = Object.entries(uploadDays).sort((a, b) => b[1] - a[1])[0];
  const bestUploadHour = Object.entries(uploadHours).sort((a, b) => b[1] - a[1])[0];

  return {
    channel: {
      channel_id: channel.id,
      name: channel.snippet.title,
      handle: channel.snippet.customUrl || '',
      description: channel.snippet.description?.substring(0, 500),
      thumbnail: channel.snippet.thumbnails?.medium?.url,
      banner: channel.brandingSettings?.image?.bannerExternalUrl,
      subscribers: parseInt(channel.statistics.subscriberCount || 0),
      total_views: parseInt(channel.statistics.viewCount || 0),
      total_videos: parseInt(channel.statistics.videoCount || 0),
      country: channel.snippet.country || 'Unknown',
      created_at: channel.snippet.publishedAt,
      keywords: channel.brandingSettings?.channel?.keywords || '',
    },
    content: {
      total_analyzed: videos.length,
      long_videos: longVideos.length,
      shorts: shorts.length,
      videos: videos,
      topByViews: topByViews,
      topByEngagement: topByEngagement,
    },
    performance: {
      avgViews,
      avgEngagement,
      totalViews,
      totalLikes,
      totalComments,
      longVideoAvgViews: longAvgViews,
      shortAvgViews: shortAvgViews,
      viewsPerSubscriber: parseInt(channel.statistics.subscriberCount) > 0
        ? parseFloat((avgViews / parseInt(channel.statistics.subscriberCount) * 100).toFixed(1))
        : 0,
    },
    strategy: {
      postingFrequency: avgPostingGapDays > 0 ? `Every ${avgPostingGapDays} days` : 'Unknown',
      postingConsistency,
      avgPostingGapDays,
      bestUploadDay: bestUploadDay ? `${bestUploadDay[0]} (${bestUploadDay[1]} uploads)` : 'Unknown',
      bestUploadHour: bestUploadHour ? `${bestUploadHour[0]}:00 UTC (${bestUploadHour[1]} uploads)` : 'Unknown',
      avgTitleLength,
      emojiUsagePercent: `${emojiUsagePercent}%`,
      contentMix: longVideos.length > 0 && shorts.length > 0
        ? `${longVideos.length} long + ${shorts.length} Shorts`
        : longVideos.length > 0 ? `${longVideos.length} long videos only` : `${shorts.length} Shorts only`,
      topContentThemes: topTitles,
    },
  };
}

// ============================================================
// COMPARE — Side by side with user's channel
// ============================================================
export async function compareWithUser(userId, competitorChannelId) {
  const { getYouTubeAnalytics } = await import('./youtube.js');

  // Get user's data
  const userData = await getYouTubeAnalytics(userId);
  if (!userData) throw new Error('Connect your YouTube channel first');

  // Get competitor data
  const competitorData = await analyzeCompetitor(competitorChannelId);

  // Build comparison
  const comparison = {
    user: {
      name: userData.channel_name,
      subscribers: userData.subscribers,
      total_views: userData.total_views,
      total_videos: userData.total_videos,
      avgViews: userData.insights.avgViews,
      avgEngagement: parseFloat(userData.insights.avgEngagementRate),
      longVideos: userData.longVideos?.length || 0,
      shorts: userData.shorts?.length || 0,
    },
    competitor: {
      name: competitorData.channel.name,
      subscribers: competitorData.channel.subscribers,
      total_views: competitorData.channel.total_views,
      total_videos: competitorData.channel.total_videos,
      avgViews: competitorData.performance.avgViews,
      avgEngagement: competitorData.performance.avgEngagement,
      longVideos: competitorData.content.long_videos,
      shorts: competitorData.content.shorts,
    },
    gaps: [],
    opportunities: [],
  };

  // Identify gaps and opportunities
  const c = comparison.competitor;
  const u = comparison.user;

  // Posting frequency gap
  if (competitorData.strategy.avgPostingGapDays > 0 && userData.insights?.patterns) {
    if (competitorData.strategy.avgPostingGapDays < 7) {
      comparison.gaps.push(`${c.name} posts every ${competitorData.strategy.avgPostingGapDays} days — much more frequently than your channel.`);
    }
  }

  // Engagement gap
  if (c.avgEngagement > u.avgEngagement * 1.5) {
    comparison.gaps.push(`${c.name} has ${c.avgEngagement}% avg engagement vs your ${u.avgEngagement}% — study their hooks and CTAs.`);
  } else if (u.avgEngagement > c.avgEngagement * 1.5) {
    comparison.opportunities.push(`Your engagement (${u.avgEngagement}%) is significantly higher than ${c.name} (${c.avgEngagement}%) — your audience is more loyal. Focus on reach.`);
  }

  // Views per video gap
  if (c.avgViews > u.avgViews * 2) {
    comparison.gaps.push(`${c.name} averages ${c.avgViews.toLocaleString()} views/video vs your ${u.avgViews.toLocaleString()} — analyze their titles and thumbnails.`);
  }

  // Shorts strategy
  if (c.shorts > 5 && u.shorts <= 1) {
    comparison.opportunities.push(`${c.name} uses Shorts actively (${c.shorts} Shorts). You have almost none — this is a growth opportunity.`);
  }

  // Subscriber advantage
  if (u.avgEngagement > c.avgEngagement && c.subscribers > u.subscribers * 5) {
    comparison.opportunities.push(`Despite ${c.name} having ${c.subscribers.toLocaleString()} subs, your engagement rate is higher. Your content resonates — you need more distribution.`);
  }

  // Content volume
  if (c.total_videos > u.total_videos * 3) {
    comparison.gaps.push(`${c.name} has ${c.total_videos} videos vs your ${u.total_videos}. Volume matters for algorithm discovery.`);
  }

  return {
    comparison,
    competitorFull: competitorData,
    userChannel: userData.channel_name,
  };
}

// ============================================================
// SAVE/LOAD — Persist tracked competitors per user
// ============================================================
export async function saveTrackedCompetitor(userId, competitorData) {
  try {
    const { data, error } = await supabase
      .from('tracked_competitors')
      .upsert({
        user_id: userId,
        channel_id: competitorData.channel_id,
        channel_name: competitorData.name,
        channel_handle: competitorData.handle,
        channel_thumbnail: competitorData.thumbnail,
        subscribers: competitorData.subscribers,
        total_views: competitorData.total_views,
        total_videos: competitorData.total_videos,
        last_analyzed: new Date().toISOString(),
      }, { onConflict: 'user_id,channel_id' })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving tracked competitor:', error);
    throw error;
  }
}

export async function getTrackedCompetitors(userId) {
  try {
    const { data, error } = await supabase
      .from('tracked_competitors')
      .select('*')
      .eq('user_id', userId)
      .order('last_analyzed', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting tracked competitors:', error);
    return [];
  }
}

export async function removeTrackedCompetitor(userId, channelId) {
  try {
    const { error } = await supabase
      .from('tracked_competitors')
      .delete()
      .eq('user_id', userId)
      .eq('channel_id', channelId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error removing tracked competitor:', error);
    throw error;
  }
}

// ============================================================
// FORMAT FOR AI — Compact competitor data for AI context
// ============================================================
export function formatCompetitorForAI(data) {
  const ch = data.channel;
  const perf = data.performance;
  const strat = data.strategy;
  const top = data.content.topByViews;

  const lines = [
    `[Competitor: "${ch.name}" (@${ch.handle})] Subs: ${ch.subscribers.toLocaleString()} | Total views: ${ch.total_views.toLocaleString()} | Videos: ${ch.total_videos}`,
    `Performance: Avg ${perf.avgViews.toLocaleString()} views/video | ${perf.avgEngagement}% engagement | ${perf.viewsPerSubscriber}% views/sub ratio`,
    `Strategy: Posts ${strat.postingFrequency} (${strat.postingConsistency}) | Best day: ${strat.bestUploadDay} | Content: ${strat.contentMix}`,
    `Titles: Avg ${strat.avgTitleLength} chars | Emoji usage: ${strat.emojiUsagePercent}`,
  ];

  if (top.length > 0) {
    const topStr = top.slice(0, 5).map((v, i) => `${i + 1}. "${v.title}" (${v.views.toLocaleString()} views, ${v.engagement_rate}% eng, ${v.type})`).join('\n');
    lines.push(`Top videos:\n${topStr}`);
  }

  return lines.join('\n');
}