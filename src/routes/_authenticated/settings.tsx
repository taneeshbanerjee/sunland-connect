import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, ShieldCheck, EyeOff, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/use-me";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Notification & Privacy Settings — Sunland Residency" },
      {
        name: "description",
        content:
          "Choose whether to receive Sunland Residency announcement notifications, hide your flat number and set up two-factor authentication.",
      },
      { property: "og:title", content: "Notification & Privacy Settings — Sunland Residency" },
      {
        property: "og:description",
        content: "Manage announcement alerts, flat-number privacy and two-factor security.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  if (!me.ready) return <Skeleton className="h-64 w-full" />;

  async function update(patch: Record<string, boolean>) {
    setSaving(true);
    const { error } = await supabase.from("profiles").update(patch).eq("id", me.user!.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save", { description: error.message });
      return;
    }
    toast.success("Preferences saved");
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  async function askPermission() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") toast.success("Announcement alerts enabled on this device");
    else toast("Notifications stayed off", { description: "You can change this in site settings." });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control announcement alerts, your privacy and account security.
        </p>
      </div>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="size-4 text-primary" />
            Announcement notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Send me announcement alerts</p>
              <p className="text-xs text-muted-foreground">
                Turn this off to stop push alerts when the committee posts a notice.
              </p>
            </div>
            <Switch
              checked={me.profile?.notify_announcements ?? true}
              disabled={saving}
              onCheckedChange={(v) => update({ notify_announcements: v })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-accent/25 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Browser permission on this device: <strong>{permission}</strong>
            </p>
            {permission === "default" && (
              <Button size="sm" variant="hero" onClick={askPermission}>
                Allow notifications
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <EyeOff className="size-4 text-primary" />
            Flat number privacy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Hide my flat number</p>
              <p className="text-xs text-muted-foreground">
                Committee members will no longer see your flat number. Only the Super Admin and
                Treasurer can still see it.
              </p>
            </div>
            <Switch
              checked={me.profile?.hide_flat_no ?? false}
              disabled={saving}
              onCheckedChange={(v) => update({ hide_flat_no: v })}
            />
          </div>
        </CardContent>
      </Card>

      <TwoFactorCard enrolled={me.profile?.mfa_enrolled ?? false} elevated={me.committee} />
    </div>
  );
}

function TwoFactorCard({ enrolled, elevated }: { enrolled: boolean; elevated: boolean }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Sunland ${Date.now()}`,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not start setup", { description: error.message });
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
  }

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      toast.error("Verification failed", { description: challenge.error.message });
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error("Wrong code", { description: error.message });
      return;
    }
    await supabase.from("profiles").update({ mfa_enrolled: true }).eq("id", me.user!.id);
    setQr(null);
    setCode("");
    toast.success("Two-factor authentication is on");
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  async function disable() {
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.totp ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    await supabase.from("profiles").update({ mfa_enrolled: false }).eq("id", me.user!.id);
    toast.success("Two-factor authentication removed");
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <Card className="panel border-0 bg-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" />
          Two-factor authentication
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {elevated
            ? "Strongly recommended for committee accounts — once enabled, the server refuses privileged actions without a fresh code."
            : "Adds a one-time code from your authenticator app to every sign-in."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {enrolled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-success">
              <KeyRound className="size-4" /> Enabled on your account
            </p>
            <Button variant="ghost" size="sm" onClick={disable}>
              Turn off
            </Button>
          </div>
        ) : qr ? (
          <div className="space-y-4">
            <img
              src={qr}
              alt="Two-factor authentication QR code for Sunland Residency"
              className="size-44 rounded-lg bg-white p-2"
            />
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="mfa-code">Enter the 6-digit code</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <Button variant="hero" onClick={verify} disabled={busy || code.length < 6}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Confirm and enable
            </Button>
          </div>
        ) : (
          <Button variant="hero" onClick={startEnroll} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
