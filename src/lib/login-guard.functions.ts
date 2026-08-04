import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeAudit } from "@/lib/audit.functions";

/** Failure budget before an account is locked. Elevated roles get a tighter one. */
const MAX_FAILURES_STANDARD = 8;
const MAX_FAILURES_ELEVATED = 5;
/** How long a lock lasts, and how long failures are remembered. */
const LOCK_MINUTES = 15;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const ELEVATED = ["super_admin", "treasurer", "president"];

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
  return supabaseAdmin;
}

async function lookup(email: string) {
  const db = await admin();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (!profile) return { db, userId: null as string | null, elevated: false };
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", profile.id);
  return {
    db,
    userId: profile.id,
    elevated: (roles ?? []).some((r) => ELEVATED.includes(r.role as string)),
  };
}

/**
 * Pre-flight check. Tells the sign-in screen whether this email is currently
 * locked out, without revealing whether the account exists.
 */
export const loginGate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255) }).parse(input),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const db = await admin();
    const { data: row } = await db
      .from("login_lockouts")
      .select("locked_until")
      .eq("email", email)
      .maybeSingle();

    if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return {
        locked: true,
        retryAfterSeconds: Math.ceil(
          (new Date(row.locked_until).getTime() - Date.now()) / 1000,
        ),
      };
    }
    return { locked: false, retryAfterSeconds: 0 };
  });

/**
 * Records the outcome of a sign-in attempt, enforces the lockout counter and
 * — for real accounts — bans the user server-side so the lock cannot be
 * bypassed by calling the auth API directly.
 */
export const noteLoginOutcome = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        success: z.boolean(),
        reason: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const { db, userId, elevated } = await lookup(email);

    await writeAudit({
      actorId: userId,
      actorEmail: email,
      action: data.success ? "login_success" : "login_failed",
      category: "auth",
      success: data.success,
      details: data.reason ? { reason: data.reason.slice(0, 200) } : {},
    });

    if (data.success) {
      await db.from("login_lockouts").delete().eq("email", email);
      return { locked: false, retryAfterSeconds: 0, failures: 0 };
    }

    const { data: row } = await db
      .from("login_lockouts")
      .select("failed_count, first_failed_at, locked_until")
      .eq("email", email)
      .maybeSingle();

    const windowOpen =
      row?.first_failed_at &&
      Date.now() - new Date(row.first_failed_at).getTime() < FAILURE_WINDOW_MS;
    const failures = (windowOpen ? (row?.failed_count ?? 0) : 0) + 1;
    const limit = elevated ? MAX_FAILURES_ELEVATED : MAX_FAILURES_STANDARD;
    const shouldLock = failures >= limit;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    const nowIso = new Date().toISOString();

    await db.from("login_lockouts").upsert(
      {
        email,
        failed_count: failures,
        first_failed_at: windowOpen ? (row?.first_failed_at ?? nowIso) : nowIso,
        last_failed_at: nowIso,
        locked_until: lockedUntil,
      },
      { onConflict: "email" },
    );

    if (shouldLock) {
      if (userId) {
        // Hard, server-side enforcement: the auth API itself refuses the user.
        await db.auth.admin
          .updateUserById(userId, { ban_duration: `${LOCK_MINUTES}m` })
          .catch(() => {});
      }
      await db.from("incident_reports").insert({
        message: `Account locked after ${failures} failed sign-in attempts for ${email}${
          elevated ? " (privileged account)" : ""
        }`,
        route: "/",
        severity: elevated ? "critical" : "warning",
        source: "server",
        user_email: email,
      });
      await writeAudit({
        actorId: userId,
        actorEmail: email,
        action: "account_locked",
        category: "auth",
        success: false,
        details: { failures, lock_minutes: LOCK_MINUTES, privileged: elevated },
      });
    }

    return {
      locked: shouldLock,
      retryAfterSeconds: shouldLock ? LOCK_MINUTES * 60 : 0,
      failures,
      remaining: Math.max(0, limit - failures),
    };
  });
