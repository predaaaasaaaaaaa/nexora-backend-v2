import { supabase } from '../services/supabase.js';

// Sign up new user
export async function signUp(req, res) {
  try {
    const { email, password, username } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    
    // Create user profile
    if (data.user) {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: data.user.id,
        email: email,
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
      error: error.message
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
    
    res.json({
      success: true,
      user: data.user,
      session: data.session,
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
export async function signOut(req, res) {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
    
  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
      error: error.message
    });
  }
}

// Update user profile
export async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const updates = req.body;
    
    const { data, error } = await supabase
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
      error: error.message
    });
  }
}

