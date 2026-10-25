import { BrandWordmark } from "@v3/ui/components/brand/logo";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  TrendingUp,
  Star,
  List,
  FileText,
  Plug,
  User,
  Settings,
  CreditCard,
  Search,
  Bell,
  Sparkles,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { GeminiRibbon } from "@v3/ui/components/ai/gemini-gradient";
import { AiBadge } from "@v3/ui/components/ai/ai-badge";
import { cn } from "@v3/ui/lib/utils";
import type { ReactNode } from "react";

const navItems = [
  { to: "/dashboard", label: "Home", icon: Home, exact: true },
  { to: "/dashboard/ranking", label: "Search Ranking", icon: TrendingUp },
  { to: "/dashboard/reviews", label: "Reviews", icon: Star },
  { to: "/dashboard/listings", label: "Listings", icon: List },
  { to: "/dashboard/content", label: "Content", icon: FileText },
  { to: "/dashboard/connections", label: "Connections", icon: Plug },
  { to: "/dashboard/profile", label: "Profile", icon: User },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
  { to: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function DashboardShell({
  title,
  user,
  children,
}: {
  title: string;
  currentPath?: string;
  user?: { name?: string | null; photo_url?: string | null };
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const name = user?.name ?? "";
  return (
    <div className="flex min-h-screen bg-[color:var(--color-surface-2)] w-full">
      <aside className="w-64 shrink-0 bg-white border-r border-[color:var(--color-hairline)] flex flex-col sticky top-0 h-screen">
        <div className="h-16 flex items-center px-5 border-b border-[color:var(--color-hairline)]">
          <BrandWordmark size={22} />
        </div>

        <div className="p-3">
          <button className="w-full inline-flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5"
            style={{ background: "var(--gradient-gemini)", backgroundSize: "200% 200%", animation: "gemini-drift 8s ease infinite" }}>
            <Sparkles className="h-4 w-4" />
            Ask AI
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as any}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all",
                  active
                    ? "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                    : "text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)] hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[color:var(--color-hairline)]">
          <AiBadge>PRO · AI-powered</AiBadge>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur-xl border-b border-[color:var(--color-hairline)] flex items-center gap-4 px-6 sticky top-0 z-40">
          <h1 className="text-base font-semibold text-ink mr-auto">{title}</h1>
          <div className="hidden md:block relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" />
            <input
              className="w-full h-10 pl-10 pr-4 rounded-full bg-[color:var(--color-surface-2)] border border-transparent text-sm placeholder:text-[color:var(--color-ink-3)] focus:outline-none focus:bg-white focus:border-[color:var(--color-g-blue)] transition-all"
              placeholder="Search…"
            />
          </div>
          <button className="relative h-10 w-10 grid place-items-center rounded-full hover:bg-[color:var(--color-surface-2)]">
            <Bell className="h-4 w-4 text-[color:var(--color-ink-2)]" />
          </button>
          <Avatar className="h-9 w-9 ring-2 ring-[color:var(--color-g-blue-soft)]">
            {user?.photo_url ? <AvatarImage src={user.photo_url} alt={name} /> : null}
            <AvatarFallback className="bg-[color:var(--color-g-blue)] text-white text-xs font-semibold">
              {(name || "U").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </header>
        <GeminiRibbon />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
