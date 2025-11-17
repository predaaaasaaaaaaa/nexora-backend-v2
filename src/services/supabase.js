import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

// DEBUG: Check if Supabase env vars are loading
console.log('🔍 DEBUG - Supabase Environment Variables:');
console.log('  - SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
console.log('  - SUPABASE_URL value:', process.env.SUPABASE_URL);
console.log('  - SUPABASE_SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_KEY);
console.log('  - SUPABASE_SERVICE_KEY first 20 chars:', process.env.SUPABASE_SERVICE_KEY?.substring(0, 20));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase credentials!');
  console.error('Make sure .env file has:');
  console.error('SUPABASE_URL=https://...');
  console.error('SUPABASE_SERVICE_KEY=...');
  throw new Error('Missing Supabase environment variables');
}

console.log('✅ Supabase credentials loaded successfully');

export const supabase = createClient(supabaseUrl, supabaseKey);

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

