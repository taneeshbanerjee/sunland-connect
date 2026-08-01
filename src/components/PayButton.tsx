import { useState } from "react";
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
import { buildUpiLink } from "@/lib/payments.functions";

type Props = {
  amount?: number | null;
  note?: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "hero" | "subtle" | "outline";
};

/**
 * Opens the resident's UPI app through a link generated on the server.
 * The receiving UPI ID is never rendered or stored in the client bundle.
 */
export function PayButton({
  amount,
  note,
  label = "Pay now",
  size = "sm",
  variant = "hero",
}: Props) {
  const getLink = useServerFn(buildUpiLink);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    try {
      const res = await getLink({
        data: { amount: amount && amount > 0 ? amount : undefined, note },
      });
      setUrl(res.url);
      setOpen(true);
    } catch (err) {
      toast.error("Could not start the payment", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
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
              {amount && amount > 0
                ? `Amount ₹${Number(amount).toLocaleString("en-IN")}`
                : "You can enter the amount in your UPI app."}
              {note ? ` · ${note}` : ""}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Tap below to open your UPI app (GPay, PhonePe, Paytm, BHIM…). The payment is completed
            inside your bank's app — this portal never sees your card, UPI PIN or bank details.
          </p>

          <Button
            variant="hero"
            className="w-full"
            onClick={() => {
              if (url) window.location.href = url;
            }}
          >
            <IndianRupee className="size-4" />
            Open UPI app to pay
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
