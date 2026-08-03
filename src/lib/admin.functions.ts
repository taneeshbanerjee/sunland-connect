import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/audit.functions";
import { assertStrongAuth } from "@/lib/session.functions";


export type ManagedRole = "super_admin" | "treasurer" | "president";

const MANAGED = ["super_admin", "treasurer", "president"] as const;
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
    await assertStrongAuth(context);
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
    await assertStrongAuth(context);
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
        role: z.enum(MANAGED),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStrongAuth(context);
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
    await assertStrongAuth(context);
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
 * Removes a resident entirely (account + records). All rules are enforced here
 * on the server: only Super Admin / Treasurer / President may call it, only the
 * Super Admin can remove another committee role holder, a Super Admin can never
 * be removed by anyone, and the auth login row is deleted so the person cannot
 * sign in again until they create a brand new account.
 */
export const deleteResident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStrongAuth(context);
    const target = data.userId;
    if (target === context.userId) throw new Error("You cannot remove your own account");

    const callerRoles = await myRoles(context);
    if (!callerRoles.some((r) => ["super_admin", "treasurer", "president"].includes(r))) {
      throw new Error("Forbidden: you cannot remove residents");
    }
    const callerSuper = callerRoles.includes("super_admin");

    const db = await adminClient();
    const { data: targetRoleRows } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", target);
    const targetRoles = (targetRoleRows ?? []).map((r) => r.role as string);

    if (targetRoles.includes("super_admin")) {
      throw new Error("The Super Admin cannot be removed from the residency database");
    }
    if (targetRoles.some((r) => ["treasurer", "president"].includes(r)) && !callerSuper) {
      throw new Error("Only the Super Admin can remove another committee role holder");
    }

    const { data: profile } = await db
      .from("profiles")
      .select("email")
      .eq("id", target)
      .maybeSingle();

    await db.from("maintenance_dues").delete().eq("user_id", target);
    await db.from("submissions").delete().eq("user_id", target);
    await db.from("receipts").delete().eq("user_id", target);
    await db.from("session_activity").delete().eq("user_id", target);
    await db.from("user_roles").delete().eq("user_id", target);
    await db.from("announcements").update({ author_id: null }).eq("author_id", target);
    await db.from("profiles").delete().eq("id", target);

    // Revoke sign-in permanently: the auth account itself is removed.
    const { error: authErr } = await db.auth.admin.deleteUser(target);
    if (authErr) throw new Error(authErr.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "resident_removed",
      category: "admin",
      targetId: target,
      targetEmail: profile?.email ?? null,
      details: { auth_account_deleted: true },
    });

    return { ok: true, email: profile?.email ?? null };
  });


/**
 * Super Admin / Treasurer / President can mint a one-time password reset link
 * for a resident who cannot receive the reset email. The link is shown once to
 * the admin, who passes it on to the resident.
 */
export const createRecoveryLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255), redirectTo: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStrongAuth(context);
    const roles = await myRoles(context);
    if (!roles.some((r) => ["super_admin", "treasurer", "president"].includes(r))) {
      throw new Error("Forbidden");
    }
    const supabaseAdmin = await adminClient();
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email.toLowerCase(),
      options: { redirectTo: data.redirectTo },
    });
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email ?? null,
      action: "recovery_link_created",
      category: "admin",
      targetEmail: data.email,
    });

    return { url: link.properties?.action_link ?? null };
  });

