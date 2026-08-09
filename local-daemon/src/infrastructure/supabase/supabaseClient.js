import { createClient } from '@supabase/supabase-js';

export function createDaemonSupabaseClient({
  url,
  anonKey
}) {
  return createClient(url, anonKey);
}
