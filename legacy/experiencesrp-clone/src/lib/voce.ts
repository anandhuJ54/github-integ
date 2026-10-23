import { supabase } from "@/integrations/supabase/client";

/* ────────────────────────────────────────────────────────────
   VOCE boost mapping — connects VOCE articles to the growth
   engine. Everything here is a live read of exp_voce_article;
   nothing is fabricated. An empty table renders as an empty
   list, never as placeholder content.
   ──────────────────────────────────────────────────────────── */

export const BOOST_PLACEMENTS = [
  "profile",
  "category_hub",
  "topic_hub",
  "search",
  "syndication",
] as const;
export type BoostPlacement = (typeof BOOST_PLACEMENTS)[number];

export const PLACEMENT_LABEL: Record<BoostPlacement, string> = {
  profile: "Profile",
  category_hub: "Category hub",
  topic_hub: "Topic hub",
  search: "Search",
  syndication: "Syndication",
};

export type VoceArticle = {
  id: string;
  title: string;
  slug: string | null;
  body_excerpt: string | null;
  author_entity_type: string | null;
  author_entity_id: string | null;
  author_name: string | null;
  gcid: string | null;
  topic: string | null;
  knows_about: string[];
  published_on: string | null;
  boosted: boolean;
  boost_placements: BoostPlacement[];
  boost_starts_on: string | null;
  boost_ends_on: string | null;
  boost_spend: number | null;
  is_demo: boolean;
};

const COLS =
  "id, title, slug, body_excerpt, author_entity_type, author_entity_id, author_name, gcid, topic, knows_about, published_on, boosted, boost_placements, boost_starts_on, boost_ends_on, boost_spend, is_demo";

const db = supabase as unknown as { from: (table: string) => any };

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

function toArticle(r: Record<string, unknown>): VoceArticle {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    slug: (r.slug as string | null) ?? null,
    body_excerpt: (r.body_excerpt as string | null) ?? null,
    author_entity_type: (r.author_entity_type as string | null) ?? null,
    author_entity_id: (r.author_entity_id as string | null) ?? null,
    author_name: (r.author_name as string | null) ?? null,
    gcid: (r.gcid as string | null) ?? null,
    topic: (r.topic as string | null) ?? null,
    knows_about: strList(r.knows_about),
    published_on: (r.published_on as string | null) ?? null,
    boosted: !!r.boosted,
    boost_placements: strList(r.boost_placements).filter((p): p is BoostPlacement =>
      (BOOST_PLACEMENTS as readonly string[]).includes(p),
    ),
    boost_starts_on: (r.boost_starts_on as string | null) ?? null,
    boost_ends_on: (r.boost_ends_on as string | null) ?? null,
    boost_spend: r.boost_spend === null || r.boost_spend === undefined ? null : Number(r.boost_spend),
    is_demo: !!r.is_demo,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Boosted AND inside its boost window (null bounds are open-ended). */
export function boostLive(a: VoceArticle, day = today()): boolean {
  if (!a.boosted) return false;
  if (a.boost_starts_on && a.boost_starts_on > day) return false;
  if (a.boost_ends_on && a.boost_ends_on < day) return false;
  return true;
}

/** Boost is live AND the article is bought into this placement. */
export function servesIn(a: VoceArticle, placement: BoostPlacement, day = today()): boolean {
  return boostLive(a, day) && a.boost_placements.includes(placement);
}

/** Featured articles first, then newest published. */
function byFeatured(a: VoceArticle, b: VoceArticle) {
  const fa = servesIn(a, "profile") ? 1 : 0;
  const fb = servesIn(b, "profile") ? 1 : 0;
  if (fa !== fb) return fb - fa;
  return (b.published_on ?? "").localeCompare(a.published_on ?? "");
}

/* ───────────── 1. Profile: this author's articles ───────────── */

/**
 * Articles authored by this entity. Matches author_entity_id first;
 * falls back to an exact author_name match (the demo rows carry a
 * name but no id yet).
 */
export async function loadAuthorArticles(
  entityId: string,
  authorName: string | null,
): Promise<VoceArticle[]> {
  const filters = [`author_entity_id.eq.${entityId}`];
  if (authorName && authorName.trim()) {
    filters.push(`author_name.eq.${authorName.replace(/[,()]/g, " ").trim()}`);
  }
  const { data, error } = await db
    .from("exp_voce_article")
    .select(COLS)
    .or(filters.join(","))
    .order("published_on", { ascending: false })
    .limit(24);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(toArticle).sort(byFeatured);
}

/* ───────────── 2. Category / topic hubs ───────────── */

export async function loadHubArticles(
  gcid: string,
  topic: string | null,
): Promise<VoceArticle[]> {
  let q = db
    .from("exp_voce_article")
    .select(COLS)
    .eq("gcid", gcid)
    .order("published_on", { ascending: false })
    .limit(60);
  if (topic) q = q.eq("topic", topic);
  const { data, error } = await q;
  if (error) return [];
  const all = ((data ?? []) as Record<string, unknown>[]).map(toArticle);
  const placement: BoostPlacement = topic ? "topic_hub" : "category_hub";
  const boosted = all.filter((a) => servesIn(a, placement));
  // Hubs lead with boosted placements, then carry the rest of the category's
  // published library so the page is a real landing surface, not a stub.
  const rest = all.filter((a) => !boosted.some((b) => b.id === a.id));
  return [...boosted, ...rest];
}

/** Distinct topics that exist for a category (for hub cross-links). */
export function topicsOf(list: VoceArticle[]): string[] {
  return [...new Set(list.map((a) => a.topic).filter((t): t is string => !!t))].sort();
}

/* ───────────── 3. Search placement ───────────── */

/**
 * The best boosted article for a SERP query. Requires the 'search'
 * placement and a real textual match on query/topic/knowsAbout, so a
 * boost never hijacks an unrelated search.
 */
export async function loadFeaturedArticle(
  q: string,
  gcid: string | null,
): Promise<VoceArticle | null> {
  const query = q.trim().toLowerCase();
  if (!query && !gcid) return null;
  let sel = db.from("exp_voce_article").select(COLS).eq("boosted", true).limit(60);
  if (gcid) sel = sel.eq("gcid", gcid);
  const { data, error } = await sel;
  if (error) return null;
  const live = ((data ?? []) as Record<string, unknown>[])
    .map(toArticle)
    .filter((a) => servesIn(a, "search"));
  if (live.length === 0) return null;
  if (!query) return live[0] ?? null;
  const terms = query.split(/\s+/).filter(Boolean);
  const scored = live
    .map((a) => {
      const hay = [a.title, a.topic, ...a.knows_about, a.body_excerpt]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/_/g, " ");
      const hits = terms.filter((t) => hay.includes(t) || hay.includes(t.replace(/e$/, ""))).length;
      return { a, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((x, y) => y.hits - x.hits);
  return scored[0]?.a ?? null;
}

/* ───────────── 4. Admin: boost manager ───────────── */

export async function loadAllArticles(): Promise<VoceArticle[]> {
  const { data, error } = await db
    .from("exp_voce_article")
    .select(COLS)
    .order("published_on", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toArticle);
}

export type BoostPatch = {
  boosted?: boolean;
  boost_placements?: BoostPlacement[];
  boost_starts_on?: string | null;
  boost_ends_on?: string | null;
  boost_spend?: number | null;
};

export async function updateBoost(id: string, patch: BoostPatch): Promise<void> {
  const { error } = await db.from("exp_voce_article").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export function boostTotals(list: VoceArticle[]) {
  const live = list.filter((a) => boostLive(a));
  const spend = live.reduce((sum, a) => sum + (a.boost_spend ?? 0), 0);
  const byPlacement = BOOST_PLACEMENTS.map((p) => ({
    placement: p,
    count: list.filter((a) => servesIn(a, p)).length,
  }));
  return { total: list.length, boosted: live.length, spend, byPlacement };
}

/** JSON-LD Article node for the profile @graph, authored by the profile. */
export function articleNode(a: VoceArticle, authorId: string, url: string | null) {
  const node: Record<string, unknown> = {
    "@type": "Article",
    headline: a.title,
    author: { "@id": authorId },
  };
  if (a.published_on) node.datePublished = a.published_on;
  if (a.body_excerpt) node.abstract = a.body_excerpt;
  if (url) node.url = url;
  const knows = a.knows_about.map((k) => k.replace(/_/g, " "));
  if (knows.length > 0) {
    node.about = knows;
    node.keywords = knows.join(", ");
  }
  if (a.topic) node.articleSection = a.topic.replace(/_/g, " ");
  return node;
}

export function hubPath(gcid: string, topic?: string | null) {
  return topic ? `/topic/${gcid}/${topic}` : `/topic/${gcid}`;
}

export function prettyTopic(topic: string | null | undefined) {
  if (!topic) return null;
  return topic.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
