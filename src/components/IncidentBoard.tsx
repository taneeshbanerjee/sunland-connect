import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Activity, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listIncidents, resolveIncident } from "@/lib/audit.functions";

const SEVERITY_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  info: "outline",
  warning: "secondary",
  error: "destructive",
  critical: "destructive",
};

export function IncidentBoard() {
  const qc = useQueryClient();
  const fetchIncidents = useServerFn(listIncidents);
  const setResolved = useServerFn(resolveIncident);

  const { data, isLoading } = useQuery({
    queryKey: ["incidents"],
    queryFn: () => fetchIncidents({ data: undefined as never }),
    refetchInterval: 20_000,
  });

  // Live alerting: a new incident row raises a toast immediately.
  useEffect(() => {
    const channel = supabase
      .channel("incidents-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incident_reports" },
        (payload) => {
          const row = payload.new as { message?: string; severity?: string };
          toast.error(`New ${row.severity ?? "error"} incident`, {
            description: (row.message ?? "").slice(0, 160),
          });
          void qc.invalidateQueries({ queryKey: ["incidents"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  const open = (data ?? []).filter((i) => !i.resolved);

  async function toggle(id: string, resolved: boolean) {
    try {
      await setResolved({ data: { id, resolved } });
      await qc.invalidateQueries({ queryKey: ["incidents"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update incident");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          Error & incident monitor
        </CardTitle>
        <div className="flex items-center gap-3">
          <Badge variant={open.length ? "destructive" : "secondary"}>
            {open.length} open
          </Badge>
          {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No incidents recorded. Errors anywhere in the portal will appear here in real time.
          </p>
        ) : (
          <ul className="space-y-2">
            {data!.map((i) => (
              <li
                key={i.id}
                className="rounded-lg border border-border/60 p-3 text-sm data-[resolved=true]:opacity-60"
                data-resolved={i.resolved}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_VARIANT[i.severity] ?? "secondary"} className="gap-1">
                    <AlertTriangle className="size-3" />
                    {i.severity}
                  </Badge>
                  <span className="font-medium">{i.message}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(i.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {i.source} · {i.route ?? "unknown page"}
                  {i.user_email ? ` · ${i.user_email}` : ""}
                </p>
                {i.stack && (
                  <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    {i.stack}
                  </pre>
                )}
                <div className="mt-2">
                  <Button size="sm" variant="subtle" onClick={() => toggle(i.id, !i.resolved)}>
                    {i.resolved ? (
                      <>
                        <RotateCcw className="size-3.5" />
                        Reopen
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-3.5" />
                        Mark resolved
                      </>
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
