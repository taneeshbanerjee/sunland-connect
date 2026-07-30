import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit.functions";

export type ManagedRole = "super_admin" | "treasurer" | "president" | "board_member";

const MANAGED = ["super_admin", "treasurer", "president", "board_member"] as const;
/** Roles that exist for exactly one person at a time. */
const SINGLETON = ["super_admin", "treasurer", "president"] as const;

/** Reads the caller's own roles through RLS (own rows are always visible). */
async function myRoles(context: { supabase: any; userId: string }): Promise<string[]> {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  return (data ?? []).map((r: { role: string }) => r.role as string);
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listCommittee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const callerRoles = await myRoles(context);
    const allowed = callerRoles.some((r) => MANAGED.includes(r as ManagedRole));
    if (!allowed) throw new Error("Forbidden");

    const supabaseAdmin = await adminClient();
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
        role: z.enum(MANAGED),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await myRoles(context);
    const isSuper = roles.includes("super_admin");
    const isTreasurer = roles.includes("treasurer");

    // Only the Super Admin can hand out the supreme roles.
    if (SINGLETON.includes(data.role as (typeof SINGLETON)[number]) && !isSuper) {
      throw new Error("Forbidden: only the Super Admin can assign this role");
    }
    if (!isSuper && !isTreasurer) {
      throw new Error("Forbidden: only the Super Admin or Treasurer can manage committee roles");
    }

    const supabaseAdmin = await adminClient();
    const email = data.email.toLowerCase();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .ilike("email", email)
      .maybeSingle();

    if (!profile) {
      throw new Error("No resident account found with that email. Ask them to sign up first.");
    }

    if (SINGLETON.includes(data.role as (typeof SINGLETON)[number])) {
      // Singleton role: remove it from whoever holds it, they stay a resident.
      const { data: holders } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", data.role);
      for (const h of holders ?? []) {
        if (h.user_id === profile.id) continue;
        await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", h.user_id)
          .eq("role", data.role);
        await writeAudit({
          actorId: context.userId,
          action: "role_transferred_away",
          category: "role",
          targetId: h.user_id,
          details: { role: data.role },
        });
      }
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: profile.id, role: data.role }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);

    // Everyone always keeps a base resident role so their account survives.
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: profile.id, role: "resident" }, { onConflict: "user_id,role" });

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
        role: z.enum(["super_admin", "treasurer", "president", "board_member"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await myRoles(context);
    const isSuper = roles.includes("super_admin");
    const isTreasurer = roles.includes("treasurer");

    if (SINGLETON.includes(data.role as (typeof SINGLETON)[number]) && !isSuper) {
      throw new Error("Forbidden: only the Super Admin can revoke this role");
    }
    if (!isSuper && !isTreasurer) {
      throw new Error("Forbidden: only the Super Admin or Treasurer can manage committee roles");
    }
    if (data.role === "super_admin" && data.userId === context.userId) {
      throw new Error("Transfer the Super Admin role to someone else instead of revoking it.");
    }

    const supabaseAdmin = await adminClient();
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

/**
 * Transfers a supreme role (Super Admin / Treasurer / President) to another
 * resident. The previous holder keeps their account and becomes a resident.
 * Only the Super Admin can do this.
 */
export const transferRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(SINGLETON),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await myRoles(context);
    if (!roles.includes("super_admin")) {
      throw new Error("Forbidden: only the Super Admin can transfer this role");
    }

    const supabaseAdmin = await adminClient();
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("That resident no longer exists");

    const { data: holders } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", data.role);

    for (const h of holders ?? []) {
      if (h.user_id === data.userId) continue;
      await supabaseAdmin.from("user_roles").delete().eq("user_id", h.user_id).eq("role", data.role);
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: h.user_id, role: "resident" }, { onConflict: "user_id,role" });
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "resident" }, { onConflict: "user_id,role" });

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "role_transferred",
      category: "role",
      targetId: data.userId,
      targetEmail: target.email,
      details: { role: data.role, previous_holders: (holders ?? []).length },
    });

    return { ok: true };
  });

/**
 * Removes a resident entirely (account + records).
 * Super Admin, Treasurer and President only. Board Members cannot.
 */
export const deleteResident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const roles = await myRoles(context);
    const allowed = roles.some((r) => ["super_admin", "treasurer", "president"].includes(r));
    if (!allowed) throw new Error("Forbidden: you cannot remove residents");
    if (data.userId === context.userId) throw new Error("You cannot remove your own account");

    const supabaseAdmin = await adminClient();

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    const targetIsSupreme = (targetRoles ?? []).some((r) =>
      ["super_admin", "treasurer"].includes(r.role as string),
    );
    if (targetIsSupreme && !roles.includes("super_admin")) {
      throw new Error("Only the Super Admin can remove another supreme role holder");
    }
    if ((targetRoles ?? []).some((r) => r.role === "super_admin")) {
      throw new Error("The Super Admin account cannot be removed. Transfer the role first.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();

    await supabaseAdmin.from("maintenance_dues").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("submissions").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("receipts").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("session_activity").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "resident_removed",
      category: "admin",
      targetId: data.userId,
      targetEmail: profile?.email ?? null,
    });

    return { ok: true };
  });
