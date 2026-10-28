// The Profile screen reads the Profile model (srp/profile-page-schema, task 9): a real seat's page shows its stored facts and none of the prototype's, and with no
// real seat the page is the prototype's. SSR render tests (no DOM, first render only: effects, clicks and the edit sheets are not run here).
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HfProfileModelProvider } from "../profile-context";
import { ProfileForSeat, profileNoticeFor } from "../profile-page";
import { ProfileScreen, makeThinks } from "./profile";
import { MOCK_NOTICE } from "@v3/srp/utils/home-model";
import { profileModel, type ProfileApi } from "@v3/srp/utils/profile-model";
import { api, withFacts } from "@v3/srp/utils/profile-fixture";
import { sampleProfileModel } from "../sample-profile";
import { mergePersona } from "../persona";

async function render(Screen: ComponentType): Promise<string> {
  const root = createRootRoute();
  const seat = createRoute({ getParentRoute: () => root, path: "/seat/$kind/$id", component: Screen });
  const router = createRouter({ routeTree: root.addChildren([seat]), history: createMemoryHistory({ initialEntries: ["/seat/professional/p1"] }) });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const miss = { value: null, present: false, source: null, trust_tier: null, confirmed_at: null, source_line: null };
const model = (patches: Record<string, object> = {}, over: Partial<ProfileApi> = {}) => profileModel(withFacts(patches, over), "34")!;
const page = (m: ReturnType<typeof model> | null) => render(() => createElement(HfProfileModelProvider, { model: m }, createElement(ProfileScreen)));
/** The colour of the dot beside a source line in the markup. */
const dot = (html: string, line: string) => new RegExp(`background:(#[0-9a-f]{6})"></span>${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(html.replace(/<!-- -->/g, ""))?.[1];
const SAMPLE_ONLY = ["Alex", "Demo Mortgage", "Davenport", "482913", "(563) 555-0100", "4.9", "(128)", "67 facts", "9 loan products", "I found 2 certifications", "Quad Cities"];

describe("a real Profile seat", () => {
  let html = "";
  let t = "";
  test("renders", async () => {
    html = await page(model());
    t = text(html);
    expect(t.length).toBeGreaterThan(500);
  });
  test("the preview: name, title and company, rating, market, NMLS and strength", () => {
    expect(t).toContain("Harper Jones");
    expect(t).toContain("Branch Manager · Example Home Loans");
    expect(t).toContain("4.1 (71) · Bettendorf · NMLS 771204");
    expect(t).toContain("58%");
    expect(t).toContain("Reviews (71)");
    expect(t).toContain("★ 4.1 rating");
  });
  test("every card shows the stored facts", () => {
    for (const s of ["Branch Manager", "2008", "(309) 555-7320", "(563) 555-0727", "mock.users.7@example.test", "412 Main St, Bettendorf, IA 52722", "Mon–Sat 9:00–4:00", "771204", "Iowa",
      "Bettendorf, Moline", "Top Producer 2025", "Helps Bettendorf-area families"]) expect(t).toContain(s);
  });
  test("every present fact shows its source line from the row", () => {
    for (const s of ["Confirmed by you · Sep 3", "From LinkedIn", "Approved by you · Sep 10", "From Google", "Confirmed by you · Oct 5", "Added by you · Aug 20", "From NMLS"]) expect(t).toContain(s);
  });
  test("a missing fact says so and nothing else is invented", () => {
    expect(t).toContain("Not found anywhere yet");
    expect(t.match(/Not found anywhere yet/g)!.length).toBe(2);        // designations and education
    expect(t).toContain("1 of 3 added");
  });
  test("the trust colour follows the tier", () => {
    expect(dot(html, "Confirmed by you · Sep 3")).toBe("#137333");
    expect(dot(html, "From NMLS")).toBe("#137333");
    expect(dot(html, "From Google")).toBe("#80868b");
    expect(dot(html, "Added by you · Aug 20")).toBe("#80868b");
  });
  test("the products, the graph and the notes", () => {
    for (const s of ["Conventional", "FHA", "VA", "USDA", "Jumbo", "5 loan products", "36 facts from 6 sources"]) expect(t).toContain(s);
    for (const n of ["Identity 7", "Contact 4", "Licence 3", "Products 5", "Reviews 9", "Presence 8"]) expect(t).toContain(n);
  });
  test("the photo, and no offer is invented", () => {
    expect(html).toContain('src="https://example.test/harper.jpg"');
    expect(t).not.toContain("I found 2 certifications");
    expect(t).not.toContain("Add them");
  });
  test("none of the prototype's figures are on the page", () => {
    for (const s of SAMPLE_ONLY) expect(t).not.toContain(s);
    expect(html).not.toContain("sample-pro");
  });
});

describe("a real seat in other shapes", () => {
  test("a thin bio offers NORA's draft, a full one shows the stored bio", async () => {
    const thin = text(await page(model({ bio: { value: "Short bio.", present: true, source: "Approved by you", trust_tier: "owner_verified", source_line: "Approved by you" } })));
    expect(thin).toContain("NORA draft ready");
    expect(thin).toContain("Review draft");
    const full = text(await page(model()));
    expect(full).not.toContain("NORA draft ready");
    expect(full).toContain("Approved by you · Sep 10");
  });
  test("a missing bio is Missing and offers the draft", async () => {
    const t = text(await page(model({ bio: miss })));
    expect(t).toContain("Bio Missing Not found anywhere yet Review draft");
  });
  test("no photo shows initials and no image", async () => {
    const html = await page(model({ photo: miss }));
    expect(html).not.toContain("<img");
    expect(text(html)).toContain("HJ");
  });
  test("unknown rating, reviews, market, NMLS and strength are left out, not zero", async () => {
    const t = text(await page(model({}, { preview: { title: "Branch Manager", company: null, city: null, rating: null, reviews: null, nmls: null, strength_pct: null, photo_url: null } })));
    expect(t).not.toContain("★ 0");
    expect(t).toContain("Branch Manager Reviews About");   // no company, no rating line, no chips for the missing figures
    expect(t).not.toContain("· NMLS");
    expect(t).not.toContain("0%");
    expect(t).not.toContain("rating");
    expect(t).toContain("— complete");
  });
  test("no products means Missing, not a count", async () => {
    const t = text(await page(model({ products: miss })));
    expect(t).not.toContain("0 loan products");
  });
  test("more than five products show the first five and how many more", async () => {
    const products = ["Conventional", "FHA", "VA", "USDA", "Jumbo", "HELOC", "Cash-out"];
    const t = text(await page(model({ products: { value: products, present: true, source: "From Google", trust_tier: "imported", source_line: "From Google" } })));
    expect(t).toContain("7 loan products");
    expect(t).toContain("+2");
    expect(t).not.toContain("+4");
  });
  test("a bar never overflows its track", async () => {
    const html = await page(model({}, { graph: { groups: [{ key: "reviews", facts: 30 }, { key: "identity", facts: 15 }], facts_total: 45, sources: 2 } }));
    expect(html).toContain("width:100%");
    expect(html).toContain("width:50%");
    expect(text(html)).toContain("45 facts from 2 sources");
  });
  test("a mock seat says so, a live one does not", () => {
    expect(profileNoticeFor(model())).toBe(MOCK_NOTICE);
    expect(profileNoticeFor(profileModel(api({ data: "live" }), "1"))).toBe("These values come from your account.");
    expect(profileNoticeFor(null)).toBeUndefined();
  });
  test("the screen is remounted when the seat changes, so one seat's edits never carry over to another", () => {
    const page = readFileSync(join(import.meta.dir, "..", "profile-page.tsx"), "utf8");
    expect(/<ProfileScreen\s+key=\{model\?\.storeKey \?\? "sample"\}/.test(page)).toBe(true);
  });
  test("the browser edit store is keyed by seat in the screen's source", () => {
    const src = readFileSync(join(import.meta.dir, "profile.tsx"), "utf8");
    expect(/loadStored\([^)]*model\.storeKey\)/.test(src)).toBe(true);
    expect(/saveStored\([^)]*model\.storeKey\)/.test(src)).toBe(true);
  });
});

describe("figures and rows that come from the model", () => {
  test("the photo row shows the photo's own source line", async () => {
    const t = text(await page(model({ photo: { value: "https://example.test/h.jpg", present: true, source: "From Google", trust_tier: "imported", source_line: "From Google" } })));
    expect(t).toContain("Photo Profile photo From Google");
  });
  test("the ring is filled to the profile strength", async () => {
    const html = await page(model());
    expect(html).toContain("stroke-dasharray:58 100");
    expect(await page(model({}, { preview: { ...api().preview!, strength_pct: null } }))).toContain("stroke-dasharray:0 100");
  });
  test("five products show no more-chip", async () => {
    expect(text(await page(model()))).not.toContain("+0");
  });
  test("NORA's notes follow the facts: the bio only when thin, the missing ones named without invented points", () => {
    const apply = (() => []) as never;
    const titles = (m: ReturnType<typeof model>) => makeThinks(apply, m).map((t) => t.t);
    expect(titles(model())).toEqual([]);                                                                 // a full bio, the year and the service areas all there
    expect(titles(model({ bio: miss, year_started: miss, service_areas: miss }))).toEqual(["Your bio is thin.", "Two things are missing."]);
    expect(titles(model({ year_started: miss }))).toEqual(["One thing is missing."]);
    expect(makeThinks(apply, model({ year_started: miss }))[0].d).toBe("Year started counts toward Completeness.");
    expect(titles(model({ service_areas: miss, year_started: miss }))[0]).toBe("Two things are missing.");
    const real = makeThinks(apply, model({ year_started: miss, service_areas: miss }));
    expect(real.at(-1)!.d).toBe("Year started and service areas count toward Completeness.");
    expect(real.map((t) => t.d).join(" ")).not.toContain("55 points");
    const sample = makeThinks(apply, sampleProfileModel(mergePersona({})));
    expect(sample.map((t) => t.t)).toEqual(["Your bio is thin.", "Two things are missing."]);
    expect(sample[1].d).toBe("Year started and service areas both count toward Completeness — 55 points are open there.");
  });
});

describe("with no real seat the page is the prototype's", () => {
  test("every sample figure is there", async () => {
    const t = text(await page(null));
    for (const s of ["Alex Sample", "Senior Loan Officer · Demo Mortgage Co", "4.9 (128) · Davenport, IA · NMLS 482913", "64%", "Reviews (128)", "★ 4.9 rating", "(563) 555-0100",
      "100 Main St, Davenport, IA 52801", "Mon–Fri 9:00–5:00", "Iowa and Illinois", "9 loan products", "67 facts from 6 sources", "NORA draft ready", "I found 2 certifications on LinkedIn. Add them?",
      "Identity 12", "Contact 9", "Licence 6", "Products 11", "Reviews 15", "Presence 14", "Confirmed by you · Oct 16", "From LinkedIn", "From Google", "From NMLS", "Missing", "Not found anywhere yet"]) {
      expect(t).toContain(s);
    }
  });
  test("the page under a real seat's provider shows the mock notice; without one, the sample notice", async () => {
    const withSeat = text(await render(() => createElement(HfProfileModelProvider, { model: model() }, createElement(ProfileForSeat))));
    expect(withSeat).toContain(MOCK_NOTICE);
    const sample = text(await render(() => createElement(HfProfileModelProvider, { model: null }, createElement(ProfileForSeat))));
    expect(sample).toContain("Sample data");
    expect(sample).not.toContain(MOCK_NOTICE);
  });
});
