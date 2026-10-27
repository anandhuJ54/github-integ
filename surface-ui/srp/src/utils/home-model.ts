/**
 * The Home page's view model (srp/home-page-schema, task 9): the one object the Day 1 / Day 7 / Day 24 layouts and the shell read, instead of constants.
 *
 * `homeModel(data)` maps the API's response (`GET /srp/seat/professional/{id}/home`) to it; `sampleHomeModel` (components/happyflow/sample-home.ts)
 * builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Values are numbers and short texts the layouts format; the few sentences whose wording differs between the sample and a real seat are composed
 * here (`copy`, the locked-feature `text`, the brief's `awayText`), so a layout renders them without branching. Unknown stays unknown: a section
 * the API leaves null is null here, never a demo number.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";

// --- the API response (contracts/srp/openapi.json, HomeResponse) ------------------------------------------------

export type HomeLayout = "day1" | "day7" | "day24";

export type HomeApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  day: { n: number; trial_days: number; layout: HomeLayout; over: boolean } | null;
  person: { first_name: string | null; full_name: string | null; title: string | null; photo_url: string | null; year_started: number | null; credentials: number } | null;
  trial: { plan: { key: string; name: string; tag: string | null }; started_at: string | null; nora_text_day: string | null } | null;
  score: {
    total: number;
    max: number | null;
    band: { name: string; min_points: number; next: { name: string; min_points: number } | null } | null;
    as_of: string | null;
    since_claim: number | null;
    week_delta: number | null;
    lanes: { key: string; name: string; points: number | null; max: number }[];
  } | null;
  rank: { position: number; of: number; city: string | null; first_position: number | null } | null;
  rival: { name: string; initial: string; score: number; points_to_first: number; review_count: number | null; review_avg: number | null; article_count: number | null } | null;
  competitors: { count: number } | null;
  board: {
    latest: { label: string; points: number | null; status: "doing" | "done"; started_at: string | null; completed_at: string | null } | null;
    done: { label: string; points: number | null }[];
    done_count: number;
    since_claim_points: number;
    next_moves: { icon: string; title: string; subtitle: string | null; recommended: boolean; target: "voce" | "website" | "profile"; points: number | null }[];
    moves: { done: number; goal: number };
    streak_weeks: number;
    needs_you_count: number;
  } | null;
  tiles: {
    map: { scanned_at: string | null; top3: number; total: number; cells: { row: number; col: number; rank: number | null }[] } | null;
    ai: { cited: number | null; checked: number; checked_at: string | null } | null;
    reviews: { avg: number | null; count: number | null; as_of: string | null };
    profile_strength: { pct: number | null; previous_pct: number | null };
    website: { score: number | null; max: number | null; url: string | null } | null;
    articles: { published: number; total: number };
  } | null;
  locked: { features: { key: string; title: string; description: string | null; points_waiting: number | null; plan: string }[]; points_waiting: number } | null;
  peers: { band_from: string; median_gain: number; horizon_days: number; cohort_size: number; cohort_period: string; reached_next_band: number; of: number } | null;
  brief: {
    week_start: string | null;
    points_total: number;
    items: { label: string; points: number | null }[];
    next_move: { label: string | null; points: number | null; target: string | null };
    away: { new_reviews: number; bio_live: boolean; first_article: boolean };
  } | null;
  drafts: { id: number; reviewer_label: string; rating: number; review_text: string; draft_text: string; compliance_status: "passed" | "needs_edit"; status: "draft" | "approved" | "posted" }[] | null;
  events: { kind: "review" | "facebook"; title: string; body: string | null; action_label: string | null; expires_at: string | null }[] | null;
  insights: { position: number; title: string; body: string; cta: string | null; action: string }[] | null;
  recap: { days: number; things_done: number; tiles: { label: string; from: number; to: number; delta: number }[]; articles: number; replies: number } | null;
  plans: { key: string; name: string; tag: string | null; highlight: boolean; items: string[] }[] | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type ModelMove = { icon: string; title: string; subtitle: string; recommended: boolean; target: "voce" | "website" | "profile"; points: number | null };
export type ModelDraft = { id: number; reviewerLabel: string; rating: number; reviewText: string; draftText: string; compliant: boolean; status: "draft" | "approved" | "posted" };
export type ModelEvent = { kind: "review" | "facebook"; title: string; body: string; actionLabel: string; expiresAt: string | null };
export type ModelInsight = { title: string; body: string; cta: string; action: string };
export type ModelPlan = { key: string; name: string; tag: string; highlight: boolean; items: string[]; cta: string | null };
export type ModelCell = { row: number; col: number; rank: number | null };

export type HomeModel = {
  mode: "sample" | "real";
  /** True when the numbers are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  layout: HomeLayout;
  day: { n: number; trialDays: number; over: boolean };
  /** The signed-in person; null in the sample view (the persona context supplies the sample name). */
  person: { firstName: string | null; fullName: string | null; title: string | null; photoUrl: string | null; yearStarted: number | null; credentials: number } | null;
  plan: { key: string; name: string; tag: string };
  noraTextDay: string;
  trial: { lockedList: string; lockedCount: number; pointsWaiting: number; showBanner: boolean };
  score: {
    total: number;
    max: number | null;
    /** Where the first-task count-up starts: the total minus the latest finished task's points. */
    startTotal: number;
    band: string | null;
    nextBand: { name: string; min: number } | null;
    sinceClaim: number | null;
    weekDelta: number | null;
  };
  rank: { position: number; of: number; city: string | null; firstPosition: number | null } | null;
  rival: { name: string; short: string; initial: string; score: number; pointsToFirst: number; reviewCount: number | null; reviewAvg: number | null; articleCount: number | null } | null;
  competitorCount: number;
  board: {
    latest: { label: string; points: number | null; status: "doing" | "done" } | null;
    done: { label: string; points: number | null }[];
    doneCount: number;
    sinceClaimPoints: number;
    nextMoves: ModelMove[];
    moves: { done: number; goal: number };
    streakWeeks: number;
    needsYouCount: number;
  };
  tiles: {
    map: { top3: number; total: number; scannedAt: string | null; cells: ModelCell[]; locked: boolean } | null;
    ai: { cited: number | null; checked: number; checkedAt: string | null; locked: boolean } | null;
    reviews: { avg: number | null; count: number | null; asOf: string | null };
    profileStrength: { pct: number | null; previousPct: number | null };
    website: { score: number | null; max: number | null; url: string | null } | null;
    articles: { published: number; total: number };
  };
  locked: { features: { key: string; title: string; text: string; pointsWaiting: number | null; plan: string }[]; pointsWaiting: number; upgradeNote: string };
  peers: { bandFrom: string; medianGain: number; horizonDays: number; cohortSize: number; cohortPeriod: string; reachedNextBand: number; of: number } | null;
  brief: { weekStart: string | null; pointsTotal: number; items: { label: string; points: number | null }[]; nextMove: { label: string; points: number; target: string }; awayText: string } | null;
  drafts: ModelDraft[];
  events: ModelEvent[];
  insights: ModelInsight[];
  recap: { days: number; thingsDone: number; tiles: { label: string; from: number; to: number; delta: number }[]; articles: number; replies: number } | null;
  plans: ModelPlan[];
  /** Sentences whose wording the sample and a real seat do not share. */
  copy: { heroSentence: string; bandNote: string | null };
};

// --- helpers ------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 16" from an ISO time (UTC, as the API stores it); "" when there is none. */
export function monthDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function awayText(away: { new_reviews: number; bio_live: boolean; first_article: boolean }): string {
  const parts = [
    away.new_reviews > 0 ? `${away.new_reviews} new ${plural(away.new_reviews, "review", "reviews")}` : null,
    away.bio_live ? "your bio went live" : null,
    away.first_article ? "your first article is published" : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `While you were away: ${joinList(parts)}.` : "Nothing new while you were away.";
}

/** The rival's name as the score bar says it: "Riverbend Bank & Trust" is "Riverbend", "The Harbor Group" is "The Harbor". */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words[0]?.toLowerCase() === "the" && words.length > 1 ? `${words[0]} ${words[1]}` : (words[0] ?? "");
}

/** A task's name as the launcher shows it: the first four words, then an ellipsis when there are more. */
export function launcherLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : words.join(" ");
}

/** A map spot's colour from its rank: top 3 green, 4 to 10 yellow, 11 to 20 orange, beyond (or unknown) red. */
export function rankColor(rank: number | null): string {
  if (rank === null) return "#ea4335";
  return rank <= 3 ? "#34a853" : rank <= 10 ? "#fbbc04" : rank <= 20 ? "#fa7b17" : "#ea4335";
}

/** NORA's quick questions on Home, with the rival's short name and the score filled in; no rival, no rival question. */
export function chipsFor(total: number, rival: string | null): string[] {
  return [
    ...(rival ? [`Where am I losing to ${rival}?`] : []),
    "What should I fix first?",
    "Write my first article",
    `Why is my score ${total}?`,
    "Show my map",
  ];
}

/** The closing line of the upgrade panel: which plan unlocks the first locked feature ("" when nothing is locked). */
export function upgradeNote(planKey: string | undefined, plans: HomeApi["plans"]): string {
  if (!planKey) return "";
  const name = plans?.find((p) => p.key === planKey)?.name ?? planKey.charAt(0).toUpperCase() + planKey.slice(1);
  return `${name} unlocks it.`;
}

export function heroSentence(rival: HomeApi["rival"], rank: HomeApi["rank"]): string {
  if (!rank) return rival ? `${rival.name} is #1 in your market — here's your gap.` : "";
  const where = rank.city ?? "your market";
  return rival ? `${rival.name} is #1 in ${where} — here's your gap. You're #${rank.position} of ${rank.of}.` : `You lead ${where}. You're #${rank.position} of ${rank.of}.`;
}

// --- the mapping ----------------------------------------------------------------------------------------------------

/** The model for a ready response, or null when the seat has no Home data yet (the caller then shows the sample view). */
export function homeModel(data: HomeApi | null | undefined): HomeModel | null {
  if (!data || !data.ready || !data.day || !data.score || !data.trial || !data.board || !data.tiles || !data.locked) return null;
  const { day, score, trial, board, tiles, locked } = data;
  const mapLocked = locked.features.some((f) => f.key === "map_rank");
  const doneTask = board.latest && board.latest.status === "done" ? (board.latest.points ?? 0) : 0;
  const lockedTitles = locked.features.map((f) => f.title);
  return {
    mode: "real",
    isMock: data.data === "mock",
    layout: day.layout,
    day: { n: day.n, trialDays: day.trial_days, over: day.over },
    person: data.person && {
      firstName: data.person.first_name, fullName: data.person.full_name, title: data.person.title, photoUrl: data.person.photo_url,
      yearStarted: data.person.year_started, credentials: data.person.credentials,
    },
    plan: { key: trial.plan.key, name: trial.plan.name, tag: trial.plan.tag ?? "" },
    noraTextDay: trial.nora_text_day ?? "",
    trial: { lockedList: joinList(lockedTitles), lockedCount: lockedTitles.length, pointsWaiting: locked.points_waiting, showBanner: lockedTitles.length > 0 },
    score: {
      total: score.total, max: score.max, startTotal: score.total - doneTask, band: score.band?.name ?? null,
      nextBand: score.band?.next ? { name: score.band.next.name, min: score.band.next.min_points } : null,
      sinceClaim: score.since_claim, weekDelta: score.week_delta,
    },
    rank: data.rank && { position: data.rank.position, of: data.rank.of, city: data.rank.city, firstPosition: data.rank.first_position },
    rival: data.rival && {
      name: data.rival.name, short: shortName(data.rival.name), initial: data.rival.initial, score: data.rival.score, pointsToFirst: data.rival.points_to_first,
      reviewCount: data.rival.review_count, reviewAvg: data.rival.review_avg, articleCount: data.rival.article_count,
    },
    competitorCount: data.competitors?.count ?? 0,
    board: {
      latest: board.latest && { label: board.latest.label, points: board.latest.points, status: board.latest.status },
      done: board.done, doneCount: board.done_count, sinceClaimPoints: board.since_claim_points,
      nextMoves: board.next_moves.map((m) => ({ ...m, subtitle: m.subtitle ?? "" })),
      moves: board.moves, streakWeeks: board.streak_weeks, needsYouCount: board.needs_you_count,
    },
    tiles: {
      map: tiles.map && { top3: tiles.map.top3, total: tiles.map.total, scannedAt: tiles.map.scanned_at, cells: tiles.map.cells, locked: mapLocked },
      ai: tiles.ai && { cited: tiles.ai.cited, checked: tiles.ai.checked, checkedAt: tiles.ai.checked_at, locked: mapLocked },
      reviews: { avg: tiles.reviews.avg, count: tiles.reviews.count, asOf: tiles.reviews.as_of },
      profileStrength: { pct: tiles.profile_strength.pct, previousPct: tiles.profile_strength.previous_pct },
      website: tiles.website,
      articles: tiles.articles,
    },
    locked: {
      features: locked.features.map((f) => ({
        key: f.key, title: f.title, plan: f.plan, pointsWaiting: f.points_waiting,
        text: [f.description, f.points_waiting !== null ? `${f.points_waiting} points are waiting.` : null].filter(Boolean).join(" "),
      })),
      pointsWaiting: locked.points_waiting,
      upgradeNote: upgradeNote(locked.features[0]?.plan, data.plans),
    },
    peers: data.peers && {
      bandFrom: data.peers.band_from, medianGain: data.peers.median_gain, horizonDays: data.peers.horizon_days, cohortSize: data.peers.cohort_size,
      cohortPeriod: data.peers.cohort_period, reachedNextBand: data.peers.reached_next_band, of: data.peers.of,
    },
    brief: data.brief && {
      weekStart: data.brief.week_start, pointsTotal: data.brief.points_total, items: data.brief.items,
      nextMove: { label: data.brief.next_move.label ?? "", points: data.brief.next_move.points ?? 0, target: data.brief.next_move.target ?? "" },
      awayText: awayText(data.brief.away),
    },
    drafts: (data.drafts ?? []).map((d) => ({
      id: d.id, reviewerLabel: d.reviewer_label, rating: d.rating, reviewText: d.review_text, draftText: d.draft_text,
      compliant: d.compliance_status === "passed", status: d.status,
    })),
    events: (data.events ?? []).map((e) => ({ kind: e.kind, title: e.title, body: e.body ?? "", actionLabel: e.action_label ?? "", expiresAt: e.expires_at })),
    insights: (data.insights ?? []).map((i) => ({ title: i.title, body: i.body, cta: i.cta ?? "", action: i.action })),
    recap: data.recap && { days: data.recap.days, thingsDone: data.recap.things_done, tiles: data.recap.tiles, articles: data.recap.articles, replies: data.recap.replies },
    plans: (data.plans ?? []).map((p) => ({ key: p.key, name: p.name, tag: p.tag ?? "", highlight: p.highlight, items: p.items, cta: p.key !== "core" ? `Choose ${p.name}` : null })),
    copy: { heroSentence: heroSentence(data.rival, data.rank), bandNote: score.band?.next ? `Next band: ${score.band.next.name} at ${score.band.next.min_points}.` : null },
  };
}

/** The notice above a real Home when its numbers are mock data from the local database. */
export const MOCK_NOTICE = "Mock data · these values come from the local database and are not your real score or activity.";

export function loadHomeData(seatId: string): Promise<HomeApi> {
  return api.get<HomeApi>(`/srp/seat/professional/${encodeURIComponent(seatId)}/home`);
}

/** The seat's Home data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useHomeApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: ["seat-home-v2", seatId],
    queryFn: () => loadHomeData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
