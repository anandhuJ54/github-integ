import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { cn } from "@v3/ui/lib/utils";
import { NotificationsBell } from "@v3/sales/components/sales/notifications-bell";

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesLayout,
});

/**
 * Growth Hub — six leader modules.
 * Operational/role surfaces (SRE Call Console, the seller Opportunities workspace)
 * are reached by role, not from this leader nav.
 */
type Section = { to: string; label: string; exact?: boolean; match?: string[] };

const SECTIONS: Section[] = [
  { to: "/sales", label: "Overview", exact: true },
  { to: "/sales/teams", label: "Teams", match: ["/sales/teams", "/sales/team/", "/sales/team_", "/sales/territories"] },
  { to: "/sales/worklist", label: "Worklist", match: ["/sales/worklist"] },
  { to: "/sales/price-book", label: "CPQ", match: ["/sales/price-book", "/sales/opportunities", "/sales/quotes", "/sales/promos", "/sales/pricing"] },
  { to: "/sales/contracts", label: "Contracts", match: ["/sales/contracts"] },
  { to: "/sales/comp", label: "Compensation", match: ["/sales/comp"] },
  { to: "/sales/directory", label: "Directory", match: ["/sales/directory"] },
];

/** Sub-tabs shown under a module when it is active. */
const SUBTABS: Record<string, { to: string; label: string }[]> = {
  "/sales/teams": [
    { to: "/sales/teams", label: "Teams" },
    { to: "/sales/territories", label: "Territories" },
  ],
  "/sales/price-book": [
    { to: "/sales/quotes", label: "Quotes" },
    { to: "/sales/price-book", label: "Price book" },
    { to: "/sales/pricing", label: "Discount signals" },
    { to: "/sales/promos", label: "Promo codes" },
    { to: "/sales/opportunities", label: "Opportunities" },
  ],
};

function isActive(section: Section, pathname: string): boolean {
  if (section.exact) return pathname === section.to;
  return (section.match ?? [section.to]).some((p) => pathname.startsWith(p));
}

function SalesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeSection = SECTIONS.find((s) => isActive(s, pathname));
  const subtabs = activeSection ? SUBTABS[activeSection.to] : undefined;

  return (
    <EmpLayout>
      <div className="border-b border-[color:var(--color-hairline)] bg-card">
        <div className="mx-auto flex w-full max-w-[1400px] gap-1 overflow-x-auto px-8">
          {SECTIONS.map((s) => {
            const active = isActive(s, pathname);
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
          <div className="ml-auto flex items-center pl-2"><NotificationsBell /></div>
        </div>
      </div>

      {subtabs && subtabs.length > 1 ? (
        <div className="border-b border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)]">
          <div className="mx-auto flex w-full max-w-[1400px] gap-2 overflow-x-auto px-8 py-2.5">
            {subtabs.map((t) => {
              const active = pathname === t.to || (t.to !== activeSection?.to && pathname.startsWith(t.to));
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-card text-[color:var(--color-g-blue)] shadow-[var(--shadow-xs)]"
                      : "text-[color:var(--color-ink-2)] hover:bg-card hover:text-ink",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      <Outlet />
    </EmpLayout>
  );
}
