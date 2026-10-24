/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";

// xmp /website/* CMS pages: every loader in surface-ui/xmp/src/lib/website.ts, run verbatim from
// PARITY_LEGACY_REF (direct supabase-js, as the signed-in user) against GET /xmp/website/*.
// Reads only: the CMS writes (pages, templates, forms, leads, trust, consent, alerts, ads,
// campaigns, media) are covered by compiled-SQL unit tests (xmp/queries/website_test.py), never
// run. Row counts at port time: pages 36, templates 6, consent config 1, ads 3, sales reps 21;
// forms, leads, trust items, consent events, alerts, campaigns and media are empty (still
// compared: both sides must answer []).

const WEBSITE = "surface-ui/xmp/src/lib/website.ts";
const W = "/xmp/website";

/**
 * Rows in the page's order, with rows that tie on the sort key put in id order (Postgres returns
 * ties in any order): exp_web_pages.updated_at has 22 distinct values over 36 rows, templates 2
 * over 6, ads.created_at 1 over 3, sales reps share a name.
 */
const byKey =
  (key: string, desc: boolean) =>
  (rows: any) =>
    Array.isArray(rows)
      ? [...rows].sort((a, b) => {
          const x = String(a[key] ?? "");
          const y = String(b[key] ?? "");
          if (x !== y) return (x < y ? -1 : 1) * (desc ? -1 : 1);
          return String(a.id).localeCompare(String(b.id));
        })
      : rows;

const loader = (exp: string, path: string, normalize?: (r: any) => any): ParityCase => ({
  name: `${exp} → GET ${W}${path}`,
  legacyModule: WEBSITE,
  legacyExport: exp,
  api: { method: "GET", path: `${W}${path}` },
  normalize,
});

export const cases: ParityCase[] = [
  loader("loadPages", "/pages", byKey("updated_at", true)),
  loader("loadDeletedPages", "/pages/trash", byKey("deleted_at", true)),
  loader("loadPageTemplates", "/templates", byKey("updated_at", true)),
  loader("loadDeletedPageTemplates", "/templates/trash", byKey("deleted_at", true)),
  loader("loadForms", "/forms", byKey("created_at", true)),
  loader("loadLeads", "/leads", byKey("created_at", true)),
  loader("loadTrustItems", "/trust", byKey("sort_order", false)),
  loader("loadConsent", "/consent", (r: any) =>
    r && typeof r === "object" ? { ...r, events: byKey("created_at", true)(r.events) } : r,
  ),
  loader("loadAlerts", "/alerts", byKey("created_at", true)),
  loader("loadAds", "/ads", byKey("created_at", true)),
  loader("loadCampaigns", "/campaigns", byKey("created_at", true)),
  loader("loadMedia", "/media", byKey("created_at", true)),
  loader("loadSellers", "/sellers", byKey("name", false)),
];
