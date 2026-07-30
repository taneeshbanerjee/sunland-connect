import { createFileRoute } from "@tanstack/react-router";
import { sweepExpiredSessions } from "@/lib/session.functions";

/**
 * Background session sweeper. Expires every idle session (Super Admin exempt)
 * even when the device never comes back online. Safe to call on a schedule.
 * Returns counts only — never any resident data.
 */
export const Route = createFileRoute("/api/public/sessions/sweep")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await sweepExpiredSessions();
          return Response.json({ ok: true, ...result });
        } catch {
          return new Response("Sweep failed", { status: 500 });
        }
      },
    },
  },
});
