import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IndianRupee, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createPaymentIntent, markPaymentOpened } from "@/lib/payments.functions";

type Props = {
  amount?: number | null;
  note?: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "hero" | "subtle" | "outline";
  /** What is being paid for — drives the server-side idempotency key. */
  context?: "due" | "submission" | "receipt" | "general";
  /** Row id of the due / submission / receipt being paid. */
  referenceId?: string;
};

/**
 * Opens the resident's UPI app through a link generated on the server.
 * The receiving UPI ID is never rendered or stored in the client bundle, and
 * repeated clicks always resolve to the same server-side payment intent.
 */
export function PayButton({
  amount,
  note,
  label = "Pay now",
  size = "sm",
  variant = "hero",
  context = "general",
  referenceId,
}: Props) {
  const startIntent = useServerFn(createPaymentIntent);
  const markOpened = useServerFn(markPaymentOpened);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [intent, setIntent] = useState<{ id: string; url: string } | null>(null);

  const amt = amount && amount > 0 ? Number(amount) : undefined;

  // Deterministic: the same target always maps to the same intent.
  const idempotencyKey = useMemo(
    () => `${context}:${referenceId ?? "general"}:${amt ? amt.toFixed(2) : "open"}`,
    [context, referenceId, amt],
  );

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await startIntent({
        data: { context, referenceId, amount: amt, note, idempotencyKey },
      });
      setIntent({ id: res.intentId, url: res.url });
      setHandedOff(false);
      setOpen(true);
    } catch (err) {
      toast.error("Could not start the payment", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handOff() {
    if (!intent || handedOff) return;
    setHandedOff(true);
    void markOpened({ data: { intentId: intent.id } }).catch(() => {});
    window.location.href = intent.url;
  }

  return (
    <>
      <Button size={size} variant={variant} disabled={busy} onClick={start}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <IndianRupee className="size-4" />}
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay the society</DialogTitle>
            <DialogDescription>
              {amt ? `Amount ₹${amt.toLocaleString("en-IN")}` : "You can enter the amount in your UPI app."}
              {note ? ` · ${note}` : ""}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Tap below to open your UPI app (GPay, PhonePe, Paytm, BHIM…). The payment is completed
            inside your bank's app — this portal never sees your card, UPI PIN or bank details.
          </p>

          <Button variant="hero" className="w-full" disabled={!intent || handedOff} onClick={handOff}>
            {handedOff ? <Loader2 className="size-4 animate-spin" /> : <IndianRupee className="size-4" />}
            {handedOff ? "Opening your UPI app…" : "Open UPI app to pay"}
          </Button>

          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Secure handover — no payment details are stored by Sunland Residency.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
