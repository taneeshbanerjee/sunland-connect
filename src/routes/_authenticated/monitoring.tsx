import { createFileRoute } from "@tanstack/react-router";
import { Activity, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/use-me";
import { IncidentBoard } from "@/components/IncidentBoard";

export const Route = createFileRoute("/_authenticated/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring & Security Alerts — Sunland Residency" },
      {
        name: "description",
        content:
          "Live error, incident and suspicious sign-in monitoring for the Sunland Residency portal.",
      },
      { property: "og:title", content: "Monitoring & Security Alerts — Sunland Residency" },
      {
        property: "og:description",
        content: "Live incidents, errors and authentication alerts for portal administrators.",
      },
    ],
  }),
  component: MonitoringPage,
});

function MonitoringPage() {
  const me = useMe();

  if (!me.ready) return <Skeleton className="h-64 w-full" />;

  if (!me.elevated) {
    return (
      <div className="panel mx-auto max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto size-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Restricted area</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Monitoring is only available to the Super Admin, Treasurer and President.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-semibold">
          <Activity className="size-7 text-primary" />
          Monitoring
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live application errors, incidents and suspicious authentication activity such as repeated
          failed sign-ins.
        </p>
      </div>
      <IncidentBoard />
    </div>
  );
}
