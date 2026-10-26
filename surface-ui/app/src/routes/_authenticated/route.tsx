import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { ImpersonationProvider } from "@v3/ui/lib/impersonation";
import { RoleProvider } from "@v3/ui/lib/roles";


export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUser(data.user ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--color-surface-2)] text-sm text-slate-500">
        Loading workspace…
      </div>
    );
  }

  return (
    <RoleProvider user={user}>
      <ImpersonationProvider>
        <Outlet />
      </ImpersonationProvider>
    </RoleProvider>
  );
}

