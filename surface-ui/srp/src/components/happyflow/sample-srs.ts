/**
 * The Happyflow prototype's sample SRS data, in one place (srp/srs-page-schema, task 8): the 10 SRS v5 lanes, NORA's three notes and her quick
 * questions that the SRS screen used to hold inline, and `sampleSrsModel`, the same numbers in the shape of `SrsModel`. The sample view (no real
 * seat) is built from this; a real seat is built from the API (`srsModel` in utils/srs-model.ts). Nothing here is read from or written to the database.
 */
import {
  barFor, countsOf, greetingFor, raceFor, subtitleFor, type LaneTo, type SrsModel,
} from "@v3/srp/utils/srs-model";
import { RIVERBEND_SCORE, SCORE_BY_DAY } from "./demo-data";
import type { HfIconName } from "./icons";
import type { HfTarget } from "./shell";

// Demo data (Happyflow prototype)
export type LaneStatus = "Missing" | "Fix" | "Fix · locked" | "Strong";
export type Lane = {
  lane: string;
  icon: HfIconName;
  status: LaneStatus;
  /** Points allocated to the lane (the 10 SRS v5 lanes add up to 850). */
  max: number;
  /** Points still open in the lane; earned = max − pts. */
  pts: number;
  cmp: string;
  act: string;
  to: LaneTo;
};

// The 10 SRS v5 lanes and their budgets (AGENTS.md §3; docs/PLATFORM_HANDOFF_2026-10-12.md §2.6): 850 points in all.
// `pts` (points still open) and the comparisons are sample values; they add up to 460 open, so 390 are earned.
export const LANES: Lane[] = [
  {
    lane: "Completeness",
    icon: "user",
    status: "Fix",
    max: 182,
    pts: 105,
    cmp: "Bio thin, service areas missing, NMLS only vs 3 designations",
    act: "Fill my profile",
    to: "profile",
  },
  {
    lane: "Articles",
    icon: "pen",
    status: "Missing",
    max: 103,
    pts: 85,
    cmp: "0 vs 14 articles",
    act: "Start publishing",
    to: "voce",
  },
  {
    lane: "Website",
    icon: "code",
    status: "Fix",
    max: 102,
    pts: 62,
    cmp: "No markup vs full markup",
    act: "Fix my website",
    to: "website",
  },
  {
    lane: "Directories",
    icon: "pin",
    status: "Fix · locked",
    max: 90,
    pts: 48,
    cmp: "9 consistent vs 28",
    act: "Unlock Listings",
    to: "Billing",
  },
  {
    lane: "Connections",
    icon: "share",
    status: "Fix",
    max: 51,
    pts: 47,
    cmp: "2 vs 5 connected accounts",
    act: "Connect accounts",
    to: "connections",
  },
  {
    lane: "Reviews",
    icon: "star",
    status: "Strong",
    max: 187,
    pts: 45,
    cmp: "128 vs 412 reviews; 31 in the last 12 months",
    act: "See reviews",
    to: "reviews",
  },
  {
    lane: "Q&A",
    icon: "help",
    status: "Missing",
    max: 34,
    pts: 34,
    cmp: "0 vs 12 answered",
    act: "Answer questions",
    to: "chat",
  },
  {
    lane: "Videos",
    icon: "video",
    status: "Missing",
    max: 27,
    pts: 27,
    cmp: "Last video 23 months old",
    act: "Plan a video",
    to: "chat",
  },
  {
    lane: "Audio",
    icon: "mic",
    status: "Missing",
    max: 6,
    pts: 6,
    cmp: "No audio vs 3 episodes",
    act: "Plan a podcast",
    to: "chat",
  },
  {
    lane: "GBP",
    icon: "plug",
    status: "Strong",
    max: 68,
    pts: 1,
    cmp: "Connected; services added today",
    act: "View connection",
    to: "connections",
  },
];

/** NORA's note as the prototype wrote it (`act` is where the button goes). */
export type SampleThink = { t: string; d: string; cta: string; act: HfTarget };

export const THINKS: SampleThink[] = [
  {
    t: "Articles gets you to Established.",
    d: "It's 85 points open, and you only need 10 to cross 400. One article could do it.",
    cta: "Start publishing",
    act: "voce",
  },
  {
    t: "Your website is costing you 62 points.",
    d: "Riverbend has full markup; you have none. I can hand the fix to your webmaster.",
    cta: "Fix my website",
    act: "website",
  },
  {
    t: "Reviews are already strong.",
    d: "31 in the last 12 months. I'll keep them coming — this one isn't where the gap is.",
    cta: "See reviews",
    act: "reviews",
  },
];

export const CHIPS = [
  "What should I fix first?",
  "Why is my score 390?",
  "How do I pass Riverbend?",
  "What can you do on your own?",
];


const SAMPLE_TOTAL = SCORE_BY_DAY[1];
const OPEN_TOTAL = LANES.reduce((a, l) => a + l.pts, 0);

/** The prototype's SRS page as an `SrsModel`: the numbers are the demo constants, the sentences are the screen's own. */
export function sampleSrsModel(): SrsModel {
  const nextBand = { name: "Established", min: 400, pointsNeeded: 400 - SAMPLE_TOTAL };
  const score = { total: SAMPLE_TOTAL, max: 850, openTotal: OPEN_TOTAL, band: "Building", nextBand };
  const rival = {
    name: "Riverbend Bank & Trust", short: "Riverbend", initial: "R", score: RIVERBEND_SCORE, pointsToFirst: RIVERBEND_SCORE - SAMPLE_TOTAL,
    reviewCount: 412, reviewAvg: 4.7,
  };
  return {
    mode: "sample",
    isMock: true,
    city: "Davenport",
    score,
    rank: { position: 6, of: 41, city: "Davenport" },
    rival,
    lanes: LANES,
    unknownLanes: 0,
    counts: countsOf(LANES),
    notes: THINKS.map((t) => ({ t: t.t, d: t.d, cta: t.cta, to: t.act as LaneTo })),
    callout: {
      title: "Articles is your biggest gap — 85 points.",
      text: "Riverbend has 14; you have none. Closing just this lane would take you past Established.",
      cta: "Start publishing",
      to: "voce",
    },
    bar: barFor(score.total, score.max, score.band, nextBand),
    race: raceFor(score.total, rival.score),
    copy: { subtitle: subtitleFor("Davenport"), greeting: greetingFor(score, rival), chips: CHIPS },
  };
}
