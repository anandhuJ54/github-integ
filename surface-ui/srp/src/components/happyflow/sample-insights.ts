/**
 * The Happyflow prototype's sample Insights data, in one place (srp/insights-page-schema, task 8): the visibility figures, AI rows, competitors, locked cards and
 * NORA's notes the Insights screen used to hold inline, and `sampleInsightsModel`, the same values in the shape of `InsightsModel`. The sample view (no real
 * seat) is built from this; a real seat is built from the API (`insightsModel` in utils/insights-model.ts). Nothing here is read from or written to the database.
 */
import {
  DEFAULT_SPOT,
  queryLine,
  summaryOf,
  type InsightsModel,
} from "@v3/srp/utils/insights-model";
import { GRID, RIVALS } from "./demo-data";
import { personalize, type HfPersona } from "./persona";
import type { Think } from "./shell";

// Demo data (Happyflow prototype)
export const THINKS: Think[] = [
  {
    t: "Riverbend wins on volume.",
    d: "412 reviews and 14 articles. Your 4.9 rating is better than their 4.7.",
    cta: "Start publishing",
    act: "voce",
  },
  {
    t: "Perplexity cites articles.",
    d: "You have none, so it never names you. One article changes that.",
    cta: "Write my first article",
    act: "voce",
  },
];

export const VIS_STATS: [string, string][] = [
  ["Search views", "1,240"],
  ["Maps views", "860"],
  ["Calls", "41"],
  ["Directions", "18"],
  ["Website clicks", "57"],
  ["Experience.com profile views", "312"],
];

export const AI_ROWS: [string, string, string, number, number][] = [
  ["ChatGPT", "1 of 3", "Cites your Zillow reviews", 1, 3],
  ["Gemini", "0 of 2", "Leans on the map pack", 0, 2],
  ["Perplexity", "0 of 2", "Cites articles; you have none", 0, 2],
];

export const COMPS: [number, string, string, string][] = [
  [1, "Riverbend Bank & Trust", "4.7 (412)", "2.1"],
  [2, "Prairie Home Lending", "4.8 (230)", "3.4"],
  [3, "Bluff City Mortgage", "4.6 (188)", "4.0"],
  [4, "Mississippi Valley Loans", "4.5 (96)", "5.2"],
  [5, "Heartland Credit Union", "4.4 (151)", "5.9"],
  [6, "Alex Sample (you)", "4.9 (128)", "7.8"],
];

export const INS_LOCKED: [string, string][] = [
  ["Map Rank tracking", "Re-scan every week and see the day you pass Riverbend"],
  ["AI-citation monitoring", "Track every answer that names you"],
];

/** The sample spot's top three: the five rivals rotate by spot, and "You" takes the place of the rank when the rank is 1 to 3. */
function spotTop(i: number, rank: number | "20+") {
  const rkN = typeof rank === "number" ? rank : 21;
  const rot = i % 3;
  const base = [RIVALS[rot % 3], RIVALS[(rot + 1) % 3], RIVALS[(rot + 2) % 3]];
  if (rkN <= 3) base.splice(rkN - 1, 0, "You");
  return base.slice(0, 3).map((name, k) => ({ place: k + 1, name, you: name === "You" }));
}

/** The prototype's Insights page as an `InsightsModel`: the persona's own name in the competitor table, the rest as drawn. */
export function sampleInsightsModel(persona: HfPersona): InsightsModel {
  return {
    mode: "sample",
    seatKey: "sample",
    isMock: true,
    visibility: VIS_STATS.map(([label, value]) => ({
      label,
      value,
      line: "Last 30 days · from Google",
    })),
    map: {
      heading: "Map rank around 100 Main St",
      scanLabel: "One-time scan · Oct 16",
      cells: GRID.map((g) => ({
        i: g.i,
        row: g.r,
        col: g.c,
        rank: typeof g.rank === "number" ? g.rank : null,
        label: g.i === DEFAULT_SPOT ? "●" : String(g.rank),
        bg: g.bg,
        fg: g.fg,
        leaders: spotTop(g.i, g.rank),
      })),
      summary: summaryOf(GRID.map((g) => (typeof g.rank === "number" ? g.rank : null))),
    },
    query: queryLine("Davenport, IA"),
    ai: {
      heading: "Named in 1 of 7 answers",
      rows: AI_ROWS.map(([name, share, note, cited, checked]) => ({
        name,
        share,
        note,
        cited,
        checked,
      })),
    },
    competitors: COMPS.map(([place, name, rating, avg]) => ({
      place,
      name: personalize(name, persona),
      you: place === 6,
      rating,
      avg,
    })),
    target: "Riverbend Bank & Trust",
    locked: INS_LOCKED.map(([t, d]) => [t, d]),
    thinks: THINKS,
  };
}
