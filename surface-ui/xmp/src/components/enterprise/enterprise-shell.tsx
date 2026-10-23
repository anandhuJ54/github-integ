import { useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  ChevronRight,
  Database,
  FileText,
  Gauge,
  LayoutGrid,
  Megaphone,
  Network,
  Search,
  Send,
  Settings,
  Sparkles,
  ShieldAlert,
  Star,
  Trophy,
  User,
  Users,
} from "lucide-react";
import { BrandIcon } from "@v3/ui/components/brand/logo";
import { PageBody } from "@v3/ui/components/console/primitives";
import { ActingAsBar } from "@v3/xmp/components/impersonation/acting-as-bar";
import { BrandAvatar, PersonAvatar } from "@v3/ui/components/sales/entity-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@v3/ui/components/ui/dialog";
import { Button } from "@v3/ui/components/ui/button";
import {
  loadOfficePage,
  loadOfficePros,
  loadStateRollup,
  proName,
  type Brand,
} from "@v3/xmp/lib/enterprise-xmp";
import { ROLE_FOR_KIND, useImpersonation } from "@v3/ui/lib/impersonation";
import { cn } from "@v3/ui/lib/utils";

type NavItem = { label: string; suffix: string; icon: ComponentType<{ className?: string }> };
type NavGroup = { label: string | null; items: NavItem[] };

const ENTERPRISE_NAV: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Command", suffix: "", icon: Gauge }],
  },
  {
    label: "Organization",
    items: [
      { label: "Hierarchy", suffix: "/hierarchy", icon: Network },
      { label: "Users", suffix: "/users", icon: Users },
    ],
  },
  {
    label: "Reputation",
    items: [
      { label: "Reviews", suffix: "/reviews", icon: Star },
      { label: "Multi-Post", suffix: "/multi-post", icon: Send },
      { label: "Campaigns", suffix: "/campaigns", icon: Megaphone },
      { label: "Content", suffix: "/content", icon: FileText },
      { label: "Moderation", suffix: "/moderation", icon: ShieldAlert },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Leaderboards", suffix: "/leaderboards", icon: Trophy },
      { label: "Reporting", suffix: "/reporting", icon: BarChart3 },
    ],
  },
  {
    label: "Data",
    items: [{ label: "Transactions", suffix: "/transactions", icon: Database }],
  },
  {
    label: null,
    items: [{ label: "Settings", suffix: "/settings", icon: Settings }],
  },
];

export const ENTERPRISE_NAV_LABELS = ENTERPRISE_NAV.flatMap((g) => g.items.map((i) => i.label));

function ShellFrame({
  eyebrow,
  title,
  subtitle,
  avatar,
  nav,
  base,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  avatar: ReactNode;
  nav: NavGroup[];
  base: string;
  actions?: ReactNode;
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
          <main className="flex-1 overflow-x-hidden">
            <PageBody>{children}</PageBody>
          </main>
        </div>
      </div>
    </div>
  );
}

/** Brand/enterprise seat. Fully replaces the admin console shell. */
export function EnterpriseShell({
  brand,
  slug,
  children,
}: {
  brand: Brand | null;
  slug: string;
  children: ReactNode;
}) {
  return (
    <ShellFrame
      eyebrow="Enterprise XMP"
      title={brand?.name ?? slug}
      subtitle={
        [brand?.address_city, brand?.address_state].filter(Boolean).join(", ") || null
      }
      avatar={<BrandAvatar name={brand?.name ?? slug} logoUrl={brand?.logo_url ?? null} size="md" />}
      nav={ENTERPRISE_NAV}
      base={`/enterprise/${slug}`}
      actions={brand ? <ViewAsPicker brand={brand} slug={slug} /> : null}
    >
      {children}
    </ShellFrame>
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
const PRO_NAV: NavGroup[] = [
  { label: null, items: [{ label: "My Profile", suffix: "", icon: User }] },
  {
    label: "My presence",
    items: [
      { label: "Expertise Graph", suffix: "/graph", icon: Network },
      { label: "Reviews", suffix: "/reviews", icon: Star },
    ],
  },
  {
    label: null,
    items: [
      { label: "Nora", suffix: "/nora", icon: Gauge },
      { label: "NORA interview", suffix: "/interview", icon: Sparkles },
    ],
  },
];

export const LOCATION_NAV_LABELS = LOCATION_NAV.flatMap((g) => g.items.map((i) => i.label));
export const PROFESSIONAL_NAV_LABELS = PRO_NAV.flatMap((g) => g.items.map((i) => i.label));


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
    >
      {children}
    </ShellFrame>
  );
}

/* ─────────── View As tree: Brand → State → Location → Professional ─────────── */

export function ViewAsPicker({ brand, slug }: { brand: Brand; slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { enter } = useImpersonation();

  const statesQ = useQuery({
    queryKey: ["viewas-states", brand.id],
    queryFn: () => loadStateRollup(brand.id, 60),
    enabled: open,
  });
  const officesQ = useQuery({
    queryKey: ["viewas-offices", brand.id, state],
    queryFn: () =>
      loadOfficePage({ brandId: brand.id, state: state ?? "", page: 0, pageSize: 25 }),
    enabled: open && !!state,
  });
  const prosQ = useQuery({
    queryKey: ["viewas-pros", officeId],
    queryFn: () => loadOfficePros(officeId!, 25),
    enabled: open && !!officeId,
  });

  const go = (kind: "office" | "professional", id: string, name: string, photo?: string | null) => {
    const path = `/seat/${kind}/${id}?from=${encodeURIComponent(slug)}`;

    enter({
      kind,
      id,
      name,
      role: ROLE_FOR_KIND[kind],
      path,
      orgSlug: slug,
      photoUrl: photo ?? null,
    });
    setOpen(false);
    void navigate({ to: path as never });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-[10px] text-xs font-semibold">
          <User className="mr-1.5 h-3.5 w-3.5" /> View As
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>View as</DialogTitle>
          <DialogDescription>
            Walk the hierarchy and drop into a location or professional workspace. Read-only.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-hidden text-sm">
          <Column title="State / region" loading={statesQ.isLoading}>
            {(statesQ.data ?? []).map((s) => (
              <Row
                key={s.state}
                active={state === s.state}
                onClick={() => {
                  setState(s.state);
                  setOfficeId(null);
                }}
                label={s.state}
                meta={`${s.offices.toLocaleString()} locations`}
                leading={<Building2 className="h-4 w-4 text-[color:var(--color-ink-3)]" />}
              />
            ))}
          </Column>

          <Column
            title="Location"
            loading={officesQ.isLoading}
            hint={!state ? "Pick a state" : undefined}
          >
            {(officesQ.data?.rows ?? []).map((o) => (
              <Row
                key={o.id}
                active={officeId === o.id}
                onClick={() => setOfficeId(o.id)}
                onDoubleClick={() => go("office", o.id, o.name)}
                label={o.name}
                meta={[o.address_city, o.address_state].filter(Boolean).join(", ")}
                leading={<BrandAvatar name={o.name} logoUrl={null} size="xs" />}
                action={
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      go("office", o.id, o.name);
                    }}
                    className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-g-blue)]"
                  >
                    Enter
                  </button>
                }
              />
            ))}
          </Column>

          <Column
            title="Professional"
            loading={prosQ.isLoading}
            hint={!officeId ? "Pick a location" : undefined}
          >
            {(prosQ.data ?? []).map((p) => (
              <Row
                key={p.id}
                onClick={() => go("professional", p.id, proName(p), p.photo_url)}
                label={proName(p)}
                meta={[p.address_city, p.address_state].filter(Boolean).join(", ")}
                leading={<PersonAvatar name={proName(p)} photoUrl={p.photo_url} size="xs" />}
                action={<ChevronRight className="h-3.5 w-3.5 text-[color:var(--color-ink-3)]" />}
              />
            ))}
          </Column>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Column({
  title,
  loading,
  hint,
  children,
}: {
  title: string;
  loading?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-[color:var(--color-hairline)] bg-card">
      <p className="border-b border-[color:var(--color-hairline)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
        {title}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {hint ? (
          <p className="px-2 py-3 text-xs text-[color:var(--color-ink-3)]">{hint}</p>
        ) : loading ? (
          <div className="space-y-1.5 p-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]"
              />
            ))}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  meta,
  leading,
  action,
  active,
  onClick,
  onDoubleClick,
}: {
  label: string;
  meta?: string;
  leading?: ReactNode;
  action?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick?.();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-[color:var(--color-g-blue-soft)]"
          : "hover:bg-[color:var(--color-surface-2)]",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">{label}</span>
        {meta ? (
          <span className="block truncate text-[10px] text-[color:var(--color-ink-3)]">{meta}</span>
        ) : null}
      </span>
      {action}
    </div>
  );
}
