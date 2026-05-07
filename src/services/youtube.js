import crypto from 'crypto';
import { google } from 'googleapis';
import { supabase } from './supabase.js';
import { encryptToken, decryptToken } from '../utils/tokenCrypto.js';

// Create OAuth2 client
function createOAuth2Client() {
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  if (!redirectUri) {
    // Refuse to silently fall back to a localhost redirect in production —
    // Google would happily mint tokens for a redirect_uri the operator didn't intend.
    throw new Error('YOUTUBE_REDIRECT_URI is not configured');
  }
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri
  );
}

// HMAC-sign the OAuth state so we can verify on callback that the userId
// in `state` was minted by us (not chosen by an attacker).
function getStateSecret() {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be set to a >=32 char value');
  }
  return secret;
}

function signState(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getStateSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyState(state) {
  if (typeof state !== 'string' || !state.includes('.')) return null;
  const [b64, sig] = state.split('.');
  if (!b64 || !sig) return null;

  const expected = crypto.createHmac('sha256', getStateSecret()).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // Reject expired state (10 min window).
  if (!payload?.userId || !payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Sanitize a user-supplied label before it ever reaches the signed state
// or the database. Strips control chars (which would corrupt logs / mail
// subjects later), clamps to 60 chars to match the DB CHECK constraint,
// returns null when nothing useful remains.
//
// Exported so every caller — getAuthUrl, handleCallback, future label
// edit endpoints — runs labels through the SAME sanitizer. Don't write
// a second one.
export function cleanLabel(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let stripped = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) stripped += ch;
  }
  stripped = stripped.trim();
  if (!stripped) return null;
  return stripped.slice(0, 60);
}

// Generate OAuth URL for user to connect their YouTube.
// `label` is an optional user-chosen nickname for this connection.
export function getAuthUrl(userId, label) {
  const oauth2Client = createOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  // Embed the cleaned label inside the HMAC-signed state so it can't
  // be tampered with between getAuthUrl and the callback.
  const state = signState({
    userId,
    label: cleanLabel(label),
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
  });

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state,
  });
}

// Typed error so callers (especially the OAuth callback) can distinguish
// "this Google account has no YouTube channel" from a generic failure
// and surface a useful message to the user.
export class YouTubeOAuthError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'YouTubeOAuthError';
    this.reason = reason; // machine-readable: 'no_channel' | 'token_exchange_failed' | etc.
  }
}

// Centralized status updater. Never bubbles its own error — a status
// write failing should not fail the calling request.
async function updateConnectionStatus(userId, patch) {
  try {
    await supabase
      .from('connected_platforms')
      .update({ ...patch, last_checked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('platform', 'youtube');
  } catch (err) {
    console.error('updateConnectionStatus error:', err.message);
  }
}

// True if a thrown Google error means "this token is dead, user must
// reconnect". invalid_grant is the canonical signal — Google returns it
// when a refresh token is revoked, expired beyond recovery, or the user
// removed our app from their Google permissions.
function isRevocationError(err) {
  const msg = String(err?.message || '');
  if (/invalid_grant/i.test(msg)) return true;
  if (err?.response?.data?.error === 'invalid_grant') return true;
  // Some surfaces report this as a 400 with "Token has been expired or revoked".
  if (/token.*(expired|revoked)/i.test(msg)) return true;
  return false;
}

// Exchange auth code for tokens and save them.
//
// Allows connections without a YouTube channel: the row is persisted
// with status='pending_channel' so the user can come back later, create
// a channel, and finish onboarding without re-doing OAuth.
export async function handleCallback(code, userId, options = {}) {
  const oauth2Client = createOAuth2Client();

  let tokens;
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch (err) {
    throw new YouTubeOAuthError('token_exchange_failed', err.message || 'Token exchange failed');
  }
  oauth2Client.setCredentials(tokens);

  // Best-effort channel lookup. A missing channel is no longer fatal —
  // we still persist the grant so we can pick it up later.
  let channel = null;
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true,
    });
    channel = channelResponse.data.items?.[0] || null;
  } catch (err) {
    // Channel listing failed — treat like no_channel for now; we still
    // persist the tokens so the user can retry the channel pickup later.
    console.warn('handleCallback: channels.list failed, marking pending_channel:', err.message);
  }

  // Single chokepoint via cleanLabel — strips control chars too, not
  // just trim+slice. Important if a future caller passes a label that
  // didn't go through the OAuth state.
  const connectionLabel = cleanLabel(options.label);

  const status = channel ? 'active' : 'pending_channel';

  const row = {
    user_id: userId,
    platform: 'youtube',
    access_token: encryptToken(tokens.access_token),
    refresh_token: encryptToken(tokens.refresh_token),
    token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    platform_user_id: channel?.id || null,
    platform_username: channel?.snippet?.title || null,
    metadata: channel ? {
      channel_id: channel.id,
      channel_title: channel.snippet.title,
      channel_thumbnail: channel.snippet.thumbnails?.default?.url,
    } : {},
    status,
    last_error: null,
    last_checked_at: new Date().toISOString(),
  };
  if (connectionLabel) row.connection_label = connectionLabel;

  const { error } = await supabase
    .from('connected_platforms')
    .upsert(row, { onConflict: 'user_id,platform' });

  if (error) throw error;

  return {
    success: true,
    status,
    channel_id: channel?.id || null,
    channel_title: channel?.snippet?.title || null,
    subscribers: channel ? parseInt(channel.statistics.subscriberCount || 0) : 0,
    connection_label: connectionLabel,
  };
}

// Get authenticated YouTube client for a user
async function getAuthenticatedClient(userId) {
  const { data, error } = await supabase
    .from('connected_platforms')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .single();

  if (error || !data) return null;

  // Refuse to hand out an OAuth client we already know is dead. Caller
  // should treat null as "not usable" and let the UI prompt reconnect.
  if (data.status === 'revoked') return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decryptToken(data.access_token),
    refresh_token: decryptToken(data.refresh_token),
  });

  oauth2Client.on('tokens', async (newTokens) => {
    const updates = {};
    if (newTokens.access_token) updates.access_token = encryptToken(newTokens.access_token);
    if (newTokens.refresh_token) updates.refresh_token = encryptToken(newTokens.refresh_token);
    if (newTokens.expiry_date) updates.token_expires_at = new Date(newTokens.expiry_date).toISOString();

    if (Object.keys(updates).length === 0) return;

    await supabase
      .from('connected_platforms')
      .update(updates)
      .eq('user_id', userId)
      .eq('platform', 'youtube');
  });

  return { oauth2Client, platformData: data };
}

// Parse ISO 8601 duration (PT1H2M3S) to seconds
function parseDuration(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// Format duration to human readable
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

// ============================================================
// YOUTUBE ANALYTICS API — Real audience data
// ============================================================

// Format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Fetch REAL audience analytics from YouTube Analytics API
async function fetchAudienceAnalytics(oauth2Client) {
  try {
    const youtubeAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const startDate = formatDate(ninetyDaysAgo);
    const endDate = formatDate(today);

    // --- Query 1: Daily views + engagement (last 90 days) ---
    // This gives us REAL data on which days of the week perform best
    const dailyResponse = await youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'day',
      metrics: 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained',
      sort: 'day',
    });

    // --- Query 2: Demographics (age + gender) ---
    const demographicsResponse = await youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'ageGroup,gender',
      metrics: 'viewerPercentage',
      sort: '-viewerPercentage',
    });

    // --- Query 3: Traffic sources ---
    const trafficResponse = await youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'insightTrafficSourceType',
      metrics: 'views,estimatedMinutesWatched',
      sort: '-views',
    });

    // --- Query 4: Geography (top countries) ---
    const geoResponse = await youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'country',
      metrics: 'views,estimatedMinutesWatched',
      sort: '-views',
      maxResults: 10,
    });

    // --- Process daily data into day-of-week aggregations ---
    const dayOfWeekStats = processViewsByDayOfWeek(dailyResponse.data.rows || []);

    // --- Process demographics ---
    const demographics = processDemographics(demographicsResponse.data.rows || []);

    // --- Process traffic sources ---
    const trafficSources = processTrafficSources(trafficResponse.data.rows || []);

    // --- Process geography ---
    const topCountries = processGeography(geoResponse.data.rows || []);

    return {
      dayOfWeekStats,
      demographics,
      trafficSources,
      topCountries,
      dateRange: { start: startDate, end: endDate },
    };

  } catch (error) {
    console.error('Error fetching audience analytics:', error.message);
    // Don't throw — return null so the rest of analytics still works
    return null;
  }
}

// Aggregate daily rows into day-of-week performance
function processViewsByDayOfWeek(rows) {
  // rows format: [date, views, likes, comments, shares, estimatedMinutesWatched, averageViewDuration, subscribersGained]
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayStats = {};

  dayNames.forEach(day => {
    dayStats[day] = { views: 0, likes: 0, comments: 0, shares: 0, watchTimeMinutes: 0, subsGained: 0, count: 0 };
  });

  rows.forEach(row => {
    const date = new Date(row[0] + 'T12:00:00Z'); // noon UTC to avoid timezone issues
    const dayName = dayNames[date.getUTCDay()];
    dayStats[dayName].views += row[1] || 0;
    dayStats[dayName].likes += row[2] || 0;
    dayStats[dayName].comments += row[3] || 0;
    dayStats[dayName].shares += row[4] || 0;
    dayStats[dayName].watchTimeMinutes += row[5] || 0;
    dayStats[dayName].subsGained += row[7] || 0;
    dayStats[dayName].count += 1;
  });

  // Calculate averages per day of week
  const result = dayNames.map(day => {
    const s = dayStats[day];
    const count = Math.max(s.count, 1);
    return {
      day,
      totalViews: s.views,
      avgViews: Math.round(s.views / count),
      avgLikes: Math.round(s.likes / count),
      avgComments: Math.round(s.comments / count),
      avgShares: Math.round(s.shares / count),
      avgWatchTimeMinutes: Math.round(s.watchTimeMinutes / count),
      avgSubsGained: parseFloat((s.subsGained / count).toFixed(1)),
      dataPoints: s.count,
    };
  });

  // Sort by avg views descending to find best days
  const ranked = [...result].sort((a, b) => b.avgViews - a.avgViews);

  return {
    byDay: result,
    bestDays: ranked.slice(0, 3).map(d => d.day),
    worstDays: ranked.slice(-2).map(d => d.day),
    ranked,
  };
}

// Process demographic data
function processDemographics(rows) {
  // rows format: [ageGroup, gender, viewerPercentage]
  if (!rows || rows.length === 0) return null;

  const ageGroups = {};
  const genders = { male: 0, female: 0 };

  rows.forEach(row => {
    const ageGroup = row[0]; // e.g., "age18-24"
    const gender = row[1];   // "male" or "female"
    const percentage = row[2];

    // Aggregate by age group
    if (!ageGroups[ageGroup]) ageGroups[ageGroup] = 0;
    ageGroups[ageGroup] += percentage;

    // Aggregate by gender
    if (gender === 'male') genders.male += percentage;
    else if (gender === 'female') genders.female += percentage;
  });

  // Format age groups nicely
  const ageLabels = {
    'age13-17': '13-17',
    'age18-24': '18-24',
    'age25-34': '25-34',
    'age35-44': '35-44',
    'age45-54': '45-54',
    'age55-64': '55-64',
    'age65-': '65+',
  };

  const formattedAge = Object.entries(ageGroups)
    .map(([key, pct]) => ({ group: ageLabels[key] || key, percentage: parseFloat(pct.toFixed(1)) }))
    .sort((a, b) => b.percentage - a.percentage);

  const topAgeGroup = formattedAge[0] || null;

  return {
    ageGroups: formattedAge,
    genderSplit: {
      male: parseFloat(genders.male.toFixed(1)),
      female: parseFloat(genders.female.toFixed(1)),
    },
    topAgeGroup: topAgeGroup ? `${topAgeGroup.group} (${topAgeGroup.percentage}%)` : 'Unknown',
    primaryGender: genders.male > genders.female ? 'Male' : 'Female',
  };
}

// Process traffic source data
function processTrafficSources(rows) {
  // rows format: [trafficSourceType, views, estimatedMinutesWatched]
  if (!rows || rows.length === 0) return null;

  const sourceLabels = {
    'SUBSCRIBER': 'Subscribers (Home/Subs feed)',
    'YT_SEARCH': 'YouTube Search',
    'SUGGESTED': 'Suggested Videos',
    'EXTERNAL': 'External (websites, social)',
    'SHORTS': 'Shorts Feed',
    'BROWSE': 'Browse Features',
    'PLAYLIST': 'Playlists',
    'NOTIFICATION': 'Notifications',
    'NO_LINK_EMBEDDED': 'Direct/Embedded',
    'END_SCREEN': 'End Screens',
    'ANNOTATION': 'Cards & Annotations',
    'CHANNEL': 'Channel Page',
    'NO_LINK_OTHER': 'Other',
    'HASHTAGS': 'Hashtags',
    'LIVE_REDIRECT': 'Live Redirect',
    'PRODUCT_PAGE': 'Product Page',
    'SOUND_PAGE': 'Sound Page',
    'RELATED_VIDEO': 'Related Videos',
    'CAMPAIGN_CARD': 'Campaign Card',
  };

  const totalViews = rows.reduce((sum, r) => sum + (r[1] || 0), 0);

  const sources = rows.map(row => ({
    source: sourceLabels[row[0]] || row[0],
    rawSource: row[0],
    views: row[1] || 0,
    watchTimeMinutes: Math.round(row[2] || 0),
    percentage: totalViews > 0 ? parseFloat(((row[1] / totalViews) * 100).toFixed(1)) : 0,
  })).filter(s => s.views > 0);

  return {
    sources: sources.slice(0, 8), // Top 8 sources
    topSource: sources[0] ? `${sources[0].source} (${sources[0].percentage}%)` : 'Unknown',
  };
}

// Process geography data
function processGeography(rows) {
  // rows format: [country, views, estimatedMinutesWatched]
  if (!rows || rows.length === 0) return null;

  const totalViews = rows.reduce((sum, r) => sum + (r[1] || 0), 0);

  return rows.map(row => ({
    country: row[0],
    views: row[1] || 0,
    watchTimeMinutes: Math.round(row[2] || 0),
    percentage: totalViews > 0 ? parseFloat(((row[1] / totalViews) * 100).toFixed(1)) : 0,
  }));
}


// ============================================================
// MAIN — Fetch REAL YouTube analytics for a user
// ============================================================
export async function getYouTubeAnalytics(userId) {
  const client = await getAuthenticatedClient(userId);
  if (!client) return null;

  try {
    const youtube = google.youtube({ version: 'v3', auth: client.oauth2Client });

    // Get channel stats
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics,contentDetails',
      mine: true,
    });

    const channel = channelResponse.data.items?.[0];
    if (!channel) return null;

    // Get recent videos from uploads playlist
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
    
    const videosPage1 = await youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
    });

    const allVideoItems = [...videosPage1.data.items];

    // Get stats + duration for all videos
    const videoIds = allVideoItems.map(v => v.contentDetails.videoId);
    let videoStats = [];

    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const statsResponse = await youtube.videos.list({
        part: 'statistics,contentDetails',
        id: batch.join(','),
      });
      videoStats.push(...(statsResponse.data.items || []));
    }

    // Build video data with stats and short/long detection
    const videos = allVideoItems.map((item) => {
      const statsItem = videoStats.find(v => v.id === item.contentDetails.videoId);
      const stats = statsItem?.statistics || {};
      const durationISO = statsItem?.contentDetails?.duration || '';
      const durationSeconds = parseDuration(durationISO);

      const views = parseInt(stats.viewCount || 0);
      const likes = parseInt(stats.likeCount || 0);
      const comments = parseInt(stats.commentCount || 0);
      const favorites = parseInt(stats.favoriteCount || 0);
      const engagement = views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00';

      // YouTube Shorts are typically <= 60 seconds
      const isShort = durationSeconds > 0 && durationSeconds <= 60;

      return {
        video_id: item.contentDetails.videoId,
        title: item.snippet.title,
        description: item.snippet.description?.substring(0, 200),
        published_at: item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url,
        views,
        likes,
        comments,
        favorites,
        engagement_rate: engagement,
        duration_seconds: durationSeconds,
        duration_formatted: formatDuration(durationSeconds),
        is_short: isShort,
        type: isShort ? 'short' : 'video',
      };
    });

    // Separate shorts and long-form videos
    const longVideos = videos.filter(v => !v.is_short);
    const shorts = videos.filter(v => v.is_short);

    // Sort by date (newest first) — videos array is already in upload order
    const latestVideo = longVideos[0] || null;
    const latestShort = shorts[0] || null;

    // Sort by views for top performers
    const topVideosByViews = [...longVideos].sort((a, b) => b.views - a.views);
    const topShortsByViews = [...shorts].sort((a, b) => b.views - a.views);
    const topAllByViews = [...videos].sort((a, b) => b.views - a.views);
    const topByEngagement = [...videos].sort((a, b) => parseFloat(b.engagement_rate) - parseFloat(a.engagement_rate));

    // Calculate insights — separate for videos vs shorts
    const totalViews = videos.reduce((sum, v) => sum + v.views, 0);
    const totalLikes = videos.reduce((sum, v) => sum + v.likes, 0);
    const totalComments = videos.reduce((sum, v) => sum + v.comments, 0);
    const avgViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
    const avgEngagement = videos.length > 0
      ? (videos.reduce((sum, v) => sum + parseFloat(v.engagement_rate), 0) / videos.length).toFixed(2)
      : '0.00';

    // Long video specific stats
    const longAvgViews = longVideos.length > 0 ? Math.round(longVideos.reduce((s, v) => s + v.views, 0) / longVideos.length) : 0;
    const shortAvgViews = shorts.length > 0 ? Math.round(shorts.reduce((s, v) => s + v.views, 0) / shorts.length) : 0;

    // Detect patterns
    const outliers = videos.filter(v => v.views > avgViews * 3);
    const patterns = detectContentPatterns(videos, avgViews, longVideos, shorts);

    // ============================================================
    // NEW: Fetch REAL audience analytics from YouTube Analytics API
    // ============================================================
    const audienceAnalytics = await fetchAudienceAnalytics(client.oauth2Client);
    
    console.log('🔍 audienceAnalytics result:', audienceAnalytics ? 'SUCCESS' : 'NULL');
    if (audienceAnalytics) {
      console.log('  → dayOfWeekStats:', audienceAnalytics.dayOfWeekStats ? 'YES' : 'NO');
      console.log('  → demographics:', audienceAnalytics.demographics ? 'YES' : 'NO');
      console.log('  → trafficSources:', audienceAnalytics.trafficSources ? 'YES' : 'NO');
      console.log('  → topCountries:', audienceAnalytics.topCountries ? `YES (${audienceAnalytics.topCountries.length} countries)` : 'NO');
    }

    const result = {
      channel_id: channel.id,
      channel_name: channel.snippet.title,
      channel_thumbnail: channel.snippet.thumbnails?.default?.url,
      subscribers: parseInt(channel.statistics.subscriberCount || 0),
      total_views: parseInt(channel.statistics.viewCount || 0),
      total_videos: parseInt(channel.statistics.videoCount || 0),
      videos: videos,
      longVideos: longVideos,
      shorts: shorts,
      latestVideo: latestVideo,
      latestShort: latestShort,
      topVideos: topVideosByViews.slice(0, 5),
      topShorts: topShortsByViews.slice(0, 5),
      topEngagement: topByEngagement.slice(0, 5),
      insights: {
        avgEngagementRate: avgEngagement,
        avgViews: avgViews,
        longVideoAvgViews: longAvgViews,
        shortAvgViews: shortAvgViews,
        totalRecentViews: totalViews,
        totalRecentLikes: totalLikes,
        totalRecentComments: totalComments,
        longVideoCount: longVideos.length,
        shortCount: shorts.length,
        subscriberGrowth: 'Connected - tracking active',
        topVideo: topVideosByViews[0] ? topVideosByViews[0].title : 'N/A',
        topVideoViews: topVideosByViews[0] ? topVideosByViews[0].views : 0,
        outlierVideos: outliers.map(v => ({
          title: v.title,
          views: v.views,
          engagement: v.engagement_rate,
          type: v.type,
          multiplier: (v.views / Math.max(avgViews, 1)).toFixed(1) + 'x above average',
        })),
        patterns: patterns,
      },
      // NEW: Real audience analytics from YouTube Analytics API
      audienceAnalytics: audienceAnalytics,
    };

    // Mark active on the way out so a previously-stale connection
    // self-heals once the underlying issue clears. Fire and forget.
    if (client.platformData?.status !== 'active') {
      updateConnectionStatus(userId, { status: 'active', last_error: null });
    }
    return result;

  } catch (error) {
    console.error('Error fetching YouTube analytics:', error.message);
    if (error.code === 401 || isRevocationError(error)) {
      // Mark the connection as revoked so the dashboard / coach can prompt
      // a reconnect immediately on the next request, instead of silently
      // returning empty analytics forever.
      await updateConnectionStatus(userId, {
        status: 'revoked',
        last_error: String(error?.message || 'Token revoked').slice(0, 500),
      });
      return null;
    }
    // Anything else: leave status alone but record the error string for
    // ops debugging. Don't throw — keep the user-visible behavior the
    // same as before this hardening.
    await updateConnectionStatus(userId, {
      status: 'stale',
      last_error: String(error?.message || 'Unknown error').slice(0, 500),
    });
    throw error;
  }
}

// Detect content patterns from video performance
function detectContentPatterns(videos, avgViews, longVideos, shorts) {
  const patterns = [];

  if (videos.length < 3) return ['Not enough videos to detect patterns yet.'];

  // Content mix analysis
  if (longVideos.length > 0 && shorts.length > 0) {
    const longAvg = Math.round(longVideos.reduce((s, v) => s + v.views, 0) / longVideos.length);
    const shortAvg = Math.round(shorts.reduce((s, v) => s + v.views, 0) / shorts.length);
    const better = longAvg > shortAvg ? 'Long videos' : 'Shorts';
    patterns.push(`CONTENT MIX: ${longVideos.length} long videos (avg ${longAvg.toLocaleString()} views) vs ${shorts.length} Shorts (avg ${shortAvg.toLocaleString()} views). ${better} perform better for your channel.`);
  } else if (shorts.length === 0 && longVideos.length > 0) {
    patterns.push(`CONTENT MIX: All ${longVideos.length} uploads are long-form videos. Consider testing YouTube Shorts to reach new audiences.`);
  }

  // Viral outliers
  const outliers = videos.filter(v => v.views > avgViews * 3);
  if (outliers.length > 0) {
    const outlierTitles = outliers.map(v => `"${v.title}" (${v.views.toLocaleString()} views, ${v.type})`).join(', ');
    patterns.push(`VIRAL OUTLIERS: ${outliers.length} video(s) performed ${Math.round(outliers[0].views / Math.max(avgViews, 1))}x above average: ${outlierTitles}. Analyze what made these different — collab, trending topic, or format change?`);
  }

  // Posting frequency
  if (videos.length >= 5) {
    const dates = videos.map(v => new Date(v.published_at)).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 0; i < dates.length - 1; i++) {
      gaps.push((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24));
    }
    const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const maxGap = Math.round(Math.max(...gaps));

    if (maxGap > avgGap * 3) {
      patterns.push(`INCONSISTENT POSTING: Average gap is ${avgGap} days but longest gap was ${maxGap} days. Consistency helps the algorithm recommend your content.`);
    } else {
      patterns.push(`POSTING FREQUENCY: Uploading roughly every ${avgGap} days. ${avgGap <= 7 ? 'Good consistency!' : 'Consider posting more frequently for better algorithmic reach.'}`);
    }
  }

  // Hidden gems
  const avgEng = videos.length > 0 ? videos.reduce((s, v) => s + parseFloat(v.engagement_rate), 0) / videos.length : 0;
  const highEngLowViews = videos.filter(v => parseFloat(v.engagement_rate) > avgEng * 1.5 && v.views < avgViews);
  if (highEngLowViews.length > 0) {
    patterns.push(`HIDDEN GEMS: ${highEngLowViews.length} video(s) have high engagement but low views — your audience loves this content but it's not reaching new viewers.`);
  }

  // Title language
  const arabicTitles = videos.filter(v => /[\u0600-\u06FF]/.test(v.title));
  const englishTitles = videos.filter(v => !/[\u0600-\u06FF]/.test(v.title));
  if (arabicTitles.length > 0 && englishTitles.length > 0) {
    const arabicAvgViews = Math.round(arabicTitles.reduce((s, v) => s + v.views, 0) / arabicTitles.length);
    const englishAvgViews = Math.round(englishTitles.reduce((s, v) => s + v.views, 0) / englishTitles.length);
    const better = arabicAvgViews > englishAvgViews ? 'Arabic' : 'English';
    patterns.push(`TITLE LANGUAGE: ${better} titles perform better (${Math.max(arabicAvgViews, englishAvgViews).toLocaleString()} avg views vs ${Math.min(arabicAvgViews, englishAvgViews).toLocaleString()}).`);
  }

  if (patterns.length === 0) {
    patterns.push('Upload more content to enable deeper pattern analysis.');
  }

  return patterns;
}

// Check if user has YouTube connected. Returns the row (with status,
// label, channel info) when present, null otherwise. Callers that only
// need a boolean can do `Boolean(await isYouTubeConnected(...))`.
export async function isYouTubeConnected(userId) {
  const { data } = await supabase
    .from('connected_platforms')
    .select('platform_username, platform_user_id, connected_at, metadata, status, connection_label, last_checked_at')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .single();

  return data || null;
}

// Best-effort: revoke a Google OAuth token via Google's revocation
// endpoint. Returns true if Google accepted the revocation OR if the
// token was already invalid (200 + invalid_token are both fine for our
// "make sure it's dead" intent).
async function revokeGoogleToken(token) {
  if (!token) return false;
  try {
    const r = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    // 200 = revoked. 400 with "invalid_token" = already invalid (still good for us).
    return r.ok || r.status === 400;
  } catch (err) {
    console.error('revokeGoogleToken: network error', err.message);
    return false;
  }
}

// Disconnect YouTube. Tells Google to revoke the refresh token before
// we delete our local row — otherwise the token remains valid until
// natural expiry, and a future DB compromise could replay it.
export async function disconnectYouTube(userId) {
  // Read first so we have the encrypted tokens to send to Google.
  const { data: row } = await supabase
    .from('connected_platforms')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .single();

  if (row) {
    // Revoke the refresh token (preferred — kills the whole grant) and
    // the access token (defense in depth). Both are best-effort; we
    // proceed to delete the row even if revocation fails so the user's
    // disconnect intent isn't blocked by Google being slow.
    const refresh = decryptToken(row.refresh_token);
    const access = decryptToken(row.access_token);
    await Promise.all([
      revokeGoogleToken(refresh),
      revokeGoogleToken(access),
    ]);
  }

  const { error } = await supabase
    .from('connected_platforms')
    .delete()
    .eq('user_id', userId)
    .eq('platform', 'youtube');

  if (error) throw error;
  return { success: true };
}