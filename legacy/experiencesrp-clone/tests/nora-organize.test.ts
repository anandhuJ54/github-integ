import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { parseCandidateFacts, registrableDomain, absoluteUrl } from "../src/lib/nora/organize/parse";
import { buildCandidates, dedupeKey, organicRows, sweepQueries } from "../src/lib/nora/organize/web-sweep";
import { toGbpCandidate, gbpLookup } from "../src/lib/nora/organize/gbp";
import { scrapeCost, sumCosts } from "../src/lib/nora/organize/costs";
import { organizeHandlers } from "../src/lib/nora/organize/handlers";
import { ownedUrls } from "../src/lib/nora/organize/fetch-site";
import { dispatchCapabilities, type GovCapability } from "../src/lib/nora-runner";

const fixture = (f: string) => readFileSync(`${import.meta.dir}/fixtures/organize/${f}`, "utf8");
const SF_URL = "https://www.statefarm.com/agent/us/ks/lenexa/greg-aldridge-1mky83ky000";

test("State Farm agent page → CandidateFacts", () => {
  const c = parseCandidateFacts(fixture("statefarm-agent.html"), {
    sourceUrl: SF_URL,
    fetchedAt: "2026-10-11T00:00:00.000Z",
  });
  expect(c.source_url).toBe(SF_URL);
  expect(c.fetched_at).toBe("2026-10-11T00:00:00.000Z");
  expect(c.blocked).toBe(false);
  // NAP from the InsuranceAgency JSON-LD (via the site contract's normalizeAddress / toE164).
  expect(c.nap.name).toContain("Greg Aldridge");
  expect(c.nap.phone).toBe("+19134926080");
  expect(c.nap.address).toMatchObject({
    streetAddress: "13501 W 87th St Pkwy",
    addressLocality: "Lenexa",
    addressRegion: "KS",
  });
  expect(c.nap.source).toEqual({ name: "jsonld", address: "jsonld", phone: "jsonld" });
  expect(c.jsonld.some((o) => JSON.stringify(o["@type"]).includes("InsuranceAgency"))).toBe(true);
  // Place id from the Maps / review links.
  expect(c.place_id).toBe("ChIJXXLAuKaUwIcR2Lc1I2HRjEg");
  // sameAs: platforms classified by SAMEAS_PLATFORM_RULES; scheme-less own site kept.
  const byUrl = Object.fromEntries(c.sameAs.map((s) => [s.url, s.platform]));
  expect(byUrl["https://www.facebook.com/247375755421060"]).toBe("Facebook");
  expect(byUrl["https://www.gregaldridgesf.com/"]).toBeNull();
  // Owned candidates: the agent's own site; NOT statefarm.com sibling subdomains (hosted profile).
  expect(c.links.ownedCandidates).toEqual([{ url: "https://www.gregaldridgesf.com/", reason: "jsonld_sameAs" }]);
  expect(c.links.internal.length).toBeGreaterThan(5);
  expect(c.links.internal.every((u) => new URL(u).host === "www.statefarm.com")).toBe(true);
  // Credentials: license numbers from visible text, parsed by toCredential.
  const lic = c.credentials.find((x) => x.text.includes("16956419"));
  expect(lic?.via).toBe("page_text");
  expect(lic?.parsed).toMatchObject({ type: "license", number: "16956419" });
  // Text blocks for the extractor.
  expect(c.text[0]).toEqual({ kind: "title", text: "Greg Aldridge - State Farm Insurance Agent in Lenexa, KS" });
  expect(c.text.some((t) => t.kind === "heading" && t.text === "Greg Aldridge")).toBe(true);
});

test("Mexican restaurant site (redirected) → CandidateFacts", () => {
  const c = parseCandidateFacts(fixture("mexican-restaurant.html"), {
    sourceUrl: "https://www.lupetortilla.com/",
    resolvedUrl: "https://tex-mex.com/",
  });
  expect(c.resolved_url).toBe("https://tex-mex.com/");
  expect(c.nap.name).toBe("Lupe Tortilla");
  expect(c.nap.source.name).toBe("jsonld");
  // Multi-location home page: no single NAP — left null, never guessed.
  expect(c.nap.phone).toBeNull();
  expect(c.nap.address).toBeNull();
  expect(c.jsonld.some((o) => JSON.stringify(o["@type"]).includes("Restaurant"))).toBe(true);
  const platforms = c.sameAs.map((s) => s.platform).sort();
  expect(platforms).toEqual(expect.arrayContaining(["Facebook", "Instagram", "X / Twitter", "Yelp"]));
  expect(c.sameAs.every((s) => s.via === "page_link")).toBe(true);
  // Both the source and the redirect target are the entity's own hosts.
  expect(c.links.internal.length).toBeGreaterThan(5);
  const owned = Object.fromEntries(c.links.ownedCandidates.map((o) => [o.url, o.reason]));
  expect(owned["https://order.lupetortilla.com/"]).toBe("brand_domain_match");
  expect(owned["https://lupetortilla.myguestaccount.com/en-us/guest/card-sales"]).toBe("name_domain_match");
  expect(c.credentials).toEqual([]);
  expect(c.text.length).toBeGreaterThan(5);
});

test("url helpers", () => {
  expect(registrableDomain("order.lupetortilla.com")).toBe("lupetortilla.com");
  expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
  expect(absoluteUrl("www.gregaldridgesf.com", SF_URL)).toBe("https://www.gregaldridgesf.com/");
  expect(absoluteUrl("tel:9134926080", SF_URL)).toBeNull();
  expect(absoluteUrl("/agent?utm_source=x#top", SF_URL)).toBe("https://www.statefarm.com/agent");
  expect(ownedUrls(["https://a.com", { url: "https://b.com", reason: "jsonld_sameAs" }, "nope"])).toEqual([
    "https://a.com",
    "https://b.com",
  ]);
});

test("web sweep: queries + dedupe hints", () => {
  const q = sweepQueries({ categoryName: "Mexican restaurant", entityName: "Lupe Tortilla", geo: "Houston, TX" });
  expect(q).toEqual(['"Lupe Tortilla" Houston, TX', "Lupe Tortilla Mexican restaurant Houston, TX"]);
  const body = {
    results: [
      {
        content: {
          results: {
            organic: [
              { pos: 1, url: "https://tex-mex.com/", title: "Lupe Tortilla", desc: "Tex Mex in Houston" },
              { pos: 2, url: "https://www.yelp.com/biz/lupe-tortilla-houston", title: "Lupe Tortilla - Houston - Yelp", desc: "Call (713) 555-0100" },
            ],
          },
        },
      },
    ],
  };
  const rows = organicRows(body);
  const c = buildCandidates(
    [
      { query: q[0], rows },
      { query: q[1], rows: [{ pos: 1, url: "https://www.yelp.com/biz/lupe-tortilla-houston/", title: "dup" }] },
    ],
    {
      categoryName: "Mexican restaurant",
      entityName: "Lupe Tortilla",
      geo: "Houston, TX",
      siteUrl: "https://tex-mex.com/",
      phone: "713-555-0100",
      knownUrls: ["https://tex-mex.com"],
    },
  );
  expect(c).toHaveLength(3);
  expect(c[0].hints).toMatchObject({ same_site: true, already_known: true, name_match: 1, geo_match: true, duplicate_of: null });
  expect(c[1].hints).toMatchObject({ platform: "Yelp", phone_match: true, same_site: false });
  expect(c[2].hints.duplicate_of).toBe(1);
  expect(dedupeKey("https://WWW.Yelp.com/biz/x/")).toBe("yelp.com/biz/x");
});

test("gbp candidate hints (pure)", () => {
  const g = toGbpCandidate(
    { id: "ChIJX", displayName: { text: "Greg Aldridge - State Farm" }, internationalPhoneNumber: "+1 913-492-6080" },
    { name: "Greg Aldridge", phone: "(913) 492-6080", placeId: "ChIJX" },
  );
  expect(g.hints).toEqual({ name_match: 1, phone_match: true, place_id_match: true });
  expect(g.phone).toBe("+19134926080");
});

test("stubs return NotConfigured, never data", async () => {
  const r = await gbpLookup({ name: "Greg Aldridge" });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.status).toBe("not_configured");
    expect(r.integration).toBe("google_places");
    expect(r.missing).toEqual(["GOOGLE_PLACES_API_KEY"]);
  }
});

test("costs: Oxylabs fetch, render fallback, direct", () => {
  const prev = process.env["FORCE_PROXY"];
  delete process.env["FORCE_PROXY"];
  expect(scrapeCost({ crawl_method: "direct", rendered: false, attempted_render_fallback: false, oxylabs: {}, ok: true })).toMatchObject({ provider: "oxylabs", requests: 1 });
  expect(scrapeCost({ crawl_method: "direct", rendered: true, attempted_render_fallback: true, oxylabs: {}, ok: true })).toMatchObject({ provider: "oxylabs", requests: 2 });
  process.env["FORCE_PROXY"] = "false";
  expect(scrapeCost({ crawl_method: "direct", rendered: false, attempted_render_fallback: false, ok: true })).toEqual({ provider: "direct", requests: 1, est_cost_usd: 0 });
  if (prev === undefined) delete process.env["FORCE_PROXY"];
  else process.env["FORCE_PROXY"] = prev;
  const s = sumCosts([
    { provider: "oxylabs", requests: 1, est_cost_usd: 0.0015 },
    { provider: "oxylabs", requests: 2, est_cost_usd: 0.0045 },
  ]);
  expect(s.lines).toEqual([{ provider: "oxylabs", requests: 3, est_cost_usd: 0.006 }]);
  expect(s.total_est_cost_usd).toBe(0.006);
});

test("handlers: registered keys, read-only, run in a dry run via the runner rule", async () => {
  const h = organizeHandlers(null as never);
  expect(Object.keys(h).sort()).toEqual(["geocode", "page_fetch", "serp_fetch", "source_crawl"]);
  expect(Object.values(h).every((x) => x.readOnly)).toBe(true);
  const caps: GovCapability[] = [
    { key: "geocode", status: "draft", entitlement_required: null, side_effects: [], dry_run: true },
  ];
  const d = await dispatchCapabilities({
    mode: "dry_run",
    capabilityKeys: ["geocode"],
    capabilities: caps,
    handlers: h,
    entity: { ref: "x", type: null, name: "Greg Aldridge" },
    inputs: {},
    trace: () => {},
  });
  expect(d.error).toBeNull();
  expect(d.steps[0].ran).toBe(true);
  expect(d.outputs["geocode"]).toMatchObject({ ok: false, status: "not_configured", telemetry: { mode: "dry_run", total_est_cost_usd: 0 } });
  // A registry side effect would stop it in a dry run (runner rule, unchanged).
  const d2 = await dispatchCapabilities({
    mode: "dry_run",
    capabilityKeys: ["geocode"],
    capabilities: [{ ...caps[0], side_effects: ["writes_graph"] }],
    handlers: h,
    entity: null,
    inputs: {},
    trace: () => {},
  });
  expect(d2.steps[0].ran).toBe(false);
});

test("serp_fetch without Oxylabs creds → NotConfigured", async () => {
  const saved = [process.env["OXYLABS_USERNAME"], process.env["OXYLABS_PASSWORD"]];
  delete process.env["OXYLABS_USERNAME"];
  delete process.env["OXYLABS_PASSWORD"];
  try {
    const h = organizeHandlers(null as never);
    const r = await h.serp_fetch.run({
      mode: "dry_run",
      entity: { ref: "x", type: null, name: "Lupe Tortilla" },
      inputs: { category_name: "Mexican restaurant", geo: "Houston, TX" },
      prior: {},
    });
    expect(r.outputs).toMatchObject({ ok: false, status: "not_configured", integration: "oxylabs" });
  } finally {
    if (saved[0] !== undefined) process.env["OXYLABS_USERNAME"] = saved[0];
    if (saved[1] !== undefined) process.env["OXYLABS_PASSWORD"] = saved[1];
  }
});
