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
import { api } from "@v3/ui/lib/server-fn";
import { loadOfficeMode } from "@v3/xmp/lib/office-mode";
import { listingSubject } from "@v3/xmp/lib/listings/subject";

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

/** loadRatings()'s filter: only sources with reviews or a rating. */
const withRatings = (rows: SeatRating[] | null | undefined) =>
  (rows ?? []).filter((r) => (r.review_count ?? 0) > 0 || r.rating_value != null);

async function loadListings(entityType: string, entityIds: string[]): Promise<SeatListing[]> {
  if (entityIds.length === 0) return [];
  // errors were ignored (no listings)
  return api
    .get<SeatListing[]>("/xmp/seat/listings", { params: { entity_type: entityType, entity_id: entityIds[0] } })
    .catch(() => []);
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
  // the office, its brand, roster (200), score, ratings and reviews (server side; null when the
  // office isn't readable)
  const data = await api.get<{
    office: SeatOffice;
    brand: LocationSeat["brand"];
    pros: SeatPro[] | null;
    score: SeatScore | null;
    ratings: SeatRating[];
    proRatings: SeatRating[];
    officeReviews: SeatReview[];
    proReviews: SeatReview[];
  } | null>(`/xmp/seat/location/${encodeURIComponent(officeId)}`);
  if (!data) return null;
  const o = data.office;
  const pros = (data.pros ?? []).map((p) => p);

  const reviews = [...(data.officeReviews ?? []), ...(data.proReviews ?? [])]
    .sort((a, b) => (b.review_date ?? "").localeCompare(a.review_date ?? ""))
    .slice(0, 20);

  return {
    office: o,
    brand: data.brand ?? null,
    pros,
    score: data.score ?? null,
    ratings: withRatings(data.ratings),
    proRatings: withRatings(data.proRatings),
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
  const [data, listings] = await Promise.all([
    // the professional, its office and brand, score, ratings, reviews (25) and active nodes (400)
    // (server side; null when the professional isn't readable)
    api.get<{
      pro: SeatPro;
      office: (LocationLite & { parent_org_id?: string | null }) | null;
      brand: LocationLite | null;
      score: SeatScore | null;
      ratings: SeatRating[];
      reviews: SeatReview[] | null;
      nodes: SeatNode[] | null;
    } | null>(`/xmp/seat/professional/${encodeURIComponent(proId)}`),
    // Single-pro office: listings belong to the location (exp_office_mode, 0027); null mode
    // (0027 unapplied) keeps the professional's own rows.
    (async () => {
      const s = listingSubject(
        { entityType: "professional", entityId: proId },
        await loadOfficeMode("professional", proId),
      );
      return loadListings(s.entityType, [s.entityId]);
    })(),
  ]);
  if (!data) return null;
  const p = data.pro;
  const office = data.office ?? null;

  return {
    pro: p,
    office: office ? { ...office } : null,
    brand: data.brand ?? null,
    score: data.score ?? null,
    ratings: withRatings(data.ratings),
    reviews: data.reviews ?? [],
    nodes: data.nodes ?? [],
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
