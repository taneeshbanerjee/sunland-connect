import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/app-auth-middleware";

/** UPI ID of the society. Never leaves the server. */
const PAYEE_UPI = "pinksjhum@oksbi";
const PAYEE_NAME = "Sunland Residency";

/** A well-formed VPA: handle@bank. Guards against a mis-edited constant. */
const UPI_ID_RE = /^[a-z0-9._-]{2,64}@[a-z]{2,32}$/i;

/** Rate limits: burst and sustained, per resident. */
const BURST_WINDOW_MS = 30 * 1000;
const BURST_MAX = 3;
const SUSTAINED_WINDOW_MS = 15 * 60 * 1000;
const SUSTAINED_MAX = 15;

const inputSchema = z.object({
  context: z.enum(["due", "submission", "receipt", "general"]),
  referenceId: z.string().uuid().optional(),
  amount: z.coerce.number().positive().max(1_000_000).optional(),
  note: z.string().trim().max(60).optional(),
  /** Stable per payment target — repeated clicks reuse the same intent. */
  idempotencyKey: z.string().trim().min(6).max(120),
});

function buildUpiUrl(amount: number | undefined, note: string | undefined, intentId: string) {
  if (!UPI_ID_RE.test(PAYEE_UPI)) {
    throw new Error("Payment destination is misconfigured. Contact the committee.");
  }
  const params = new URLSearchParams({
    pa: PAYEE_UPI,
    pn: PAYEE_NAME,
    cu: "INR",
    tr: intentId.replace(/-/g, "").slice(0, 32),
  });
  if (amount && amount > 0) params.set("am", amount.toFixed(2));
  const safeNote = (note ?? "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60);
  if (safeNote) params.set("tn", safeNote);
  return `upi://pay?${params.toString()}`;
}

/**
 * Creates (or returns) a single payment intent for the signed-in resident and
 * hands back a UPI deep link. Idempotent: the same idempotency key always
 * resolves to the same intent, so double clicks can never start two payments.
 * Rate limited server-side and validated server-side; the UPI ID is never
 * shipped to the browser.
 */
export const createPaymentIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");

    // 1. Idempotency — return the existing intent untouched.
    const { data: existing } = await supabaseAdmin
      .from("payment_intents")
      .select("id, amount, note")
      .eq("user_id", context.userId)
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();

    if (existing) {
      return {
        intentId: existing.id,
        url: buildUpiUrl(
          existing.amount != null ? Number(existing.amount) : undefined,
          existing.note ?? undefined,
          existing.id,
        ),
        reused: true,
      };
    }

    // 2. Rate limiting (only reached for genuinely new intents).
    const now = Date.now();
    const { count: burst } = await supabaseAdmin
      .from("payment_intents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", new Date(now - BURST_WINDOW_MS).toISOString());
    if ((burst ?? 0) >= BURST_MAX) {
      throw new Error("Too many payment attempts. Please wait a moment and try again.");
    }
    const { count: sustained } = await supabaseAdmin
      .from("payment_intents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", new Date(now - SUSTAINED_WINDOW_MS).toISOString());
    if ((sustained ?? 0) >= SUSTAINED_MAX) {
      throw new Error("Payment attempt limit reached. Please try again in a few minutes.");
    }

    // 3. Create the intent.
    const { data: created, error } = await supabaseAdmin
      .from("payment_intents")
      .insert({
        user_id: context.userId,
        idempotency_key: data.idempotencyKey,
        context: data.context,
        reference_id: data.referenceId ?? null,
        amount: data.amount ?? null,
        note: data.note ?? null,
        status: "initiated",
      })
      .select("id")
      .single();

    if (error || !created) {
      // Lost a race with a parallel click — fetch the winner instead of failing.
      const { data: raced } = await supabaseAdmin
        .from("payment_intents")
        .select("id, amount, note")
        .eq("user_id", context.userId)
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      if (raced) {
        return {
          intentId: raced.id,
          url: buildUpiUrl(
            raced.amount != null ? Number(raced.amount) : undefined,
            raced.note ?? undefined,
            raced.id,
          ),
          reused: true,
        };
      }
      throw new Error("Could not start the payment. Please try again.");
    }

    return {
      intentId: created.id,
      url: buildUpiUrl(data.amount, data.note, created.id),
      reused: false,
    };
  });

/** Marks an intent as handed off to the UPI app. Owner-scoped. */
export const markPaymentOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ intentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
    await supabaseAdmin
      .from("payment_intents")
      .update({ status: "opened" })
      .eq("id", data.intentId)
      .eq("user_id", context.userId);
    return { ok: true };
  });
