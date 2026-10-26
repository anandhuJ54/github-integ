import { Globe, HelpCircle, Lock, UserX, Zap } from "lucide-react";
import { Badge } from "@v3/shared/components/ui/badge";
import { cn } from "@v3/shared/components/utils/utils";

export type CrawlMethod =
  | "server_crawl"
  | "blocked_needs_proxy"
  | "js_needs_api"
  | "unreachable"
  | "no_profiles_on_site"
  | "unprobed"
  | string;

export const CRAWL_METHOD_LABEL: Record<string, string> = {
  server_crawl: "Server crawl",
  blocked_needs_proxy: "Needs proxy",
  js_needs_api: "Needs rendering",
  unreachable: "Unreachable",
  no_profiles_on_site: "No profiles on site",
  unprobed: "Unprobed",
};

export const CRAWL_METHOD_REASON: Record<string, string> = {
  server_crawl: "Free server-side crawl — runnable now.",
  blocked_needs_proxy: "Server crawl blocked (403) — mapped and harvested through the proxy",
  js_needs_api: "JavaScript-rendered — mapped and harvested with browser rendering (or the site's profile API)",
  unreachable: "Host did not respond — needs the browser-worker layer",
  no_profiles_on_site:
    "Site has no individual profile pages for this category — profiles live elsewhere (see note)",
  unprobed: "Not probed yet — crawl method unknown",
};

// Fix (remap rendered / proxy sites, 2026-10-15): sites that need browser rendering or a proxy can be mapped, so they
// count as ready for mapping; only unreachable sites and sites without profile pages stay blocked.
export function isReadyMethod(method: string | null | undefined): boolean {
  return method === "server_crawl" || method === "js_needs_api" || method === "blocked_needs_proxy";
}

export function isBlockedMethod(method: string | null | undefined): boolean {
  return method === "unreachable" || method === "no_profiles_on_site";
}

const STYLES: Record<string, string> = {
  server_crawl: "bg-emerald-50 text-emerald-700",
  blocked_needs_proxy: "bg-red-50 text-red-700",
  js_needs_api: "bg-amber-50 text-amber-700",
  unreachable: "bg-red-50 text-red-700",
  no_profiles_on_site: "bg-amber-50 text-amber-800",
  unprobed: "bg-slate-100 text-slate-500",
};

export function CrawlMethodChip({
  method,
  className,
}: {
  method: string | null | undefined;
  className?: string;
}) {
  const key = method ?? "unprobed";
  const Icon =
    key === "server_crawl"
      ? Globe
      : key === "js_needs_api"
        ? Zap
        : key === "no_profiles_on_site"
          ? UserX
          : key === "unprobed"
          ? HelpCircle
          : Lock;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 font-normal",
        STYLES[key] ?? "bg-slate-100 text-slate-500",
        className,
      )}
      title={CRAWL_METHOD_REASON[key] ?? key}
    >
      <Icon className="h-3 w-3" />
      {CRAWL_METHOD_LABEL[key] ?? key}
    </Badge>
  );
}
