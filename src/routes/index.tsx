import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Lock, ShieldCheck, Loader2, MailQuestion, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authErrorMessage } from "@/lib/auth-errors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sunland Residency — Resident & Committee Portal" },
      {
        name: "description",
        content:
          "Secure portal for Sunland Residency: check maintenance dues, track committee submissions and read society announcements.",
      },
      { property: "og:title", content: "Sunland Residency — Resident & Committee Portal" },
      {
        property: "og:description",
        content:
          "Sign in to check your maintenance status, pending submissions and society announcements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"auth" | "forgot">("auth");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [flatNo, setFlatNo] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) navigate({ to: "/dashboard", replace: true });
      else setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        email: z.string().trim().email("Enter a valid email address").max(255),
        password: z.string().min(1, "Enter your password").max(128),
      })
      .safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setBusy(false);
    if (error || !data.session) {
      const msg = authErrorMessage(error ?? { message: "No session returned" });
      toast.error(msg.title, { description: msg.description });
      return;
    }
    toast.success("Signed in");
    navigate({ to: "/dashboard", replace: true });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        email: z.string().trim().email("Enter a valid email address").max(255),
        password: z
          .string()
          .min(8, "Use at least 8 characters")
          .max(128)
          .regex(/[a-z]/, "Include a lowercase letter")
          .regex(/[A-Z0-9]/, "Include a number or capital letter"),
        fullName: z.string().trim().min(2, "Enter your full name").max(100),
        flatNo: z.string().trim().max(20).optional(),
        phone: z.string().trim().max(20).optional(),
      })
      .safeParse({ email, password, fullName, flatNo, phone });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: parsed.data.fullName,
          flat_no: parsed.data.flatNo ?? "",
          phone: parsed.data.phone ?? "",
        },
      },
    });
    if (error) {
      setBusy(false);
      const msg = authErrorMessage(error);
      toast.error(msg.title, { description: msg.description });
      return;
    }

    // Always establish a fresh session for the new account.
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setBusy(false);
    if (signInError || !signedIn.session) {
      toast.success("Account created", {
        description: "Please sign in with your new details to continue.",
      });
      return;
    }
    void data;
    toast.success("Welcome to Sunland Residency");
    navigate({ to: "/dashboard", replace: true });
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().email("Enter a valid email address").max(255).safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      const msg = authErrorMessage(error);
      toast.error(msg.title, { description: msg.description });
      return;
    }
    setSentTo(parsed.data);
    toast.success("Reset link sent", { description: "Check your inbox and spam folder." });
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-2">
        <section className="hidden lg:block">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-accent/40 px-3 py-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            End-to-end secured resident records
          </span>
          <h1 className="mt-6 text-5xl font-semibold leading-[1.05]">
            Welcome to <span className="text-gradient">Sunland Residency</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            One place for every household — check whether your maintenance is cleared, see what the
            committee still needs from you, and never miss an announcement again.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
            {[
              "Live maintenance ledger for every flat",
              "Committee submission tracking",
              "Instant announcement notifications",
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="size-1.5 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground">
              <Building2 className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Resident access</h2>
              <p className="text-xs text-muted-foreground">Sunland Residency portal</p>
            </div>
          </div>

          {mode === "forgot" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MailQuestion className="size-4 text-primary" />
                Reset your password
              </div>
              {sentTo ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  If an account exists for <span className="text-foreground">{sentTo}</span>, a
                  password reset link is on its way. The link opens a page where you can choose a
                  new password.
                </p>
              ) : (
                <form onSubmit={handleForgot} className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Enter your registered email and we'll send you a secure link to set a new
                    password.
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
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Send reset link
                  </Button>
                </form>
              )}
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setSentTo(null);
                  setMode("auth");
                }}
              >
                <ArrowLeft className="size-4" />
                Back to sign in
              </Button>
            </div>
          ) : (
          <Tabs defaultValue="signin">

            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="si-email">Email</Label>
                  <Input
                    id="si-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="si-pass">Password</Label>
                  <Input
                    id="si-pass"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" variant="hero" className="w-full" disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                  Sign in securely
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="su-name">Full name</Label>
                  <Input
                    id="su-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Resident name"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="su-flat">Flat no.</Label>
                    <Input
                      id="su-flat"
                      value={flatNo}
                      onChange={(e) => setFlatNo(e.target.value)}
                      placeholder="A-402"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-phone">Phone</Label>
                    <Input
                      id="su-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="9876543210"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-email">Email</Label>
                  <Input
                    id="su-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="su-pass">Password</Label>
                  <Input
                    id="su-pass"
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
                <Button type="submit" variant="hero" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Create my account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          )}

        </section>
      </div>
    </div>
  );
}
