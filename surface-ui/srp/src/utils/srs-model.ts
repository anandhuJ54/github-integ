/**
 * The SRS page's view model (srp/srs-page-schema, task 8): the one object the Search Rank Score screen reads, instead of constants.
 *
 * `srsModel(data)` maps the API's response (`GET /srp/seat/professional/{id}/srs`) to it; `sampleSrsModel` (components/happyflow/sample-srs.ts)
 * builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Unknown stays unknown: a lane whose points the API does not know is left out (and counted in `unknownLanes`), never shown as 0; a section the
 * API leaves null is null here. The few sentences whose wording the sample and a real seat share are composed here (`copy`, `callout`), so the screen
 * renders them without branching.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";
import type { HfIconName } from "@v3/srp/components/happyflow/icons";
import type { HfTarget } from "@v3/srp/components/happyflow/shell";
import { shortName } from "@v3/srp/utils/home-model";

// --- the API response (contracts/srp/openapi.json, SrsResponse) ------------------------------------------------

export type SrsStatus = "Missing" | "Fix" | "Fix · locked" | "Strong";
export type SrsTarget = "profile" | "voce" | "website" | "connections" | "reviews" | "chat" | "billing";

export type SrsApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  score: {
    total: number;
    max: number | null;
    open_total: number | null;
    as_of: string | null;
    band: { name: string; min_points: number; next: { name: string; min_points: number; points_needed: number } | null } | null;
  } | null;
  rank: { position: number; of: number; city: string | null } | null;
  rival: { name: string; score: number; points_to_first: number; review_count: number | null; review_avg: number | null } | null;
  lanes:
    | {
        key: string;
        name: string;
        short_name: string | null;
        earned: number | null;
        max: number;
        open: number | null;
        status: SrsStatus | null;
        you_text: string | null;
        rival_text: string | null;
        note: string | null;
        action_label: string | null;
        action_target: SrsTarget | null;
      }[]
    | null;
  counts: { all: number; missing: number; fix: number; strong: number } | null;
  notes: { title: string; body: string; cta: string | null; action: string | null }[] | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type LaneTo = HfTarget | "Billing";

/** One row of the gap list, exactly what the screen draws: `pts` is the points still open (earned is `max - pts`). */
export type ModelLane = {
  lane: string;
  icon: HfIconName;
  status: SrsStatus;
  max: number;
  pts: number;
  cmp: string;
  act: string;
  to: LaneTo;
};

export type SrsFilter = "All" | "Missing" | "Fix" | "Strong";

export type SrsModel = {
  mode: "sample" | "real";
  /** True when the numbers are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  city: string | null;
  score: { total: number; max: number | null; openTotal: number | null; band: string | null; nextBand: { name: string; min: number; pointsNeeded: number } | null };
  rank: { position: number; of: number; city: string | null } | null;
  rival: { name: string; short: string; initial: string; score: number; pointsToFirst: number; reviewCount: number | null; reviewAvg: number | null } | null;
  lanes: ModelLane[];
  /** Lanes the API sent without points: not shown, never shown as zero. */
  unknownLanes: number;
  counts: Record<SrsFilter, number>;
  notes: { t: string; d: string; cta: string; to: LaneTo }[];
  callout: { title: string; text: string; cta: string; to: LaneTo } | null;
  /** The band bar: the filled share, the next band's marker (null at the top band), and its labels. */
  bar: { fillPct: number; markerPct: number | null; from: string; next: string | null; end: number | null };
  /** The race: your bar as a share of the rival's score (null without a rival). */
  race: { youPct: number | null };
  copy: { subtitle: string; greeting: { before: string; bold: string; after: string }; chips: string[] };
};

// --- helpers ------------------------------------------------------------------------------------------------------

/** The icon of each SRS v5 lane (the screen's own choice; a lane it does not know gets a target). */
const ICONS: Record<string, HfIconName> = {
  completeness: "user", articles: "pen", website: "code", directories: "pin", connections: "share", reviews: "star", qa: "help", videos: "video", audio: "mic", gbp: "plug",
};

export const pct1 = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;
export const pct2 = (part: number, whole: number) => Math.round((part / whole) * 10000) / 100;

/** A target from the API as the screen opens it: billing is the Billing page, the rest are screens. */
export const toTarget = (target: string | null | undefined): LaneTo => (target === "billing" ? "Billing" : ((target ?? "chat") as HfTarget));

export const pointsText = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

export const subtitleFor = (city: string | null) => `Every gap between you and the #1 lender in ${city ?? "your market"}.`;

/** NORA's opening line: how far the next band and #1 are. The bold part is the band news. */
export function greetingFor(
  score: { total: number; band: string | null; nextBand: { name: string; pointsNeeded: number } | null },
  rival: { pointsToFirst: number } | null,
): { before: string; bold: string; after: string } {
  const bold = score.nextBand ? `${pointsText(score.nextBand.pointsNeeded)} from ${score.nextBand.name}` : score.band ? `in ${score.band}` : `at ${score.total} points`;
  return { before: "You're ", bold, after: `${rival ? ` and ${rival.pointsToFirst} from #1` : ""}. Here's where I'd start.` };
}

export function chipsFor(total: number, rival: string | null): string[] {
  return ["What should I fix first?", `Why is my score ${total}?`, ...(rival ? [`How do I pass ${rival}?`] : []), "What can you do on your own?"];
}

export function barFor(total: number, max: number | null, band: string | null, next: { name: string; min: number } | null) {
  return {
    fillPct: max ? pct1(total, max) : 0,
    markerPct: next && max ? pct2(next.min, max) : null,
    from: band ?? "",
    next: next ? `${next.min} ${next.name}` : null,
    end: max,
  };
}

export const raceFor = (total: number, rivalScore: number | null) => ({ youPct: rivalScore ? Math.min(100, pct1(total, rivalScore)) : null });

export function countsOf(lanes: { status: SrsStatus }[]): Record<SrsFilter, number> {
  const n = (f: (s: SrsStatus) => boolean) => lanes.filter((l) => f(l.status)).length;
  return { All: lanes.length, Missing: n((s) => s === "Missing"), Fix: n((s) => s === "Fix" || s === "Fix · locked"), Strong: n((s) => s === "Strong") };
}

// --- the mapping ----------------------------------------------------------------------------------------------------

type ApiLane = NonNullable<SrsApi["lanes"]>[number];

function laneRow(l: ApiLane): ModelLane {
  const cmp = l.you_text !== null && l.rival_text !== null ? `${l.you_text} vs ${l.rival_text}${l.note ? `; ${l.note}` : ""}` : "";
  return {
    lane: l.short_name ?? l.name, icon: ICONS[l.key] ?? "target", status: l.status as SrsStatus, max: l.max, pts: l.open as number, cmp,
    act: l.action_label ?? "", to: toTarget(l.action_target),
  };
}

/** The model for a ready response, or null when the seat has no SRS data yet (the caller then shows the sample view). */
export function srsModel(data: SrsApi | null | undefined): SrsModel | null {
  if (!data || !data.ready || !data.score || !data.lanes || !data.counts) return null;
  const known = data.lanes.filter((l) => l.status !== null && l.earned !== null && l.open !== null);
  const lanes = known.map(laneRow);
  const band = data.score.band;
  const nextBand = band?.next ? { name: band.next.name, min: band.next.min_points, pointsNeeded: band.next.points_needed } : null;
  const score = { total: data.score.total, max: data.score.max, openTotal: data.score.open_total, band: band?.name ?? null, nextBand };
  const rival = data.rival && {
    name: data.rival.name, short: shortName(data.rival.name), initial: (data.rival.name || "?").charAt(0).toUpperCase(), score: data.rival.score,
    pointsToFirst: data.rival.points_to_first, reviewCount: data.rival.review_count, reviewAvg: data.rival.review_avg,
  };
  const top = known.find((l) => (l.open ?? 0) > 0);
  let callout: SrsModel["callout"] = null;
  if (top) {
    const row = laneRow(top);
    const rivalLine = rival && top.rival_text !== null && top.you_text !== null ? `${rival.short}: ${top.rival_text}; you have ${top.you_text}.` : "";
    const bandLine = nextBand && (top.open ?? 0) >= nextBand.pointsNeeded ? `Closing just this lane would take you past ${nextBand.name}.` : "";
    callout = {
      title: `${row.lane} is your biggest gap — ${pointsText(top.open ?? 0)}.`, text: [rivalLine, bandLine].filter(Boolean).join(" "),
      cta: row.act || "Ask NORA", to: row.act ? row.to : "chat",
    };
  }
  return {
    mode: "real",
    isMock: data.data !== "live",
    city: data.rank?.city ?? null,
    score,
    rank: data.rank,
    rival,
    lanes,
    unknownLanes: data.lanes.length - known.length,
    counts: { All: data.counts.all, Missing: data.counts.missing, Fix: data.counts.fix, Strong: data.counts.strong },
    notes: (data.notes ?? []).map((n) => ({ t: n.title, d: n.body, cta: n.cta ?? "Ask NORA", to: toTarget(n.action) })),
    callout,
    bar: barFor(score.total, score.max, score.band, nextBand),
    race: raceFor(score.total, rival?.score ?? null),
    copy: { subtitle: subtitleFor(data.rank?.city ?? null), greeting: greetingFor(score, rival), chips: chipsFor(score.total, rival?.short ?? null) },
  };
}

/** The notice above a real SRS page when its numbers are mock data from the local database (the same words as the Home's). */
export { MOCK_NOTICE } from "@v3/srp/utils/home-model";

export function loadSrsData(seatId: string): Promise<SrsApi> {
  return api.get<SrsApi>(`/srp/seat/professional/${encodeURIComponent(seatId)}/srs`);
}

/** The seat's SRS data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useSrsApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: ["seat-srs-v1", seatId],
    queryFn: () => loadSrsData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
