/**
 * Enterprise XMP (per-brand) live reads.
 *
 * Real-only policy: every number here comes from a table or a read-only
 * aggregate function. Nothing is estimated or fabricated. When a source is not
 * wired (e.g. review ingestion), the caller renders an honest empty state.
 */
import { api } from "@v3/ui/lib/server-fn";

/** Default enterprise example brand — State Farm. */
export const DEFAULT_BRAND_ID = "bbbbbbb1-0000-4000-8000-000000000001";
export const DEFAULT_BRAND_SLUG = "state-farm";

export type Brand = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  entity_type: string | null;
  address_city: string | null;
  address_state: string | null;
  search_rank_score: number | null;
};

export type BrandOverview = {
  offices: number;
  offices_claimed: number;
  offices_scored: number;
  avg_office_score: number | null;
  pros: number;
  pros_claimed: number;
  pros_scored: number;
  avg_pro_score: number | null;
  pros_bio: number;
  pros_photo: number;
  pros_place_id: number;
  pros_products: number;
  reviews_pro: number;
  states: number;
};

export type OfficeRow = {
  id: string;
  name: string;
  slug: string;
  address_city: string | null;
  address_state: string | null;
  search_rank_score: number | null;
  claimed: boolean | null;
  pro_count: number;
  total_count: number;
};

export type StateRow = {
  state: string;
  offices: number;
  pros: number;
  claimed: number;
  with_bio: number;
  with_photo: number;
  reviews: number;
};

export type ProRow = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  slug: string | null;
  photo_url: string | null;
  bio: string | null;
  address_city: string | null;
  address_state: string | null;
  search_rank_score: number | null;
  claimed: boolean | null;
  primary_org_id: string | null;
};

export type DepthRow = {
  id: string;
  display_name: string | null;
  slug: string | null;
  address_city: string | null;
  address_state: string | null;
  node_count: number;
};

export type ReviewLeaderRow = {
  id: string;
  display_name: string | null;
  slug: string | null;
  review_count: number;
  avg_rating: number | null;
};

export const proName = (p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) =>
  p.display_name?.trim() ||
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
  "Unnamed professional";

export const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

/* ─────────── brand ─────────── */

/** An allow-listed read-only RPC (FastAPI /xmp/rpc): its rows, or its jsonb value. */
const rpc = <T>(name: string, args: Record<string, unknown>) =>
  api.post<T>(`/xmp/rpc/${name}`, { args });

export async function loadBrand(slug: string): Promise<Brand | null> {
  // errors were ignored (no brand)
  return api.get<Brand | null>(`/xmp/enterprise/brands/${encodeURIComponent(slug)}`).catch(() => null);
}

export async function loadOverview(brandId: string): Promise<BrandOverview> {
  return rpc<BrandOverview>("exp_xmp_brand_overview", { p_brand: brandId });
}

export async function loadStateRollup(brandId: string, limit = 60): Promise<StateRow[]> {
  const data = await rpc<StateRow[] | null>("exp_xmp_state_rollup", { p_brand: brandId, p_limit: limit });
  return data ?? [];
}

/* ─────────── hierarchy explorer (paginated) ─────────── */

export async function loadOfficePage(args: {
  brandId: string;
  q?: string;
  state?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: OfficeRow[]; total: number }> {
  const data = await rpc<OfficeRow[] | null>("exp_xmp_offices_page", {
    p_brand: args.brandId,
    p_q: args.q ?? "",
    p_state: args.state ?? "",
    p_limit: args.pageSize,
    p_offset: args.page * args.pageSize,
  });
  const rows = data ?? [];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function loadOfficePros(officeId: string, limit = 50): Promise<ProRow[]> {
  const data = await api.get<ProRow[]>(`/xmp/enterprise/offices/${encodeURIComponent(officeId)}/pros`, {
    params: { limit },
  });
  return data ?? [];
}

/** Distinct states present under the brand, for the filter control. */
export async function loadStateOptions(brandId: string): Promise<string[]> {
  const rows = await loadStateRollup(brandId, 200);
  return rows
    .map((r) => r.state)
    .filter((s) => s && s !== "—" && s.length <= 3)
    .sort();
}

/* ─────────── leaderboards ─────────── */

export async function loadTopProsByScore(brandId: string, limit = 20): Promise<ProRow[]> {
  const data = await rpc<ProRow[] | null>("exp_xmp_top_pros_score", { p_brand: brandId, p_limit: limit });
  return data ?? [];
}

export async function loadTopOfficesByScore(brandId: string, limit = 20): Promise<OfficeRow[]> {
  const data = await api.get<Omit<OfficeRow, "pro_count" | "total_count">[]>(
    `/xmp/enterprise/brands/${encodeURIComponent(brandId)}/top-offices`,
    { params: { limit } },
  );
  return (data ?? []).map((r) => ({ ...r, pro_count: 0, total_count: 0 })) as OfficeRow[];
}

export async function loadTopDepth(brandId: string, limit = 20): Promise<DepthRow[]> {
  const data = await rpc<DepthRow[] | null>("exp_xmp_top_depth", { p_brand: brandId, p_limit: limit });
  return data ?? [];
}

export async function loadTopReviews(brandId: string, limit = 20): Promise<ReviewLeaderRow[]> {
  const data = await rpc<ReviewLeaderRow[] | null>("exp_xmp_top_reviews", { p_brand: brandId, p_limit: limit });
  return data ?? [];
}

/* ─────────── view-as (read-only) ─────────── */

export type ViewAsProfessional = {
  kind: "professional";
  pro: ProRow & { headline: string | null; job_title: string | null; email: string | null; phone: string | null };
  office: { id: string; name: string; slug: string; address_city: string | null; address_state: string | null } | null;
  nodes: { id: string; node_type: string | null; title: string | null; url: string | null; ring: number | null }[];
  reviews: { id: string; rating: number | null; reviewer_name: string | null; review_text: string | null; review_date: string | null }[];
};

export type ViewAsLocation = {
  kind: "location";
  office: {
    id: string;
    name: string;
    slug: string;
    phone: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    search_rank_score: number | null;
    claimed: boolean | null;
  };
  pros: ProRow[];
};

export async function loadViewAsProfessional(id: string): Promise<ViewAsProfessional | null> {
  // the professional, its office, active nodes and reviews (server side; null when not readable)
  const data = await api.get<Omit<ViewAsProfessional, "kind"> | null>(
    `/xmp/enterprise/view-as/professional/${encodeURIComponent(id)}`,
  );
  if (!data) return null;
  return { kind: "professional", ...data };
}

export async function loadViewAsLocation(id: string): Promise<ViewAsLocation | null> {
  // the office and loadOfficePros(id, 100) (server side; null when the office isn't readable)
  const data = await api.get<Omit<ViewAsLocation, "kind"> | null>(
    `/xmp/enterprise/view-as/location/${encodeURIComponent(id)}`,
  );
  if (!data) return null;
  return { kind: "location", office: data.office, pros: data.pros };
}

/* ─────────── moderation queue (scaffold) ─────────── */

export type ModerationItem = {
  id: string;
  entity_id: string | null;
  rating: number | null;
  reviewer_name: string | null;
  review_text: string | null;
  review_date: string | null;
  flags: string[];
};

const PII_PATTERNS: [string, RegExp][] = [
  ["email address", /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ["phone number", /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/],
  ["street address", /\b\d{1,6}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane)\b/],
  ["policy / account number", /\b(?:policy|account|acct)\s*#?\s*[\w-]{5,}/i],
];

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "bastard", "damn", "crap"];

export function screenText(text: string | null): string[] {
  if (!text) return [];
  const flags: string[] = [];
  for (const [label, re] of PII_PATTERNS) if (re.test(text)) flags.push(`PII: ${label}`);
  const lower = text.toLowerCase();
  if (PROFANITY.some((w) => new RegExp(`\\b${w}`, "i").test(lower))) flags.push("Profanity");
  return flags;
}

export async function loadModerationQueue(brandId: string, limit = 50): Promise<ModerationItem[]> {
  // loadTopReviews(brand, 200), then those professionals' newest reviews (server side)
  const data = await api.get<Omit<ModerationItem, "flags">[]>(
    `/xmp/enterprise/brands/${encodeURIComponent(brandId)}/moderation`,
    { params: { limit } },
  );
  return (data ?? []).map((r) => ({ ...r, flags: screenText(r.review_text) }));
}
