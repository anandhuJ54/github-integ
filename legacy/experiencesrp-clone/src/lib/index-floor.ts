/**
 * One floor for indexing. Pure helpers shared by the sitemap routes and tests;
 * the SQL in drizzle/migrations/0024_index_floor.sql (exp_index_sync,
 * exp_sitemap_rebuild) applies the same rules in the database.
 *
 * The floor is the category page template's completeness_floor, the same value
 * the profile page compares against when it emits robots noindex
 * (profile-render.ts completeness()). Score only orders and bands pages; it is
 * never a second floor.
 */

export type IndexLane = "professional" | "location" | "brand";

/** Built-in floors, identical to BUILTIN_TEMPLATE in profile-render.ts. */
export const BUILTIN_FLOOR: Record<IndexLane, number> = {
  professional: 60,
  location: 60,
  brand: 55,
};

/** Same comparison as completeness().indexable; unknown completeness never passes. */
export function passesFloor(completenessPct: number | null | undefined, floor: number): boolean {
  if (completenessPct === null || completenessPct === undefined) return false;
  return completenessPct >= floor;
}

export type QueueState = "held" | "pending" | "submitting" | "submitted" | "indexed" | string;

/**
 * Next exp_index_queue.state after a sync.
 * - below the floor or demo -> held (also for submitted / indexed: the page is noindex now)
 * - submitted / indexed stay put unless the canonical URL changed
 * - everything else (held, pending, stuck submitting) -> pending
 */
export function nextQueueState(input: {
  current: QueueState | null;
  completenessPct: number | null | undefined;
  floor: number;
  isDemo: boolean;
  urlChanged?: boolean;
}): QueueState {
  if (input.isDemo || !passesFloor(input.completenessPct, input.floor)) return "held";
  if ((input.current === "submitted" || input.current === "indexed") && !input.urlChanged) {
    return input.current;
  }
  return "pending";
}

/** Canonical public path per lane: /p professional, /o location, /c brand. */
export function canonicalProfilePath(entityType: string | null | undefined, slug: string): string {
  const prefix = entityType === "professional" ? "p" : entityType === "brand" ? "c" : "o";
  return `/${prefix}/${slug}`;
}

export type BandPartition = { partition_key: string; min_score: number | null };

/**
 * Score band ranges read from exp_sitemap_partition rows. Bands are ordered by
 * min_score; the top band is open above and the bottom band is open below, so
 * every page that passed the floor lands in exactly one indexable sitemap.
 */
export function bandRanges(
  partitions: BandPartition[],
  indexable: readonly string[],
): Map<string, { min: number | null; maxExclusive: number | null }> {
  const bands = partitions
    .filter((p) => indexable.includes(p.partition_key))
    .sort((a, b) => Number(b.min_score ?? 0) - Number(a.min_score ?? 0));
  const out = new Map<string, { min: number | null; maxExclusive: number | null }>();
  bands.forEach((p, i) => {
    const higher = i > 0 ? Number(bands[i - 1].min_score ?? 0) : null;
    const isLowest = i === bands.length - 1;
    out.set(p.partition_key, { min: isLowest ? null : Number(p.min_score ?? 0), maxExclusive: higher });
  });
  return out;
}

export function bandForScore(
  score: number | null | undefined,
  partitions: BandPartition[],
  indexable: readonly string[],
): string | null {
  const s = Number(score ?? 0);
  for (const [key, r] of bandRanges(partitions, indexable)) {
    if ((r.min === null || s >= r.min) && (r.maxExclusive === null || s < r.maxExclusive)) return key;
  }
  return null;
}

/**
 * URL prefixes served by the signed-in console (src/routes/_authenticated is a
 * pathless layout, so its pages live at these top-level paths). Kept in sync
 * with the folder by tests/index-floor.test.ts.
 */
export const CONSOLE_PATH_PREFIXES = [
  "accounts",
  "admin",
  "billing",
  "build",
  "categories",
  "claim",
  "claims",
  "compliance",
  "console",
  "control-graph",
  "dashboard",
  "dev",
  "discovery",
  "emp",
  "enterprise",
  "nora-os",
  "organizations",
  "products",
  "professionals",
  "reports",
  "sales",
  "search",
  "seat",
  "support",
  "website",
] as const;

/* ───────────── Site-wide indexing switch ───────────── */

/** exp_index_config key read by exp_index_enabled(); seeded 'false' by 0024. */
export const SITE_INDEXING_KEY = "site_indexing_enabled";

/** Same rule as exp_index_enabled(): only the literal 'true' turns indexing on. */
export function parseIndexingEnabled(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export const SITE_NOINDEX = "noindex,nofollow";

/**
 * Site-wide robots meta from the root shell. OFF -> noindex,nofollow (it sits
 * beside any per-page robots tag; crawlers apply the most restrictive). ON ->
 * nothing, so per-page rules (profile completeness floor, marketing pages) decide.
 */
export function siteRobotsMeta(enabled: boolean): { name: "robots"; content: string } | null {
  return enabled ? null : { name: "robots", content: SITE_NOINDEX };
}

/** X-Robots-Tag value for every response while indexing is OFF. */
export function siteRobotsHeader(enabled: boolean): string | null {
  return enabled ? null : "noindex, nofollow";
}

/**
 * robots.txt body. OFF (the default): disallow everything, no Sitemap line.
 * ON: sitemap index from the request origin; console and API kept out.
 */
export function robotsTxt(origin: string, enabled = false): string {
  if (!enabled) return ["User-agent: *", "Disallow: /", ""].join("\n");
  const consoleRules = CONSOLE_PATH_PREFIXES.flatMap((p) => [`Disallow: /${p}$`, `Disallow: /${p}/`]);
  return [
    "User-agent: *",
    "Allow: /api/public/sitemap.xml",
    "Allow: /api/public/sitemap/",
    "Disallow: /api/",
    ...consoleRules,
    "",
    `Sitemap: ${origin}/api/public/sitemap.xml`,
    "",
  ].join("\n");
}
