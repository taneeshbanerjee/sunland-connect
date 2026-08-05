import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/app-auth-middleware";
import { writeAudit } from "@/lib/audit.functions";

/** Idle window before a session is force-expired, in milliseconds. */
export const SESSION_IDLE_MS = 5 * 60 * 1000;

/** Roles that are never force-expired. */
const EXEMPT_ROLES = ["super_admin"];

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
  return supabaseAdmin;
}

async function rolesOf(db: Awaited<ReturnType<typeof admin>>, userId: string) {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}

/**
 * Revokes every refresh token of a user. The device is signed out in the
 * background the moment its access token is next refreshed.
 */
async function revoke(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  email: string | null,
  reason: string,
) {
  await db.auth.admin.signOut(userId, "global");
  await db
    .from("session_activity")
    .update({ expired_at: new Date().toISOString() })
    .eq("user_id", userId);
  await writeAudit({
    actorId: userId,
    actorEmail: email,
    action: "session_expired",
    category: "auth",
    details: { reason, idle_minutes: SESSION_IDLE_MS / 60000 },
  });
}

/**
 * Background sweeper: expires every non-exempt session idle for longer than
 * the idle window, even if that device never comes back online.
 */
export async function sweepExpiredSessions() {
  const db = await admin();
  const cutoff = new Date(Date.now() - SESSION_IDLE_MS).toISOString();

  const { data: stale } = await db
    .from("session_activity")
    .select("user_id, last_seen_at, expired_at")
    .lt("last_seen_at", cutoff)
    .is("expired_at", null)
    .limit(200);

  let expired = 0;
  for (const row of stale ?? []) {
    const roles = await rolesOf(db, row.user_id);
    if (roles.some((r) => EXEMPT_ROLES.includes(r))) continue;
    const { data: profile } = await db
      .from("profiles")
      .select("email")
      .eq("id", row.user_id)
      .maybeSingle();
    await revoke(db, row.user_id, profile?.email ?? null, "idle_timeout");
    expired += 1;
  }
  return { swept: stale?.length ?? 0, expired };
}

/**
 * Records activity for the signed-in user and enforces the idle window.
 * Runs entirely on the server — there is no frontend timer.
 */
export async function enforceIdleExpiry(userId: string, email: string | null) {
  const db = await admin();
  const roles = await rolesOf(db, userId);
  const exempt = roles.some((r) => EXEMPT_ROLES.includes(r));

  const { data: existing } = await db
    .from("session_activity")
    .select("last_seen_at, expired_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!exempt && existing?.last_seen_at) {
    const idleFor = Date.now() - new Date(existing.last_seen_at).getTime();
    if (idleFor > SESSION_IDLE_MS) {
      await revoke(db, userId, email, "idle_timeout");
      return { expired: true, exempt: false };
    }
  }

  await db
    .from("session_activity")
    .upsert(
      { user_id: userId, last_seen_at: new Date().toISOString(), expired_at: null },
      { onConflict: "user_id" },
    );

  return { expired: false, exempt };
}

export const touchSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    enforceIdleExpiry(
      context.userId,
      (context.claims as { email?: string } | undefined)?.email ?? null,
    ),
  );



/**
 * Two-factor gate. Elevated roles that have enrolled TOTP must present an
 * aal2 session before any privileged server action is allowed.
 */
export async function assertStrongAuth(context: {
  supabase: any;
  userId: string;
  claims: Record<string, unknown>;
}) {
  const db = await admin();
  const roles = await rolesOf(db, context.userId);
  const elevated = roles.some((r) =>
    ["super_admin", "treasurer", "president"].includes(r),
  );
  if (!elevated) return;

  const { data: profile } = await db
    .from("profiles")
    .select("mfa_enrolled")
    .eq("id", context.userId)
    .maybeSingle();

  if (profile?.mfa_enrolled && context.claims?.aal !== "aal2") {
    throw new Error("Two-factor verification required. Sign in again and enter your code.");
  }
}
