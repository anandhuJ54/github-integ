/**
 * The Web analytics page's view model (srp/web-analytics-page-schema, task 8): the one object the Website screen reads, instead of constants.
 *
 * `webAnalyticsModel(data, seatId)` maps the API's response (`GET /srp/seat/professional/{id}/website`) to it; `sampleWebAnalyticsModel`
 * (components/happyflow/sample-web-analytics.ts) builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Unknown stays unknown: a missing gauge is null, a missing top fix is null, a missing scan date is an empty label, never 0. The Re-check progress, Send to my webmaster, Copy and
 * the hand-off steps are on-screen simulations in the screen; nothing here writes.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";
import { monthDay } from "@v3/srp/utils/home-model";
import type { HfIconName } from "@v3/srp/components/happyflow/icons";

// --- the API response (contracts/srp/openapi.json, WebAnalyticsResponse) ----------------------------------------

export type WebState = "fail" | "warn" | "pass";
export type WebCheckKey =
  | "entity_markup"
  | "nap"
  | "indexing"
  | "service_pages"
  | "speed"
  | "ai_readiness"
  | "content"
  | "conversion"
  | "reviews_on_site"
  | "security";

export type WebAnalyticsApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  site: { url: string | null; last_checked: string | null } | null;
  health: { earned: number; max: number; open: number } | null;
  checks:
    | {
        key: WebCheckKey;
        group: string;
        state: WebState;
        result: string;
        points: number | null;
        max: number | null;
        points_text: string;
        source: string;
        trust_tier:
          | "self_declared"
          | "imported"
          | "platform_observed"
          | "authority_verified"
          | "owner_verified";
      }[]
    | null;
  counts: { all: number; fail: number; warn: number; pass: number } | null;
  tiles:
    | {
        key: "speed" | "markup" | "ai_readiness";
        label: string;
        value: string;
        note: string;
        state: WebState;
        check: WebCheckKey;
      }[]
    | null;
  top_fix: { open: number; snippet: string | null } | null;
  notes: { title: string; body: string; cta: string; action: "send" | "close" }[] | null;
  facts: {
    name: string | null;
    company: string | null;
    phone: string | null;
    address: string | null;
  } | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type WebCheckRow = { group: string; result: string; points: string; state: WebState };
export type WebTile = {
  icon: HfIconName;
  label: string;
  value: string;
  note: string;
  state: WebState;
  check: string;
};
export type WebThink = { t: string; d: string; cta: string; action: "send" | "close" };

export type WebAnalyticsModel = {
  mode: "sample" | "real";
  /** What remounts the screen when the seat changes, so one seat's filter and hand-off never carry over: the seat's id, or "sample". */
  seatKey: string;
  /** True when the numbers are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  /** The address under the title ("" when the seat has none). */
  site: string;
  /** "Oct 16" ("" when the seat has never been scanned: the page then says "Not checked yet"). */
  lastChecked: string;
  /** The Site health gauge (the SRS v5 website lane); null when unknown. */
  gauge: { earned: number; max: number } | null;
  checks: WebCheckRow[];
  counts: { all: number; fail: number; warn: number; pass: number };
  tiles: WebTile[];
  /** The top-fix card; `snippet` is null when the Profile has no name to put in it. */
  topFix: { open: number; snippet: string | null } | null;
  thinks: WebThink[];
};

const TILE_ICON: Record<"speed" | "markup" | "ai_readiness", HfIconName> = {
  speed: "zap",
  markup: "code",
  ai_readiness: "spark",
};

export function countsOf(checks: { state: WebState }[]): WebAnalyticsModel["counts"] {
  return {
    all: checks.length,
    fail: checks.filter((c) => c.state === "fail").length,
    warn: checks.filter((c) => c.state === "warn").length,
    pass: checks.filter((c) => c.state === "pass").length,
  };
}

// --- the mapping ----------------------------------------------------------------------------------------------------

/** The model for a ready response, or null when the seat has no Web analytics data yet (the caller then shows the sample view). */
export function webAnalyticsModel(
  data: WebAnalyticsApi | null | undefined,
  seatId = "",
): WebAnalyticsModel | null {
  if (!data || !data.ready || !data.checks) return null;
  const group = new Map(data.checks.map((c) => [c.key, c.group]));
  const checks = data.checks.map((c) => ({
    group: c.group,
    result: c.result,
    points: c.points_text,
    state: c.state,
  }));
  return {
    mode: "real",
    seatKey: seatId,
    isMock: data.data !== "live",
    site: data.site?.url ?? "",
    lastChecked: monthDay(data.site?.last_checked),
    gauge: data.health ? { earned: data.health.earned, max: data.health.max } : null,
    checks,
    counts: countsOf(checks),
    tiles: (data.tiles ?? []).map((t) => ({
      icon: TILE_ICON[t.key],
      label: t.label,
      value: t.value,
      note: t.note,
      state: t.state,
      check: group.get(t.check) ?? "",
    })),
    topFix: data.top_fix ? { open: data.top_fix.open, snippet: data.top_fix.snippet } : null,
    thinks: (data.notes ?? []).map((n) => ({
      t: n.title,
      d: n.body,
      cta: n.cta,
      action: n.action,
    })),
  };
}

/** The cache key of a seat's Web analytics data: one entry per seat, so two seats never share data. */
export const webAnalyticsKey = (seatId: string) => ["seat-web-analytics-v1", seatId] as const;

export function loadWebAnalyticsData(seatId: string): Promise<WebAnalyticsApi> {
  return api.get<WebAnalyticsApi>(`/srp/seat/professional/${encodeURIComponent(seatId)}/website`);
}

/** The seat's Web analytics data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useWebAnalyticsApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: webAnalyticsKey(seatId),
    queryFn: () => loadWebAnalyticsData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
