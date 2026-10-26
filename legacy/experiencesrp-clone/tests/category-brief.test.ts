import { describe, expect, test } from "bun:test";
import {
  briefFailures,
  compileCategoryBrief,
  entityBrief,
  nextGaps,
  type CategoryBriefRows,
  type RingRow,
} from "../src/lib/category-brief";
import restaurantRows from "./fixtures/category-brief.restaurant.json";
import mortgageRows from "./fixtures/category-brief.mortgage_lender.json";
import rings from "./fixtures/exp_rings.json";

// Fixtures are live rows captured from the DB (see tests/fixtures/*.json).
const rows = (r: unknown, gcid: string): CategoryBriefRows =>
  ({ ...(r as object), gcid, rings: rings as RingRow[] }) as CategoryBriefRows;

const restaurant = compileCategoryBrief(rows(restaurantRows, "gcid:restaurant"));
const mortgage = compileCategoryBrief(rows(mortgageRows, "gcid:mortgage_lender"));

describe("restaurant brief", () => {
  test("is location-first", () => {
    expect(restaurant.shape).toBe("location_first");
    expect(restaurant.primaryEntityType).toBe("location");
    expect(restaurant.entityTypes.map((e) => e.type)).toEqual(["brand", "location"]);
  });

  test("has a many-cardinality menu collection", () => {
    const loc = entityBrief(restaurant)!;
    const menu = loc.collections.find((c) => c.key === "offers")!;
    expect(menu.label).toBe("Menu");
    expect(menu.cardinality).toBe("many");
    expect(menu.cardinalitySource).toBe("derived");
    expect(menu.schemaProperties.some((p) => p === "hasMenu" || p === "menu")).toBe(true);
    expect(menu.expectedCount.max).toBeGreaterThanOrEqual(100);
  });

  test("location form + claim keys are NAP", () => {
    const loc = entityBrief(restaurant, "location")!;
    expect(loc.identityKeys.map((k) => k.schemaProperty)).toEqual(["name", "address", "telephone"]);
    expect(loc.formFields.slice(0, 3).every((f) => f.source === "identity_key")).toBe(true);
    expect(loc.claim.claimable).toBe(true);
    expect(loc.claim.keys.length).toBe(3);
  });

  test("passes the structural gate", () => {
    expect(briefFailures(restaurant)).toEqual([]);
  });

  test("all nodes land on one of the 10 rings", () => {
    const keys = new Set(restaurant.rings.map((r) => r.key));
    expect(keys.size).toBe(10);
    for (const e of restaurant.entityTypes)
      for (const n of e.nodes) expect(keys.has(n.ring)).toBe(true);
  });
});

describe("mortgage lender brief", () => {
  test("is professional-capable", () => {
    const pro = entityBrief(mortgage, "professional")!;
    expect(pro).not.toBeNull();
    expect(pro.required).toBe(true);
    expect(pro.scopeFallback).toBe(false);
    expect(mortgage.primaryEntityType).toBe("professional");
  });

  test("has a few-cardinality products collection labelled Products", () => {
    const pro = entityBrief(mortgage, "professional")!;
    const products = pro.collections.find((c) => c.key === "offers")!;
    expect(products.label).toBe("Products");
    expect(products.cardinality).toBe("few");
    expect(products.vocabulary.length).toBeGreaterThan(0);
  });

  test("professional claim uses the regulator license id", () => {
    const pro = entityBrief(mortgage, "professional")!;
    const cred = pro.identityKeys.find((k) => k.key === "credential_id")!;
    expect(cred.label).toBe("NMLS #");
    expect(pro.claim.verifiableNodes.length).toBeGreaterThan(0);
  });

  test("carries compliance rules for interview copy", () => {
    expect(mortgage.compliance.prohibitedPhrases).toContain("guaranteed approval");
    expect(mortgage.compliance.flags.glba).toBe(true);
  });

  test("passes the structural gate", () => {
    expect(briefFailures(mortgage)).toEqual([]);
  });
});

describe("nextGaps", () => {
  test("ranks required_for_score first and drops filled nodes", () => {
    const gaps = nextGaps(mortgage, [], "professional");
    const firstOptional = gaps.findIndex((g) => !g.requiredForScore);
    expect(gaps.slice(0, firstOptional).every((g) => g.requiredForScore)).toBe(true);
    expect(gaps.slice(firstOptional).every((g) => !g.requiredForScore)).toBe(true);

    const filled = gaps.slice(0, 3).map((g) => g.nodeSlug);
    const after = nextGaps(mortgage, filled, "professional");
    expect(after.length).toBe(gaps.length - 3);
    expect(after.some((g) => filled.includes(g.nodeSlug))).toBe(false);
  });

  test("is scoped to the entity type", () => {
    const pro = nextGaps(mortgage, [], "professional");
    expect(pro.every((g) => g.entityScope === "professional" || g.entityScope === "shared")).toBe(
      true,
    );
    expect(nextGaps(mortgage, [], "nonexistent")).toEqual([]);
  });
});

describe("optional cardinality columns win over the fallback", () => {
  test("registry cardinality + expected counts are used when present", () => {
    const r = rows(mortgageRows, "gcid:mortgage_lender");
    const nodes = r.nodes!.map((n) =>
      n.schema_property === "hasOfferCatalog"
        ? { ...n, cardinality: "many" as const, expected_count_min: 5, expected_count_max: 40 }
        : n,
    );
    const b = compileCategoryBrief({ ...r, nodes });
    const offers = entityBrief(b, "professional")!.collections.find((c) => c.key === "offers")!;
    expect(offers.cardinality).toBe("many");
    expect(offers.cardinalitySource).toBe("registry");
    expect(offers.expectedCount).toEqual({ min: 5, max: 40 });
  });

  test("shape identity_keys win over derived keys", () => {
    const r = rows(restaurantRows, "gcid:restaurant");
    const b = compileCategoryBrief({
      ...r,
      shape: {
        ...r.shape!,
        identity_keys: { location: ["name", { key: "phone", schemaProperty: "telephone" }] },
      },
    });
    const keys = entityBrief(b, "location")!.identityKeys;
    expect(keys.map((k) => k.key)).toEqual(["name", "phone"]);
    expect(keys.every((k) => k.source === "shape")).toBe(true);
  });
});
