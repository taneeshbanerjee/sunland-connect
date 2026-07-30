import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit.functions";

export type ManagedRole = "president" | "board_member" | "resident";

/** Reads the caller's own roles through RLS (own rows are always visible). */
async function myRoles(context: { supabase: any; userId: string }): Promise<string[]> {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  return (data ?? []).map((r: { role: string }) => r.role as string);
}

export const listCommittee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const callerRoles = await myRoles(context);
    const allowed = callerRoles.some(
      (r) => r === "super_admin" || r === "president" || r === "board_member",
    );
    if (!allowed) throw new Error("Forbidden");



    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .neq("role", "resident");
    if (error) throw new Error(error.message);

    const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
    if (ids.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, flat_no")
      .in("id", ids);

    return ids.map((id) => {
      const p = profiles?.find((x) => x.id === id);
      return {
        userId: id,
        fullName: p?.full_name ?? "",
        email: p?.email ?? "",
        flatNo: p?.flat_no ?? "",
        roles: (roles ?? []).filter((r) => r.user_id === id).map((r) => r.role as string),
      };
    });
  });

export const assignRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        role: z.enum(["president", "board_member", "resident"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isSuper } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isSuper) throw new Error("Forbidden: only the Super Admin can manage committee roles");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();

    if (!profile) {
      throw new Error("No resident account found with that email. Ask them to sign up first.");
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: profile.id, role: data.role }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "role_granted",
      category: "role",
      targetId: profile.id,
      targetEmail: profile.email,
      details: { role: data.role },
    });

    return { ok: true };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["president", "board_member"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isSuper } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isSuper) throw new Error("Forbidden: only the Super Admin can manage committee roles");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role);
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "role_revoked",
      category: "role",
      targetId: data.userId,
      details: { role: data.role },
    });

    return { ok: true };
  });
