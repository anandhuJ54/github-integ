import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { signInPath } from "@v3/state/auth";
import { useSession } from "@v3/state/session/use-session";
import { whenSessionReady } from "@v3/state/session/bootstrap";
import { store } from "@v3/state/store";
import { AccessGate } from "../../state/access-gate";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Wait for the stored session to be restored, so a reload does not bounce a signed-in user.
    const session = await whenSessionReady(store);
    if (session.status !== "authed" || !session.user) throw redirect({ to: signInPath() as "/auth" });
    return { user: session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, status } = useSession();

  if (status !== "authed" || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--color-surface-2)] text-sm text-slate-500">
        Loading workspace…
      </div>
    );
  }

  return (
    <AccessGate user={user}>
      <Outlet />
    </AccessGate>
  );
}
