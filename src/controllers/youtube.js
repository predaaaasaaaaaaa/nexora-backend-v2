import {
    getAuthUrl,
    handleCallback,
    getYouTubeAnalytics,
    isYouTubeConnected,
    disconnectYouTube,
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
    try {
      const { code, state } = req.query;
      const userId = state; // we passed userId as state in getAuthUrl
  
      if (!code || !userId) {
        return res.redirect(`${process.env.FRONTEND_URL || 'https://nexora-ai.org'}/settings?youtube=error&reason=missing_params`);
      }
  
      const result = await handleCallback(code, userId);
  
      // Redirect back to frontend settings page with success
      res.redirect(`${process.env.FRONTEND_URL || 'https://nexora-ai.org'}/settings?youtube=connected&channel=${encodeURIComponent(result.channel_title)}`);
  
    } catch (error) {
      console.error('Error in YouTube callback:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'https://nexora-ai.org'}/settings?youtube=error&reason=${encodeURIComponent(error.message)}`);
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