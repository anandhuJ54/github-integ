/**
 * The Happyflow prototype's sample Web analytics data, in one place (srp/web-analytics-page-schema, task 8): the checks, tiles, code snippet and NORA's notes the Website screen
 * used to hold inline, and `sampleWebAnalyticsModel`, the same values in the shape of `WebAnalyticsModel`. The sample view (no real seat) is built from this; a real seat is built
 * from the API (`webAnalyticsModel` in utils/web-analytics-model.ts). Nothing here is read from or written to the database.
 */
import {
  countsOf,
  type WebAnalyticsModel,
  type WebState,
  type WebThink,
  type WebTile,
} from "@v3/srp/utils/web-analytics-model";
import { personalize, type HfPersona } from "./persona";

// Demo data (Happyflow prototype)

export const THINKS: WebThink[] = [
  {
    t: "Markup is worth 42 points.",
    d: "I've written the code — your webmaster only needs to paste it in.",
    cta: "Send to my webmaster",
    action: "send",
  },
  {
    t: "AI can't read your page yet.",
    d: "GPTBot is blocked in robots.txt, and there's no llms.txt or FAQ.",
    cta: "See the checks",
    action: "close",
  },
];

/** [group, result, points, state] */
export const CHK: [string, string, string, WebState][] = [
  ["Entity and markup", "No structured data on the page", "+42 open", "fail"],
  ["Name, address, phone", "Matches the profile", "30 of 30", "pass"],
  ["Indexing", "Indexed; no sitemap", "10 of 20", "warn"],
  ["Service pages", "No pages for FHA or VA loans", "0 of 10", "fail"],
  ["Speed", "LCP 3.1 s (needs work), INP 180 ms, CLS 0.02", "—", "warn"],
  [
    "AI readiness",
    "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content in the page HTML",
    "—",
    "warn",
  ],
  ["Content", "No blog", "—", "fail"],
  ["Conversion", "Click-to-call yes; no booking link", "—", "warn"],
  ["Reviews on site", "Widget not installed", "—", "fail"],
  ["Security", "HTTPS", "Pass", "pass"],
];

export const TILES: WebTile[] = [
  {
    icon: "zap",
    label: "Speed",
    value: "LCP 3.1 s",
    note: "Needs work",
    state: "warn",
    check: "Speed",
  },
  {
    icon: "code",
    label: "Markup",
    value: "Missing",
    note: "+42 open",
    state: "fail",
    check: "Entity and markup",
  },
  {
    icon: "spark",
    label: "AI readiness",
    value: "2 of 5",
    note: "Needs work",
    state: "warn",
    check: "AI readiness",
  },
];

export const CODE_SAMPLE = `<script type="application/ld+json">
{ "@type": "FinancialService",
  "name": "Alex Sample – Demo Mortgage",
  "telephone": "(563) 555-0100",
  "address": "100 Main St, Davenport, IA 52801" }
</script>`;

/** The prototype's Website Analytics page as a `WebAnalyticsModel`: the persona's own name and site address in place of the sample ones, the rest as drawn. */
export function sampleWebAnalyticsModel(persona: HfPersona): WebAnalyticsModel {
  const checks = CHK.map(([group, result, points, state]) => ({ group, result, points, state }));
  return {
    mode: "sample",
    seatKey: "sample",
    isMock: true,
    site: persona.site,
    lastChecked: "Oct 16",
    gauge: { earned: 40, max: 102 },
    checks,
    counts: countsOf(checks),
    tiles: TILES,
    topFix: { open: 42, snippet: personalize(CODE_SAMPLE, persona) },
    thinks: THINKS,
  };
}
