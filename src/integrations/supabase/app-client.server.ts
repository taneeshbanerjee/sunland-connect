// Service-role Supabase client for the society's own Supabase project.
// SERVER ONLY — bypasses RLS. Load it inside handlers with a dynamic import.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createAppSupabaseAdminClient() {
  const url = process.env.APP_SUPABASE_URL;
  const serviceKey = process.env.APP_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    const missing = [
      ...(!url ? ['APP_SUPABASE_URL'] : []),
      ...(!serviceKey ? ['APP_SUPABASE_SERVICE_ROLE_KEY'] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(', ')}.`);
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _admin: ReturnType<typeof createAppSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createAppSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_admin) _admin = createAppSupabaseAdminClient();
    return Reflect.get(_admin, prop, receiver);
  },
});
