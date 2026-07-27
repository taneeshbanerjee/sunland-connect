import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { type AppRole, isCommittee, isElevated } from "@/lib/roles";
import { ensureAccount } from "@/lib/account.functions";


export function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, ready, user: session?.user ?? null };
}

export function useMe() {
  const { user, ready } = useSupabaseSession();

  const query = useQuery({
    queryKey: ["me", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      try {
        await ensureAccount();
      } catch {
        // non-fatal: profile/role bootstrap will retry on next load
      }
      const [{ data: profile }, { data: roleRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, flat_no, phone, email")
          .eq("id", user!.id)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user!.id),
      ]);

      const roles = (roleRows ?? []).map((r) => r.role as AppRole);
      return { profile, roles };
    },
  });

  const roles = query.data?.roles ?? [];

  return {
    ready: ready && (!user || !query.isLoading),
    user,
    profile: query.data?.profile ?? null,
    roles,
    committee: isCommittee(roles),
    elevated: isElevated(roles),
    superAdmin: roles.includes("super_admin"),
    refetch: query.refetch,
  };
}
