import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { History, Loader2, ShieldAlert, LogIn, UserCog, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listAuditLogs } from "@/lib/audit.functions";

const FILTERS = [
  { value: "all", label: "Everything", icon: History },
  { value: "auth", label: "Login attempts", icon: LogIn },
  { value: "role", label: "Role changes", icon: UserCog },
  { value: "admin", label: "Admin actions", icon: Settings2 },
] as const;

const ACTION_LABEL: Record<string, string> = {
  login_success: "Signed in",
  login_failed: "Failed sign-in",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  incident_resolved: "Incident resolved",
  incident_reopened: "Incident reopened",
};

export function AuditTrail() {
  const [category, setCategory] = useState<(typeof FILTERS)[number]["value"]>("all");
  const fetchLogs = useServerFn(listAuditLogs);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", category],
    queryFn: () => fetchLogs({ data: { category } }),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          Audit trail
        </CardTitle>
        {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={category === f.value ? "hero" : "subtle"}
              onClick={() => setCategory(f.value)}
            >
              <f.icon className="size-3.5" />
              {f.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {data!.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                {row.success ? (
                  <Badge variant="secondary">{ACTION_LABEL[row.action] ?? row.action}</Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="size-3" />
                    {ACTION_LABEL[row.action] ?? row.action}
                  </Badge>
                )}
                <span className="text-foreground">{row.actor_email ?? "system"}</span>
                {row.target_email && (
                  <span className="text-muted-foreground">→ {row.target_email}</span>
                )}
                {row.details && Object.keys(row.details).length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {Object.entries(row.details)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
