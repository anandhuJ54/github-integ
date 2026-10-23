import { describe, expect, test } from "bun:test";
import { PUBLISHER_CATALOGS } from "../src/lib/listings/catalog.fallback";
import {
  buildCatalogs,
  normalizeStatus,
  type FieldMapDbRow,
  type PublisherDbRow,
} from "../src/lib/listings/catalog";
import { CHANNEL_META, emit, flatten } from "../tools/listings/emit_catalog_sql";

/** Simulate "0026 applied": the rows the migration inserts, read back the way the console reads them. */
function dbRoundTrip() {
  const pubs: PublisherDbRow[] = PUBLISHER_CATALOGS.map((p, i) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    subtitle: p.subtitle,
    publishes_to: p.publishesTo,
    ops_notes: p.opsNotes,
    display_sort: (i + 1) * 10,
    channel_role: CHANNEL_META[p.id].channel_role,
    role_status: "proposed",
  }));
  const rows: FieldMapDbRow[] = flatten().map((r) => ({
    publisher_id: r.publisher_id,
    section: r.section,
    section_note: r.section_note,
    their_field: r.their_field,
    our_target: r.our_target,
    rules: r.rules,
    applicability: r.applicability,
    status_default: r.status_default,
    variant_family: r.variant_family,
    sort: r.sort,
  }));
  return buildCatalogs(pubs, rows.reverse()); // order must come from `sort`, not insertion
}

describe("listings catalog → DB", () => {
  test("seed counts match the catalog (12 publishers; 105 mapped / 44 pipeline / 7 missing / 13 na)", () => {
    const rows = flatten();
    expect(PUBLISHER_CATALOGS.length).toBe(12);
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status_default] = (c[r.status_default] ?? 0) + 1;
    expect(c).toEqual({ mapped: 105, pipeline: 44, missing_ours: 7, na: 13 });
  });

  test("DB round trip renders exactly what the constants rendered", () => {
    const fromDb = dbRoundTrip()!;
    const expected = PUBLISHER_CATALOGS.map(({ defaultOpen: _d, ...p }) => p);
    expect(fromDb).toEqual(expected);
  });

  test("no DB rows → null (fallback)", () => {
    expect(buildCatalogs([], [])).toBeNull();
    // pre-0026 publishers: no display_sort
    expect(
      buildCatalogs(
        [
          {
            id: "google",
            name: "G",
            kind: "direct",
            subtitle: null,
            publishes_to: null,
            ops_notes: [],
            display_sort: null,
            channel_role: null,
            role_status: null,
          },
        ],
        [],
      ),
    ).toBeNull();
  });

  test("channel roles: proposed 4 direct + 4 distribution, Experience.com is not a publisher", () => {
    const by = (role: string) =>
      Object.entries(CHANNEL_META)
        .filter(([, m]) => m.channel_role === role)
        .map(([id]) => id)
        .sort();
    expect(by("direct")).toEqual(["apple", "bing", "google", "meta"]);
    expect(by("distribution")).toEqual(["data_axle", "foursquare", "here", "localeze"]);
    expect(Object.keys(CHANNEL_META)).not.toContain("experience");
    expect(Object.keys(CHANNEL_META).sort()).toEqual(PUBLISHER_CATALOGS.map((p) => p.id).sort());
  });

  test("legacy 'n/a' normalizes", () => {
    expect(normalizeStatus("n/a")).toBe("na");
    expect(normalizeStatus("pipeline")).toBe("pipeline");
  });

  test("emitted SQL is deterministic, additive, and idempotent-shaped", () => {
    const sql = emit();
    expect(emit()).toBe(sql);
    expect(sql).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE)\b/im);
    expect(sql.match(/^ALTER TABLE \S+ ADD COLUMN IF NOT EXISTS/gm)!.length).toBe(15);
    expect(sql).toContain("DO NOTHING;");
    expect(sql).toContain("WHERE catalog_version IS NULL;");
  });

  test("committed migration matches the generator", async () => {
    const committed = await Bun.file(
      new URL("../drizzle/migrations/0026_listings_catalog_db.sql", import.meta.url),
    ).text();
    expect(committed).toBe(emit());
  });
});
