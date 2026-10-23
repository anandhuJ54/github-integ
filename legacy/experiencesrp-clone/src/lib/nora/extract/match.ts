import type { BriefNode, Collection, EntityBrief } from "@/lib/category-brief";

/*
 * Pure matching helpers shared by the deterministic pass and Haiku validation.
 * Nothing here knows a category: properties carry schema.org meaning, and node /
 * vocabulary matching is token overlap against the brief's own data.
 */

export const baseProp = (p: string | null | undefined) => (p ? p.split(".")[0] : "");

/**
 * graph_nodes.node_type by schema.org property — the generic node types the graph
 * already uses (ETL writes product_service / credential / social_profile …, and
 * exp_ring_crosswalk keys ring autofill on them). Unlisted properties fall back
 * to the property name in snake_case.
 */
const NODE_TYPE: Record<string, string> = {
  name: "identity_name",
  legalName: "identity_name",
  alternateName: "identity_alias",
  telephone: "contact_phone",
  faxNumber: "contact_fax",
  email: "contact_email",
  address: "address",
  geo: "geo",
  url: "website",
  sameAs: "social_profile",
  description: "bio",
  logo: "image_logo",
  image: "image_photo",
  photo: "image_photo",
  hasCredential: "credential",
  hasCertification: "credential",
  award: "award",
  makesOffer: "product_service",
  hasOfferCatalog: "product_service",
  availableService: "product_service",
  hasMenu: "menu_item",
  menu: "menu_item",
  hasMenuItem: "menu_item",
  hasMenuSection: "menu_item",
  review: "review",
  aggregateRating: "review_aggregate",
  areaServed: "service_area",
  openingHoursSpecification: "office_hours",
  employee: "team_member",
  knowsLanguage: "language",
  memberOf: "membership",
};

export function nodeTypeFor(schemaProperty: string): string {
  const bp = baseProp(schemaProperty);
  return (
    NODE_TYPE[bp] ??
    bp
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase()
  );
}

/**
 * Schema.org substitution chains: where an item found under one property may live
 * in a registry that models it under a sibling property (a menu item under
 * `menu`/`hasMenu`, a product under `hasOfferCatalog`, …). First tier with nodes wins.
 */
const MENU_CHAIN = ["hasMenuItem", "menu", "hasMenu", "hasMenuSection", "makesOffer", "hasOfferCatalog"];
const OFFER_CHAIN = ["makesOffer", "hasOfferCatalog", "availableService", "hasMenu", "menu"];
const PROPERTY_CHAIN: Record<string, string[]> = {
  hasMenuItem: MENU_CHAIN,
  hasMenuSection: MENU_CHAIN,
  hasMenu: ["hasMenu", "menu", ...MENU_CHAIN],
  menu: ["menu", "hasMenu", ...MENU_CHAIN],
  makesOffer: OFFER_CHAIN,
  hasOfferCatalog: ["hasOfferCatalog", ...OFFER_CHAIN],
  availableService: ["availableService", ...OFFER_CHAIN],
  hasCredential: ["hasCredential", "hasCertification", "award"],
  hasCertification: ["hasCertification", "hasCredential", "award"],
  award: ["award", "awards", "hasCredential"],
  legalName: ["legalName", "name"],
  photo: ["photo", "image"],
  image: ["image", "photo"],
};

export const chainFor = (prop: string) => [...new Set(PROPERTY_CHAIN[prop] ?? [prop])];

const STOP = new Set([
  "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "by", "at", "or",
  "url", "profile", "page", "node", "fallback", "listing", "service", "services", "offer",
  "www", "com", "net", "org", "co", "io", "https", "http", "html", "us",
]);
/** Short host labels → the name registries use for them. */
const HOST_ALIAS: Record<string, string> = { x: "twitter", fb: "facebook", g: "google" };

export function tokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .map((t) => HOST_ALIAS[t] ?? t)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Host labels of a URL ("https://www.facebook.com/x" → ["facebook"]). */
export function hostTokens(url: string): string[] {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").split(".");
    return tokens(h.slice(0, Math.max(1, h.length - 1)).join(" "));
  } catch {
    return [];
  }
}

/** Share of the node's own tokens present in the hint (≥ 0.5 counts as a match). */
function nodeMatch(node: BriefNode, hint: Set<string>): number {
  const nt = new Set([...tokens(node.nodeSlug), ...tokens(node.nodeName)]);
  if (!nt.size || !hint.size) return 0;
  let hit = 0;
  for (const t of nt) if (hint.has(t)) hit++;
  return hit / nt.size;
}

export type Resolved = { node: BriefNode | null; collection: Collection | null; tier: string };

const byValue = (a: BriefNode, b: BriefNode) =>
  Number(b.requiredForScore) - Number(a.requiredForScore) ||
  b.scorePoints - a.scorePoints ||
  a.priority - b.priority ||
  a.nodeSlug.localeCompare(b.nodeSlug);

/**
 * Registry node for a fact found under `prop`. Walks the property chain; within the
 * first tier that has nodes, picks the node whose own name the hint covers (≥ 50%).
 * When nothing matches: a single-valued tier takes its most valuable node; a list
 * tier with several nodes leaves the node unresolved (null) rather than guessing —
 * the collection still holds the item.
 */
export function resolveNode(
  eb: EntityBrief,
  prop: string,
  hint: string[] = [],
  within?: Collection | null,
): Resolved | null {
  const h = new Set(hint);
  const pool = within ? eb.nodes.filter((n) => within.nodeSlugs.includes(n.nodeSlug)) : eb.nodes;
  for (const tier of chainFor(prop)) {
    const exact = pool.filter((n) => n.schemaProperty === tier);
    const cands = exact.length ? exact : pool.filter((n) => baseProp(n.schemaProperty) === tier);
    if (!cands.length) continue;
    let best: BriefNode | null = null;
    let bestScore = 0;
    for (const n of [...cands].sort(byValue)) {
      const s = nodeMatch(n, h);
      if (s >= 0.5 && s > bestScore) [best, bestScore] = [n, s];
    }
    // Single-valued facts (name, phone, …) are one fact however many nodes model them:
    // take the most valuable node. List items with no name match stay unresolved.
    const node =
      best ??
      (cands.length === 1 || cands.every((n) => n.cardinality === "one")
        ? [...cands].sort(byValue)[0]
        : null);
    const collection =
      within ||
      (node && eb.collections.find((c) => c.nodeSlugs.includes(node.nodeSlug))) ||
      eb.collections.find((c) => cands.some((n) => c.nodeSlugs.includes(n.nodeSlug))) ||
      null;
    return { node, collection, tier };
  }
  return within ? { node: null, collection: within, tier: within.schemaProperty } : null;
}

const MENU_PROPS = new Set(["hasMenu", "menu", "hasMenuItem", "hasMenuSection"]);

/** Property a single collection item is filed under (schema.org meaning, not category). */
export function itemPropFor(c: Collection): string {
  return c.schemaProperties.some((p) => MENU_PROPS.has(baseProp(p))) ? "hasMenuItem" : c.schemaProperty;
}

/**
 * Vocabulary term an item name matches: one token set contains the other
 * ("Boat Insurance" ⊂ "boat and marine insurance"); best Jaccard wins.
 */
export function matchVocabulary(name: string, vocabulary: string[]): string | null {
  const it = new Set(tokens(name));
  if (!it.size) return null;
  let best: string | null = null;
  let bestJ = 0;
  for (const term of vocabulary) {
    const tt = new Set(tokens(term));
    if (!tt.size) continue;
    const inter = [...it].filter((t) => tt.has(t)).length;
    const contained = inter === it.size || inter === tt.size;
    if (!contained) continue;
    const j = inter / new Set([...it, ...tt]).size;
    if (j > bestJ) [best, bestJ] = [term, j];
  }
  return best;
}

/** Normalised comparison key: phones by last 10 digits, everything else alnum-lowercase. */
export function normalizeValue(schemaProperty: string, value: string): string {
  const bp = baseProp(schemaProperty);
  if (bp === "telephone" || bp === "faxNumber") {
    const d = value.replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : d;
  }
  if (bp === "url" || bp === "sameAs")
    return value.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
