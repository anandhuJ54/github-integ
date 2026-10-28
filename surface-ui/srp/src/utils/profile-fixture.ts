// A ready Profile API response for tests (srp/profile-page-schema): the shape of GET /srp/seat/professional/{id}/profile, for a seat whose every fact differs from
// the prototype's. Facts are in the API's fixed order.
import type { ProfileApi } from "@v3/srp/utils/profile-model";

type F = ProfileApi["facts"] extends (infer T)[] | null ? T : never;

const fact = (field: F["field"], value: F["value"], source: string | null, tier: F["trust_tier"], confirmed: string | null = null): F => ({
  field, present: value !== null, value, source: value === null ? null : source, trust_tier: value === null ? null : tier,
  confirmed_at: value === null ? null : confirmed, source_line: value === null || source === null ? null : confirmed ? `${source} · ${monthDay(confirmed)}` : source,
});
const monthDay = (iso: string) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1] + " " + Number(iso.slice(8, 10));

export const api = (over: Partial<ProfileApi> = {}): ProfileApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  facts: [
    fact("name", "Harper Jones", "Confirmed by you", "owner_verified", "2026-09-03T09:00:00Z"),
    fact("title", "Branch Manager", "From LinkedIn", "imported"),
    fact("photo", "https://example.test/harper.jpg", "From LinkedIn", "imported"),
    fact("bio", "Helps Bettendorf-area families buy and refinance homes, with a focus on first-time buyers and FHA and VA loans.", "Approved by you", "owner_verified", "2026-09-10T09:00:00Z"),
    fact("year_started", "2008", "Confirmed by you", "owner_verified", "2026-09-03T09:00:00Z"),
    fact("office_phone", "+13095557320", "From Google", "imported"),
    fact("mobile_phone", "+15635550727", "Confirmed by you", "owner_verified", "2026-10-05T09:00:00Z"),
    fact("email", "mock.users.7@example.test", "Confirmed by you", "owner_verified", "2026-10-05T09:00:00Z"),
    fact("address", "412 Main St, Bettendorf, IA 52722", "From Google", "imported"),
    fact("hours", "Mon–Sat 9:00–4:00", "Added by you", "self_declared", "2026-08-20T09:00:00Z"),
    fact("nmls", "771204", "From NMLS", "authority_verified"),
    fact("licensed_in", "Iowa", "From NMLS", "authority_verified"),
    fact("products", ["Conventional", "FHA", "VA", "USDA", "Jumbo"], "From Google", "imported"),
    fact("service_areas", "Bettendorf, Moline", "Added by you", "self_declared", "2026-08-21T09:00:00Z"),
    fact("designations", null, null, null),
    fact("awards", "Top Producer 2025", "From LinkedIn", "imported"),
    fact("education", null, null, null),
    fact("company", "Example Home Loans", "From LinkedIn", "imported"),
  ],
  preview: { title: "Branch Manager", company: "Example Home Loans", city: "Bettendorf", rating: 4.1, reviews: 71, nmls: "771204", strength_pct: 58, photo_url: "https://example.test/harper.jpg" },
  credentials: { added: 1, of: 3 },
  graph: {
    groups: [{ key: "identity", facts: 7 }, { key: "contact", facts: 4 }, { key: "licence", facts: 3 }, { key: "products", facts: 5 }, { key: "reviews", facts: 9 }, { key: "presence", facts: 8 }],
    facts_total: 36, sources: 6,
  },
  ...over,
});

/** The fixture with some facts replaced (each patch: a field and its new value, source and tier; a null value makes it missing). */
export function withFacts(patches: Record<string, Partial<F>>, over: Partial<ProfileApi> = {}): ProfileApi {
  const base = api(over);
  return { ...base, facts: base.facts!.map((f) => (patches[f.field] ? { ...f, ...patches[f.field] } : f)) };
}
