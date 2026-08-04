import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, MessageSquareWarning, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/app-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Report an issue — Sunland Residency" },
      {
        name: "description",
        content:
          "Report a problem with the Sunland Residency portal or raise a society complaint. Open to residents and visitors.",
      },
      { property: "og:title", content: "Report an issue — Sunland Residency" },
      {
        property: "og:description",
        content: "Send the committee a report about the portal or the society.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email("Enter a valid email address").max(255).optional().or(z.literal("")),
  category: z.enum(["website", "society", "maintenance", "security", "general"]),
  subject: z.string().trim().min(3, "Add a short subject").max(140),
  message: z.string().trim().min(10, "Please describe the issue").max(2000),
});

function ReportPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("website");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ name, email, category, subject, message });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { data: session } = await supabase.auth.getSession();
    const { error } = await supabase.from("reports").insert({
      name: parsed.data.name || null,
      email: parsed.data.email || null,
      category: parsed.data.category,
      subject: parsed.data.subject,
      message: parsed.data.message,
      user_id: session.session?.user.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not send the report", { description: error.message });
      return;
    }
    setSent(true);
    toast.success("Report sent to the committee");
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <section className="panel p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground">
            <MessageSquareWarning className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Report an issue</h1>
            <p className="text-xs text-muted-foreground">
              Anyone can use this form — residents, guests or visitors.
            </p>
          </div>
        </div>

        {sent ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-accent/30 p-4 text-sm text-muted-foreground">
              Thank you — your report has reached the Sunland Residency committee. If you left an
              email address, they will get back to you there.
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>
              Send another report
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rp-name">Your name (optional)</Label>
                <Input id="rp-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rp-email">Email (optional)</Label>
                <Input
                  id="rp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="website">Website problem</SelectItem>
                  <SelectItem value="society">Society matter</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="security">Security concern</SelectItem>
                  <SelectItem value="general">Something else</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rp-subject">Subject</Label>
              <Input
                id="rp-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Lift not working in Block B"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rp-message">Details</Label>
              <Textarea
                id="rp-message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell the committee what happened…"
              />
            </div>

            <Button type="submit" variant="hero" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send report
            </Button>
          </form>
        )}

        <Button asChild variant="ghost" className="mt-4 w-full">
          <Link to="/">
            <ArrowLeft className="size-4" />
            Back to the portal
          </Link>
        </Button>
      </section>
    </div>
  );
}
