import {
    getAuthUrl,
    handleCallback,
    getYouTubeAnalytics,
    isYouTubeConnected,
    disconnectYouTube,
    verifyState,
    YouTubeOAuthError,
  } from '../services/youtube.js';

  // Resolve the URL to redirect the user back to after the OAuth round trip.
  // Production sets FRONTEND_URL explicitly. In dev we infer from the
  // request's own host so a localhost OAuth never bounces the user to
  // production (where they have no session).
  function resolveFrontend(req) {
    if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, '');
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host && /(localhost|127\.0\.0\.1)/.test(host)) {
      // Frontend dev server is conventionally on a different port than the
      // API. Default to :3000.
      const hostname = String(host).split(':')[0];
      return `http://${hostname}:3000`;
    }
    return 'https://nexora-ai.org';
  }
  
  // Start YouTube OAuth flow.
  // Accepts an optional `label` (query string for GET, body for POST) so
  // the user can name the connection ahead of time. The label is signed
  // into the OAuth state so it can't be tampered with mid-flight.
  export async function connectYouTube(req, res) {
    try {
      const userId = req.user.id;
      const label = req.query?.label || req.body?.label || null;
      const authUrl = getAuthUrl(userId, label);

      res.json({
        success: true,
        authUrl: authUrl,
      });
    } catch (error) {
      console.error('Error starting YouTube OAuth:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to start YouTube connection',
      });
    }
  }
  
  // Handle OAuth callback from Google
  export async function youtubeCallback(req, res) {
    const frontend = resolveFrontend(req);
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.redirect(`${frontend}/settings?youtube=error&reason=missing_params`);
      }

      // Verify the HMAC-signed state we minted in getAuthUrl. This is what
      // binds the OAuth callback to the user that started the flow — without
      // it, anyone could complete OAuth and write tokens for any user.
      const verified = verifyState(state);
      if (!verified) {
        return res.redirect(`${frontend}/settings?youtube=error&reason=invalid_state`);
      }

      const result = await handleCallback(code, verified.userId, { label: verified.label });

      // Redirect back to frontend with the typed status so the UI can
      // pick the right banner (success vs "create a channel" nudge).
      const params = new URLSearchParams({ youtube: 'connected', status: result.status });
      if (result.channel_title) params.set('channel', result.channel_title);
      res.redirect(`${frontend}/settings?${params.toString()}`);

    } catch (error) {
      console.error('Error in YouTube callback:', error);
      // Pass a typed reason to the UI so it can show a useful message.
      // Anything we don't recognize falls back to a generic code — no
      // raw error.message in the URL.
      const reason = error instanceof YouTubeOAuthError ? error.reason : 'callback_failed';
      res.redirect(`${frontend}/settings?youtube=error&reason=${encodeURIComponent(reason)}`);
    }
  }
  
  // Get YouTube analytics (real data)
  export async function getYouTubeData(req, res) {
    try {
      const userId = req.user.id;

      const connected = await isYouTubeConnected(userId);
      if (!connected) {
        return res.json({
          success: true,
          connected: false,
          status: 'not_connected',
          message: 'YouTube not connected. Connect your account to see real analytics.',
        });
      }

      // Honor the persisted lifecycle status so we don't burn quota
      // calling YouTube for a row we already know is dead/half-set-up.
      if (connected.status === 'pending_channel') {
        return res.json({
          success: true,
          connected: true,
          status: 'pending_channel',
          message: 'No YouTube channel on this Google account yet. Create one to start tracking analytics.',
          details: connected,
        });
      }
      if (connected.status === 'revoked') {
        return res.json({
          success: true,
          connected: true,
          status: 'revoked',
          message: 'YouTube access was revoked. Please reconnect your account.',
          details: connected,
        });
      }

      const analytics = await getYouTubeAnalytics(userId);

      if (!analytics) {
        // getYouTubeAnalytics already updated the row to 'revoked' on
        // invalid_grant; we mirror that to the client.
        return res.json({
          success: true,
          connected: true,
          status: 'revoked',
          message: 'YouTube access was revoked. Please reconnect your account.',
        });
      }

      res.json({
        success: true,
        connected: true,
        status: 'active',
        platform: 'youtube',
        data: analytics,
      });

    } catch (error) {
      console.error('Error fetching YouTube data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch YouTube analytics',
      });
    }
  }
  
  // Check connection status
  export async function checkYouTubeConnection(req, res) {
    try {
      const userId = req.user.id;
      const connected = await isYouTubeConnected(userId);

      res.json({
        success: true,
        connected: !!connected,
        status: connected?.status || 'not_connected',
        details: connected || null,
      });

    } catch (error) {
      console.error('Error checking YouTube connection:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check connection status',
      });
    }
  }
  
  // Disconnect YouTube
  export async function removeYouTube(req, res) {
    try {
      const userId = req.user.id;
      await disconnectYouTube(userId);
  
      res.json({
        success: true,
        message: 'YouTube disconnected successfully',
      });
  
    } catch (error) {
      console.error('Error disconnecting YouTube:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to disconnect YouTube',
      });
    }
  }