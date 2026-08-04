import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Building2,
  Bell,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  Settings,
  MessageSquareWarning,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/app-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationGate } from "@/components/NotificationGate";
import { useMe } from "@/lib/use-me";
import { ROLE_LABEL, highestRole } from "@/lib/roles";

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { to: "/announcements", label: "Announcements", icon: Bell, show: true },
    { to: "/admin", label: "Admin", icon: ShieldCheck, show: me.committee },
    { to: "/settings", label: "Settings", icon: Settings, show: true },
    { to: "/report", label: "Report", icon: MessageSquareWarning, show: true },
  ].filter((n) => n.show);


  return (
    <div className="min-h-screen">
      <NotificationGate />
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground">
              <Building2 className="size-5" />
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold tracking-tight">Sunland Residency</span>
              <span className="text-[11px] text-muted-foreground">Resident Portal</span>
            </span>
          </Link>

          <nav className="ml-auto flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors " +
                    (active
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")
                  }
                >
                  <item.icon className="size-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 border-l border-border/70 pl-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium">{me.profile?.full_name || me.user?.email}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px]">
                {ROLE_LABEL[highestRole(me.roles)]}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        Sunland Residency Welfare Committee · Secure resident portal
      </footer>
    </div>
  );
}
