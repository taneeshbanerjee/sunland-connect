import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, KeyRound, Loader2, MailQuestion, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/app-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResetSteps } from "@/components/ResetSteps";
import { authErrorMessage } from "@/lib/auth-errors";
import { otpSendGate, otpVerifyOutcome } from "@/lib/otp-guard.functions";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password — Sunland Residency" },
      {
        name: "description",
        content:
          "Reset your Sunland Residency portal password with a 6-digit verification code sent to your registered email.",
      },
      { property: "og:title", content: "Reset your password — Sunland Residency" },
      {
        property: "og:description",
        content: "Verify with a 6-digit email code and choose a new Sunland Residency password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

type Step = 1 | 2 | 3;

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    },
    [],
  );

  function startCooldown(seconds = 45) {
    setCooldown(seconds);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function resetAll() {
    setEmail("");
    setCode("");
    setPassword("");
    setConfirm("");
    setStep(1);
    setCooldown(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
  }

  /** Step 1 — request the 6-digit code (server-side rate limited). */
  async function sendCode(target: string) {
    setBusy(true);
    const gate = await otpSendGate({ data: { email: target } }).catch(() => null);
    if (gate && !gate.allowed) {
      setBusy(false);
      const mins = Math.ceil(gate.retryAfterSeconds / 60);
      toast.error("Too many code requests", {
        description: `For security, try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
      });
      startCooldown(gate.retryAfterSeconds);
      return false;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      const msg = authErrorMessage(error);
      toast.error(msg.title, { description: msg.description });
      return false;
    }
    startCooldown();
    toast.success("Verification code sent", {
      description:
        gate && gate.remaining <= 1
          ? "Check your inbox. This is your last code request for this hour."
          : "Check your inbox for the 6-digit code. It expires in 60 minutes.",
    });
    return true;
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().email("Enter a valid email address").max(255).safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setEmail(parsed.data);
    if (await sendCode(parsed.data)) {
      setCode("");
      setStep(2);
    }
  }

  /** Step 2 — verify the code. */
  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .string()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your email")
      .safeParse(code.trim());
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: parsed.data,
      type: "email",
    });
    if (error || !data.session) {
      const outcome = await otpVerifyOutcome({
        data: { email, success: false },
      }).catch(() => null);
      setBusy(false);
      if (outcome?.locked) {
        const mins = Math.ceil(outcome.retryAfterSeconds / 60);
        toast.error("Too many incorrect codes", {
          description: `This reset is locked for ${mins} minutes. Try again later.`,
        });
        resetAll();
        return;
      }
      const msg = authErrorMessage(error ?? { message: "Invalid code" });
      toast.error("Incorrect or expired code", {
        description:
          outcome && typeof outcome.remaining === "number"
            ? `${msg.description} ${outcome.remaining} attempt${outcome.remaining === 1 ? "" : "s"} left.`
            : msg.description,
      });
      return;
    }
    await otpVerifyOutcome({ data: { email, success: true } }).catch(() => {});
    setBusy(false);
    toast.success("Code verified", { description: "Now choose your new password." });
    setStep(3);
  }

  /** Step 3 — set the new password. */
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .string()
      .min(8, "Use at least 8 characters")
      .max(128)
      .regex(/[a-z]/, "Include a lowercase letter")
      .regex(/[A-Z0-9]/, "Include a number or capital letter")
      .safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    if (error) {
      setBusy(false);
      const msg = authErrorMessage(error);
      toast.error(msg.title, { description: msg.description });
      return;
    }
    await recordAuthEvent({ data: { action: "password_changed", reason: "otp_reset" } }).catch(
      () => {},
    );
    // Clear every temporary auth/OTP state and send them back to a clean login.
    await supabase.auth.signOut();
    setBusy(false);
    resetAll();
    toast.success("Password reset successful!", {
      description: "Sign in with your new password.",
    });
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="panel w-full max-w-md p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground">
            {step === 3 ? <KeyRound className="size-5" /> : <MailQuestion className="size-5" />}
          </span>
          <div>
            <h1 className="text-lg font-semibold">
              {step === 1 && "Forgot your password?"}
              {step === 2 && "Enter your code"}
              {step === 3 && "Set a new password"}
            </h1>
            <p className="text-xs text-muted-foreground">Sunland Residency portal</p>
          </div>
        </div>

        <ResetSteps current={step} />

        {step === 1 && (
          <form onSubmit={handleRequest} className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Enter your registered email and we'll send a 6-digit verification code.
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
              Send verification code
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">{email}</span>. Check your spam or
              “Promotions” folder if it hasn't arrived.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fp-code">Verification code</Label>
              <Input
                id="fp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="text-center text-xl tracking-[0.5em]"
                required
              />
            </div>
            <Button type="submit" variant="hero" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Verify code
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={busy || cooldown > 0}
              onClick={() => void sendCode(email)}
            >
              <RefreshCw className="size-4" />
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setCode("");
                setStep(1);
              }}
            >
              <ArrowLeft className="size-4" />
              Back to email
            </Button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fp-pass">New password</Label>
              <Input
                id="fp-pass"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Minimum 8 characters with a number or capital letter.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fp-confirm">Confirm new password</Label>
              <Input
                id="fp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="hero" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Update password
            </Button>
          </form>
        )}

        {step !== 3 && (
          <Button asChild variant="ghost" className="mt-4 w-full">
            <Link to="/">
              <ArrowLeft className="size-4" />
              Back to sign in
            </Link>
          </Button>
        )}
      </section>
    </div>
  );
}
