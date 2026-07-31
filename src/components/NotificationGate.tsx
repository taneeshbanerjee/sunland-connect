import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/use-me";

const ASKED_KEY = "sunland.notify.asked";

function supported() {
  return typeof window !== "undefined" && "Notification" in window;
}

async function getRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function showNotification(title: string, body: string) {
  if (!supported() || Notification.permission !== "granted") return;
  const reg = await getRegistration();
  try {
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: "/favicon.ico",
        tag: "sunland-announcement",
        data: { url: "/announcements" },
      });
      return;
    }
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    /* notification display is best-effort */
  }
}

/**
 * Asks for browser/phone notification permission once — on the first signed-in
 * visit where the user has not decided yet — and raises a notification whenever
 * a new announcement is published, if the user opted in.
 */
export function NotificationGate() {
  const me = useMe();
  const [prompt, setPrompt] = useState(false);
  const init = useRef(false);
  const optedIn = me.profile?.notify_announcements ?? true;

  useEffect(() => {
    // Only after the user is actually signed in, and only once per device.
    if (!supported() || init.current || !me.user) return;
    init.current = true;
    void getRegistration();
    if (Notification.permission === "default" && !localStorage.getItem(ASKED_KEY)) {
      setPrompt(true);
    }
  }, [me.user]);

  const enable = useCallback(async () => {
    localStorage.setItem(ASKED_KEY, "1");
    setPrompt(false);
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        toast.success("Notifications on", {
          description: "You'll be alerted whenever the committee posts an announcement.",
        });
        await showNotification(
          "Sunland Residency",
          "Announcement alerts are now enabled on this device.",
        );
      } else {
        toast("Notifications stayed off", {
          description: "You can enable them anytime from Settings.",
        });
      }
    } catch {
      /* permission request unavailable */
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(ASKED_KEY, "1");
    setPrompt(false);
  }, []);

  useEffect(() => {
    if (!me.user || !optedIn) return;
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
          void showNotification(`Sunland Residency — ${title}`, body.slice(0, 200));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me.user, optedIn]);


  if (!prompt) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
      <div className="panel flex items-start gap-3 p-4 shadow-xl">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
          <Bell className="size-4" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium">Get announcement alerts</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Allow notifications so committee announcements reach your phone instantly.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="hero" onClick={enable}>
              Allow notifications
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss notification prompt"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
