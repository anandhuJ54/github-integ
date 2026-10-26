/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import { loadOrgBundle, loadProfessionalBundle } from "@v3/search/lib/profile-render";
import { loadAdUnits, loadSponsoredSlots } from "@v3/search/lib/monetization";

// End to end: the legacy bundle builders (git, direct supabase-js) against the current ones
// (same page logic, rows from GET /search/profile/*). Run signed out: these are public pages.
// moved (surface audit 2026-10-25): the pages, libs and API are in the search Surface now
// (/srp/... → /search/...). The legacy paths below stay: they are read from the legacy git ref.
const PROFILE_RENDER = "surface-ui/srp/src/lib/profile-render.ts";
const MONETIZATION = "surface-ui/srp/src/lib/monetization.ts";

const pro = (slug: string, why: string): ParityCase => ({
  name: `profile /p/${slug} (${why})`,
  legacyModule: PROFILE_RENDER,
  legacyExport: "loadProfessionalBundle",
  legacyDeps: ["surface-ui/srp/src/lib/public-profile.ts"],
  legacyArgs: [slug],
  current: () => loadProfessionalBundle(slug),
});
const org = (kind: "o" | "c", slug: string, why: string): ParityCase => ({
  name: `profile /${kind}/${slug} (${why})`,
  legacyModule: PROFILE_RENDER,
  legacyExport: "loadOrgBundle",
  legacyDeps: ["surface-ui/srp/src/lib/public-profile.ts"],
  legacyArgs: [kind, slug],
  current: () => loadOrgBundle(kind, slug),
});

export const cases: ParityCase[] = [
  pro("sf-a9ee009780abff5cc27f", "State Farm agent: office + company, 35 graph nodes"),
  pro("emily-smith-houston-tx", "real estate agent"),
  pro("amber-ernst", "reviews, ratings, credentials"),
  pro("joy-schneckloth", "credentials"),
  pro("does-not-exist-parity", "unknown slug → null"),
  org("o", "sf-office-1562c3fed9e7f39d", "office with parent"),
  org("o", "re-max-leland-nc", "office with staff"),
  org("o", "new-american-funding", "ratings"),
  org("c", "remax-demo", "brand with child locations"),
  org("c", "does-not-exist-parity", "unknown slug → null"),
  {
    name: "sponsored slots gcid:mortgage_broker / 94301",
    legacyModule: MONETIZATION,
    legacyExport: "loadSponsoredSlots",
    legacyArgs: ["gcid:mortgage_broker", "94301"],
    current: () => loadSponsoredSlots("gcid:mortgage_broker", "94301"),
  },
  {
    name: "ad units serp / gcid:mortgage_broker / 94301",
    legacyModule: MONETIZATION,
    legacyExport: "loadAdUnits",
    legacyArgs: ["serp", "gcid:mortgage_broker", "94301"],
    current: () => loadAdUnits("serp", "gcid:mortgage_broker", "94301"),
  },
  {
    name: "ad units unclaimed-profile / default",
    legacyModule: MONETIZATION,
    legacyExport: "loadAdUnits",
    legacyArgs: ["unclaimed-profile", null, null],
    current: () => loadAdUnits("unclaimed-profile", null, null),
  },
  {
    // voce-hub.ts labelFor() (not exported): the raw lookup it made
    name: "category label gcid:insurance_agency",
    legacy: async (supabase) => {
      const { data } = await supabase.from("gbp_categories").select("display_name, slug").eq("gcid", "gcid:insurance_agency").maybeSingle();
      return data;
    },
    api: { method: "GET", path: "/search/category-label/gcid:insurance_agency" },
  },
];
