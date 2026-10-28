/**
 * The Profile page's view model (srp/profile-page-schema, task 8): the one object the Profile screen reads, instead of constants.
 *
 * `profileModel(data, seatId)` maps the API's response (`GET /srp/seat/professional/{id}/profile`) to it; `sampleProfileModel` (components/happyflow/sample-profile.ts)
 * builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Unknown stays unknown: a missing fact is an empty string (the page says "Missing"), a missing preview figure is null, and no offer or draft number is invented.
 * The edits a person types stay in the browser under a per-seat key (`storeKey`); nothing here writes.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";
import { storeKeyFor } from "@v3/srp/components/happyflow/screens/profile-store";
import type { ProfileField } from "@v3/srp/components/happyflow/screens/profile-voice";

// --- the API response (contracts/srp/openapi.json, ProfileResponse) ----------------------------------------------

export type ProfileApiField =
  | "name" | "title" | "photo" | "bio" | "year_started" | "office_phone" | "mobile_phone" | "email" | "address" | "hours" | "nmls" | "licensed_in" | "products"
  | "service_areas" | "designations" | "awards" | "education" | "company";
export type ProfileTier = "self_declared" | "imported" | "platform_observed" | "authority_verified" | "owner_verified";

export type ProfileApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  facts:
    | {
        field: ProfileApiField;
        present: boolean;
        value: string | string[] | null;
        source: string | null;
        trust_tier: ProfileTier | null;
        confirmed_at: string | null;
        source_line: string | null;
      }[]
    | null;
  preview: { title: string | null; company: string | null; city: string | null; rating: number | null; reviews: number | null; nmls: string | null; strength_pct: number | null; photo_url: string | null } | null;
  credentials: { added: number; of: number } | null;
  graph: { groups: { key: GraphKey; facts: number }[]; facts_total: number; sources: number } | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type GraphKey = "identity" | "contact" | "licence" | "products" | "reviews" | "presence";

export type ProfileModel = {
  mode: "sample" | "real";
  /** True when the numbers are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  /** The browser key of the demo edits: the original key for the sample page, one per seat for a real one. */
  storeKey: string;
  /** The fifteen editable facts as the page shows them; "" is a missing fact. */
  initial: Record<ProfileField, string>;
  /** Each fact's source line ("Confirmed by you · Oct 16"); "" when the fact is missing. */
  sources: Record<ProfileField, string>;
  /** Whether each source reads as trusted (owner or authority verified): the green source line. */
  trusted: Record<ProfileField, boolean>;
  photo: { url: string | null; source: string; trusted: boolean; initials: string };
  products: string[];
  credentials: { added: number; of: number };
  /** The preview card's figures (null = unknown, never 0). */
  preview: { title: string | null; company: string | null; city: string | null; rating: number | null; reviews: number | null; nmls: string | null; strengthPct: number | null };
  graph: { groups: { key: GraphKey; label: string; facts: number }[]; total: number; sources: number };
  /** `thin`: the bio is missing or under THIN_BIO characters, so NORA's draft is offered; `draft` is a fixed template over the facts. */
  bio: { thin: boolean; draft: string };
  /** The prototype offers "I found 2 certifications on LinkedIn"; a real seat has nothing in the database that says so. */
  linkedinOffer: boolean;
};

export const THIN_BIO = 60;
export const FIELD_ORDER: ProfileField[] = ["Name", "Title", "Bio", "Year started", "Office", "Mobile", "Email", "Address", "Hours", "NMLS", "Licensed in", "Service areas", "Designations", "Awards", "Education"];
const API_FIELD: Record<ProfileField, ProfileApiField> = {
  Name: "name", Title: "title", Bio: "bio", "Year started": "year_started", Office: "office_phone", Mobile: "mobile_phone", Email: "email", Address: "address", Hours: "hours",
  NMLS: "nmls", "Licensed in": "licensed_in", "Service areas": "service_areas", Designations: "designations", Awards: "awards", Education: "education",
};
const GRAPH_LABEL: Record<GraphKey, string> = { identity: "Identity", contact: "Contact", licence: "Licence", products: "Products", reviews: "Reviews", presence: "Presence" };
export const graphLabel = (key: GraphKey) => GRAPH_LABEL[key];

// --- helpers ------------------------------------------------------------------------------------------------------

/** "(563) 555-0100" from "+15635550100" or "5635550100"; anything else is left as it is. */
export function formatPhone(raw: string): string {
  const m = /^(?:\+1|1)?(\d{10})$/.exec(raw.trim().replace(/[\s().-]/g, ""));
  return m ? `(${m[1].slice(0, 3)}) ${m[1].slice(3, 6)}-${m[1].slice(6)}` : raw;
}

/** The first letters of the first and last word of a name ("HJ"); "" for no name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

/** The source line of an edited fact reads as trusted when it starts with one of the prototype's confirming words. */
export const trustedText = (line: string): boolean => /^(Confirmed|Verified|Updated|Approved)/.test(line);

/** NORA's bio draft: a fixed template over the facts, never generated text; a part whose fact is missing is left out. */
export function bioDraftFor(f: { name: string; city: string | null; yearStarted: string; asOf: string; products: string[] }): string {
  const started = /^\d{4}$/.test(f.yearStarted.trim()) ? Number(f.yearStarted) : null;
  const years = started === null ? 0 : Number(f.asOf.slice(0, 4)) - started;
  const duration = years > 0 ? ` for ${years} ${years === 1 ? "year" : "years"}` : "";
  const focus = f.products.length >= 2 ? ` and ${f.products[0]} and ${f.products[1]} loans` : f.products.length === 1 ? ` and ${f.products[0]} loans` : "";
  return `${f.name} has helped ${f.city ? `${f.city} ` : ""}families buy and refinance homes${duration}, with a focus on first-time buyers${focus}.`;
}

// --- the mapping ----------------------------------------------------------------------------------------------------

type Fact = NonNullable<ProfileApi["facts"]>[number];

/** The model for a ready response, or null when the seat has no Profile data yet (the caller then shows the sample view). */
export function profileModel(data: ProfileApi | null | undefined, seatId: string): ProfileModel | null {
  if (!data || !data.ready || !data.facts || !data.preview || !data.credentials || !data.graph) return null;
  const by = new Map<ProfileApiField, Fact>(data.facts.map((f) => [f.field, f]));
  const text = (f: ProfileApiField): string => {
    const fact = by.get(f);
    return fact && fact.present && typeof fact.value === "string" ? fact.value : "";
  };
  const initial = {} as Record<ProfileField, string>;
  const sources = {} as Record<ProfileField, string>;
  const trusted = {} as Record<ProfileField, boolean>;
  for (const field of FIELD_ORDER) {
    const fact = by.get(API_FIELD[field]);
    const value = text(API_FIELD[field]);
    initial[field] = field === "Office" || field === "Mobile" ? formatPhone(value) : value;
    sources[field] = value && fact?.source_line ? fact.source_line : "";
    trusted[field] = Boolean(value) && (fact?.trust_tier === "owner_verified" || fact?.trust_tier === "authority_verified");
  }
  const photo = by.get("photo");
  const productsFact = by.get("products");
  const products = productsFact?.present && Array.isArray(productsFact.value) ? productsFact.value : [];
  const bio = initial.Bio;
  const name = initial.Name;
  return {
    mode: "real",
    isMock: data.data !== "live",
    storeKey: storeKeyFor(seatId),
    initial,
    sources,
    trusted,
    photo: {
      url: photo?.present && typeof photo.value === "string" ? photo.value : null,
      source: photo?.present && photo.source_line ? photo.source_line : "",
      trusted: Boolean(photo?.present) && (photo?.trust_tier === "owner_verified" || photo?.trust_tier === "authority_verified"),
      initials: initialsOf(name),
    },
    products,
    credentials: data.credentials,
    preview: {
      title: data.preview.title, company: data.preview.company, city: data.preview.city, rating: data.preview.rating, reviews: data.preview.reviews,
      nmls: data.preview.nmls, strengthPct: data.preview.strength_pct,
    },
    graph: { groups: data.graph.groups.map((g) => ({ key: g.key, label: GRAPH_LABEL[g.key], facts: g.facts })), total: data.graph.facts_total, sources: data.graph.sources },
    bio: { thin: bio.length < THIN_BIO, draft: bioDraftFor({ name: name || "Your profile", city: data.preview.city, yearStarted: initial["Year started"], asOf: data.as_of, products }) },
    linkedinOffer: false,
  };
}

/** The cache key of a seat's Profile data: one entry per seat, so two seats never share data. */
export const profileKey = (seatId: string) => ["seat-profile-v1", seatId] as const;

export function loadProfileData(seatId: string): Promise<ProfileApi> {
  return api.get<ProfileApi>(`/srp/seat/professional/${encodeURIComponent(seatId)}/profile`);
}

/** The seat's Profile data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useProfileApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: profileKey(seatId),
    queryFn: () => loadProfileData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
