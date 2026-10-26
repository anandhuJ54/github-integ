/**
 * DEMO DATA — Happyflow prototype ("Happyflow Prototype — Screens and Mock Data", Oct 16 2026).
 *
 * One fictional loan officer (Alex Sample, Demo Mortgage Co) and one fictional market
 * (Davenport, IA). Every number on every Happyflow screen comes from here or from the screen's
 * own demo constants, so the score climbs consistently from screen to screen. None of this is
 * read from or written to the database.
 */
import samplePhoto from "@v3/srp/assets/happyflow/sample-pro.jpg";
import sampleTampaPhoto from "@v3/srp/assets/happyflow/sample-pro-tampa.jpg";
import sampleSimilarPhoto from "@v3/srp/assets/happyflow/sample-pro-similar.jpg";
import experienceIcon from "@v3/srp/assets/happyflow/experience-icon.png";

export const HF_ASSETS = { samplePhoto, sampleTampaPhoto, sampleSimilarPhoto, experienceIcon };

export const PERSONA = {
  name: "Alex Sample",
  first: "Alex",
  title: "Senior Loan Officer",
  company: "Demo Mortgage Co",
  branch: "Davenport Branch",
  city: "Davenport, IA",
  address: "100 Main St, Davenport, IA 52801",
  officePhone: "(563) 555-0100",
  oldPhone: "(563) 555-0177",
  mobile: "(563) 555-0144",
  email: "alex.sample@demomortgage.com",
  nmls: "482913",
  states: "Iowa and Illinois",
  rating: 4.9,
  reviews: 128,
  years: 12,
  site: "demomortgage.com/alex-sample",
  photo: samplePhoto,
  photoPos: "50% 22%",
} as const;

/** Score at each moment of the demo. */
export const SCORE_BY_DAY: Record<HfDay, number> = { 1: 390, 7: 418, 24: 471 };
export const SCORE_AT_LANDING = 384;
export const RIVERBEND_SCORE = 571;

export type HfDay = 1 | 7 | 24;

export const PRODUCTS = [
  "Conventional",
  "FHA",
  "VA",
  "USDA",
  "Jumbo",
  "Rate-and-term",
  "Cash-out",
  "HELOC",
  "Pre-approval",
];

export const RIVALS = [
  "Riverbend Bank & Trust",
  "Prairie Home Lending",
  "Bluff City Mortgage",
  "Mississippi Valley Loans",
  "Heartland Credit Union",
];

export type GridCell = {
  i: number;
  r: number;
  c: number;
  d: number;
  ring: number;
  /** Order outward from the office pin (0 = closest). */
  k: number;
  bg: string;
  fg: string;
  rank: number | "20+";
};

/** The 7 × 7 = 49-spot map grid around 100 Main St: top 3 in 9, 4–10 in 17, 11–20 in 14, 20+ in 9. */
export const GRID: GridCell[] = (() => {
  const cells: GridCell[] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++)
      cells.push({
        i: r * 7 + c,
        r,
        c,
        d: Math.hypot(r - 3, c - 3) + ((r * 7 + c) % 5) * 0.07,
        ring: Math.max(Math.abs(r - 3), Math.abs(c - 3)),
        k: 0,
        bg: "",
        fg: "",
        rank: 0,
      });
  [...cells]
    .sort((a, b) => a.d - b.d)
    .forEach((x, k) => {
      x.k = k;
      if (k < 9) {
        x.bg = "#34a853";
        x.rank = [2, 1, 3, 2, 1, 3, 2, 3, 2][k];
        x.fg = "#fff";
      } else if (k < 26) {
        x.bg = "#fbbc04";
        x.rank = 4 + (k % 7);
        x.fg = "#202124";
      } else if (k < 40) {
        x.bg = "#fa7b17";
        x.rank = 11 + (k % 10);
        x.fg = "#fff";
      } else {
        x.bg = "#ea4335";
        x.rank = "20+";
        x.fg = "#fff";
      }
    });
  return cells;
})();

/** Text with `**bold**` segments, as NORA's lines are written. */
export function parseBold(s: string): { t: string; b: boolean }[] {
  return s
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((t) => (t.startsWith("**") ? { t: t.slice(2, -2), b: true } : { t, b: false }));
}
