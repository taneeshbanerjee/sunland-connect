import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/**
 * Legacy magic-link reset entry point. Password reset now uses a 6-digit
 * email code, so any old link lands here and is forwarded to that flow.
 */
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Sunland Residency" },
      {
        name: "description",
        content: "Set a new password for your Sunland Residency resident portal account.",
      },
      { property: "og:title", content: "Reset password — Sunland Residency" },
      {
        property: "og:description",
        content: "Choose a new password to regain access to the Sunland Residency portal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordRedirect,
});

function ResetPasswordRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/forgot-password", replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}
