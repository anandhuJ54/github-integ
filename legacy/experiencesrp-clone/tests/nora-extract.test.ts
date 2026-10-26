import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compileCategoryBrief,
  entityBrief,
  type CategoryBriefRows,
  type RingRow,
} from "../src/lib/category-brief";
import {
  extractFacts,
  graphEntityType,
  validateLlmItems,
  type CandidateFacts,
  type LlmExtractFn,
} from "../src/lib/nora/extract";
import { buildPrompt, haikuExtractor, outputSchema } from "../src/lib/nora/extract/haiku.server";
import { hostTokens, matchVocabulary, normalizeValue } from "../src/lib/nora/extract/match";
import { toUpsertPayload } from "../src/lib/nora/graph-upsert";
import insuranceRows from "./fixtures/category-brief.insurance_agency.json";
import mexicanRows from "./fixtures/category-brief.mexican_restaurant.json";
import agentPage from "./fixtures/candidate-facts.insurance_agent.json";
import restaurantPage from "./fixtures/candidate-facts.mexican_restaurant.json";
import rings from "./fixtures/exp_rings.json";

// Brief fixtures are live rows captured from the DB (getCategoryBrief-equivalent SELECTs).
const rows = (r: unknown, gcid: string): CategoryBriefRows =>
  ({ ...(r as object), gcid, rings: rings as RingRow[] }) as CategoryBriefRows;
const insurance = compileCategoryBrief(rows(insuranceRows, "gcid:insurance_agency"));
const mexican = compileCategoryBrief(rows(mexicanRows, "gcid:mexican_restaurant"));
const agent = agentPage as CandidateFacts;
const restaurant = restaurantPage as CandidateFacts;

/** Stand-in for Haiku: answers from the page's product list, plus one invented item. */
const fakeHaiku: LlmExtractFn = async ({ page, collections }) => {
  const out: Record<string, ReturnType<typeof item>[]> = {};
  const item = (name: string, evidence: string, vocabulary_term: string | null = null) => ({
    name,
    detail: null,
    price: null,
    section: "Products offered",
    vocabulary_term,
    evidence,
  });
  for (const c of collections) out[c.key] = [];
  if (collections.some((c) => c.key === "offers")) {
    const lines = page.text
      .filter((b) => b.kind === "paragraph" && b.text.endsWith("Insurance"))
      .map((b) => b.text);
    out.offers = lines.map((l) => item(l, l, l === "Pet Insurance" ? "pet insurance" : null));
    out.offers.push(item("Umbrella Insurance", "Umbrella Insurance")); // not on the page
  }
  return out;
};

describe("State Farm agent (professional, gcid:insurance_agency)", () => {
  test("deterministic pass maps NAP, JSON-LD, sameAs and credentials onto the brief", async () => {
    const r = await extractFacts({ brief: insurance, entityType: "professional", pages: [agent] });
    expect(r.entity_type).toBe("professional");
    expect(r.stats.llm_calls).toBe(0);
    const bySlug = (s: string) => r.nodes.filter((n) => n.registry_node_slug === s);
    // sameAs → presence nodes matched by host (linkedin, x.com → twitter).
    expect(bySlug("url_linkedin")[0]?.cardinality_group.collection).toBe("profiles");
    expect(bySlug("url_twitter")[0]?.value).toBe("https://x.com/janedoesf");
    // credential + the brief's credential identity key (hasCredential.identifier).
    const cred = r.nodes.find((n) => n.node_type === "credential" && n.schema_property === "hasCredential");
    expect(cred?.cardinality_group.collection).toBe("credentials");
    expect(r.nodes.some((n) => n.schema_property === "hasCredential.identifier" && n.value === "1234567")).toBe(true);
    // every value cites its source
    for (const n of r.nodes) expect(n.evidence.length).toBeGreaterThan(0);
  });

  test("two phones for a single-valued node become a conflict, not two facts", async () => {
    const r = await extractFacts({ brief: insurance, entityType: "professional", pages: [agent] });
    const phone = r.conflicts.find((c) => c.schema_property === "telephone");
    expect(phone).toBeDefined();
    expect(phone!.candidates.map((c) => normalizeValue("telephone", c.value)).sort()).toEqual([
      "5125550142",
      "5125550199",
    ]);
    expect(r.nodes.some((n) => n.schema_property === "telephone")).toBe(false);
  });

  test("products land in ONE 'few' collection, matched to the brief vocabulary", async () => {
    const r = await extractFacts({
      brief: insurance,
      entityType: "professional",
      pages: [agent],
      llm: fakeHaiku,
    });
    expect(r.llm_requested).toContain("offers");
    expect(r.llm_requested).not.toContain("credentials"); // filled deterministically
    expect(r.stats.llm_calls).toBe(1);
    const products = r.nodes.filter((n) => n.method === "haiku");
    expect(products.length).toBe(7);
    expect(new Set(products.map((p) => p.cardinality_group.collection))).toEqual(new Set(["offers"]));
    expect(new Set(products.map((p) => p.cardinality_group.cardinality))).toEqual(new Set(["few"]));
    const term = (name: string) =>
      products.find((p) => p.value === name)?.cardinality_group.vocabulary_term ?? null;
    expect(term("Pet Insurance")).toBe("pet insurance");
    expect(term("Boat Insurance")).toBe("boat and marine insurance");
    expect(term("Motorcycle Insurance")).toBe("motorcycle and powersports insurance");
    expect(term("Flood Insurance")).toBe("flood insurance policies");
    expect(term("Auto Insurance")).toBeNull(); // not in this category's vocabulary — kept, unmatched
    expect(products.every((p) => p.node_type === "product_service")).toBe(true);
    // the invented item is rejected: its evidence is not on the page
    expect(r.rejected.map((x) => x.name)).toEqual(["Umbrella Insurance"]);
  });
});

test("a page organize judged blocked never goes to the model", async () => {
  let called = 0;
  const r = await extractFacts({
    brief: insurance,
    entityType: "professional",
    pages: [{ ...agent, blocked: true }],
    llm: async () => {
      called++;
      return {};
    },
  });
  expect(called).toBe(0);
  expect(r.stats.llm_calls).toBe(0);
});

describe("Mexican restaurant (location, gcid:mexican_restaurant)", () => {
  test("menu items land in ONE 'many' collection with price + section, no model call needed", async () => {
    const calls: string[][] = [];
    const spy: LlmExtractFn = async (a) => {
      calls.push(a.collections.map((c) => c.key));
      return {};
    };
    const r = await extractFacts({ brief: mexican, entityType: "location", pages: [restaurant], llm: spy });
    const menu = r.nodes.filter((n) => n.node_type === "menu_item");
    expect(menu.length).toBe(7);
    expect(new Set(menu.map((m) => m.cardinality_group.collection))).toEqual(new Set(["offers"]));
    expect(new Set(menu.map((m) => m.cardinality_group.cardinality))).toEqual(new Set(["many"]));
    expect(new Set(menu.map((m) => m.registry_node_slug)).size).toBe(1);
    const tacos = menu.find((m) => m.value === "Carne Asada Tacos")!;
    expect(tacos.extracted_data.price).toBe("$14.00");
    expect(tacos.extracted_data.section).toBe("Tacos");
    expect(tacos.method).toBe("deterministic");
    // the menu was filled deterministically, so Haiku is never asked for it
    expect(r.llm_requested).not.toContain("offers");
    for (const keys of calls) expect(keys).not.toContain("offers");
  });

  test("identity (NAP) agrees with JSON-LD → no conflicts; presence by host", async () => {
    const r = await extractFacts({ brief: mexican, entityType: "location", pages: [restaurant] });
    expect(r.conflicts).toEqual([]);
    const name = r.nodes.find((n) => n.schema_property === "name");
    expect(name?.value).toBe("La Casita Cocina Mexicana");
    expect(name?.cardinality_group.cardinality).toBe("one");
    expect(r.nodes.find((n) => n.value.includes("instagram.com"))?.registry_node_slug).toBe(
      "instagram_profile",
    );
    expect(r.nodes.find((n) => n.value.includes("yelp.com"))?.registry_node_slug).toBe("yelp_profile");
  });
});

describe("Haiku request + validation", () => {
  test("prompt + schema ask only for the requested collection keys with their cardinality", () => {
    const loc = entityBrief(mexican, "location")!;
    const menu = loc.collections.find((c) => c.key === "offers")!;
    const req = [
      { key: menu.key, label: menu.label, cardinality: menu.cardinality, expected: menu.expectedCount, vocabulary: menu.vocabulary },
    ];
    const schema = outputSchema(req);
    expect(Object.keys(schema.properties.collections.properties)).toEqual(["offers"]);
    const { user } = buildPrompt({ page: restaurant, categoryName: mexican.displayName, collections: req });
    expect(user).toContain('offers ("Menu"): cardinality many');
    expect(user).toContain("Taco Tuesday specials");
  });

  test("items without verbatim evidence, or whose name is not in it, are dropped; prices must be quoted", () => {
    const pro = entityBrief(insurance, "professional")!;
    const offers = pro.collections.find((c) => c.key === "offers")!;
    const { kept, rejected } = validateLlmItems(agent, offers, [
      { name: "Pet Insurance", evidence: "Pet Insurance", price: "$20/mo", detail: null, section: null, vocabulary_term: "not a term" },
      { name: "Renters Insurance", evidence: "Pet Insurance", price: null, detail: null, section: null, vocabulary_term: null },
      { name: "Earthquake Insurance", evidence: "Earthquake Insurance", price: null, detail: null, section: null, vocabulary_term: null },
    ]);
    expect(kept.map((k) => k.name)).toEqual(["Pet Insurance"]);
    expect(kept[0].price).toBeNull(); // not quoted on the page
    expect(kept[0].vocabulary_term).toBeNull(); // not a brief term
    expect(rejected.map((r) => r.reason)).toEqual([
      "name not inside its evidence",
      "evidence not found in page text",
    ]);
  });
});

test("haikuExtractor sends a raw Messages API request with the json_schema and parses it", async () => {
  let sent: { url: string; body: Record<string, any> } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)) };
    const answer = { collections: { offers: [{ name: "Pet Insurance", detail: null, price: null, section: null, vocabulary_term: "pet insurance", evidence: "Pet Insurance" }] } };
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answer) }] }));
  }) as unknown as typeof fetch;
  const llm = haikuExtractor({ apiKey: "test-key", fetchImpl: fakeFetch });
  const out = await llm({
    page: agent,
    categoryName: insurance.displayName,
    collections: [{ key: "offers", label: "Coverage & products", cardinality: "few", expected: { min: 1, max: 12 }, vocabulary: ["pet insurance"] }],
  });
  expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
  expect(sent!.body.model).toBe("claude-haiku-5-5");
  expect(sent!.body.output_config.format.type).toBe("json_schema");
  expect(Object.keys(sent!.body.output_config.format.schema.properties.collections.properties)).toEqual(["offers"]);
  expect(out.offers[0].name).toBe("Pet Insurance");
});

describe("helpers", () => {
  test("vocabulary matching is token containment, not substring luck", () => {
    const v = ["boat and marine insurance", "pet insurance", "travel insurance"];
    expect(matchVocabulary("Boat Insurance", v)).toBe("boat and marine insurance");
    expect(matchVocabulary("Insurance", v)).not.toBeNull(); // contained in all — best Jaccard wins
    expect(matchVocabulary("Auto Insurance", v)).toBeNull();
  });

  test("host tokens", () => {
    expect(hostTokens("https://www.facebook.com/x")).toEqual(["facebook"]);
    expect(hostTokens("https://x.com/abc")).toEqual(["twitter"]);
  });

  test("brief entity types map onto graph_nodes.entity_type", () => {
    expect(graphEntityType("professional")).toBe("professional");
    expect(graphEntityType("location")).toBe("organization");
    expect(graphEntityType("brand")).toBe("organization");
  });

  test("upsert payload carries provenance for every node", async () => {
    const r = await extractFacts({ brief: mexican, entityType: "location", pages: [restaurant] });
    const payload = toUpsertPayload(r.nodes, mexican.gcid);
    for (const p of payload) {
      expect(p.value).toBeTruthy();
      expect(p.node_type).toBeTruthy();
      expect(p.source_url).toBe(restaurant.source_url);
      expect(p.evidence).toBeTruthy();
      expect(p.gcid).toBe("gcid:mexican_restaurant");
    }
  });
});

describe("migration 0022 (static guards)", () => {
  const sql = readFileSync(new URL("../drizzle/migrations/0022_graph_upsert.sql", import.meta.url), "utf8");
  test("writer is SECURITY DEFINER, auth-checked, and not executable by anon/PUBLIC", () => {
    expect(sql).toMatch(/exp_graph_upsert_nodes[\s\S]*SECURITY DEFINER/);
    expect(sql).toContain("RAISE EXCEPTION 'Sign in required'");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.exp_graph_upsert_nodes\([^)]*\) FROM PUBLIC, anon;/);
  });
  test("additive + idempotent DDL only", () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS trust_tier");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS graph_nodes_upsert_key");
    expect(sql).toContain("DROP TRIGGER IF EXISTS trg_graph_nodes_owner_firewall");
  });
});
