/**
 * The Happyflow prototype's sample Home data, in one place (srp/home-page-schema, task 9): the constants the Day 1 / Day 7 / Day 24 layouts and
 * the shell used to hold inline, and `sampleHomeModel`, the same numbers in the shape of `HomeModel`. The sample view (no real seat) is built from this;
 * a real seat is built from the API (`homeModel` in utils/home-model.ts). Nothing here is read from or written to the database.
 */
import { awayText, heroSentence, type HomeLayout, type HomeModel } from "@v3/srp/utils/home-model";
import { GRID, PERSONA, RIVALS, RIVERBEND_SCORE, SCORE_AT_LANDING, SCORE_BY_DAY, type HfDay } from "./demo-data";
import type { HfIconName } from "./icons";
import type { Think } from "./shell";

// Demo data (Happyflow prototype)
export const SCORE_AT_CLAIM = 298;
export const TASK_POINTS = 6;

export const MOVES: {
  icon: HfIconName;
  t: string;
  sub: string;
  rec: boolean;
  to: "voce" | "website" | "profile";
}[] = [
  {
    icon: "pen",
    t: "Start publishing",
    sub: "Your biggest gap: 0 articles to Riverbend's 14. Free VOCE credits.",
    rec: true,
    to: "voce",
  },
  {
    icon: "wrench",
    t: "Fix my website",
    sub: "Markup is missing · health 40 of 102",
    rec: false,
    to: "website",
  },
  {
    icon: "award",
    t: "Add your credentials",
    sub: "Certifications and awards for your profile",
    rec: false,
    to: "profile",
  },
];

export const DONE_BEFORE: [string, string][] = [
  ["Fixed 4 places", "+19"],
  ["Kept 9 loan products", "+13"],
  ["Built your profile · 67 facts", "+54"],
  ["Mapped 5 competitors", ""],
];

export const LOCKED: { t: string; d: string; pts: string }[] = [
  {
    t: "Listings",
    d: "22 directories are missing you or show your old phone. 42 points are waiting.",
    pts: "+42",
  },
  { t: "VOCE", d: "No articles yet. 85 points are in Articles.", pts: "+85" },
  { t: "Map Rank tracking", d: "See the week you pass Riverbend.", pts: "" },
];

export const THINKS_DAY1: Think[] = [
  {
    t: "Riverbend's lead is mostly content.",
    d: "They have 14 articles to your 0 — 85 points are sitting in Articles. Publishing is the fastest way to close the gap.",
    cta: "Start publishing",
    act: "voce",
  },
  {
    t: "Your reviews are better — there are just fewer.",
    d: "Yours average 4.9 to their 4.7, but they have 412 to your 128.",
    cta: "See reviews",
    act: "reviews",
  },
  {
    t: "AI barely knows you yet.",
    d: "ChatGPT names you in 1 of 7 answers. Your website is missing the markup AI reads.",
    cta: "Want to see why?",
    act: "insights",
  },
];

export const CHIPS = [
  "Where am I losing to Riverbend?",
  "What should I fix first?",
  "Write my first article",
  "Why is my score 390?",
  "Show my map",
];

// Demo data (Happyflow prototype)
export const THINKS_DAY7: Think[] = [
  {
    t: "You crossed into Established.",
    d: "418 now. Next is the website: 42 points, and the code is written.",
    cta: "Fix my website",
    act: "website",
  },
  {
    t: "Two replies are waiting.",
    d: "Both drafts are ready and compliant. Approve them and I'll post.",
    cta: "Show me",
    act: "close",
  },
];

/** The two sample reviews NORA has drafted replies to; the first one names the professional. */
export const draftsFor = (first: string): { n: string; s: number; t: string; d: string }[] => [
  {
    n: "Maria L.",
    s: 5,
    t: `${first} walked us through every step of our FHA loan. We closed in 28 days.`,
    d: "Thank you, Maria! It was a pleasure helping you and your family get into your new home.",
  },
  {
    n: "James T.",
    s: 4,
    t: "Explained everything clearly. A couple of slow email replies.",
    d: "Thanks, James — I appreciate the honest feedback, and I’m working on faster replies.",
  },
];

export const BRIEF: [string, string][] = [
  ["Service areas added", "+6"],
  ["Bio approved", "+8"],
  ["First article published (VOCE free credits)", "+12"],
  ["2 replies posted", "+2"],
];

export const TILES: { icon: HfIconName; l: string; v: string; n: string; lk: boolean }[] = [
  { icon: "pin", l: "Top-3 map spots", v: "9 of 49", n: "Last scan Oct 16", lk: true },
  { icon: "spark", l: "AI citations", v: "1 of 7", n: "Last check Oct 16", lk: true },
  { icon: "star", l: "Reviews", v: "4.9", n: "from 130 reviews", lk: false },
  { icon: "user", l: "Profile strength", v: "72%", n: "up from 64%", lk: false },
];

export const YEARS = Array.from({ length: 37 }, (_, i) => String(2026 - i));

export const PLANS: { name: string; tag: string; items: string[]; cta?: string; highlight?: boolean }[] = [
  {
    name: "Core",
    tag: "Your trial today · stays free after day 30",
    items: ["Your profile", "Reviews", "Referral network", "Single social posts", "Chat with NORA"],
  },
  {
    name: "Engage",
    tag: "Listings",
    items: [
      "Everything in Core",
      "Publish your details to Apple Maps, Bing and 28 directories",
      "Correct the 22 directories that miss you or show your old phone · +42 points",
    ],
    cta: "Choose Engage",
  },
  {
    name: "Amplify",
    tag: "Includes Engage",
    items: [
      "Everything in Engage",
      "VOCE articles · 85 points open in Articles",
      "Map Rank tracking · see the week you pass Riverbend",
      "AI-citation monitoring",
      "NORA's drafts, fixes and weekly brief",
      "Website audits",
    ],
    cta: "Choose Amplify",
    highlight: true,
  },
];


/** The demo's two event banners (the demo bar and the `events` screen): a 2★ review and an expiring Facebook connection. */
export const SAMPLE_EVENTS: Record<"review" | "fb", { kind: "review" | "facebook"; title: string; body: string; actionLabel: string; expiresAt: string | null }> = {
  review: { kind: "review", title: "A 2★ review from Kevin P. needs you today.", body: "I drafted a calm, compliant reply.", actionLabel: "Review the draft", expiresAt: null },
  fb: { kind: "facebook", title: "Your Facebook connection expires Friday.", body: "Reconnect to keep your social points.", actionLabel: "Reconnect", expiresAt: null },
};

// --- the sample view model ----------------------------------------------------------------------------------------

const points = (s: string): number | null => (s ? Number(s.replace("+", "")) : null);
const SAMPLE_WEEK = "2026-10-16T00:00:00Z";
const LOCKED_KEYS = [
  { key: "listings", plan: "engage" },
  { key: "voce", plan: "engage" },
  { key: "map_rank", plan: "amplify" },
] as const;

/** The sample page's numbers in the shape of `HomeModel`, for day 1, 7 or 24. `first` is the persona's first name (it appears in the drafts). */
export function sampleHomeModel(day: HfDay = 1, first: string = PERSONA.first): HomeModel {
  const layout: HomeLayout = day === 1 ? "day1" : day === 7 ? "day7" : "day24";
  const total = SCORE_BY_DAY[day];
  const rank = { position: day === 1 ? 6 : day === 7 ? 5 : 4, of: 41, city: "Davenport", firstPosition: 6 };
  const rival = {
    name: RIVALS[0], short: "Riverbend", initial: "R", score: RIVERBEND_SCORE, pointsToFirst: RIVERBEND_SCORE - total, reviewCount: 412, reviewAvg: 4.7, articleCount: 14,
  };
  const later = day !== 1;
  const apiRival = { ...rival, points_to_first: rival.pointsToFirst, review_count: 412, review_avg: 4.7, article_count: 14 };
  const insights = (later ? THINKS_DAY7 : THINKS_DAY1).map((t) => ({ title: t.t, body: t.d, cta: t.cta, action: typeof t.act === "string" ? t.act : "close" }));
  return {
    mode: "sample",
    isMock: true,
    layout,
    day: { n: day, trialDays: 30, over: false },
    person: null,
    plan: { key: "core", name: PLANS[0].name, tag: PLANS[0].tag },
    noraTextDay: "Tuesday early morning",
    trial: { lockedList: "Listings, VOCE articles, Map Rank tracking and AI-citation monitoring", lockedCount: 4, pointsWaiting: 127, showBanner: true },
    score: {
      total, max: 850, startTotal: day === 1 ? SCORE_AT_LANDING : total, band: later ? "Established" : "Building",
      nextBand: later ? null : { name: "Established", min: 400 }, sinceClaim: total - SCORE_AT_CLAIM, weekDelta: later ? 28 : null,
    },
    rank,
    rival,
    competitorCount: RIVALS.length,
    board: {
      latest: { label: "Adding your Google category and services", points: TASK_POINTS, status: "done" },
      done: [{ label: "Adding your Google category and services", points: TASK_POINTS }, ...DONE_BEFORE.map(([label, pts]) => ({ label, points: points(pts) }))],
      doneCount: 10,
      sinceClaimPoints: SCORE_BY_DAY[1] - SCORE_AT_CLAIM,
      nextMoves: MOVES.map((m) => ({ icon: m.icon, title: m.t, subtitle: m.sub, recommended: m.rec, target: m.to, points: null })),
      moves: { done: later ? 2 : 0, goal: 3 },
      streakWeeks: later ? 1 : 0,
      needsYouCount: later ? draftsFor(first).length : 0,
    },
    tiles: {
      map: { top3: 9, total: 49, scannedAt: later ? SAMPLE_WEEK : null, locked: later, cells: GRID.map((c) => ({ row: c.r, col: c.c, rank: c.rank === "20+" ? null : c.rank })) },
      ai: { cited: 1, checked: 7, checkedAt: later ? SAMPLE_WEEK : null, locked: later },
      reviews: { avg: 4.9, count: later ? 130 : 128, asOf: null },
      profileStrength: later ? { pct: 72, previousPct: 64 } : { pct: 64, previousPct: null },
      website: { score: 40, max: 102, url: null },
      articles: { published: 0, total: 0 },
    },
    locked: {
      features: LOCKED.map((l, i) => ({ key: LOCKED_KEYS[i].key, title: l.t, text: l.d, pointsWaiting: points(l.pts), plan: LOCKED_KEYS[i].plan })),
      pointsWaiting: 127,
      upgradeNote: "Engage keeps your details right everywhere; Amplify includes it.",
    },
    peers: { bandFrom: "Building", medianGain: 61, horizonDays: 90, cohortSize: 34, cohortPeriod: "Jan–Sep 2026", reachedNextBand: 3, of: 5 },
    brief: later
      ? {
          weekStart: SAMPLE_WEEK, pointsTotal: 28, items: BRIEF.map(([label, pts]) => ({ label, points: points(pts) })),
          nextMove: { label: "Fix my website", points: 42, target: "website" },
          awayText: awayText({ new_reviews: 2, bio_live: true, first_article: true }),
        }
      : null,
    drafts: later ? draftsFor(first).map((d, i) => ({ id: i + 1, reviewerLabel: d.n, rating: d.s, reviewText: d.t, draftText: d.d, compliant: true, status: "draft" as const })) : [],
    events: [],
    insights,
    recap: day === 24
      ? {
          days: 24, thingsDone: 41, articles: 3, replies: 12,
          tiles: [{ label: "Score", from: 384, to: 471, delta: 87 }, { label: "Rank", from: 6, to: 4, delta: 2 }, { label: "Profile strength", from: 64, to: 88, delta: 24 }],
        }
      : null,
    plans: PLANS.map((p) => ({ key: p.name.toLowerCase(), name: p.name, tag: p.tag, highlight: Boolean(p.highlight), items: p.items, cta: p.cta ?? null })),
    copy: {
      heroSentence: heroSentence({ ...apiRival }, { ...rank, first_position: 6 }),
      bandNote: later ? "You crossed 400 on day 6. Next band target: Riverbend at 571." : null,
    },
  };
}
