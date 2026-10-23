import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { EmpLayout } from "@/components/emp-layout";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/search")({
  component: SearchLayout,
});

/** Search — control plane for the public growth engine. */
const SECTIONS = [
  { to: "/search", label: "Overview", exact: true },
  { to: "/search/indexing", label: "Indexing agent" },
  { to: "/search/sponsored", label: "Sponsored search" },
  { to: "/search/ads", label: "Ads platform" },
  { to: "/search/voce", label: "VOCE boost" },
];

function SearchLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <EmpLayout>
      <div className="border-b border-[color:var(--color-hairline)] bg-card">
        <div className="mx-auto flex w-full max-w-[1400px] gap-1 overflow-x-auto px-8">
          {SECTIONS.map((s) => {
            const active = s.exact ? pathname === s.to : pathname.startsWith(s.to);
            return (
              <Link
                key={s.to}
                to={s.to}
                className={cn(
                  "-mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                  active
                    ? "border-[color:var(--color-g-blue)] text-[color:var(--color-g-blue)]"
                    : "border-transparent text-[color:var(--color-ink-2)] hover:text-ink",
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </EmpLayout>
  );
}
