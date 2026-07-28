import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    await writeAudit({
      actorEmail: data.email.toLowerCase(),
      action: data.success ? "login_success" : "login_failed",
      category: "auth",
      success: data.success,
      details: data.reason ? { reason: data.reason } : {},
    });
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
  const { data: allowed } = await context.supabase.rpc("is_elevated", {
    _user_id: context.userId,
  });
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
