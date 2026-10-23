import * as Lucide from "lucide-react";
import { Check, type LucideIcon } from "lucide-react";

/** Resolves a lucide icon name stored in CMS content. Falls back to Check. */
export function iconByName(name?: string | null): LucideIcon {
  if (!name) return Check;
  const key = name.trim();
  const found = (Lucide as unknown as Record<string, unknown>)[key];
  if (typeof found === "function" || (found && typeof found === "object")) {
    return found as LucideIcon;
  }
  return Check;
}

/** Curated icon names offered in the CMS icon picker. */
export const ICON_CHOICES = [
  "Check", "MapPin", "TrendingUp", "RefreshCw", "Globe", "Search", "Eye", "ShieldCheck",
  "LayoutDashboard", "Users", "Star", "Trophy", "Target", "Gauge", "BarChart3", "LineChart",
  "Compass", "Filter", "Inbox", "MousePointerClick", "Gamepad2", "ListChecks", "Zap", "Brain",
  "MessageSquare", "Phone", "Mail", "Calendar", "Building2", "Sparkles", "Lock", "Bot",
] as const;
