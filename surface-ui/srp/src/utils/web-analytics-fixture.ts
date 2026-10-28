// A ready Web analytics API response for tests (srp/web-analytics-page-schema): the shape of GET /srp/seat/professional/{id}/website, for a seat whose every value
// differs from the prototype's.
import type { WebAnalyticsApi, WebCheckKey } from "@v3/srp/utils/web-analytics-model";

const SCAN = { source: "From your site scan", trust_tier: "platform_observed" as const };

const check = (
  key: WebCheckKey,
  group: string,
  state: "fail" | "warn" | "pass",
  result: string,
  points: number | null,
  max: number | null,
  points_text: string,
) => ({
  key,
  group,
  state,
  result,
  points,
  max,
  points_text,
  ...SCAN,
});

export const api = (over: Partial<WebAnalyticsApi> = {}): WebAnalyticsApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  site: { url: "harper-jones.example.test/loans", last_checked: "2026-09-09T09:00:00Z" },
  health: { earned: 77, max: 102, open: 25 },
  checks: [
    check(
      "entity_markup",
      "Entity and markup",
      "warn",
      "Structured data is incomplete",
      22,
      42,
      "+20 open",
    ),
    check("nap", "Name, address, phone", "pass", "Matches the profile", 30, 30, "30 of 30"),
    check("indexing", "Indexing", "pass", "Indexed with a sitemap", 20, 20, "20 of 20"),
    check(
      "service_pages",
      "Service pages",
      "warn",
      "Service pages for some of your loan products",
      5,
      10,
      "5 of 10",
    ),
    check("speed", "Speed", "pass", "LCP 1.9 s, INP 90 ms, CLS 0.02", null, null, "Pass"),
    check(
      "ai_readiness",
      "AI readiness",
      "fail",
      "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags",
      null,
      null,
      "—",
    ),
    check("content", "Content", "pass", "Blog with 4 posts", null, null, "Pass"),
    check(
      "conversion",
      "Conversion",
      "fail",
      "No click-to-call and no booking link",
      null,
      null,
      "—",
    ),
    check(
      "reviews_on_site",
      "Reviews on site",
      "pass",
      "Reviews widget installed",
      null,
      null,
      "Pass",
    ),
    check(
      "security",
      "Security",
      "fail",
      "No HTTPS (the page is served over HTTP)",
      null,
      null,
      "—",
    ),
  ],
  counts: { all: 10, fail: 3, warn: 2, pass: 5 },
  tiles: [
    {
      key: "speed",
      label: "Speed",
      value: "LCP 1.9 s",
      note: "Passing",
      state: "pass",
      check: "speed",
    },
    {
      key: "markup",
      label: "Markup",
      value: "Partial",
      note: "+20 open",
      state: "warn",
      check: "entity_markup",
    },
    {
      key: "ai_readiness",
      label: "AI readiness",
      value: "0 of 5",
      note: "Failing",
      state: "fail",
      check: "ai_readiness",
    },
  ],
  top_fix: {
    open: 20,
    snippet:
      '<script type="application/ld+json">\n{ "@type": "FinancialService",\n  "name": "Harper Jones – Example Home Loans" }\n</script>',
  },
  notes: [
    {
      title: "Markup is worth 20 points.",
      body: "I've written the code — your webmaster only needs to paste it in.",
      cta: "Send to my webmaster",
      action: "send",
    },
    {
      title: "AI can't read your page yet.",
      body: "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content built by scripts; missing title or description tags.",
      cta: "See the checks",
      action: "close",
    },
  ],
  facts: { name: "Harper Jones", company: "Example Home Loans", phone: null, address: null },
  ...over,
});
