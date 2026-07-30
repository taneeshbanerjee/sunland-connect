import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Wallet, FileText, Bell, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/use-me";
import { receiptFileUrl } from "@/lib/receipts.functions";


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My Dashboard — Sunland Residency" },
      {
        name: "description",
        content:
          "Check your Sunland Residency maintenance status, pending committee submissions and latest announcements.",
      },
      { property: "og:title", content: "My Dashboard — Sunland Residency" },
      {
        property: "og:description",
        content: "Your maintenance status, submissions and society announcements at a glance.",
      },
    ],
  }),
  component: Dashboard,
});

function money(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
}

function Dashboard() {
  const me = useMe();
  const queryClient = useQueryClient();
  const userId = me.user?.id;


  const dues = useQuery({
    queryKey: ["my-dues", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_dues")
        .select("*")
        .eq("user_id", userId!)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const submissions = useQuery({
    queryKey: ["my-submissions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [requests, mine] = await Promise.all([
        supabase.from("submission_requests").select("*").order("created_at", { ascending: false }),
        supabase.from("submissions").select("*").eq("user_id", userId!),
      ]);
      if (requests.error) throw requests.error;
      if (mine.error) throw mine.error;
      return (requests.data ?? []).map((r) => ({
        ...r,
        done: mine.data?.find((s) => s.request_id === r.id)?.submitted ?? false,
      }));
    },
  });

  const announcements = useQuery({
    queryKey: ["announcements-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data;
    },
  });

  const receipts = useQuery({
    queryKey: ["my-receipts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingDues = (dues.data ?? []).filter((d) => d.status !== "paid");
  const outstanding = pendingDues.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const pendingSubs = (submissions.data ?? []).filter((s) => !s.done);
  const newReceipts = (receipts.data ?? []).filter((r) => !r.acknowledged);

  async function acknowledge(id: string) {
    const { error } = await supabase.from("receipts").update({ acknowledged: true }).eq("id", id);
    if (error) {
      toast.error("Could not update", { description: error.message });
      return;
    }
    toast.success("Receipt marked as received");
    void queryClient.invalidateQueries({ queryKey: ["my-receipts", userId] });
  }

  async function openFile(id: string) {
    try {
      const res = await receiptFileUrl({ data: { receiptId: id } });
      if (res?.url) window.open(res.url, "_blank", "noopener");
      else toast("No file attached to this receipt");
    } catch (err) {
      toast.error("Could not open the receipt", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">
          Hello, {me.profile?.full_name?.split(" ")[0] || "resident"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {me.profile?.flat_no ? `Flat ${me.profile.flat_no} · ` : ""}Here is where your household
          stands today.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Maintenance outstanding"
          value={dues.isLoading ? null : money(outstanding)}
          tone={outstanding > 0 ? "warning" : "success"}
          hint={outstanding > 0 ? `${pendingDues.length} unpaid period(s)` : "All cleared"}
          hash="maintenance"
        />
        <StatCard
          icon={FileText}
          label="Pending submissions"
          value={submissions.isLoading ? null : String(pendingSubs.length)}
          tone={pendingSubs.length > 0 ? "warning" : "success"}
          hint={pendingSubs.length > 0 ? "Action needed from you" : "Nothing pending"}
          hash="submissions"
        />
        <StatCard
          icon={Receipt}
          label="Receipts"
          value={receipts.isLoading ? null : String(receipts.data?.length ?? 0)}
          tone={newReceipts.length > 0 ? "warning" : "primary"}
          hint={newReceipts.length > 0 ? `${newReceipts.length} new for you` : "Nothing new"}
          hash="receipts"
        />
        <StatCard
          icon={Bell}
          label="Announcements"
          value={announcements.isLoading ? null : String(announcements.data?.length ?? 0)}
          tone="primary"
          hint="Recent notices from the committee"
          to="/announcements"
        />
      </div>


      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="text-base">Maintenance ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dues.isLoading && <Skeleton className="h-20 w-full" />}
            {!dues.isLoading && (dues.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                No maintenance records have been added for your flat yet.
              </p>
            )}
            {(dues.data ?? []).map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-accent/25 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{d.period}</p>
                  <p className="text-xs text-muted-foreground">
                    {money(Number(d.amount))}
                    {d.due_date ? ` · due ${d.due_date}` : ""}
                  </p>
                </div>
                <StatusBadge paid={d.status === "paid"} partial={d.status === "partial"} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="text-base">Committee submissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {submissions.isLoading && <Skeleton className="h-20 w-full" />}
            {!submissions.isLoading && (submissions.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                The committee has not requested anything right now.
              </p>
            )}
            {(submissions.data ?? []).map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-accent/25 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  )}
                  {s.due_date && (
                    <p className="mt-1 text-[11px] text-muted-foreground">Deadline {s.due_date}</p>
                  )}
                </div>
                <StatusBadge paid={s.done} submitLabel />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="text-base">Latest announcements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {announcements.isLoading && <Skeleton className="h-16 w-full" />}
          {!announcements.isLoading && (announcements.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          )}
          {(announcements.data ?? []).map((a) => (
            <div key={a.id} className="rounded-lg border border-border/70 bg-accent/25 px-4 py-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{a.title}</p>
                {a.importance !== "normal" && (
                  <Badge variant={a.importance === "urgent" ? "destructive" : "secondary"}>
                    {a.importance}
                  </Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {a.author_name ?? "Committee"} · {new Date(a.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  paid,
  partial,
  submitLabel,
}: {
  paid: boolean;
  partial?: boolean;
  submitLabel?: boolean;
}) {
  if (paid) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="size-3.5" />
        {submitLabel ? "Submitted" : "Paid"}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning">
      <AlertCircle className="size-3.5" />
      {submitLabel ? "Pending" : partial ? "Partial" : "Unpaid"}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  hash,
  to,
}: {
  icon: typeof Wallet;
  label: string;
  value: string | null;
  hint: string;
  tone: "success" | "warning" | "primary";
  hash?: string;
  to?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-success bg-success/15"
      : tone === "warning"
        ? "text-warning bg-warning/15"
        : "text-primary bg-primary/15";

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={`flex size-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-4" />
        </span>
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-3 text-2xl font-semibold">{value}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </>
  );

  const className =
    "panel block p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent/30";

  if (to === "/announcements") {
    return (
      <Link to="/announcements" className={className}>
        {inner}
      </Link>
    );
  }

  if (hash) {
    return (
      <a href={`#${hash}`} className={className}>
        {inner}
      </a>
    );
  }

  return <div className="panel p-5">{inner}</div>;
}

