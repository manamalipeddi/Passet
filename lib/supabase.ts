import { createClient } from '@supabase/supabase-js';

// Server-side only client. Uses the service role key, which bypasses RLS,
// so this file must never be imported from a client component.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
