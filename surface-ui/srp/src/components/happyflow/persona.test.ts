// The Happyflow screens' person: the sample persona by default, the signed-in professional's real name and
// title when the seat has them (srp/local-login-srp-home). Pure functions only.
import { describe, expect, test } from "bun:test";
import { PERSONA } from "./demo-data";
import { SAMPLE_DATA_NOTE } from "./sample-data";
import { bylineFor, mergePersona, personaFromSeat, personalize, sampleNoticeFor } from "./persona";

type Seat = Parameters<typeof personaFromSeat>[0];
const seat = (pro: Record<string, unknown>): Seat =>
  ({ pro: { first_name: null, last_name: null, display_name: null, job_title: null, ...pro }, office: null }) as unknown as Seat;

describe("personaFromSeat", () => {
  test("nothing known means nothing overridden", () => {
    expect(personaFromSeat(null)).toEqual({});
    expect(personaFromSeat(undefined)).toEqual({});
    expect(personaFromSeat(seat({}))).toEqual({});
  });

  test("first and last name become the first name and the full name", () => {
    expect(personaFromSeat(seat({ first_name: "Harper", last_name: "Jones", display_name: "Harper Jones" }))).toEqual({
      first: "Harper",
      name: "Harper Jones",
    });
  });

  test("a display name alone gives the first name from its first word", () => {
    expect(personaFromSeat(seat({ display_name: "Casey Ito" }))).toEqual({ first: "Casey", name: "Casey Ito" });
  });

  test("a first name alone is both the first name and the name", () => {
    expect(personaFromSeat(seat({ first_name: "Blake" }))).toEqual({ first: "Blake", name: "Blake" });
  });

  test("first and last name are joined when there is no display name", () => {
    expect(personaFromSeat(seat({ first_name: "Skyler", last_name: "Lopez" }))).toEqual({
      first: "Skyler",
      name: "Skyler Lopez",
    });
  });

  test("the job title is used when there is one", () => {
    expect(personaFromSeat(seat({ first_name: "Harper", job_title: "Senior Advisor" })).title).toBe("Senior Advisor");
    expect(personaFromSeat(seat({ first_name: "Harper" })).title).toBeUndefined();
  });

  test("blank and whitespace-only values are ignored, and the rest are trimmed", () => {
    expect(personaFromSeat(seat({ first_name: "   ", last_name: "", display_name: "", job_title: "  " }))).toEqual({});
    expect(personaFromSeat(seat({ first_name: "  Harper ", last_name: " Jones  " }))).toEqual({
      first: "Harper",
      name: "Harper Jones",
    });
  });
});

describe("mergePersona", () => {
  test("with no override it is the sample persona and says so", () => {
    const p = mergePersona({});
    expect(p.name).toBe(PERSONA.name);
    expect(p.first).toBe(PERSONA.first);
    expect(p.title).toBe(PERSONA.title);
    expect(p.isReal).toBe(false);
  });

  test("an override replaces the name fields and marks the persona real", () => {
    const p = mergePersona({ first: "Harper", name: "Harper Jones" });
    expect(p.first).toBe("Harper");
    expect(p.name).toBe("Harper Jones");
    expect(p.title).toBe(""); // a real person without a job title gets none, never the sample "Senior Loan Officer"
    expect(p.company).toBe(PERSONA.company); // the rest of the story is still the sample one
    expect(p.nmls).toBe(PERSONA.nmls);
    expect(p.isReal).toBe(true);
  });
});

describe("bylineFor", () => {
  test("the sample persona keeps its original byline", () => {
    expect(bylineFor(mergePersona({}))).toBe("Alex Sample · Senior Loan Officer · NMLS 482913");
  });

  test("a real person gets their name and title, and never the sample NMLS number", () => {
    expect(bylineFor(mergePersona({ first: "Harper", name: "Harper Jones", title: "Senior Advisor" }))).toBe(
      "Harper Jones · Senior Advisor",
    );
    expect(bylineFor(mergePersona({ first: "Harper", name: "Harper Jones" }))).toBe("Harper Jones");
  });
});

describe("sampleNoticeFor", () => {
  test("the original notice for the sample persona", () => {
    expect(sampleNoticeFor(false)).toBe(SAMPLE_DATA_NOTE);
  });

  test("a real name changes the notice so it does not claim everything is example data", () => {
    const note = sampleNoticeFor(true);
    expect(note).toContain("name");
    expect(note).toContain("example values");
    expect(note).not.toBe(SAMPLE_DATA_NOTE);
  });
});

describe("personalize", () => {
  const real = mergePersona({ first: "Harper", name: "Harper Jones", email: "harper@example.test", site: "demomortgage.com/harper-jones" });

  test("the sample persona's text is left exactly as it is", () => {
    const sample = mergePersona({});
    expect(personalize("Alex Sample, hello Alex — alex.sample@demomortgage.com", sample)).toBe(
      "Alex Sample, hello Alex — alex.sample@demomortgage.com",
    );
  });

  test("the full name, the first name, the email and the site are replaced", () => {
    expect(personalize("Alex Sample – Demo Mortgage", real)).toBe("Harper Jones – Demo Mortgage");
    expect(personalize("Morning, Alex", real)).toBe("Morning, Harper");
    expect(personalize("write to alex.sample@demomortgage.com", real)).toBe("write to harper@example.test");
    expect(personalize("demomortgage.com/alex-sample", real)).toBe("demomortgage.com/harper-jones");
  });

  test("the look-alike in a name search becomes the name with Jr., not a mangled name", () => {
    expect(personalize("Alex Sampler", real)).toBe("Harper Jones Jr.");
  });

  test("only the whole word Alex is replaced", () => {
    expect(personalize("Alexander and Alexa met Alex", real)).toBe("Alexander and Alexa met Harper");
  });

  test("it does nothing to text without the sample name", () => {
    expect(personalize("Riverbend Bank & Trust", real)).toBe("Riverbend Bank & Trust");
  });
});

describe("the rest of the person from the seat", () => {
  test("email and phone come from the seat; the site comes from the slug, or the name", () => {
    const o = personaFromSeat(
      seat({ first_name: "Harper", last_name: "Jones", email: "h@example.test", phone: "+15550001111", slug: "harper-jones-34" }),
    );
    expect(o.email).toBe("h@example.test");
    expect(o.mobile).toBe("+15550001111");
    expect(mergePersona(o).site).toBe("demomortgage.com/harper-jones-34");
    expect(mergePersona(personaFromSeat(seat({ first_name: "Casey", last_name: "Ito" }))).site).toBe("demomortgage.com/casey-ito");
  });

  test("without them the sample email, phone and site stay, as they do not name Alex only when real", () => {
    const p = mergePersona(personaFromSeat(seat({ first_name: "Harper" })));
    expect(p.email).not.toMatch(/alex/i);
    expect(p.site).not.toMatch(/alex/i);
  });
});
