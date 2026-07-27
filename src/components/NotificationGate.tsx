import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ASKED_KEY = "sunland.notify.asked";

/**
 * Asks for browser notification permission on the first authenticated visit and
 * raises a desktop/phone notification whenever a new announcement is published.
 */
export function NotificationGate() {
  const asked = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (asked.current) return;
    asked.current = true;

    if (Notification.permission === "default" && !localStorage.getItem(ASKED_KEY)) {
      localStorage.setItem(ASKED_KEY, "1");
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("announcements-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcements" },
        (payload) => {
          const row = payload.new as { title?: string; body?: string };
          const title = row.title ?? "New announcement";
          const body = row.body ?? "";
          toast(title, { description: body.slice(0, 140) });
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(`Sunland Residency — ${title}`, {
                body: body.slice(0, 200),
                icon: "/favicon.ico",
              });
            } catch {
              /* notification display is best-effort */
            }
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
