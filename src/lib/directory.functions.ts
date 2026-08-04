import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/app-auth-middleware";

export type DirectoryEntry = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  flat_no: string | null;
  hide_flat_no: boolean;
  created_at: string;
};

/**
 * Residency directory. Replaces the former SECURITY DEFINER `residents_directory()`
 * RPC so no privileged database function is exposed to signed-in users.
 * Masking rules are enforced here, server-side:
 *  - committee roles see everyone; a plain resident only sees their own row
 *  - a hidden flat number is only revealed to its owner and to the Super Admin
 */
export const listResidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DirectoryEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r) => r.role as string);
    const isSupreme = roles.includes("super_admin");
    const isCommittee = roles.some((r) => ["super_admin", "treasurer", "president"].includes(r));

    let query = supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, flat_no, hide_flat_no, created_at");
    if (!isCommittee) query = query.eq("id", context.userId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      phone: p.phone,
      flat_no:
        p.hide_flat_no && p.id !== context.userId && !isSupreme ? null : p.flat_no,
      hide_flat_no: p.hide_flat_no,
      created_at: p.created_at,
    }));
  });
