import { supabase, supabaseAsUser } from '../services/supabase.js';

// Verify a Cloudflare Turnstile token. Returns true if the token is
// valid (or if Turnstile isn't configured — dev fallback).
//
// Set TURNSTILE_SECRET in production. Get one at
// https://dash.cloudflare.com/?to=/:account/turnstile (free).
async function verifyTurnstile(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('TURNSTILE_SECRET missing in production — signup CAPTCHA disabled');
    }
    return true; // dev mode: accept anything
  }
  if (!token || typeof token !== 'string') return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteip || '' }),
    });
    const json = await r.json();
    return Boolean(json.success);
  } catch (err) {
    console.error('Turnstile verify error:', err);
    return false;
  }
}

// Sign up new user
export async function signUp(req, res) {
  try {
    const { email, password, username, turnstileToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // CAPTCHA gate. Stops botnets from minting accounts to harvest the
    // Free tier's AI quota. Honest dev mode: if TURNSTILE_SECRET is
    // unset we let it through and warn at module load.
    const captchaOk = await verifyTurnstile(turnstileToken, req.ip);
    if (!captchaOk) {
      return res.status(400).json({
        success: false,
        error: 'captcha_failed',
        message: 'Please complete the verification challenge and try again.',
      });
    }

    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    
    // Create user profile. Use the email Supabase Auth actually accepted,
    // not the raw request body — this prevents drift if Supabase normalizes
    // the address and avoids future tricks where someone manages to create
    // an auth user with one email but a profile.email pointing elsewhere.
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: data.user.id,
        email: data.user.email,
        username: username || null,
        niche: 'general',
        goals: [],
        created_at: new Date().toISOString(),
      });

      if (profileError) {
        console.error('Error creating profile:', profileError);
      }
    }
    
    res.json({
      success: true,
      message: 'User created successfully. Please check your email to verify.',
      user: data.user,
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({
      success: false,
      error: 'Signup failed'
    });
  }
}

// Sign in user
export async function signIn(req, res) {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Don't echo the refresh_token to the response body. The token
    // would otherwise live in localStorage on the client; on XSS the
    // refresh token = persistent account access (much worse than a
    // 1-hour access_token). The frontend uses Supabase JS directly for
    // sign-in so this endpoint is mostly a fallback — but we still
    // shouldn't ship long-lived secrets we don't have to.
    const session = data.session ? {
      access_token: data.session.access_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      token_type: data.session.token_type,
    } : null;

    res.json({
      success: true,
      user: data.user,
      session,
    });
    
  } catch (error) {
    console.error('Signin error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }
}

// Sign out user
//
// supabase.auth.signOut() called on the service-role client is a no-op for
// the user's session. To actually invalidate the access/refresh tokens we
// have to ask the auth admin API to revoke the specific JWT.
export async function signOut(req, res) {
  try {
    const token = req.userToken;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { error } = await supabase.auth.admin.signOut(token);
    if (error) throw error;

    res.json({
      success: true,
      message: 'Signed out successfully'
    });

  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sign out'
    });
  }
}

// Get current user profile
export async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      profile: data
    });
    
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load profile'
    });
  }
}

// Fields a user is allowed to change on their own profile.
// Anything billing-, identity-, or platform-related is server-managed.
const PROFILE_WRITABLE_FIELDS = new Set([
  'username',
  'niche',
  'goals',
  'preferences',
  'ai_context',
]);

// Update user profile
export async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const updates = {};
    for (const key of Object.keys(body)) {
      if (PROFILE_WRITABLE_FIELDS.has(key)) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No editable fields provided'
      });
    }

    // Run as the user so RLS on profiles is the final gate, not just our
    // .eq('user_id', userId) filter.
    const db = supabaseAsUser(req.userToken);
    const { data, error } = await db
      .from('profiles')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      profile: data
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
}

