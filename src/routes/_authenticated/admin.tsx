import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck,
  Users,
  Wallet,
  FileText,
  Loader2,
  Trash2,
  Receipt as ReceiptIcon,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMe } from "@/lib/use-me";
import { ROLE_LABEL, ROLE_BLURB, MANAGED_ROLES, type AppRole } from "@/lib/roles";
import {
  assignRole,
  revokeRole,
  listCommittee,
  transferRole,
  deleteResident,
} from "@/lib/admin.functions";
import { issueReceipt, deleteReceipt } from "@/lib/receipts.functions";
import { AuditTrail } from "@/components/AuditTrail";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Committee Admin — Sunland Residency" },
      {
        name: "description",
        content:
          "Committee console for Sunland Residency: manage residents, maintenance dues, submissions, receipts and admin roles.",
      },
      { property: "og:title", content: "Committee Admin — Sunland Residency" },
      {
        property: "og:description",
        content: "Manage residents, dues, submissions, receipts and committee roles.",
      },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const me = useMe();

  if (!me.ready) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!me.committee) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <ShieldCheck className="mx-auto size-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Restricted area</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This console is only available to committee members.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Committee console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in with elevated access. Every action here is verified again on the server.
        </p>
      </div>

      <Tabs defaultValue="residents">
        <TabsList>
          <TabsTrigger value="residents">Residents</TabsTrigger>
          <TabsTrigger value="dues">Maintenance</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          {me.elevated && <TabsTrigger value="receipts">Receipts</TabsTrigger>}
          {me.supreme && <TabsTrigger value="roles">Admin roles</TabsTrigger>}
          {me.elevated && <TabsTrigger value="audit">Audit trail</TabsTrigger>}
        </TabsList>

        <TabsContent value="residents" className="mt-6">
          <ResidentsPanel />
        </TabsContent>
        <TabsContent value="dues" className="mt-6">
          <DuesPanel canEdit={me.elevated} />
        </TabsContent>
        <TabsContent value="submissions" className="mt-6">
          <SubmissionsPanel canEdit={me.elevated} />
        </TabsContent>
        {me.elevated && (
          <TabsContent value="receipts" className="mt-6">
            <ReceiptsPanel />
          </TabsContent>
        )}
        {me.supreme && (
          <TabsContent value="roles" className="mt-6">
            <RolesPanel />
          </TabsContent>
        )}
        {me.elevated && (
          <TabsContent value="audit" className="mt-6">
            <AuditTrail />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type DirectoryRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  flat_no: string | null;
  hide_flat_no: boolean;
};

function useResidents() {
  return useQuery({
    queryKey: ["residents"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("residents_directory");
      if (error) throw error;
      return ((data ?? []) as DirectoryRow[]).sort((a, b) =>
        (a.flat_no ?? "~").localeCompare(b.flat_no ?? "~"),
      );
    },
  });
}

function ResidentsPanel() {
  const me = useMe();
  const queryClient = useQueryClient();
  const residents = useResidents();
  const removeResident = useServerFn(deleteResident);
  const transfer = useServerFn(transferRole);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = (residents.data ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return `${r.full_name ?? ""} ${r.flat_no ?? ""} ${r.email ?? ""}`.toLowerCase().includes(s);
  });

  async function onDelete(r: DirectoryRow) {
    if (!window.confirm(`Remove ${r.full_name || r.email} from Sunland Residency?`)) return;
    setBusyId(r.id);
    try {
      await removeResident({ data: { userId: r.id } });
      toast.success("Resident removed");
      void queryClient.invalidateQueries({ queryKey: ["residents"] });
      void queryClient.invalidateQueries({ queryKey: ["committee"] });
    } catch (err) {
      toast.error("Could not remove resident", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onTransfer(r: DirectoryRow, role: string) {
    setBusyId(r.id);
    try {
      await transfer({
        data: { userId: r.id, role: role as "super_admin" | "treasurer" | "president" },
      });
      toast.success(`${ROLE_LABEL[role as AppRole]} role transferred to ${r.full_name || r.email}`);
      void queryClient.invalidateQueries({ queryKey: ["committee"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error("Could not transfer role", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="panel border-0 bg-transparent">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" />
          Residency database ({rows.length})
        </CardTitle>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, flat or email"
          className="max-w-xs"
        />
      </CardHeader>
      <CardContent>
        {residents.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flat</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                {me.elevated && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.flat_no || (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <EyeOff className="size-3.5" /> hidden
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{r.full_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.email}</TableCell>
                  <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                  {me.elevated && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {me.superAdmin && r.id !== me.user?.id && (
                          <Select
                            value=""
                            onValueChange={(v) => onTransfer(r, v)}
                            disabled={busyId === r.id}
                          >
                            <SelectTrigger className="h-8 w-[150px] text-xs">
                              <SelectValue placeholder="Assign role" />
                            </SelectTrigger>
                            <SelectContent>
                              {MANAGED_ROLES.map((role) => (
                                <SelectItem key={role} value={role}>
                                  Make {ROLE_LABEL[role]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${r.full_name || r.email}`}
                          disabled={busyId === r.id || r.id === me.user?.id}
                          onClick={() => onDelete(r)}
                        >
                          {busyId === r.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


function DuesPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const residents = useResidents();
  const [userId, setUserId] = useState("");
  const [period, setPeriod] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const dues = useQuery({
    queryKey: ["all-dues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_dues")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const nameOf = (id: string) => {
    const r = residents.data?.find((x) => x.id === id);
    return r ? `${r.flat_no ? r.flat_no + " · " : ""}${r.full_name || r.email}` : id.slice(0, 8);
  };

  async function addDue(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        userId: z.string().uuid("Choose a resident"),
        period: z.string().trim().min(2, "Enter a period, e.g. Jan 2026").max(60),
        amount: z.coerce.number().min(0).max(10_000_000),
      })
      .safeParse({ userId, period, amount });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("maintenance_dues").insert({
      user_id: parsed.data.userId,
      period: parsed.data.period,
      amount: parsed.data.amount,
      due_date: dueDate || null,
      status: "unpaid",
    });
    setBusy(false);
    if (error) {
      toast.error("Could not add record", { description: error.message });
      return;
    }
    setPeriod("");
    setAmount("");
    setDueDate("");
    toast.success("Maintenance record added");
    void queryClient.invalidateQueries({ queryKey: ["all-dues"] });
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase
      .from("maintenance_dues")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["all-dues"] });
  }

  async function removeDue(id: string) {
    const { error } = await supabase.from("maintenance_dues").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["all-dues"] });
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <Card className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-primary" />
              Raise a maintenance record
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addDue} className="grid gap-4 md:grid-cols-5">
              <div className="space-y-2 md:col-span-2">
                <Label>Resident</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select resident" />
                  </SelectTrigger>
                  <SelectContent>
                    {(residents.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.flat_no ? `${r.flat_no} · ` : ""}
                        {r.full_name || r.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-period">Period</Label>
                <Input
                  id="d-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  placeholder="Jan 2026"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-amount">Amount (₹)</Label>
                <Input
                  id="d-amount"
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="2500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-due">Due date</Label>
                <Input
                  id="d-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="md:col-span-5">
                <Button type="submit" variant="hero" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Add record
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="text-base">All maintenance records</CardTitle>
        </CardHeader>
        <CardContent>
          {dues.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dues.data ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{nameOf(d.user_id)}</TableCell>
                    <TableCell>{d.period}</TableCell>
                    <TableCell>₹{Number(d.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "paid" ? "secondary" : "destructive"}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={() => setStatus(d.id, d.status === "paid" ? "unpaid" : "paid")}
                          >
                            Mark {d.status === "paid" ? "unpaid" : "paid"}
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removeDue(d.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubmissionsPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const residents = useResidents();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const requests = useQuery({
    queryKey: ["submission-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("submission_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const submissions = useQuery({
    queryKey: ["all-submissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("submissions").select("*");
      if (error) throw error;
      return data;
    },
  });

  async function createRequest(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        title: z.string().trim().min(3, "Give the request a title").max(140),
        description: z.string().trim().max(1000).optional(),
        paymentAmount: z.coerce.number().min(0).max(10_000_000).optional(),
      })
      .safeParse({
        title,
        description,
        paymentAmount: paymentAmount === "" ? undefined : paymentAmount,
      });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("submission_requests").insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      due_date: dueDate || null,
      payment_required: paymentRequired,
      payment_amount: paymentRequired ? (parsed.data.paymentAmount ?? null) : null,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not create request", { description: error.message });
      return;
    }
    setTitle("");
    setDescription("");
    setDueDate("");
    setPaymentRequired(false);
    setPaymentAmount("");
    toast.success("Submission request created");
    void queryClient.invalidateQueries({ queryKey: ["submission-requests"] });
  }


  async function toggle(requestId: string, resId: string, current: boolean) {
    const { error } = await supabase.from("submissions").upsert(
      {
        request_id: requestId,
        user_id: resId,
        submitted: !current,
        submitted_at: !current ? new Date().toISOString() : null,
      },
      { onConflict: "request_id,user_id" },
    );
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["all-submissions"] });
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <Card className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" />
              Ask residents to submit something
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createRequest} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <div className="space-y-2">
                  <Label htmlFor="s-title">What is required</Label>
                  <Input
                    id="s-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Police verification of domestic help"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="s-due">Deadline</Label>
                  <Input
                    id="s-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-desc">Details</Label>
                <Textarea
                  id="s-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="rounded-lg border border-border/70 bg-accent/25 p-4">
                <label className="flex items-center gap-3 text-sm font-medium">
                  <Checkbox
                    checked={paymentRequired}
                    onCheckedChange={(v) => setPaymentRequired(v === true)}
                  />
                  Ask residents to pay for this submission
                </label>
                <p className="mt-1 pl-7 text-xs text-muted-foreground">
                  When checked, a secure “Pay now” button appears on every resident's dashboard for
                  this request.
                </p>
                {paymentRequired && (
                  <div className="mt-3 max-w-[220px] space-y-2 pl-7">
                    <Label htmlFor="s-pay-amount">Amount (₹, optional)</Label>
                    <Input
                      id="s-pay-amount"
                      type="number"
                      min="0"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="2500"
                    />
                  </div>
                )}
              </div>
              <Button type="submit" variant="hero" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Create request
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {(requests.data ?? []).map((r) => (
        <Card key={r.id} className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {r.title}
              {r.payment_required && (
                <Badge variant="secondary">
                  Payment requested
                  {r.payment_amount
                    ? ` · ₹${Number(r.payment_amount).toLocaleString("en-IN")}`
                    : ""}
                </Badge>
              )}
            </CardTitle>
            {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
          </CardHeader>

          <CardContent>
            {residents.isLoading || submissions.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(residents.data ?? []).map((res) => {
                  const done =
                    submissions.data?.find((s) => s.request_id === r.id && s.user_id === res.id)
                      ?.submitted ?? false;
                  return (
                    <div
                      key={res.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-accent/25 px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {res.flat_no ? `${res.flat_no} · ` : ""}
                        {res.full_name || res.email}
                      </span>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant={done ? "subtle" : "outline"}
                          onClick={() => toggle(r.id, res.id, done)}
                        >
                          {done ? "Submitted" : "Pending"}
                        </Button>
                      ) : (
                        <Badge variant={done ? "secondary" : "destructive"}>
                          {done ? "Submitted" : "Pending"}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReceiptsPanel() {
  const queryClient = useQueryClient();
  const residents = useResidents();
  const issue = useServerFn(issueReceipt);
  const remove = useServerFn(deleteReceipt);

  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const receipts = useQuery({
    queryKey: ["all-receipts"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const nameOf = (id: string) => {
    const r = residents.data?.find((x) => x.id === id);
    return r ? `${r.flat_no ? r.flat_no + " · " : ""}${r.full_name || r.email}` : id.slice(0, 8);
  };

  async function toBase64(f: File) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]);
    return btoa(binary);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        userId: z.string().uuid("Choose a resident"),
        title: z.string().trim().min(2, "Give the receipt a title").max(140),
        amount: z.coerce.number().min(0).max(10_000_000),
      })
      .safeParse({ userId, title, amount });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (file && file.size > 4 * 1024 * 1024) {
      toast.error("File is too large", { description: "Please upload a file under 4 MB." });
      return;
    }
    setBusy(true);
    try {
      await issue({
        data: {
          userId: parsed.data.userId,
          title: parsed.data.title,
          amount: parsed.data.amount,
          period: period || undefined,
          note: note || undefined,
          fileName: file?.name,
          fileType: file?.type,
          fileBase64: file ? await toBase64(file) : undefined,
        },
      });
      setTitle("");
      setAmount("");
      setPeriod("");
      setNote("");
      setFile(null);
      setFileKey((k) => k + 1);
      toast.success("Receipt sent to the resident");
      void queryClient.invalidateQueries({ queryKey: ["all-receipts"] });
    } catch (err) {
      toast.error("Could not issue the receipt", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function drop(id: string, label: string) {
    if (!window.confirm(`Delete the receipt “${label}”? The resident will no longer see it.`))
      return;
    try {
      await remove({ data: { id } });
      toast.success("Receipt deleted");
      void queryClient.invalidateQueries({ queryKey: ["all-receipts"] });
      void queryClient.invalidateQueries({ queryKey: ["my-receipts"] });
    } catch (err) {
      toast.error("Could not delete", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }


  return (
    <div className="space-y-6">
      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptIcon className="size-4 text-primary" />
            Issue a receipt
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The resident sees the receipt on their dashboard and can acknowledge it.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Resident</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select resident" />
                </SelectTrigger>
                <SelectContent>
                  {(residents.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.flat_no ? `${r.flat_no} · ` : ""}
                      {r.full_name || r.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-title">Title</Label>
              <Input
                id="rc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Maintenance receipt"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-amount">Amount (₹)</Label>
              <Input
                id="rc-amount"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-period">Period</Label>
              <Input
                id="rc-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="Jan 2026"
              />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="rc-note">Note</Label>
              <Input
                id="rc-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Received with thanks"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="rc-file">Scanned receipt (optional)</Label>
              <Input
                key={fileKey}
                id="rc-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-accent/25 px-3 py-2 text-xs">
                  <span className="truncate">
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFile(null);
                      setFileKey((k) => k + 1);
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                    Remove file
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-end md:col-span-2">
              <Button type="submit" variant="hero" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Send receipt
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="text-base">Issued receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {receipts.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipts.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{nameOf(r.user_id)}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>₹{Number(r.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant={r.acknowledged ? "secondary" : "destructive"}>
                        {r.acknowledged ? "acknowledged" : "sent"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete receipt ${r.title}`}
                        onClick={() => drop(r.id, r.title)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                        Delete
                      </Button>
                    </TableCell>

                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolesPanel() {
  const queryClient = useQueryClient();
  const assign = useServerFn(assignRole);
  const revoke = useServerFn(revokeRole);
  const fetchCommittee = useServerFn(listCommittee);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("president");
  const [busy, setBusy] = useState(false);

  const committee = useQuery({
    queryKey: ["committee"],
    staleTime: 30_000,
    queryFn: () => fetchCommittee(),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z.string().trim().email().safeParse(email);
    if (!parsed.success) {
      toast.error("Enter a valid resident email");
      return;
    }
    setBusy(true);
    try {
      await assign({
        data: {
          email: parsed.data,
          role: role as "super_admin" | "treasurer" | "president",
        },
      });
      setEmail("");
      toast.success(`${ROLE_LABEL[role]} access granted`);
      await queryClient.invalidateQueries({ queryKey: ["committee"] });
      void queryClient.invalidateQueries({ queryKey: ["residents"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error("Could not assign role", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function drop(userId: string, r: string) {
    if (!MANAGED_ROLES.includes(r as AppRole)) return;
    try {
      await revoke({
        data: { userId, role: r as "super_admin" | "treasurer" | "president" },
      });
      toast.success("Access revoked");
      await queryClient.invalidateQueries({ queryKey: ["committee"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      toast.error("Could not revoke", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {MANAGED_ROLES.map((r) => (
          <div key={r} className="panel p-4">
            <p className="text-sm font-semibold text-primary">{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ROLE_BLURB[r]}</p>
          </div>
        ))}
      </div>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            Grant committee access
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The person must already have a resident account. Roles are single-holder: granting one
            moves it away from the current holder, who stays a resident.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_200px_auto]">
            <div className="space-y-2">
              <Label htmlFor="r-email">Resident email</Label>
              <Input
                id="r-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANAGED_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="hero" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Grant access
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="panel border-0 bg-transparent">
        <CardHeader>
          <CardTitle className="text-base">Current committee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {committee.isLoading && <Skeleton className="h-20 w-full" />}
          {(committee.data ?? []).map((m) => (
            <div
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-accent/25 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{m.fullName || m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {ROLE_LABEL[r as AppRole] ?? r}
                  </Badge>
                ))}
                {m.roles
                  .filter((r) => MANAGED_ROLES.includes(r as AppRole))
                  .map((r) => (
                    <Button
                      key={`rm-${r}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => drop(m.userId, r)}
                    >
                      Revoke {ROLE_LABEL[r as AppRole]}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

