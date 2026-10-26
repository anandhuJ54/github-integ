import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  bandForScore,
  bandRanges,
  canonicalProfilePath,
  CONSOLE_PATH_PREFIXES,
  nextQueueState,
  parseIndexingEnabled,
  passesFloor,
  robotsTxt,
  siteRobotsHeader,
  siteRobotsMeta,
} from "../src/lib/index-floor";
import { sitemapIndexXml, urlSetXml } from "../src/lib/sitemap.server";

// Live exp_sitemap_partition rows (2026-10-11).
const PARTS = [
  { partition_key: "priority-high", min_score: 650 },
  { partition_key: "priority-mid", min_score: 450 },
  { partition_key: "priority-low", min_score: 1 },
  { partition_key: "held-below-floor", min_score: 0 },
];
const INDEXABLE = ["priority-high", "priority-mid", "priority-low"] as const;

describe("one floor", () => {
  test("same comparison as the page: pct >= floor; unknown never passes", () => {
    expect(passesFloor(65, 65)).toBe(true);
    expect(passesFloor(64, 65)).toBe(false);
    expect(passesFloor(null, 0)).toBe(false);
    expect(passesFloor(undefined, 60)).toBe(false);
  });

  test("state transitions", () => {
    const base = { floor: 65, isDemo: false };
    expect(nextQueueState({ ...base, current: "held", completenessPct: 75 })).toBe("pending");
    expect(nextQueueState({ ...base, current: "pending", completenessPct: 50 })).toBe("held");
    expect(nextQueueState({ ...base, current: "submitting", completenessPct: 75 })).toBe("pending");
    expect(nextQueueState({ ...base, current: "submitted", completenessPct: 75 })).toBe("submitted");
    expect(nextQueueState({ ...base, current: "indexed", completenessPct: 75 })).toBe("indexed");
    expect(nextQueueState({ ...base, current: "indexed", completenessPct: 75, urlChanged: true })).toBe("pending");
    expect(nextQueueState({ ...base, current: "indexed", completenessPct: 40 })).toBe("held");
    expect(nextQueueState({ ...base, isDemo: true, current: "pending", completenessPct: 100 })).toBe("held");
    expect(nextQueueState({ ...base, current: "held", completenessPct: null })).toBe("held");
  });

  test("canonical paths per lane", () => {
    expect(canonicalProfilePath("professional", "amber-ernst")).toBe("/p/amber-ernst");
    expect(canonicalProfilePath("location", "bettendorf-1872")).toBe("/o/bettendorf-1872");
    expect(canonicalProfilePath("brand", "new-american-funding")).toBe("/c/new-american-funding");
  });
});

describe("bands from exp_sitemap_partition", () => {
  test("ranges are contiguous; top open above, lowest open below", () => {
    const r = bandRanges(PARTS, INDEXABLE);
    expect(r.get("priority-high")).toEqual({ min: 650, maxExclusive: null });
    expect(r.get("priority-mid")).toEqual({ min: 450, maxExclusive: 650 });
    expect(r.get("priority-low")).toEqual({ min: null, maxExclusive: 450 });
    expect(r.has("held-below-floor")).toBe(false);
  });

  test("score is not a second floor", () => {
    expect(bandForScore(0, PARTS, INDEXABLE)).toBe("priority-low");
    expect(bandForScore(449, PARTS, INDEXABLE)).toBe("priority-low");
    expect(bandForScore(450, PARTS, INDEXABLE)).toBe("priority-mid");
    expect(bandForScore(649, PARTS, INDEXABLE)).toBe("priority-mid");
    expect(bandForScore(900, PARTS, INDEXABLE)).toBe("priority-high");
  });

  test("thresholds follow the table, not constants", () => {
    const moved = PARTS.map((p) => (p.partition_key === "priority-mid" ? { ...p, min_score: 300 } : p));
    expect(bandForScore(323, moved, INDEXABLE)).toBe("priority-mid");
    expect(bandForScore(323, PARTS, INDEXABLE)).toBe("priority-low");
  });
});

describe("robots.txt", () => {
  const body = robotsTxt("https://example.test", true);

  test("points at the sitemap index on the request origin", () => {
    expect(body).toContain("Sitemap: https://example.test/api/public/sitemap.xml");
  });

  test("keeps API out except sitemaps", () => {
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Allow: /api/public/sitemap.xml");
    expect(body).toContain("Allow: /api/public/sitemap/");
  });

  test("covers every console (_authenticated) top-level path", () => {
    const dir = join(import.meta.dir, "../src/routes/_authenticated");
    const segs = new Set(
      readdirSync(dir)
        .map((f) => f.split(".")[0].replace(/_$/, ""))
        .filter((s) => s && !s.startsWith("$") && s !== "route"),
    );
    for (const s of segs) expect(CONSOLE_PATH_PREFIXES as readonly string[]).toContain(s);
    for (const p of CONSOLE_PATH_PREFIXES) expect(body).toContain(`Disallow: /${p}/`);
  });

  test("public profile paths are not disallowed", () => {
    for (const p of ["/p/", "/o/", "/c/", "/search-ranking", "/website-marketing"]) {
      expect(body).not.toContain(`Disallow: ${p}`);
    }
  });
});

describe("site-wide indexing switch", () => {
  test("only the literal 'true' turns it on; missing / anything else is OFF", () => {
    expect(parseIndexingEnabled("true")).toBe(true);
    expect(parseIndexingEnabled(" TRUE ")).toBe(true);
    expect(parseIndexingEnabled(true)).toBe(true);
    for (const v of ["false", "", "1", "yes", null, undefined, false, 1]) {
      expect(parseIndexingEnabled(v)).toBe(false);
    }
  });

  test("robots.txt OFF (and by default): Disallow: / and no Sitemap line", () => {
    for (const body of [robotsTxt("https://example.test", false), robotsTxt("https://example.test")]) {
      expect(body).toBe("User-agent: *\nDisallow: /\n");
      expect(body).not.toContain("Sitemap:");
    }
  });

  test("robots.txt ON: sitemap line, no blanket disallow", () => {
    const body = robotsTxt("https://example.test", true);
    expect(body).toContain("Sitemap: https://example.test/api/public/sitemap.xml");
    expect(body.split("\n")).not.toContain("Disallow: /");
  });

  test("head: noindex,nofollow when OFF, nothing when ON", () => {
    expect(siteRobotsMeta(false)).toEqual({ name: "robots", content: "noindex,nofollow" });
    expect(siteRobotsMeta(true)).toBeNull();
    expect(siteRobotsHeader(false)).toBe("noindex, nofollow");
    expect(siteRobotsHeader(true)).toBeNull();
  });

  const part = {
    partition_key: "priority-high",
    min_score: 650,
    max_score: null,
    changefreq: "daily",
    priority: 0.9,
    url_count: 3,
    last_built_at: "2026-10-11T00:00:00Z",
  };
  const rows = [{ url: "/p/jane", lastmod: null, submitted_at: null, created_at: null }];

  test("sitemap index and urlset are empty when OFF (and by default)", () => {
    for (const xml of [sitemapIndexXml("https://x.test", [part], false), sitemapIndexXml("https://x.test", [part])]) {
      expect(xml).toContain("<sitemapindex");
      expect(xml).not.toContain("<sitemap>");
    }
    for (const xml of [urlSetXml("https://x.test", part, rows, false), urlSetXml("https://x.test", part, rows)]) {
      expect(xml).toContain("<urlset");
      expect(xml).not.toContain("<url>");
    }
  });

  test("sitemap lists pages when ON", () => {
    expect(sitemapIndexXml("https://x.test", [part], true)).toContain(
      "<loc>https://x.test/api/public/sitemap/priority-high.xml</loc>",
    );
    expect(urlSetXml("https://x.test", part, rows, true)).toContain("<loc>https://x.test/p/jane</loc>");
  });
});
