import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/app-auth-middleware";
import { enforceIdleExpiry } from "@/lib/session.functions";

const OWNER_EMAIL = "mickeybanerjee29@gmail.com";

// Ensures the signed-in user has a profile row and a base role, and enforces
// the backend session-expiry policy (SessionTokenExpiry).
export const ensureAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const user = authUser?.user;
    if (!user) throw new Error("User not found");

    const session = await enforceIdleExpiry(context.userId, user.email ?? null);
    if (session.expired) return { ok: true, sessionExpired: true };


    const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;

    await supabaseAdmin.from("profiles").upsert(
      {
        id: user.id,
        full_name: meta.full_name ?? "",
        flat_no: meta.flat_no || null,
        phone: meta.phone || null,
        email: user.email ?? null,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

    const roles: Array<{ user_id: string; role: "resident" | "super_admin" }> = [
      { user_id: user.id, role: "resident" },
    ];
    if ((user.email ?? "").toLowerCase() === OWNER_EMAIL) {
      roles.push({ user_id: user.id, role: "super_admin" });
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert(roles, { onConflict: "user_id,role", ignoreDuplicates: true });

    return { ok: true, sessionExpired: false };
  });
