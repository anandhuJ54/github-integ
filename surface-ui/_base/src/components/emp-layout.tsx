import { BrandIcon } from "@v3/ui/components/brand/logo";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  Bot,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronsLeft,
  CreditCard,
  Grid3x3,
  Headphones,
  Home,
  LifeBuoy,
  LogOut,
  Network,
  PanelLeft,
  Globe2,
  Rocket,

  Search,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Plug,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Avatar, AvatarFallback } from "@v3/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v3/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@v3/ui/components/ui/tooltip";
import { ROLE_LABELS, grantScopeLabel, useOptionalRole } from "@v3/ui/lib/roles";
import { cn } from "@v3/ui/lib/utils";

type NavItem = { to: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: null, items: [{ to: "/console", label: "Home", icon: Home, exact: true }] },
  {
    label: "Platform",
    items: [
      { to: "/categories", label: "Categories", icon: Grid3x3 },
      { to: "/professionals", label: "Profiles & Graph", icon: Network },
      { to: "/nora-os", label: "Nora OS", icon: Bot },
    ],
  },
  {
    label: "Customers",
    items: [
      { to: "/accounts", label: "Accounts", icon: Building2 },
      { to: "/enterprise", label: "Enterprise XMP", icon: Network },
      { to: "/billing", label: "Billing", icon: CreditCard },
      { to: "/support", label: "Support", icon: Headphones },
    ],
  },
  {
    label: "Growth engine",
    items: [
      { to: "/sales", label: "Growth Hub", icon: TrendingUp },
      { to: "/search", label: "Search", icon: Search },
      { to: "/website", label: "Demand engine", icon: Globe2 },
    ],
  },

  {
    label: "SRP Dev Progress",
    items: [
      { to: "/dev", label: "Launch program", icon: Rocket },
      { to: "/build", label: "Build", icon: BookOpen },
    ],
  },

  {
    label: "Admin",
    items: [
      { to: "/admin/users", label: "Users & Access", icon: UserCog },
      { to: "/admin/integrations", label: "Integrations", icon: Plug },
      { to: "/compliance", label: "Compliance", icon: ShieldCheck },
      { to: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
];


const STORAGE_KEY = "xp.console.sidebar.collapsed";

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = useOptionalRole();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const email = role?.user?.email ?? "";
  const initials = (email.slice(0, 2) || "AD").toUpperCase();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen w-full bg-[color:var(--color-surface-2)]">
        <aside
          className={cn(
            "sticky top-0 flex h-screen shrink-0 flex-col border-r border-[color:var(--color-hairline)] bg-card transition-[width] duration-200",
            collapsed ? "w-[72px]" : "w-[248px]",
          )}
        >
          <div className="flex h-16 items-center gap-2 px-4">
            <BrandIcon size={32} />
            {!collapsed ? (
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-bold lowercase tracking-tight text-[#12294D]">experience.com</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                  Super-Admin Console
                </p>
              </div>
            ) : null}
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
            {NAV.map((group, gi) => (
              <div key={group.label ?? `g${gi}`} className="space-y-1">
                {group.label && !collapsed ? (
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                    {group.label}
                  </p>
                ) : null}
                {group.label && collapsed ? (
                  <div className="mx-3 mb-2 h-px bg-[color:var(--color-hairline)]" />
                ) : null}
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  const link = (
                    <Link
                      key={item.to}
                      to={item.to as never}
                      aria-label={item.label}
                      className={cn(
                        "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                          : "text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)] hover:text-ink",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    </Link>
                  );
                  if (!collapsed) return link;
                  return (
                    <Tooltip key={item.to}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-[color:var(--color-hairline)] p-3">
            <button
              onClick={toggle}
              className={cn(
                "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-xs font-medium text-[color:var(--color-ink-2)] transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-ink",
                collapsed && "justify-center px-0",
              )}
            >
              {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
              {!collapsed ? "Collapse" : null}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-[color:var(--color-hairline)] bg-card/85 px-6 backdrop-blur-xl">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-ink-3)]" />
              <input
                className="h-10 w-full rounded-[10px] border border-transparent bg-[color:var(--color-surface-2)] pl-10 pr-14 text-sm text-ink placeholder:text-[color:var(--color-ink-3)] transition-colors focus:border-[color:var(--color-g-blue)] focus:bg-card focus:outline-none"
                placeholder="Search categories, accounts, profiles…"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[color:var(--color-hairline)] bg-card px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-ink-3)]">
                ⌘K
              </kbd>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-ink-2)] lg:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[#34a853]" />
                Internal · Production
              </span>
              <button
                aria-label="Notifications"
                className="grid h-10 w-10 place-items-center rounded-[10px] text-[color:var(--color-ink-2)] transition-colors hover:bg-[color:var(--color-surface-2)]"
              >
                <Bell className="h-[18px] w-[18px]" />
              </button>
              <a
                href="mailto:support@experience.com"
                aria-label="Help"
                className="hidden h-10 w-10 place-items-center rounded-[10px] text-[color:var(--color-ink-2)] transition-colors hover:bg-[color:var(--color-surface-2)] sm:grid"
              >
                <LifeBuoy className="h-[18px] w-[18px]" />
              </a>

              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-[10px] py-1 pl-1 pr-2 transition-colors hover:bg-[color:var(--color-surface-2)]">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-[color:var(--color-g-blue)] text-[11px] font-semibold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden flex-col items-start leading-tight md:flex">
                    <span className="max-w-[170px] truncate text-xs font-medium text-ink">
                      {email || "Signed in"}
                    </span>
                    {role?.activeRole ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                        {ROLE_LABELS[role.activeRole]}
                        {role.activeGrant ? ` · ${grantScopeLabel(role.activeGrant)}` : ""}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className="h-4 w-4 text-[color:var(--color-ink-3)]" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="text-xs font-normal text-[color:var(--color-ink-2)]">
                    {email || "Signed in"}
                  </DropdownMenuLabel>
                  {role && role.grants.length > 1 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-[color:var(--color-ink-3)]">
                        Switch context
                      </DropdownMenuLabel>
                      {role.grants.map((g) => (
                        <DropdownMenuItem
                          key={g.id}
                          onClick={() => role.setActiveGrant(g.id)}
                          className={cn(
                            "flex flex-col items-start gap-0.5 text-sm",
                            role.activeGrant?.id === g.id &&
                              "font-semibold text-[color:var(--color-g-blue)]",
                          )}
                        >
                          <span>{grantScopeLabel(g)}</span>
                          <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-ink-3)]">
                            {ROLE_LABELS[g.role]}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => role?.signOut()} className="gap-2 text-sm">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Legacy alias — existing screens mount inside the new console shell unchanged. */
export const EmpLayout = ConsoleShell;
