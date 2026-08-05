import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/app-client";
import { touchSession } from "@/lib/session.functions";

/** Client-side mirror of the backend idle window. */
const IDLE_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

const EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "visibilitychange"] as const;

/**
 * Enforces the 5-minute inactivity policy. Activity is reported to the server
 * (which owns the real decision and revokes refresh tokens); the local timer is
 * a fast fallback so the tab logs out even while offline.
 */
export function IdleGuard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lastActive = useRef(Date.now());
  const endedRef = useRef(false);

  useEffect(() => {
    const bump = () => {
      lastActive.current = Date.now();
    };
    EVENTS.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    async function endSession() {
      if (endedRef.current) return;
      endedRef.current = true;
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      toast.info("Signed out", { description: "You were inactive for 5 minutes." });
      navigate({ to: "/", replace: true });
    }

    const id = window.setInterval(async () => {
      const idleFor = Date.now() - lastActive.current;
      if (idleFor > IDLE_MS) {
        void endSession();
        return;
      }
      try {
        const res = await touchSession();
        if (res?.expired) void endSession();
      } catch {
        /* offline or token already revoked — local timer still applies */
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(id);
      EVENTS.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [navigate, queryClient]);

  return null;
}
