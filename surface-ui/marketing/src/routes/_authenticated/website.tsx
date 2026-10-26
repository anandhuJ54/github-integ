import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/website")({
  component: WebsiteLayout,
});

const SECTIONS = [
  { to: "/website", label: "Overview", exact: true },
  { to: "/website/cms", label: "CMS" },
  { to: "/website/leads", label: "Leads" },
  { to: "/website/campaigns", label: "Campaigns" },
  { to: "/website/ads", label: "Ads" },
  { to: "/website/demo-center", label: "Demo Center" },
  { to: "/website/trust", label: "Trust Center" },
  { to: "/website/consent", label: "Cookie Consent" },
  { to: "/website/alerts", label: "Alerts" },
  { to: "/website/developers", label: "Developers" },
];

function WebsiteLayout() {
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
