import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required Supabase env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  throw new Error('Missing Supabase environment variables');
}

// Service-role client. Bypasses RLS — only use for system operations
// (webhooks, cron jobs, OAuth callback persistence, lookups that legitimately
// need to span users). For writes triggered by an authenticated user, prefer
// supabaseAsUser(jwt) below so RLS policies still apply.
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Per-request Supabase client that authenticates as the calling user.
// PostgREST will run queries as that user, so RLS policies on profiles,
// coach_conversations, scheduled_posts, etc. are enforced even if the
// application code accidentally drops a user_id filter.
export function supabaseAsUser(jwt) {
  if (!jwt) throw new Error('supabaseAsUser requires a user JWT');
  // Anon key is the right choice here: PostgREST decides the role from the
  // Authorization JWT, not from the apikey.
  return createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Helper function to verify user token
export async function verifyUser(token) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) throw error;
    return user;
  } catch (error) {
    console.error('Error verifying user:', error);
    return null;
  }
}

// Helper function to get user profile
export async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}

// Helper function to update user profile
export async function updateUserProfile(userId, updates) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating profile:', error);
    return null;
  }
}

