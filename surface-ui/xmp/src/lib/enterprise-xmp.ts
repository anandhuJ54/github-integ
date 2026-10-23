/**
 * Enterprise XMP (per-brand) live reads.
 *
 * Real-only policy: every number here comes from a table or a read-only
 * aggregate function. Nothing is estimated or fabricated. When a source is not
 * wired (e.g. review ingestion), the caller renders an honest empty state.
 */
import { supabase } from "@v3/ui/integrations/supabase/client";

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

export async function loadBrand(slug: string): Promise<Brand | null> {
  const { data } = await supabase
    .from("organizations")
    .select("id,name,slug,logo_url,entity_type,address_city,address_state,search_rank_score")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Brand | null) ?? null;
}

export async function loadOverview(brandId: string): Promise<BrandOverview> {
  const { data, error } = await supabase.rpc("exp_xmp_brand_overview", { p_brand: brandId });
  if (error) throw error;
  return data as unknown as BrandOverview;
}

export async function loadStateRollup(brandId: string, limit = 60): Promise<StateRow[]> {
  const { data, error } = await supabase.rpc("exp_xmp_state_rollup", {
    p_brand: brandId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as unknown as StateRow[]) ?? [];
}

/* ─────────── hierarchy explorer (paginated) ─────────── */

export async function loadOfficePage(args: {
  brandId: string;
  q?: string;
  state?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: OfficeRow[]; total: number }> {
  const { data, error } = await supabase.rpc("exp_xmp_offices_page", {
    p_brand: args.brandId,
    p_q: args.q ?? "",
    p_state: args.state ?? "",
    p_limit: args.pageSize,
    p_offset: args.page * args.pageSize,
  });
  if (error) throw error;
  const rows = (data as unknown as OfficeRow[]) ?? [];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function loadOfficePros(officeId: string, limit = 50): Promise<ProRow[]> {
  const { data, error } = await supabase
    .from("professionals")
    .select(
      "id,display_name,first_name,last_name,slug,photo_url,bio,address_city,address_state,search_rank_score,claimed,primary_org_id",
    )
    .eq("primary_org_id", officeId)
    .order("display_name", { nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data as ProRow[]) ?? [];
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
  const { data, error } = await supabase.rpc("exp_xmp_top_pros_score", {
    p_brand: brandId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as unknown as ProRow[]) ?? [];
}

export async function loadTopOfficesByScore(brandId: string, limit = 20): Promise<OfficeRow[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,slug,address_city,address_state,search_rank_score,claimed")
    .eq("parent_org_id", brandId)
    .gt("search_rank_score", 0)
    .order("search_rank_score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({ ...r, pro_count: 0, total_count: 0 })) as OfficeRow[];
}

export async function loadTopDepth(brandId: string, limit = 20): Promise<DepthRow[]> {
  const { data, error } = await supabase.rpc("exp_xmp_top_depth", {
    p_brand: brandId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as unknown as DepthRow[]) ?? [];
}

export async function loadTopReviews(brandId: string, limit = 20): Promise<ReviewLeaderRow[]> {
  const { data, error } = await supabase.rpc("exp_xmp_top_reviews", {
    p_brand: brandId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data as unknown as ReviewLeaderRow[]) ?? [];
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
  const { data: pro } = await supabase
    .from("professionals")
    .select(
      "id,display_name,first_name,last_name,slug,photo_url,bio,headline,job_title,email,phone,address_city,address_state,search_rank_score,claimed,primary_org_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!pro) return null;

  const [officeRes, nodeRes, revRes] = await Promise.all([
    pro.primary_org_id
      ? supabase
          .from("organizations")
          .select("id,name,slug,address_city,address_state")
          .eq("id", pro.primary_org_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as any),
    supabase
      .from("graph_nodes")
      .select("id,node_type,title,url,ring")
      .eq("entity_id", id)
      .eq("is_active", true)
      .order("ring")
      .limit(300),
    supabase
      .from("reviews")
      .select("id,rating,reviewer_name,review_text,review_date")
      .eq("entity_type", "professional")
      .eq("entity_id", id)
      .order("review_date", { ascending: false })
      .limit(25),
  ]);

  return {
    kind: "professional",
    pro: pro as any,
    office: (officeRes as any).data ?? null,
    nodes: ((nodeRes.data as any[]) ?? []) as ViewAsProfessional["nodes"],
    reviews: ((revRes.data as any[]) ?? []) as ViewAsProfessional["reviews"],
  };
}

export async function loadViewAsLocation(id: string): Promise<ViewAsLocation | null> {
  const { data: office } = await supabase
    .from("organizations")
    .select(
      "id,name,slug,phone,address_street,address_city,address_state,address_zip,search_rank_score,claimed",
    )
    .eq("id", id)
    .maybeSingle();
  if (!office) return null;
  const pros = await loadOfficePros(id, 100);
  return { kind: "location", office: office as any, pros };
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
  const pros = await loadTopReviews(brandId, 200);
  const ids = pros.map((p) => p.id);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("reviews")
    .select("id,entity_id,rating,reviewer_name,review_text,review_date")
    .eq("entity_type", "professional")
    .in("entity_id", ids)
    .order("review_date", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []).map((r) => ({ ...r, flags: screenText(r.review_text) }));
}
