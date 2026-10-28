// The Profile view model built from the API's response (srp/profile-page-schema, task 8). Pure functions, no DOM, no network.
import { describe, expect, test } from "bun:test";
import { api as client } from "@v3/state/api/server-fn";
import { THIN_BIO, bioDraftFor, formatPhone, initialsOf, loadProfileData, profileKey, profileModel, trustedText, type ProfileApi } from "@v3/srp/utils/profile-model";
import { api, withFacts } from "@v3/srp/utils/profile-fixture";
import { STORE_KEY } from "@v3/srp/components/happyflow/screens/profile-store";
import { sampleProfileModel } from "@v3/srp/components/happyflow/sample-profile";
import { PERSONA, PRODUCTS } from "@v3/srp/components/happyflow/demo-data";
import { mergePersona } from "@v3/srp/components/happyflow/persona";

const m = profileModel(api(), "34")!;
const miss = { value: null, present: false, source: null, trust_tier: null, confirmed_at: null, source_line: null };

describe("not ready", () => {
  test("no data, ready false or a missing section gives no model (the sample view)", () => {
    expect(profileModel(null, "1")).toBeNull();
    expect(profileModel(undefined, "1")).toBeNull();
    expect(profileModel(api({ ready: false }), "1")).toBeNull();
    for (const k of ["facts", "preview", "credentials", "graph"] as const) expect(profileModel(api({ [k]: null }), "1")).toBeNull();
  });
});

describe("a ready response", () => {
  test("identity: real, mock or live, and the browser store key per seat", () => {
    expect([m.mode, m.isMock]).toEqual(["real", true]);
    expect(profileModel(api({ data: "live" }), "34")!.isMock).toBe(false);
    expect(m.storeKey).toBe(`${STORE_KEY}:34`);
    expect(profileModel(api(), "9")!.storeKey).toBe(`${STORE_KEY}:9`);
  });
  test("the fifteen editable facts, with phones formatted and missing ones empty", () => {
    expect(m.initial).toEqual({
      Name: "Harper Jones", Title: "Branch Manager", Bio: "Helps Bettendorf-area families buy and refinance homes, with a focus on first-time buyers and FHA and VA loans.",
      "Year started": "2008", Office: "(309) 555-7320", Mobile: "(563) 555-0727", Email: "mock.users.7@example.test", Address: "412 Main St, Bettendorf, IA 52722",
      Hours: "Mon–Sat 9:00–4:00", NMLS: "771204", "Licensed in": "Iowa", "Service areas": "Bettendorf, Moline", Designations: "", Awards: "Top Producer 2025", Education: "",
    });
  });
  test("source lines come from the rows and a missing fact has none", () => {
    expect(m.sources).toMatchObject({ Name: "Confirmed by you · Sep 3", Title: "From LinkedIn", Bio: "Approved by you · Sep 10", Office: "From Google", Mobile: "Confirmed by you · Oct 5",
      NMLS: "From NMLS", Hours: "Added by you · Aug 20", Designations: "", Education: "" });
    expect(m.photo.source).toBe("From LinkedIn");
  });
  test("a fact that is not present shows no source even if the response carries one", () => {
    const x = profileModel(withFacts({ designations: { ...miss, source_line: "From LinkedIn", trust_tier: "owner_verified" } }), "1")!;
    expect([x.sources.Designations, x.trusted.Designations, x.initial.Designations]).toEqual(["", false, ""]);
  });
  test("a source is trusted when its tier is owner or authority verified", () => {
    expect(m.trusted).toMatchObject({ Name: true, NMLS: true, "Licensed in": true, Mobile: true, Title: false, Office: false, Hours: false, "Service areas": false, Awards: false });
    expect(m.trusted.Designations).toBe(false);
  });
  test("the text rule for an edited source line is the prototype's", () => {
    expect(["Confirmed by you · Oct 16", "Verified by NORA", "Updated by voice", "Approved by you"].every(trustedText)).toBe(true);
    expect(["From LinkedIn", "From Google", "Added by you", "NORA draft ready", ""].some(trustedText)).toBe(false);
  });
  test("the photo and the initials", () => {
    expect(m.photo).toEqual({ url: "https://example.test/harper.jpg", source: "From LinkedIn", trusted: false, initials: "HJ" });
    const none = profileModel(withFacts({ photo: miss }), "1")!;
    expect(none.photo).toMatchObject({ url: null, source: "", trusted: false, initials: "HJ" });
  });
  test("products, credentials, preview and graph", () => {
    expect(m.products).toEqual(["Conventional", "FHA", "VA", "USDA", "Jumbo"]);
    expect(profileModel(withFacts({ products: miss }), "1")!.products).toEqual([]);
    expect(m.credentials).toEqual({ added: 1, of: 3 });
    expect(profileModel(api({ credentials: { added: 3, of: 3 } }), "1")!.credentials).toEqual({ added: 3, of: 3 });
    expect(m.preview).toEqual({ title: "Branch Manager", company: "Example Home Loans", city: "Bettendorf", rating: 4.1, reviews: 71, nmls: "771204", strengthPct: 58 });
    expect(m.graph).toEqual({ groups: [{ key: "identity", label: "Identity", facts: 7 }, { key: "contact", label: "Contact", facts: 4 }, { key: "licence", label: "Licence", facts: 3 },
      { key: "products", label: "Products", facts: 5 }, { key: "reviews", label: "Reviews", facts: 9 }, { key: "presence", label: "Presence", facts: 8 }], total: 36, sources: 6 });
  });
  test("unknown preview figures stay unknown", () => {
    const x = profileModel(api({ preview: { title: null, company: null, city: null, rating: null, reviews: null, nmls: null, strength_pct: null, photo_url: null } }), "1")!;
    expect(x.preview).toEqual({ title: null, company: null, city: null, rating: null, reviews: null, nmls: null, strengthPct: null });
  });
  test("no offer is invented for a real seat", () => {
    expect(m.linkedinOffer).toBe(false);
  });
});

describe("phones, names and the bio", () => {
  test("a phone as people read it", () => {
    expect(formatPhone("+15635550100")).toBe("(563) 555-0100");
    expect(formatPhone("+13095550188")).toBe("(309) 555-0188");
    expect(formatPhone("5635550100")).toBe("(563) 555-0100");
    expect(formatPhone("555-0100")).toBe("555-0100");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone("")).toBe("");
  });
  test("initials are the first letters of the first and last word", () => {
    expect([initialsOf("Harper Jones"), initialsOf("Cher"), initialsOf("  Ana  Maria  Lopez "), initialsOf("")]).toEqual(["HJ", "C", "AL", ""]);
  });
  test("a bio is thin under the limit, and a missing one is thin too", () => {
    expect(THIN_BIO).toBe(60);
    const bio = (text: string | null) => profileModel(withFacts({ bio: text === null ? miss : { value: text, present: true, source: "Approved by you" } }), "1")!.bio;
    expect(bio("x".repeat(59)).thin).toBe(true);
    expect(bio("x".repeat(60)).thin).toBe(false);
    expect(bio("x".repeat(61)).thin).toBe(false);
    expect(bio(null).thin).toBe(true);
    expect(m.bio.thin).toBe(false);
  });
  test("NORA's draft is a template over the facts", () => {
    expect(m.bio.draft).toBe("Harper Jones has helped Bettendorf families buy and refinance homes for 18 years, with a focus on first-time buyers and Conventional and FHA loans.");
  });
  test("a part whose fact is missing is left out of the draft", () => {
    const draft = (patches: Record<string, object>, over: Partial<ProfileApi> = {}) => profileModel(withFacts(patches, over), "1")!.bio.draft;
    expect(draft({ year_started: miss })).toBe("Harper Jones has helped Bettendorf families buy and refinance homes, with a focus on first-time buyers and Conventional and FHA loans.");
    expect(draft({}, { preview: { ...api().preview!, city: null } })).toBe("Harper Jones has helped families buy and refinance homes for 18 years, with a focus on first-time buyers and Conventional and FHA loans.");
    expect(draft({ products: { value: ["VA"], present: true, source: "x", trust_tier: "imported" } })).toBe("Harper Jones has helped Bettendorf families buy and refinance homes for 18 years, with a focus on first-time buyers and VA loans.");
    expect(draft({ products: miss })).toBe("Harper Jones has helped Bettendorf families buy and refinance homes for 18 years, with a focus on first-time buyers.");
  });
  test("the years are counted to the year of the data, never negative", () => {
    expect(bioDraftFor({ name: "A", city: null, yearStarted: "2008", asOf: "2026-10-27T00:00:00Z", products: [] })).toContain("for 18 years");
    expect(bioDraftFor({ name: "A", city: null, yearStarted: "2030", asOf: "2026-10-27T00:00:00Z", products: [] })).not.toContain("years");
    expect(bioDraftFor({ name: "A", city: null, yearStarted: "n/a", asOf: "2026-10-27T00:00:00Z", products: [] })).not.toContain("years");
    expect(bioDraftFor({ name: "A", city: null, yearStarted: "2025", asOf: "2026-10-27T00:00:00Z", products: [] })).toContain("for 1 year,");
  });
});

describe("the sample model", () => {
  const persona = mergePersona({});
  const s = sampleProfileModel(persona);
  test("it is the prototype's page: today's facts, sources and products", () => {
    expect(s.mode).toBe("sample");
    expect(s.storeKey).toBe(STORE_KEY);
    expect(s.initial).toMatchObject({ Name: PERSONA.name, Title: PERSONA.title, Bio: "Thin", "Year started": "", Office: PERSONA.officePhone, Mobile: PERSONA.mobile, Email: PERSONA.email,
      Address: PERSONA.address, Hours: "Mon–Fri 9:00–5:00", NMLS: PERSONA.nmls, "Licensed in": PERSONA.states, "Service areas": "", Designations: "", Awards: "", Education: "" });
    expect(s.products).toEqual(PRODUCTS);
    expect(s.sources).toMatchObject({ Name: "From LinkedIn", Title: "From LinkedIn", Office: "Confirmed by you · Oct 16", Mobile: "Confirmed by you · Oct 16", Email: "Confirmed by you · Oct 16",
      Address: "Confirmed by you · Oct 16", Hours: "From Google", NMLS: "Confirmed by you · Oct 16", "Licensed in": "From NMLS", "Year started": "", "Service areas": "" });
    expect(s.photo).toMatchObject({ url: PERSONA.photo, source: "From LinkedIn" });
  });
  test("the trust colours are the prototype's text rule", () => {
    for (const [field, line] of Object.entries(s.sources)) expect(s.trusted[field as keyof typeof s.trusted]).toBe(trustedText(line));
    expect(s.trusted.Office).toBe(true);
    expect(s.trusted.Hours).toBe(false);
  });
  test("the preview, credentials, graph and bio are the prototype's", () => {
    expect(s.preview).toEqual({ title: PERSONA.title, company: PERSONA.company, city: PERSONA.city, rating: PERSONA.rating, reviews: PERSONA.reviews, nmls: PERSONA.nmls, strengthPct: 64 });
    expect(s.credentials).toEqual({ added: 0, of: 3 });
    expect(s.graph.groups.map((g) => [g.label, g.facts])).toEqual([["Identity", 12], ["Contact", 9], ["Licence", 6], ["Products", 11], ["Reviews", 15], ["Presence", 14]]);
    expect([s.graph.total, s.graph.sources]).toEqual([67, 6]);
    expect(s.bio.thin).toBe(true);
    expect(s.bio.draft).toBe("Alex Sample has helped Quad Cities families buy and refinance homes for 12 years, with a focus on first-time buyers and FHA and VA loans.");
    expect(s.linkedinOffer).toBe(true);
  });
  test("a person's name, title, phone and email replace the sample ones", () => {
    const real = mergePersona({ name: "Pat Example", first: "Pat", title: "Loan Officer", email: "pat@example.test", mobile: "(555) 010-0100" });
    const x = sampleProfileModel(real);
    expect([x.initial.Name, x.initial.Title, x.initial.Email, x.initial.Mobile]).toEqual(["Pat Example", "Loan Officer", "pat@example.test", "(555) 010-0100"]);
    expect(x.initial.Office).toBe(PERSONA.officePhone);
    expect(x.bio.draft.startsWith("Pat Example has helped")).toBe(true);
  });
});

describe("loading", () => {
  test("the cache key is one per seat", () => {
    expect(profileKey("1")).not.toEqual(profileKey("2"));
    expect(profileKey("7")).toEqual(["seat-profile-v1", "7"]);
  });
  test("the data is read from the seat's Profile route", async () => {
    const calls: string[] = [];
    const c = client as unknown as { get: (url: string) => Promise<unknown> };
    const real = c.get;
    c.get = async (url: string) => {
      calls.push(url);
      return api();
    };
    try {
      expect((await loadProfileData("42/x")).ready).toBe(true);
    } finally {
      c.get = real;
    }
    expect(calls).toEqual(["/srp/seat/professional/42%2Fx/profile"]);
  });
});
