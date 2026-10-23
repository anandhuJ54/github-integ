import { toE164 } from "@/routes/api/public/-disco-site-contract";
import { UNIT_COST_USD } from "./costs";
import { withIntegration, type IntegrationResult } from "./integrations";
import { tokenShare } from "./web-sweep";
import type { ProviderCost } from "./types";

/*
 * gbpLookup — find the entity's Google Business Profile listing through the Google Places
 * API (New), behind the integrations stub contract ("google_places"). Text Search by
 * name + address, or Place Details when a place id is already known (e.g. CandidateFacts
 * .place_id from a Maps / review link on the site). Returns candidates with match hints;
 * ownership is proven elsewhere (gbp_list_locations via OAuth).
 */

export type GbpQuery = {
  name: string;
  address?: string | null;
  phone?: string | null;
  placeId?: string | null;
};

export type GbpCandidate = {
  place_id: string;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  location: { latitude: number; longitude: number } | null;
  primary_type: string | null;
  business_status: string | null;
  hints: { name_match: number; phone_match: boolean; place_id_match: boolean };
};

export type GbpOutput = { mode: "details" | "text_search"; candidates: GbpCandidate[]; cost: ProviderCost };

const FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "location",
  "primaryType",
  "businessStatus",
];

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  businessStatus?: string;
};

/** Pure: Places API place → candidate with match hints. */
export function toGbpCandidate(p: Place, q: GbpQuery): GbpCandidate {
  const phone = toE164(p.internationalPhoneNumber ?? "");
  const want = toE164(q.phone ?? "");
  return {
    place_id: String(p.id ?? ""),
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    phone,
    website: p.websiteUri ?? null,
    maps_url: p.googleMapsUri ?? null,
    location: p.location ?? null,
    primary_type: p.primaryType ?? null,
    business_status: p.businessStatus ?? null,
    hints: {
      name_match: tokenShare(q.name, p.displayName?.text ?? ""),
      phone_match: !!phone && !!want && phone === want,
      place_id_match: !!q.placeId && p.id === q.placeId,
    },
  };
}

export async function gbpLookup(q: GbpQuery): Promise<IntegrationResult<GbpOutput>> {
  return withIntegration("google_places", async ({ secrets }) => {
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": secrets["apiKey"],
      "X-Goog-FieldMask": q.placeId ? FIELDS.join(",") : FIELDS.map((f) => `places.${f}`).join(","),
    };
    const cost: ProviderCost = {
      provider: "google_places",
      requests: 1,
      est_cost_usd: UNIT_COST_USD.google_places_text_search,
    };
    if (q.placeId) {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(q.placeId)}`, { headers });
      if (!r.ok) throw new Error(`Places details HTTP ${r.status}`);
      return { mode: "details" as const, candidates: [toGbpCandidate((await r.json()) as Place, q)], cost };
    }
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers,
      body: JSON.stringify({ textQuery: [q.name, q.address].filter(Boolean).join(", "), pageSize: 5 }),
    });
    if (!r.ok) throw new Error(`Places text search HTTP ${r.status}`);
    const body = (await r.json()) as { places?: Place[] };
    return {
      mode: "text_search" as const,
      candidates: (body.places ?? []).map((p) => toGbpCandidate(p, q)),
      cost,
    };
  });
}
