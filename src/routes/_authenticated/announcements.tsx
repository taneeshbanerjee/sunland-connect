import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Megaphone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/lib/use-me";
import { ROLE_LABEL, highestRole } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/announcements")({
  head: () => ({
    meta: [
      { title: "Announcements — Sunland Residency" },
      {
        name: "description",
        content: "All notices published by the Sunland Residency welfare committee.",
      },
      { property: "og:title", content: "Announcements — Sunland Residency" },
      {
        property: "og:description",
        content: "Notices and updates from the Sunland Residency welfare committee.",
      },
    ],
  }),
  component: Announcements,
});

function Announcements() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [importance, setImportance] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  function resetForm() {
    setTitle("");
    setBody("");
    setImportance("normal");
    setEditingId(null);
  }

  function startEdit(a: { id: string; title: string; body: string; importance: string }) {
    setEditingId(a.id);
    setTitle(a.title);
    setBody(a.body);
    setImportance(a.importance);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    const parsed = z
      .object({
        title: z.string().trim().min(3, "Title is too short").max(140),
        body: z.string().trim().min(3, "Write the announcement body").max(4000),
      })
      .safeParse({ title, body });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setBusy(true);
    const error = editingId
      ? (
          await supabase
            .from("announcements")
            .update({ title: parsed.data.title, body: parsed.data.body, importance })
            .eq("id", editingId)
        ).error
      : (
          await supabase.from("announcements").insert({
            title: parsed.data.title,
            body: parsed.data.body,
            importance,
            author_id: me.user!.id,
            author_name: me.profile?.full_name || me.user?.email,
            author_role: highestRole(me.roles),
          })
        ).error;
    setBusy(false);

    if (error) {
      toast.error(editingId ? "Could not update" : "Could not publish", {
        description: error.message,
      });
      return;
    }
    toast.success(
      editingId ? "Announcement updated" : "Announcement published to all residents",
    );
    resetForm();
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
    void queryClient.invalidateQueries({ queryKey: ["announcements-recent"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete", { description: error.message });
      return;
    }
    if (editingId === id) resetForm();
    toast.success("Announcement removed");
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
    void queryClient.invalidateQueries({ queryKey: ["announcements-recent"] });
  }


  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Announcements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Notices from the Sunland Residency welfare committee.
        </p>
      </div>

      {me.committee && (
        <Card className="panel border-0 bg-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4 text-primary" />
              Publish a new announcement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={publish} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <div className="space-y-2">
                  <Label htmlFor="an-title">Title</Label>
                  <Input
                    id="an-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Water supply maintenance on Sunday"
                    maxLength={140}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="an-imp">Priority</Label>
                  <Select value={importance} onValueChange={setImportance}>
                    <SelectTrigger id="an-imp">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="important">Important</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="an-body">Message</Label>
                <Textarea
                  id="an-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="Share the details residents need to know…"
                />
              </div>
              <Button type="submit" variant="hero" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Publish &amp; notify residents
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {list.isLoading && <Skeleton className="h-24 w-full" />}
        {!list.isLoading && (list.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No announcements have been posted yet.</p>
        )}
        {(list.data ?? []).map((a) => (
          <article key={a.id} className="panel p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{a.title}</h2>
              {a.importance !== "normal" && (
                <Badge variant={a.importance === "urgent" ? "destructive" : "secondary"}>
                  {a.importance}
                </Badge>
              )}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {a.body}
            </p>
            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {a.author_name ?? "Committee"}
                {a.author_role ? ` · ${ROLE_LABEL[a.author_role]}` : ""} ·{" "}
                {new Date(a.created_at).toLocaleString()}
              </span>
              {(me.elevated || a.author_id === me.user?.id) && (
                <Button variant="ghost" size="sm" onClick={() => remove(a.id)}>
                  Delete
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
