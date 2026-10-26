/**
 * Location / Professional seat shell (ScopedShell) and its nav (LOCATION_NAV, PRO_NAV).
 * Moved from xmp's components/enterprise/enterprise-shell.tsx with the seat pages, surface audit
 * 2026-10-25; ShellFrame is a copy of xmp's (the enterprise console still uses its own).
 */
import { type ComponentType, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Gauge,
  Globe,
  House,
  LayoutGrid,
  Lock,
  Network,
  Plug,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  User,
  Users,
} from "lucide-react";
import { BrandIcon } from "@v3/shared/components/icons/logo";
import { PageBody } from "@v3/shared/components/ui/console-primitives";
import { ActingAsBar } from "@v3/srp/components/impersonation/acting-as-bar";
import { BrandAvatar, PersonAvatar } from "@v3/shared/components/ui/entity-avatar";
import { cn } from "@v3/shared/components/utils/utils";

type NavItem = {
  label: string;
  suffix: string;
  icon: ComponentType<{ className?: string }>;
  /** Shows a lock (feature not configurable yet); the page still opens. */
  locked?: boolean;
  /** Shows an orange PRO pill (paid-plan feature). */
  pro?: boolean;
};
type NavGroup = { label: string | null; items: NavItem[] };

function ShellFrame({
  eyebrow,
  title,
  subtitle,
  avatar,
  nav,
  base,
  actions,
  hideHeader = false,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  avatar: ReactNode;
  nav: NavGroup[];
  base: string;
  actions?: ReactNode;
  /** Drop the top search / subtitle bar (professional seats). */
  hideHeader?: boolean;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-[color:var(--color-surface-2)]">
      <ActingAsBar />
      <div className="flex min-h-screen w-full">
        <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-[color:var(--color-hairline)] bg-card">
          <div className="flex items-center gap-3 border-b border-[color:var(--color-hairline)] px-4 py-4">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-ink">{title}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                {eyebrow}
              </p>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {nav.map((group, gi) => (
              <div key={group.label ?? `g${gi}`} className="space-y-1">
                {group.label ? (
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                    {group.label}
                  </p>
                ) : null}
                {group.items.map((item) => {
                  const to = `${base}${item.suffix}`;
                  const active = item.suffix
                    ? pathname === to || pathname.startsWith(`${to}/`)
                    : pathname === base || pathname === `${base}/`;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      to={to as never}
                      className={cn(
                        "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                          : "text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)] hover:text-ink",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.pro ? (
                        <span className="ml-auto rounded-full bg-orange-500 px-2 py-px text-[9px] font-bold tracking-wide text-white">
                          PRO
                        </span>
                      ) : null}
                      {item.locked ? (
                        <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Locked" />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-[color:var(--color-hairline)] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
              <BrandIcon size={16} /> Powered by Nora
            </span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {hideHeader ? null : (
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[color:var(--color-hairline)] bg-card/85 px-6 backdrop-blur-xl">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-ink-3)]" />
              <input
                className="h-10 w-full rounded-[10px] border border-transparent bg-[color:var(--color-surface-2)] pl-10 pr-3 text-sm text-ink placeholder:text-[color:var(--color-ink-3)] focus:border-[color:var(--color-g-blue)] focus:bg-card focus:outline-none"
                placeholder="Search locations, users…"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {subtitle ? (
                <span className="hidden text-xs text-[color:var(--color-ink-2)] lg:inline">
                  {subtitle}
                </span>
              ) : null}
              {actions}
            </div>
          </header>
          )}
          <main className="flex-1 overflow-x-hidden">
            <PageBody>{children}</PageBody>
          </main>
        </div>
      </div>
    </div>
  );
}

const LOCATION_NAV: NavGroup[] = [
  { label: null, items: [{ label: "Overview", suffix: "", icon: LayoutGrid }] },
  {
    label: "This location",
    items: [
      { label: "Team", suffix: "/team", icon: Users },
      { label: "Reviews", suffix: "/reviews", icon: Star },
      { label: "Listings", suffix: "/listings", icon: Network },
      { label: "Multi-Post", suffix: "/multi-post", icon: Send },
    ],
  },
  {
    label: null,
    items: [
      { label: "Reporting", suffix: "/reporting", icon: BarChart3 },
      { label: "NORA interview", suffix: "/interview", icon: Sparkles },
    ],
  },
];
// Professional seat = the Happyflow SRP (components/happyflow); Expertise Graph and Reviews stay live.
const PRO_NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Home", suffix: "", icon: House },
      { label: "SRS", suffix: "/nora", icon: Gauge },
    ],
  },
  {
    label: "My presence",
    items: [
      { label: "Profile", suffix: "/profile", icon: User },
      { label: "Insights", suffix: "/insights", icon: BarChart3 },
      { label: "Website Analytics", suffix: "/website", icon: Globe, pro: true },
      { label: "Expertise Graph", suffix: "/graph", icon: Network },
      { label: "Reviews", suffix: "/reviews", icon: Star, locked: true },
      { label: "Connections", suffix: "/connections", icon: Plug },
      { label: "Network", suffix: "/network", icon: Users },
    ],
  },
  {
    label: null,
    items: [
      { label: "Settings", suffix: "/settings", icon: SlidersHorizontal },
      { label: "NORA interview", suffix: "/interview", icon: Sparkles },
    ],
  },
];

export const LOCATION_NAV_LABELS = LOCATION_NAV.flatMap((g) => g.items.map((i) => i.label));
export const PROFESSIONAL_NAV_LABELS = PRO_NAV.flatMap((g) => g.items.map((i) => i.label));
/** Suffix of every nav item, for tests. */
export const PROFESSIONAL_NAV_SUFFIXES = PRO_NAV.flatMap((g) => g.items.map((i) => i.suffix));
export const LOCATION_NAV_SUFFIXES = LOCATION_NAV.flatMap((g) => g.items.map((i) => i.suffix));
/** Items with a PRO pill or a lock, for tests. */
export const PROFESSIONAL_NAV_FLAGS = PRO_NAV.flatMap((g) =>
  g.items.filter((i) => i.pro || i.locked).map((i) => ({ label: i.label, pro: !!i.pro, locked: !!i.locked })),
);


/**
 * Location / Professional seat. Scoped to a single office or professional —
 * the enterprise nav is replaced by that entity's own (scaffold) nav.
 */
export function ScopedShell({
  kind,
  name,
  subtitle,
  photoUrl,
  base,
  children,
}: {
  kind: "office" | "professional";
  name: string;
  subtitle?: string | null;
  photoUrl?: string | null;
  base: string;
  children: ReactNode;
}) {
  return (
    <ShellFrame
      eyebrow={kind === "office" ? "Location workspace" : "Professional workspace"}
      title={name}
      subtitle={subtitle ?? null}
      avatar={
        kind === "office" ? (
          <BrandAvatar name={name} logoUrl={photoUrl ?? null} size="md" />
        ) : (
          <PersonAvatar name={name} photoUrl={photoUrl ?? null} size="md" />
        )
      }
      nav={kind === "office" ? LOCATION_NAV : PRO_NAV}
      base={base}
      hideHeader={kind === "professional"}
    >
      {children}
    </ShellFrame>
  );
}
