import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/app-auth-middleware";

export type AuditCategory = "auth" | "role" | "admin" | "system";

export type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  category: string;
  target_email: string | null;
  details: Record<string, string | number | boolean | null>;
  success: boolean;
  created_at: string;
};

export type IncidentRow = {
  id: string;
  message: string;
  stack: string | null;
  route: string | null;
  severity: string;
  source: string;
  user_email: string | null;
  resolved: boolean;
  created_at: string;
};

/** Server-only audit writer. Never call from the browser. */
export async function writeAudit(entry: {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  category: AuditCategory;
  targetId?: string | null;
  targetEmail?: string | null;
  details?: Record<string, string | number | boolean | null>;
  success?: boolean;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
  await supabaseAdmin.from("audit_logs").insert({
    actor_id: entry.actorId ?? null,
    actor_email: entry.actorEmail ?? null,
    action: entry.action,
    category: entry.category,
    target_id: entry.targetId ?? null,
    target_email: entry.targetEmail ?? null,
    details: (entry.details ?? {}) as never,
    success: entry.success ?? true,
  });
}

/** Records a sign-in attempt. Intentionally unauthenticated: failures have no session. */
export const recordLoginAttempt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        success: z.boolean(),
        reason: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    await writeAudit({
      actorEmail: email,
      action: data.success ? "login_success" : "login_failed",
      category: "auth",
      success: data.success,
      details: data.reason ? { reason: data.reason } : {},
    });

    if (!data.success) {
      const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "login_failed")
        .eq("actor_email", email)
        .gte("created_at", since);

      const failures = count ?? 0;
      if (failures >= 5) {
        // Is this a privileged account? Then it is a critical alert.
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("email", email)
          .maybeSingle();
        let elevated = false;
        if (profile) {
          const { data: roles } = await supabaseAdmin
            .from("user_roles")
            .select("role")
            .eq("user_id", profile.id);
          elevated = (roles ?? []).some((r) =>
            ["super_admin", "treasurer", "president"].includes(r.role as string),
          );
        }
        await supabaseAdmin.from("incident_reports").insert({
          message: `${failures} failed sign-in attempts for ${email} in the last 15 minutes${
            elevated ? " (privileged account)" : ""
          }`,
          route: "/",
          severity: elevated || failures >= 10 ? "critical" : "warning",
          source: "server",
          user_email: email,
        });
        await writeAudit({
          actorEmail: email,
          action: "suspicious_login_activity",
          category: "auth",
          success: false,
          details: { failures, window_minutes: 15, privileged: elevated },
        });
      }
    }

    return { ok: true };
  });


/** Records a client-side error/incident for the supreme admin console. */
export const reportIncident = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        message: z.string().trim().min(1).max(500),
        stack: z.string().max(4000).optional(),
        route: z.string().max(300).optional(),
        severity: z.enum(["info", "warning", "error", "critical"]).default("error"),
        source: z.enum(["client", "server"]).default("client"),
        userEmail: z.string().max(255).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
    await supabaseAdmin.from("incident_reports").insert({
      message: data.message,
      stack: data.stack ?? null,
      route: data.route ?? null,
      severity: data.severity,
      source: data.source,
      user_email: data.userEmail ?? null,
    });
    return { ok: true };
  });

async function assertElevated(context: { supabase: any; userId: string }) {
  const { data: rows } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const roles = (rows ?? []).map((r: { role: string }) => r.role);
  const allowed = roles.some((r: string) => r === "super_admin" || r === "president");
  if (!allowed) throw new Error("Forbidden");
}


export const listAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ category: z.enum(["all", "auth", "role", "admin", "system"]).default("all") })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertElevated(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
    let q = supabaseAdmin
      .from("audit_logs")
      .select("id, actor_email, action, category, target_email, details, success, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.category !== "all") q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as AuditRow[];
  });

export const listIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertElevated(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("incident_reports")
      .select("id, message, stack, route, severity, source, user_email, resolved, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as IncidentRow[];
  });

export const resolveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), resolved: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertElevated(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/app-client.server");
    const { error } = await supabaseAdmin
      .from("incident_reports")
      .update({
        resolved: data.resolved,
        resolved_at: data.resolved ? new Date().toISOString() : null,
        resolved_by: data.resolved ? context.userId : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      action: data.resolved ? "incident_resolved" : "incident_reopened",
      category: "admin",
      details: { incident_id: data.id },
    });
    return { ok: true };
  });
