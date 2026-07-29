import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, MailQuestion, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResetSteps } from "@/components/ResetSteps";
import { authErrorMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Forgot password — Sunland Residency" },
      {
        name: "description",
        content:
          "Request a secure password reset link for your Sunland Residency resident portal account.",
      },
      { property: "og:title", content: "Forgot password — Sunland Residency" },
      {
        property: "og:description",
        content: "Send yourself a secure link to set a new Sunland Residency password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  async function send(target: string) {
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      const msg = authErrorMessage(error);
      toast.error(msg.title, { description: msg.description });
      return false;
    }
    setSentTo(target);
    setCooldown(45);
    const timer = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    toast.success("Reset link sent", { description: "It usually arrives within a minute." });
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().email("Enter a valid email address").max(255).safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    await send(parsed.data);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="panel w-full max-w-md p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground">
            <MailQuestion className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Forgot your password?</h1>
            <p className="text-xs text-muted-foreground">Sunland Residency portal</p>
          </div>
        </div>

        <ResetSteps current={sentTo ? 2 : 1} />

        {sentTo ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-accent/30 p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                If an account exists for{" "}
                <span className="font-medium text-foreground">{sentTo}</span>, a secure reset link
                is on its way.
              </p>
            </div>
            <ol className="space-y-3 text-sm text-muted-foreground">
              {[
                "Open the email from Sunland Residency.",
                "Tap the “Reset password” link — it opens this portal.",
                "Choose a new password and you're signed straight in.",
              ].map((line, i) => (
                <li key={line} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  {line}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">
              Nothing yet? Check your spam or “Promotions” folder — the link expires in 60 minutes.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy || cooldown > 0}
              onClick={() => void send(sentTo)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Enter your registered email and we'll send a secure link to set a new password.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fp-email">Email</Label>
              <Input
                id="fp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <Button type="submit" variant="hero" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send reset link
            </Button>
          </form>
        )}

        <Button asChild variant="ghost" className="mt-4 w-full">
          <Link to="/">
            <ArrowLeft className="size-4" />
            Back to sign in
          </Link>
        </Button>
      </section>
    </div>
  );
}
