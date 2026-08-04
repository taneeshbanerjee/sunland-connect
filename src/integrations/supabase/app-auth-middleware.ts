// Auth middleware bound to the society's own Supabase project.
import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const url = process.env.APP_SUPABASE_URL;
    const anonKey = process.env.APP_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error('Missing Supabase environment variables for the society backend.');
    }

    const request = getRequest();
    const authHeader = request?.headers?.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('Unauthorized: No authorization header provided');
    }

    const token = authHeader.slice('Bearer '.length);
    if (!token || token.split('.').length !== 3) {
      throw new Error('Unauthorized: Invalid token');
    }

    const supabase = createClient<Database>(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new Error('Unauthorized: Invalid token');
    }

    return next({
      context: {
        supabase,
        userId: data.user.id,
        claims: { sub: data.user.id, email: data.user.email } as Record<string, unknown>,
      },
    });
  },
);
