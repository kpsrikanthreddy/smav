import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SMAV_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SMAV_SUPABASE_ANON_KEY || '';

export const isCentralSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-central-smav-project')
);

// Publishable client - uses anon key only (NEVER service-role key)
export const centralSupabase = isCentralSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

/**
 * Creates an authenticated Supabase client for reading scoped records
 * honoring the RLS policy: users can read only their own profile.
 */
export function createAuthenticatedSupabaseClient(accessToken: string) {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
