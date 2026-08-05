import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeAudit } from "@/lib/audit.functions";

/** Abuse controls for the e-mail OTP / forgot-password flow. */
const MAX_SENDS = 3; // per window — matches the provider's hourly send budget
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_VERIFY_FAILURES = 5;
const LOCK_MINUTES = 15;

const emailSchema = z.object({ email: z.string().trim().email().max(255) });

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
  return supabaseAdmin;
}

/** Lockout rows are keyed by email; OTP counters use a namespaced key. */
const key = (email: string) => `otp:${email.toLowerCase()}`;

async function readRow(email: string) {
  const db = await admin();
  const { data } = await db
    .from("login_lockouts")
    .select("failed_count, first_failed_at, locked_until")
    .eq("email", key(email))
    .maybeSingle();
  return { db, row: data };
}

function lockedFor(lockedUntil: string | null | undefined) {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Called before requesting a code. Enforces both the send budget and any
 * active lock, without revealing whether the account exists.
 */
export const otpSendGate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const { db, row } = await readRow(email);

    const retryAfterSeconds = lockedFor(row?.locked_until);
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds, remaining: 0 };

    const windowOpen =
      row?.first_failed_at &&
      Date.now() - new Date(row.first_failed_at).getTime() < SEND_WINDOW_MS;
    const sends = (windowOpen ? (row?.failed_count ?? 0) : 0) + 1;

    if (sends > MAX_SENDS) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      await db
        .from("login_lockouts")
        .upsert({ email: key(email), failed_count: sends, locked_until: until }, {
          onConflict: "email",
        });
      await writeAudit({
        actorEmail: email,
        action: "otp_rate_limited",
        category: "auth",
        success: false,
        details: { sends, window_minutes: SEND_WINDOW_MS / 60000 },
      });
      return { allowed: false, retryAfterSeconds: LOCK_MINUTES * 60, remaining: 0 };
    }

    const nowIso = new Date().toISOString();
    await db.from("login_lockouts").upsert(
      {
        email: key(email),
        failed_count: sends,
        first_failed_at: windowOpen ? (row?.first_failed_at ?? nowIso) : nowIso,
        last_failed_at: nowIso,
        locked_until: null,
      },
      { onConflict: "email" },
    );

    return { allowed: true, retryAfterSeconds: 0, remaining: MAX_SENDS - sends };
  });

/**
 * Records the outcome of a code verification. Repeated wrong codes lock the
 * whole reset flow for this address.
 */
export const otpVerifyOutcome = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    emailSchema.extend({ success: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const db = await admin();
    const vkey = `otpv:${email}`;

    if (data.success) {
      await db.from("login_lockouts").delete().in("email", [vkey, key(email)]);
      await writeAudit({
        actorEmail: email,
        action: "otp_verified",
        category: "auth",
        success: true,
        details: {},
      });
      return { locked: false, retryAfterSeconds: 0 };
    }

    const { data: row } = await db
      .from("login_lockouts")
      .select("failed_count, locked_until")
      .eq("email", vkey)
      .maybeSingle();

    const active = lockedFor(row?.locked_until);
    if (active > 0) return { locked: true, retryAfterSeconds: active };

    const failures = (row?.failed_count ?? 0) + 1;
    const shouldLock = failures >= MAX_VERIFY_FAILURES;
    const nowIso = new Date().toISOString();

    await db.from("login_lockouts").upsert(
      {
        email: vkey,
        failed_count: failures,
        first_failed_at: nowIso,
        last_failed_at: nowIso,
        locked_until: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
          : null,
      },
      { onConflict: "email" },
    );

    if (shouldLock) {
      await writeAudit({
        actorEmail: email,
        action: "otp_locked",
        category: "auth",
        success: false,
        details: { failures, lock_minutes: LOCK_MINUTES },
      });
    }

    return {
      locked: shouldLock,
      retryAfterSeconds: shouldLock ? LOCK_MINUTES * 60 : 0,
      remaining: Math.max(0, MAX_VERIFY_FAILURES - failures),
    };
  });
