import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/build")({
  component: BuildLayout,
});

const SECTIONS = [
  { to: "/build", label: "Home", exact: true },
  { to: "/build/spaces", label: "Spaces" },
  { to: "/build/teams", label: "Teams & People" },
  { to: "/build/projects", label: "Projects" },
  { to: "/build/weekly", label: "Weekly reporting" },
];

function BuildLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <EmpLayout>
      <div className="border-b border-[color:var(--color-hairline)] bg-card">
        <div className="mx-auto flex w-full max-w-[1400px] gap-1 overflow-x-auto px-8">
          {SECTIONS.map((s) => {
            const active = s.exact ? pathname === s.to || pathname === `${s.to}/` : pathname.startsWith(s.to);
            return (
              <Link
                key={s.to}
                to={s.to}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors",
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
