/**
 * The Happyflow prototype's sample Profile data, in one place (srp/profile-page-schema, task 8): the facts, their sources, NORA's bio draft and the graph counts
 * the Profile screen used to hold inline, and `sampleProfileModel`, the same values in the shape of `ProfileModel`. The sample view (no real seat) is built from
 * this; a real seat is built from the API (`profileModel` in utils/profile-model.ts). Nothing here is read from or written to the database.
 */
import { THIN_BIO, trustedText, graphLabel, type GraphKey, type ProfileModel } from "@v3/srp/utils/profile-model";
import { PERSONA, PRODUCTS } from "./demo-data";
import { personalize, type HfPersona } from "./persona";
import type { ProfileField } from "./screens/profile-voice";
import { STORE_KEY } from "./screens/profile-store";

// Demo data (Happyflow prototype)
export const BIO_DRAFT =
  "Alex Sample has helped Quad Cities families buy and refinance homes for 12 years, with a focus on first-time buyers and FHA and VA loans.";

export const INITIAL: Record<ProfileField, string> = {
  Name: PERSONA.name,
  Title: PERSONA.title,
  Bio: "Thin",
  "Year started": "",
  Office: PERSONA.officePhone,
  Mobile: PERSONA.mobile,
  Email: PERSONA.email,
  Address: PERSONA.address,
  Hours: "Mon–Fri 9:00–5:00",
  NMLS: PERSONA.nmls,
  "Licensed in": PERSONA.states,
  "Service areas": "",
  Designations: "",
  Awards: "",
  Education: "",
};

/** The source line the prototype shows for each fact ("" = the fact is missing, so the page says "Not found anywhere yet"). */
export const SAMPLE_SOURCES: Record<ProfileField, string> = {
  Name: "From LinkedIn",
  Title: "From LinkedIn",
  Bio: "",
  "Year started": "",
  Office: "Confirmed by you · Oct 16",
  Mobile: "Confirmed by you · Oct 16",
  Email: "Confirmed by you · Oct 16",
  Address: "Confirmed by you · Oct 16",
  Hours: "From Google",
  NMLS: "Confirmed by you · Oct 16",
  "Licensed in": "From NMLS",
  "Service areas": "",
  Designations: "",
  Awards: "",
  Education: "",
};

/** The expertise graph's six bars (facts per source), as the prototype draws them. */
export const SAMPLE_GRAPH: [GraphKey, number][] = [["identity", 12], ["contact", 9], ["licence", 6], ["products", 11], ["reviews", 15], ["presence", 14]];

/** The prototype's Profile page as a `ProfileModel`: the persona's own name, title, phone and email in place of the sample ones, the rest as drawn. */
export function sampleProfileModel(persona: HfPersona): ProfileModel {
  const initial: Record<ProfileField, string> = { ...INITIAL, Name: persona.name, Title: persona.title, Mobile: persona.mobile, Email: persona.email };
  const trusted = Object.fromEntries(Object.entries(SAMPLE_SOURCES).map(([k, line]) => [k, trustedText(line)])) as Record<ProfileField, boolean>;
  return {
    mode: "sample",
    isMock: true,
    storeKey: STORE_KEY,
    initial,
    sources: { ...SAMPLE_SOURCES },
    trusted,
    photo: { url: PERSONA.photo, source: "From LinkedIn", trusted: false, initials: "" },
    products: [...PRODUCTS],
    credentials: { added: 0, of: 3 },
    preview: { title: persona.title, company: PERSONA.company, city: PERSONA.city, rating: PERSONA.rating, reviews: PERSONA.reviews, nmls: PERSONA.nmls, strengthPct: 64 },
    graph: {
      groups: SAMPLE_GRAPH.map(([key, facts]) => ({ key, label: graphLabel(key), facts })),
      total: SAMPLE_GRAPH.reduce((a, [, n]) => a + n, 0),
      sources: SAMPLE_GRAPH.length,
    },
    bio: { thin: INITIAL.Bio.length < THIN_BIO, draft: personalize(BIO_DRAFT, persona) },
    linkedinOffer: true,
  };
}
