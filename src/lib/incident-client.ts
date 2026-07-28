import { reportIncident } from "@/lib/audit.functions";

let installed = false;
const recent = new Map<string, number>();
const DEDUPE_MS = 30_000;

function shouldSend(key: string) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return false;
  recent.set(key, now);
  return true;
}

export function captureIncident(
  message: string,
  options: { stack?: string; severity?: "info" | "warning" | "error" | "critical" } = {},
) {
  const text = message.slice(0, 500);
  if (!shouldSend(text)) return;
  void reportIncident({
    data: {
      message: text,
      stack: options.stack?.slice(0, 4000),
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      severity: options.severity ?? "error",
      source: "client",
    },
  }).catch(() => {
    /* reporting must never break the app */
  });
}

/** Streams uncaught browser errors into the incident board. */
export function installIncidentReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = event.error as Error | undefined;
    captureIncident(err?.message ?? event.message ?? "Unknown script error", {
      stack: err?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as Error | string | undefined;
    const message = reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection");
    captureIncident(message, {
      stack: reason instanceof Error ? reason.stack : undefined,
      severity: "critical",
    });
  });
}
