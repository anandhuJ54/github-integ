/**
 * Inner role-shell (seat) live reads.
 *
 * Two seats:
 *  - LOCATION  — one `organizations` row (entity_type='office') and the
 *                professionals attached to it.
 *  - PROFESSIONAL — one `professionals` row, scoped to self.
 *
 * Real-only policy: every number comes from a table. Nothing is estimated.
 * Every query is filtered by the seat's own id (or its roster of ids), so a
 * seat can never read another account's rows.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadOfficeMode } from "@/lib/office-mode";
import { listingSubject } from "@/lib/listings/subject";

export type SeatOffice = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  gcid: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  gbp_place_id: string | null;
  gbp_connected: boolean | null;
  search_rank_score: number | null;
  claimed: boolean | null;
  is_demo: boolean | null;
  parent_org_id: string | null;
};

export type SeatPro = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  slug: string | null;
  photo_url: string | null;
  bio: string | null;
  headline: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  gcid: string | null;
  address_city: string | null;
  address_state: string | null;
  search_rank_score: number | null;
  claimed: boolean | null;
  is_demo: boolean | null;
  primary_org_id: string | null;
};

export type SeatScore = {
  total_score: number | null;
  max_possible: number | null;
  score_pct: number | null;
  score_reviews: number | null;
  score_profile: number | null;
  score_listings: number | null;
  score_content: number | null;
  score_web_analytics: number | null;
  score_connections: number | null;
  gaps: unknown;
  next_milestone: number | null;
  next_milestone_gap: number | null;
  calculated_at: string | null;
};

export type SeatRating = {
  source: string | null;
  rating_value: number | null;
  review_count: number | null;
  last_review_date: string | null;
};

export type SeatReview = {
  id: string;
  rating: number | null;
  title: string | null;
  body: string | null;
  reviewer_name: string | null;
  reviewer_photo_url: string | null;
  review_date: string | null;
  source: string | null;
  reply_body: string | null;
  entity_id: string | null;
};

export type SeatNode = {
  id: string;
  ring: number | null;
  node_type: string | null;
  title: string | null;
  url: string | null;
  source: string | null;
  score_points: number | null;
  verified: boolean | null;
};

export type SeatListing = {
  id: string;
  directory_key: string | null;
  directory_name: string | null;
  directory_url: string | null;
  listing_url: string | null;
  status: string | null;
  has_drift: boolean | null;
  last_verified: string | null;
};

export const seatProName = (p: Pick<SeatPro, "display_name" | "first_name" | "last_name">) =>
  p.display_name?.trim() ||
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
  "Unnamed professional";

const PRO_COLS =
  "id,display_name,first_name,last_name,slug,photo_url,bio,headline,job_title,email,phone,gcid,address_city,address_state,search_rank_score,claimed,is_demo,primary_org_id";
const ORG_COLS =
  "id,name,slug,logo_url,phone,email,website_url,gcid,address_street,address_city,address_state,address_zip,gbp_place_id,gbp_connected,search_rank_score,claimed,is_demo,parent_org_id";

async function loadScore(entityType: string, entityId: string): Promise<SeatScore | null> {
  const { data } = await supabase
    .from("search_rank_scores")
    .select(
      "total_score,max_possible,score_pct,score_reviews,score_profile,score_listings,score_content,score_web_analytics,score_connections,gaps,next_milestone,next_milestone_gap,calculated_at",
    )
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SeatScore | null) ?? null;
}

async function loadRatings(entityType: string, entityIds: string[]): Promise<SeatRating[]> {
  if (entityIds.length === 0) return [];
  const { data } = await supabase
    .from("aggregate_ratings")
    .select("source,rating_value,review_count,last_review_date")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds);
  return ((data as SeatRating[]) ?? []).filter((r) => (r.review_count ?? 0) > 0 || r.rating_value != null);
}

async function loadReviews(entityType: string, entityIds: string[], limit = 20): Promise<SeatReview[]> {
  if (entityIds.length === 0) return [];
  const { data } = await supabase
    .from("reviews")
    .select(
      "id,rating,title,body,reviewer_name,reviewer_photo_url,review_date,source,reply_body,entity_id",
    )
    .eq("entity_type", entityType)
    .in("entity_id", entityIds)
    .order("review_date", { ascending: false })
    .limit(limit);
  return (data as SeatReview[]) ?? [];
}

async function loadListings(entityType: string, entityIds: string[]): Promise<SeatListing[]> {
  if (entityIds.length === 0) return [];
  const { data } = await supabase
    .from("listings")
    .select("id,directory_key,directory_name,directory_url,listing_url,status,has_drift,last_verified")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds)
    .order("directory_key")
    .limit(100);
  return (data as SeatListing[]) ?? [];
}

/* ─────────────────────────── LOCATION seat ─────────────────────────── */

export type LocationSeat = {
  office: SeatOffice;
  brand: { id: string; name: string; slug: string | null; logo_url: string | null } | null;
  pros: SeatPro[];
  score: SeatScore | null;
  ratings: SeatRating[];
  proRatings: SeatRating[];
  reviews: SeatReview[];
  isDemo: boolean;
};

export async function loadLocationSeat(officeId: string): Promise<LocationSeat | null> {
  const { data: office } = await supabase
    .from("organizations")
    .select(ORG_COLS)
    .eq("id", officeId)
    .maybeSingle();
  if (!office) return null;
  const o = office as SeatOffice;

  const [brandRes, prosRes, score, ratings] = await Promise.all([
    o.parent_org_id
      ? supabase.from("organizations").select("id,name,slug,logo_url").eq("id", o.parent_org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("professionals")
      .select(PRO_COLS)
      .eq("primary_org_id", officeId)
      .order("search_rank_score", { ascending: false, nullsFirst: false })
      .limit(200),
    loadScore("organization", officeId),
    loadRatings("organization", [officeId]),
  ]);

  const pros = ((prosRes.data as SeatPro[]) ?? []).map((p) => p);
  const proIds = pros.map((p) => p.id);
  const [proRatings, officeReviews, proReviews] = await Promise.all([
    loadRatings("professional", proIds.slice(0, 200)),
    loadReviews("organization", [officeId], 20),
    loadReviews("professional", proIds.slice(0, 200), 20),
  ]);

  const reviews = [...officeReviews, ...proReviews]
    .sort((a, b) => (b.review_date ?? "").localeCompare(a.review_date ?? ""))
    .slice(0, 20);

  return {
    office: o,
    brand: (brandRes.data as LocationSeat["brand"]) ?? null,
    pros,
    score,
    ratings,
    proRatings,
    reviews,
    isDemo: Boolean(o.is_demo) || pros.some((p) => p.is_demo),
  };
}

export async function loadLocationListings(officeId: string): Promise<SeatListing[]> {
  return loadListings("organization", [officeId]);
}

/** Coverage = the completeness signals we can measure on the roster. */
export function rosterCoverage(pros: SeatPro[]) {
  const n = pros.length;
  const count = (fn: (p: SeatPro) => boolean) => pros.filter(fn).length;
  return {
    total: n,
    claimed: count((p) => Boolean(p.claimed)),
    photo: count((p) => Boolean(p.photo_url)),
    bio: count((p) => Boolean(p.bio)),
    title: count((p) => Boolean(p.job_title || p.headline)),
    scored: count((p) => p.search_rank_score != null),
    contact: count((p) => Boolean(p.email || p.phone)),
  };
}

/* ───────────────────────── PROFESSIONAL seat ───────────────────────── */

export type LocationLite = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  address_city: string | null;
  address_state: string | null;
};

export type ProfessionalSeat = {
  pro: SeatPro;
  office: LocationLite | null;
  brand: LocationLite | null;
  score: SeatScore | null;
  ratings: SeatRating[];
  reviews: SeatReview[];
  nodes: SeatNode[];
  listings: SeatListing[];
  isDemo: boolean;
};

export async function loadProfessionalSeat(proId: string): Promise<ProfessionalSeat | null> {
  const { data: pro } = await supabase.from("professionals").select(PRO_COLS).eq("id", proId).maybeSingle();
  if (!pro) return null;
  const p = pro as SeatPro;

  const [officeRes, score, ratings, reviews, nodesRes, listings] = await Promise.all([
    p.primary_org_id
      ? supabase
          .from("organizations")
          .select("id,name,slug,logo_url,address_city,address_state,parent_org_id")
          .eq("id", p.primary_org_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadScore("professional", proId),
    loadRatings("professional", [proId]),
    loadReviews("professional", [proId], 25),
    supabase
      .from("graph_nodes")
      .select("id,ring,node_type,title,url,source,score_points,verified")
      .eq("entity_type", "professional")
      .eq("entity_id", proId)
      .eq("is_active", true)
      .order("ring")
      .limit(400),
    // Single-pro office: listings belong to the location (exp_office_mode, 0027); null mode
    // (0027 unapplied) keeps the professional's own rows.
    (async () => {
      const s = listingSubject(
        { entityType: "professional", entityId: proId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await loadOfficeMode(supabase as any, "professional", proId),
      );
      return loadListings(s.entityType, [s.entityId]);
    })(),
  ]);

  const office = (officeRes.data as (LocationLite & { parent_org_id?: string | null }) | null) ?? null;
  let brand: LocationLite | null = null;
  if (office?.parent_org_id) {
    const { data } = await supabase
      .from("organizations")
      .select("id,name,slug,logo_url,address_city,address_state")
      .eq("id", office.parent_org_id)
      .maybeSingle();
    brand = (data as LocationLite | null) ?? null;
  }

  return {
    pro: p,
    office: office ? { ...office } : null,
    brand,
    score,
    ratings,
    reviews,
    nodes: ((nodesRes.data as SeatNode[]) ?? []),
    listings,
    isDemo: Boolean(p.is_demo),
  };
}

/* ──────────────────── Nora "next moves" (see → say → act) ─────────────────── */

export type NextMove = {
  title: string;
  detail: string;
  points: number | null;
  ring: string;
};

const RING_LABELS: Record<number, string> = {
  1: "Identity",
  2: "Credentials",
  3: "Services",
  4: "Presence",
  5: "Reviews",
  6: "Content",
  7: "Place",
  8: "Hierarchy",
};

export const ringLabel = (ring: number | null | undefined) =>
  ring != null ? (RING_LABELS[ring] ?? `Ring ${ring}`) : "Unringed";

/** Display names for the v5 scorer's lane keys (exp_score_v5_explain). */
const LANE_LABELS: Record<string, string> = {
  reviews: "Reviews",
  completeness: "Completeness",
  website: "Website + Schema",
  articles: "Articles",
  gbp: "Google Business Profile",
  directories: "Directories",
  qa: "Q&A",
  connections: "Connections",
  videos: "Videos",
  audio: "Audio",
};

const GAP_STATUS: Record<string, string> = {
  missing: "Missing",
  stale: "Stale",
  invalid: "Needs a fix",
  unverified: "Not verified yet",
};

/**
 * Reads search_rank_scores.gaps into moves.
 *  - v5 (exp_score_v5_persist): {lane, label, status, marginal_pts, ...} — points = marginal_pts.
 *  - legacy v1/v2 (exp_compute_score / _v2): {lane, action, gap: number} — points = gap.
 *  - older shapes: plain strings, or {label|gap: string, points?, ring?}.
 * Points are only ever what the scorer wrote; null when it wrote none.
 */
export function scorerMoves(gapsRaw: unknown): NextMove[] {
  if (!Array.isArray(gapsRaw)) return [];
  return (gapsRaw as unknown[]).flatMap((g): NextMove[] => {
    if (typeof g === "string") return [{ title: g, detail: "Reported by the scorer.", points: null, ring: "Score" }];
    if (!g || typeof g !== "object") return [];
    const o = g as Record<string, unknown>;
    const title =
      typeof o.label === "string" ? o.label
      : typeof o.action === "string" ? o.action
      : typeof o.gap === "string" ? o.gap
      : null;
    if (!title) return [];
    const points =
      typeof o.marginal_pts === "number" ? o.marginal_pts
      : typeof o.points === "number" ? o.points
      : typeof o.gap === "number" ? o.gap
      : null;
    const lane = typeof o.lane === "string" ? (LANE_LABELS[o.lane] ?? o.lane) : null;
    const status = typeof o.status === "string" ? (GAP_STATUS[o.status] ?? o.status) : null;
    return [
      {
        title,
        detail:
          typeof o.detail === "string" ? o.detail
          : status && lane ? `${status} · ${lane} lane`
          : "Reported by the scorer.",
        points,
        ring: lane ?? (typeof o.ring === "string" ? o.ring : ringLabel(typeof o.ring === "number" ? o.ring : null)),
      },
    ];
  });
}

/**
 * Turns measured gaps into an ordered "next moves" list. Points come from
 * search_rank_scores.gaps when the scorer supplied them; otherwise null (we
 * never invent a point value).
 */
export function nextMoves(seat: ProfessionalSeat): NextMove[] {
  const moves: NextMove[] = [];
  const { pro, score, ratings, nodes, listings } = seat;

  moves.push(...scorerMoves(score?.gaps));

  if (!pro.photo_url)
    moves.push({ title: "Add a professional headshot", detail: "Identity ring is incomplete without a photo.", points: null, ring: "Identity" });
  if (!pro.bio)
    moves.push({ title: "Write your bio", detail: "A bio feeds both the Identity ring and your schema output.", points: null, ring: "Identity" });
  if (!pro.job_title && !pro.headline)
    moves.push({ title: "Set your title", detail: "Your role/title anchors the entity in category context.", points: null, ring: "Identity" });
  if (!pro.claimed)
    moves.push({ title: "Claim your profile", detail: "Unclaimed profiles cannot publish updates or reply to reviews.", points: null, ring: "Identity" });
  if (ratings.length === 0)
    moves.push({ title: "Connect a review source", detail: "No rating aggregate is on file for you yet.", points: null, ring: "Reviews" });
  if (listings.length === 0)
    moves.push({ title: "Start directory listings", detail: "No listing rows exist for you — Listings ring is empty.", points: null, ring: "Place" });

  const filledRings = new Set(nodes.map((n) => n.ring).filter((r): r is number => r != null));
  for (const ring of [2, 3, 4, 6]) {
    if (!filledRings.has(ring))
      moves.push({
        title: `Fill the ${ringLabel(ring)} ring`,
        detail: `No active graph nodes captured on ring ${ring}.`,
        points: null,
        ring: ringLabel(ring),
      });
  }

  return moves.slice(0, 8);
}

export function ringSummary(nodes: SeatNode[]) {
  const map = new Map<number, { ring: number; label: string; count: number; points: number }>();
  for (const n of nodes) {
    const ring = n.ring ?? 0;
    const cur = map.get(ring) ?? { ring, label: ringLabel(n.ring), count: 0, points: 0 };
    cur.count += 1;
    cur.points += n.score_points ?? 0;
    map.set(ring, cur);
  }
  return [...map.values()].sort((a, b) => a.ring - b.ring);
}
