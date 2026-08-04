// Browser Supabase client for the society's own Supabase project.
// Import this everywhere instead of the platform-generated ./client.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { APP_SUPABASE_ANON_KEY, APP_SUPABASE_URL } from "./app-config";

function createAppSupabaseClient() {
  return createClient<Database>(APP_SUPABASE_URL, APP_SUPABASE_ANON_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });
}

let _client: ReturnType<typeof createAppSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createAppSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_client) _client = createAppSupabaseClient();
    return Reflect.get(_client, prop, receiver);
  },
});
