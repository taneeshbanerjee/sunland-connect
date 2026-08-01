import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Builds a UPI deep link on the server so the receiving UPI ID is never
 * shipped in the browser bundle or shown in the UI. Anyone may call this —
 * it only produces a payment intent, it never moves money by itself.
 */
export const buildUpiLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.coerce.number().min(1).max(1_000_000).optional(),
        note: z.string().trim().max(60).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const payee = "pinksjhum@oksbi";
    const params = new URLSearchParams({
      pa: payee,
      pn: "Sunland Residency",
      cu: "INR",
    });
    if (data.amount) params.set("am", data.amount.toFixed(2));
    if (data.note) params.set("tn", data.note.replace(/[^\w\s.-]/g, "").slice(0, 60));
    return { url: `upi://pay?${params.toString()}` };
  });
