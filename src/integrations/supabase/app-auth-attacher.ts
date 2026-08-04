// Attaches the society Supabase session bearer token to every server function call.
import { createMiddleware } from '@tanstack/react-start';
import { supabase } from './app-client';

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    let headers: Record<string, string> = {};
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers = { Authorization: `Bearer ${token}` };
    } catch {
      // no session — the server middleware will reject if the call needs auth
    }
    return next({ headers });
  },
);
