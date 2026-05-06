import {
    getAuthUrl,
    handleCallback,
    getYouTubeAnalytics,
    isYouTubeConnected,
    disconnectYouTube,
    verifyState,
  } from '../services/youtube.js';
  
  // Start YouTube OAuth flow
  export async function connectYouTube(req, res) {
    try {
      const userId = req.user.id;
      const authUrl = getAuthUrl(userId);
  
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
    const frontend = process.env.FRONTEND_URL || 'https://nexora-ai.org';
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

      const result = await handleCallback(code, verified.userId);

      // Redirect back to frontend settings page with success
      res.redirect(`${frontend}/settings?youtube=connected&channel=${encodeURIComponent(result.channel_title)}`);

    } catch (error) {
      console.error('Error in YouTube callback:', error);
      // Don't echo error.message back to the URL — it can leak internals.
      res.redirect(`${frontend}/settings?youtube=error&reason=callback_failed`);
    }
  }
  
  // Get YouTube analytics (real data)
  export async function getYouTubeData(req, res) {
    try {
      const userId = req.user.id;
  
      // Check if connected first
      const connected = await isYouTubeConnected(userId);
      if (!connected) {
        return res.json({
          success: true,
          connected: false,
          message: 'YouTube not connected. Connect your account to see real analytics.',
        });
      }
  
      // Fetch real analytics
      const analytics = await getYouTubeAnalytics(userId);
  
      if (!analytics) {
        return res.json({
          success: true,
          connected: false,
          message: 'YouTube token expired. Please reconnect your account.',
        });
      }
  
      res.json({
        success: true,
        connected: true,
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