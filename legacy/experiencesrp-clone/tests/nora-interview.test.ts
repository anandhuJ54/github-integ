import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compileCategoryBrief,
  type CategoryBriefRows,
  type RingRow,
} from "../src/lib/category-brief";
import { extractFacts, type CandidateFacts } from "../src/lib/nora/extract";
import { parseCandidateFacts } from "../src/lib/nora/organize/parse";
import { buildCandidates } from "../src/lib/nora/organize/web-sweep";
import {
  ORGANIZE_SKILLS,
  claimStepModel,
  confirmInputs,
  confirmedNodes,
  extractInputs,
  hopInputs,
  interviewEntityType,
  itemId,
  organizedPages,
  reviewModel,
  runView,
  sweepInputs,
  sweepModel,
  type InterviewSubject,
} from "../src/lib/nora/interview";
import type { SkillRun } from "../src/lib/nora-runner";
import insuranceRows from "./fixtures/category-brief.insurance_agency.json";
import mexicanRows from "./fixtures/category-brief.mexican_restaurant.json";
import agentPage from "./fixtures/candidate-facts.insurance_agent.json";
import restaurantPage from "./fixtures/candidate-facts.mexican_restaurant.json";
import rings from "./fixtures/exp_rings.json";

const rows = (r: unknown, gcid: string): CategoryBriefRows =>
  ({ ...(r as object), gcid, rings: rings as RingRow[] }) as CategoryBriefRows;
const insurance = compileCategoryBrief(rows(insuranceRows, "gcid:insurance_agency"));
const mexican = compileCategoryBrief(rows(mexicanRows, "gcid:mexican_restaurant"));
const html = (f: string) => readFileSync(`${import.meta.dir}/fixtures/organize/${f}`, "utf8");

/** An exp_skill_run row as runSkill returns it (only the fields the view model reads). */
const run = (
  skill: string,
  capabilities: Record<string, unknown>,
  extra: Partial<SkillRun> = {},
): SkillRun =>
  ({
    id: "run",
    skill_key: skill,
    mode: "dry_run",
    verdict: "not_implemented",
    error: null,
    outputs: {
      capabilities,
      governance: {
        live_blockers: ["publish_state: skill is draft — live runs require a published skill"],
      },
      unimplemented: ["dedupe_match"],
    },
    ...extra,
  }) as unknown as SkillRun;

const greg: InterviewSubject = {
  kind: "professional",
  id: "56d35654-1bcd-4ee6-97e3-3571ef61c8f1",
  name: "Greg Aldridge",
  gcid: "gcid:insurance_agency",
  websiteUrl: "https://www.gregaldridge.com",
  city: "Austin",
  state: "TX",
  phone: null,
  claimed: false,
};

describe("step 1 — claim adapter (main flow and PR #58 gate)", () => {
  test("main: approved claim_queue row + claimed record → claimed, tier unknown, can confirm", () => {
    const m = claimStepModel({
      recordClaimed: true,
      queue: {
        status: "approved",
        confidence_score: 85,
        confidence_signals: {
          name: { matched: true, weight: 35 },
          license: { matched: false, weight: 30 },
        },
      },
    });
    expect(m.state).toBe("claimed");
    expect(m.tier).toBeNull();
    expect(m.tierLabel).toBe("Verified claim");
    expect(m.canConfirm).toBe(true);
    expect(m.signals.map((s) => [s.key, s.matched])).toEqual([
      ["name", true],
      ["license", false],
    ]);
  });

  test("PR #58: trust_tier rides on claim_queue; T0 may preview but not confirm", () => {
    const t0 = claimStepModel({
      recordClaimed: false,
      queue: { status: "pending", trust_tier: 0 },
    });
    expect(t0.state).toBe("pending");
    expect(t0.tierLabel).toBe("T0 · authenticated");
    expect(t0.canPreview).toBe(true);
    expect(t0.canConfirm).toBe(false);
    const t2 = claimStepModel({
      recordClaimed: true,
      queue: { status: "approved", trust_tier: 2 },
    });
    expect(t2.tierLabel).toBe("T2 · ownership proven");
    expect(t2.canConfirm).toBe(true);
  });

  test("no claim at all → unclaimed, preview only", () => {
    const m = claimStepModel({ recordClaimed: false, queue: null });
    expect(m.state).toBe("unclaimed");
    expect(m.canConfirm).toBe(false);
  });
});

describe("entity type comes from the brief", () => {
  test("professional record → professional; office record → the brief's location type", () => {
    expect(interviewEntityType(insurance, "professional")).toBe("professional");
    expect(interviewEntityType(mexican, "office")).toBe("location");
    // the restaurant brief has no professional type → falls back to its primary type
    expect(interviewEntityType(mexican, "professional")).toBe(mexican.primaryEntityType);
  });
});

describe("State Farm agent Greg Aldridge (gcid:insurance_agency)", () => {
  const SF_URL = "https://www.statefarm.com/agent/us/tx/austin/greg-aldridge-abc123";
  const site = parseCandidateFacts(html("statefarm-agent.html"), {
    sourceUrl: SF_URL,
    fetchedAt: "2026-10-11T00:00:00.000Z",
  });

  test("sweep inputs carry the website on file, category display name and geo", () => {
    const i = sweepInputs(greg, insurance, "professional");
    expect(i).toMatchObject({
      url: "https://www.gregaldridge.com",
      entity_name: "Greg Aldridge",
      category_name: insurance.displayName,
      geo: "Austin, TX",
      gcid: "gcid:insurance_agency",
      entity_type: "professional",
    });
    const noSite = sweepInputs({ ...greg, websiteUrl: null }, insurance, "professional");
    expect("url" in noSite).toBe(false);
  });

  test("sweep model: dedupes results, pre-ticks the owner's own site, keeps stub honest", () => {
    const candidates = buildCandidates(
      [
        {
          query: '"Greg Aldridge" Austin, TX',
          rows: [
            {
              url: SF_URL,
              title: "Greg Aldridge - State Farm",
              desc: "Austin TX insurance",
              pos: 1,
            },
            { url: SF_URL + "/", title: "dup", desc: "", pos: 2 },
            {
              url: "https://www.linkedin.com/in/gregaldridge",
              title: "Greg Aldridge | LinkedIn",
              desc: "Austin",
              pos: 3,
            },
          ],
        },
      ],
      {
        categoryName: insurance.displayName,
        entityName: "Greg Aldridge",
        geo: "Austin, TX",
        siteUrl: SF_URL,
      },
    );
    const m = sweepModel(
      run(ORGANIZE_SKILLS.sweep, {
        serp_fetch: { status: "live", candidates },
        page_fetch: { url: SF_URL, ok: true, error: null, facts: site },
      }),
    );
    expect(m.status).toBe("live");
    expect(m.rows.map((r) => r.url)).toEqual([SF_URL, "https://www.linkedin.com/in/gregaldridge"]);
    expect(m.rows[0].likelyYou).toBe(true);
    expect(m.rows[1].likelyYou).toBe(false);
    expect(m.rows[1].platform).toContain("LinkedIn");
    expect(m.website.ok).toBe(true);

    const stub = sweepModel(
      run(ORGANIZE_SKILLS.sweep, {
        serp_fetch: { ok: false, status: "not_configured", reason: "Oxylabs is not configured" },
        page_fetch: { url: SF_URL, ok: true, error: null, facts: site },
      }),
    );
    expect(stub.status).toBe("not_configured");
    expect(stub.reason).toContain("Oxylabs");
    expect(stub.rows).toEqual([]);
  });

  test("hop inputs = owned candidates ∪ tapped sweep results, website page carried for extract", () => {
    const m = sweepModel(
      run(ORGANIZE_SKILLS.sweep, { page_fetch: { url: SF_URL, ok: true, facts: site } }),
    );
    const i = hopInputs(m, ["https://www.linkedin.com/in/gregaldridge", SF_URL], {
      gcid: "gcid:insurance_agency",
    });
    expect(i.owned_candidates).toContain("https://www.linkedin.com/in/gregaldridge");
    expect(i.owned_candidates).not.toContain(SF_URL);
    expect(i.pages).toEqual([site]);
    expect(i.gcid).toBe("gcid:insurance_agency");
  });

  test("organized pages: website then parsed hop pages, blocked/duplicate pages dropped", () => {
    const m = sweepModel(
      run(ORGANIZE_SKILLS.sweep, { page_fetch: { url: SF_URL, ok: true, facts: site } }),
    );
    const agent = agentPage as CandidateFacts;
    const hop = run(ORGANIZE_SKILLS.hop, {
      source_crawl: {
        pages: [
          { url: agent.source_url, ok: true, facts: agent },
          { url: SF_URL, ok: true, facts: site },
          {
            url: "https://blocked.example",
            ok: false,
            facts: { ...agent, source_url: "https://blocked.example", blocked: true },
          },
        ],
      },
    });
    const pages = organizedPages(m, hop);
    expect(pages.map((p) => p.source_url)).toEqual([SF_URL, agent.source_url]);
    expect(extractInputs(pages, { gcid: "g" })).toMatchObject({
      pages,
      owned_candidates: [],
      gcid: "g",
    });
  });

  test("review model: brief labels, few → chips, conflicts labelled by identity key", async () => {
    const ex = await extractFacts({
      brief: insurance,
      entityType: "professional",
      pages: [agentPage as CandidateFacts],
    });
    const m = reviewModel(insurance, ex);
    expect(m.entityType).toBe("professional");
    expect(m.entityNoun).toBe(insurance.labels.entityNoun);
    const creds = m.collections.find((c) => c.key === "credentials")!;
    expect(creds.label).toBe("Licenses"); // brief's credentialLabel for this category
    expect(creds.ui).toBe("chips");
    expect(creds.bulk).toBe(false);
    const profiles = m.collections.find((c) => c.key === "profiles")!;
    expect(profiles.label).toBe("Profiles & links");
    expect(profiles.items.length).toBe(3);
    // two phones → one conflict to pick; name variants too
    const phone = m.conflicts.find((c) => c.label === "Phone" || c.key.includes("phone"));
    expect(phone?.options.length).toBe(2);
    const name = m.conflicts.find((c) => c.label === "Name");
    expect(name).toBeDefined();
    // Offers had nothing on the page → reported missing under the brief's label
    expect(m.missing).toContain("Coverage & products");
    expect(m.defaultSelected.length).toBe(
      m.fields.length + m.collections.reduce((s, c) => s + c.items.length, 0),
    );
  });

  test("confirm: ticked items + conflict picks → owner_verified graph_upsert inputs; unpicked conflicts held", async () => {
    const ex = await extractFacts({
      brief: insurance,
      entityType: "professional",
      pages: [agentPage as CandidateFacts],
    });
    const m = reviewModel(insurance, ex);
    const linkedin = m.collections
      .find((c) => c.key === "profiles")!
      .items.find((i) => i.value.includes("linkedin"))!;
    const phone = ex.conflicts.find((c) => c.schema_property === "telephone")!;
    const nodes = confirmedNodes(
      insurance,
      ex,
      [linkedin.id],
      { [phone.key]: 1 },
      "2026-10-11T00:00:00.000Z",
    );
    expect(nodes.length).toBe(2);
    expect(nodes[0].value).toContain("linkedin");
    expect(nodes[1].value).toBe(phone.candidates[1].value);
    expect(nodes[1].schema_property).toBe("telephone");
    expect(nodes[1].cardinality_group.cardinality).toBe("one");
    expect(nodes[1].fetched_at).toBe("2026-10-11T00:00:00.000Z");
    const i = confirmInputs(nodes, ex);
    expect(i).toMatchObject({
      trust: "owner_verified",
      source: "user",
      gcid: "gcid:insurance_agency",
      entity_type: "professional",
    });
    // the unpicked name conflict is not written
    expect(nodes.some((n) => n.schema_property === "name")).toBe(false);
  });
});

describe("Mexican restaurant (gcid:mexican_restaurant)", () => {
  test("live page fixture parses into organize pages and the brief's location type", () => {
    const site = parseCandidateFacts(html("mexican-restaurant.html"), {
      sourceUrl: "https://www.lupetortilla.com/",
      resolvedUrl: "https://tex-mex.com/",
    });
    const m = sweepModel(
      run(ORGANIZE_SKILLS.sweep, {
        page_fetch: { url: "https://www.lupetortilla.com/", ok: true, facts: site },
      }),
    );
    expect(m.status).toBe("not_run");
    expect(m.website.ok).toBe(true);
    expect(organizedPages(m, null).length).toBe(1);
  });

  test("review model: Menu is a many-collection list with bulk accept; identity keys first", async () => {
    const ex = await extractFacts({
      brief: mexican,
      entityType: "location",
      pages: [restaurantPage as CandidateFacts],
    });
    const m = reviewModel(mexican, ex);
    expect(m.entityType).toBe("location");
    const menu = m.collections.find((c) => c.key === "offers")!;
    expect(menu.label).toBe("Menu");
    expect(menu.ui).toBe("list");
    expect(menu.bulk).toBe(true);
    expect(menu.items.map((i) => i.title)).toContain("Carne Asada Tacos");
    expect(menu.items.length).toBe(7);
    const features = m.collections.find((c) => c.key === "attributes")!;
    expect(features.ui).toBe("chips");
    // identity keys (Name, Address, Phone) come first, labelled from the brief
    const labels = m.fields.filter((f) => f.identityKey).map((f) => f.label);
    expect(labels).toEqual(["Name", "Address", "Phone"]);
    expect(m.fields.slice(0, 3).every((f) => f.identityKey)).toBe(true);
    expect(m.conflicts).toEqual([]);
  });

  test("bulk: select-all menu items flow to graph_upsert unchanged", async () => {
    const ex = await extractFacts({
      brief: mexican,
      entityType: "location",
      pages: [restaurantPage as CandidateFacts],
    });
    const m = reviewModel(mexican, ex);
    const nodes = confirmedNodes(mexican, ex, m.defaultSelected, {});
    expect(nodes.length).toBe(ex.nodes.length);
    expect(new Set(nodes.map(itemId)).size).toBe(nodes.length);
    expect(confirmInputs(nodes, ex).entity_type).toBe("location");
  });
});

describe("run view", () => {
  test("dry-run row with outputs but draft skill: produced, blockers surfaced", () => {
    const v = runView(run(ORGANIZE_SKILLS.sweep, { serp_fetch: {}, page_fetch: {} }), [
      "serp_fetch",
      "page_fetch",
    ]);
    expect(v.produced).toBe(true);
    expect(v.verdict).toBe("not_implemented");
    expect(v.blockers[0]).toContain("draft");
    expect(v.unimplemented).toEqual(["dedupe_match"]);
    expect(runView(run(ORGANIZE_SKILLS.sweep, {}), ["page_fetch"]).produced).toBe(false);
  });
});
