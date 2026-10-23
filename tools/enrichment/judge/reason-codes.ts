// Relevance judge — fixed vocabularies (reason codes, decisions, lanes).
//
// This file is the single source of truth. The prompt (prompt.ts), the JSON Schema
// (schema.ts), the validator (validate.ts) and the README tables are all generated
// from it. Adding or renaming a code is a vocabulary change: bump JUDGE_VOCAB_VERSION,
// re-run the golden set, and log it in docs/ETL-Enhancements.md.
//
// Say "category", never "vertical".

export const JUDGE_VOCAB_VERSION = "judge-vocab.v1";

/** The 14 taxonomy lanes (exp_taxonomy.lane). */
export const LANES = [
  "keyword",
  "product_service",
  "specialization",
  "topic",
  "question",
  "content_title",
  "tag",
  "audience",
  "review_aspect",
  "industry_term",
  "alias",
  "profession_title",
  "negative_keyword",
  "modifier",
] as const;
export type Lane = (typeof LANES)[number];

export interface LaneDef {
  lane: Lane;
  /** What a `keep` means in this lane. */
  keepMeans: string;
  /** keep rows must carry a topic family (true) or must have family=null (false). */
  takesFamily: boolean;
  /** `informational` terms routed OUT of this lane may go here (a valid `to_lane` target). */
  informationalTarget: boolean;
}

export const LANE_DEFS: Record<Lane, LaneDef> = {
  keyword: { lane: "keyword", keepMeans: "a search a customer types when they want to find or hire this kind of business", takesFamily: true, informationalTarget: false },
  product_service: { lane: "product_service", keepMeans: "something this category actually sells or performs", takesFamily: true, informationalTarget: false },
  specialization: { lane: "specialization", keepMeans: "a focus area, niche or sub-specialty practitioners in this category advertise", takesFamily: true, informationalTarget: false },
  topic: { lane: "topic", keepMeans: "a subject a business in this category can credibly publish about", takesFamily: true, informationalTarget: true },
  question: { lane: "question", keepMeans: "a question a customer asks that a business in this category can answer", takesFamily: true, informationalTarget: true },
  content_title: { lane: "content_title", keepMeans: "a page/article title a business in this category would publish", takesFamily: true, informationalTarget: true },
  tag: { lane: "tag", keepMeans: "an attribute/amenity/qualifier that can be attached to a profile (not a search)", takesFamily: false, informationalTarget: false },
  audience: { lane: "audience", keepMeans: "a customer segment this category serves", takesFamily: false, informationalTarget: false },
  review_aspect: { lane: "review_aspect", keepMeans: "a thing customers praise or complain about in reviews of this category", takesFamily: false, informationalTarget: false },
  industry_term: { lane: "industry_term", keepMeans: "vocabulary of the trade that appears in correct content for this category", takesFamily: true, informationalTarget: false },
  alias: { lane: "alias", keepMeans: "another name for the category or its practitioner that a customer uses and means the same thing", takesFamily: true, informationalTarget: false },
  profession_title: { lane: "profession_title", keepMeans: "a job title held by a practitioner of this category", takesFamily: true, informationalTarget: false },
  negative_keyword: { lane: "negative_keyword", keepMeans: "a term that should be NEGATED in ads for this category (see README open question 7: derive from excludes instead of judging)", takesFamily: false, informationalTarget: false },
  modifier: { lane: "modifier", keepMeans: "a qualifier that can be combined with any family term (near me, best, 24 hour). Modifiers are tags, never families", takesFamily: false, informationalTarget: false },
};

export const DECISIONS = ["keep", "exclude", "move"] as const;
export type Decision = (typeof DECISIONS)[number];

export const REASON_CODES = [
  "keep",
  "brand_or_business_name",
  "other_category",
  "different_audience",
  "informational",
  "geo_specific",
  "ambiguous_meaning",
  "portal_owned",
  "navigational_brand",
  "amenity_attribute",
  "compliance_conflict",
  "off_intent",
  "duplicate_meaning",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface ReasonCodeDef {
  code: ReasonCode;
  /** The only decisions this code may be paired with. */
  decisions: readonly Decision[];
  definition: string;
  /** What the validator / downstream expects in `note`. */
  noteRule: string;
  examples: ReadonlyArray<{ category: string; term: string; why: string }>;
}

export const REASON_CODE_DEFS: Record<ReasonCode, ReasonCodeDef> = {
  keep: {
    code: "keep",
    decisions: ["keep"],
    definition:
      "The term is a real search (or lane entry) for exactly this category and a business in it can legitimately compete for it. Modifiers such as 'best', 'top', 'near me', 'open late', 'delivery' do not change that; they become tags downstream. A near-me form of a portal-owned term is kept when local_pack=Y.",
    noteRule: "May be empty. Use it only when the keep is non-obvious (for example 'local pack present: portal head term, near-me form kept').",
    examples: [
      { category: "gcid:cannabis_store", term: "dispensary that takes card near me", why: "a real transactional local search; paying by card is a purchase question, not an amenity browse" },
      { category: "gcid:real_estate_agents", term: "houses for sale near me", why: "the head term is portal-owned, but the near-me form triggers a map pack of real estate businesses (local_pack=Y)" },
    ],
  },
  brand_or_business_name: {
    code: "brand_or_business_name",
    decisions: ["exclude"],
    definition:
      "The term names a specific company, chain, franchise, product brand or an individual business (with or without a city). A person typing it wants THAT business. Includes brand-like coined names that only make sense as a business name. If a brand and a city are both present, the code is brand_or_business_name (the brand is what makes it unwinnable; a geo template would not rescue it).",
    noteRule: "Name the brand if recognisable (e.g. 'chain: Taco Bell').",
    examples: [
      { category: "gcid:mexican_restaurant", term: "chipotle mexican grill near me", why: "a chain; a local independent cannot win it" },
      { category: "gcid:cannabis_store", term: "mint dispensary az", why: "brand plus geo; the brand decides it" },
    ],
  },
  other_category: {
    code: "other_category",
    decisions: ["exclude"],
    definition:
      "The term describes a different real GBP category (a sibling listed in the prompt, or one the judge recognises) whose businesses would be the right answer. Exclude from this category's lane; the note names the category so the term can be offered to it. Do NOT use it for a sibling that shares Google's map pack with this category (see the pooled-pack rule in the prompt).",
    noteRule: "REQUIRED: name the other category (display name or gcid). When there is no exact GBP category, say 'no exact GBP category; nearest: <gcid>'.",
    examples: [
      { category: "gcid:mexican_restaurant", term: "mexican grocery store near me", why: "belongs to gcid:mexican_grocery_store" },
      { category: "gcid:real_estate_agents", term: "commercial real estate agent", why: "belongs to gcid:commercial_real_estate_agency" },
    ],
  },
  different_audience: {
    code: "different_audience",
    decisions: ["exclude"],
    definition:
      "The searcher is not a customer of this category: job seekers, students, people seeking licensing or training, vendors, competitors, or a B2B buyer when the category sells to consumers (or the reverse).",
    noteRule: "State the audience (e.g. 'job seekers', 'licensing students').",
    examples: [
      { category: "gcid:cannabis_store", term: "dispensary jobs near me", why: "job seekers" },
      { category: "gcid:real_estate_agents", term: "realtor classes", why: "people studying for a licence" },
    ],
  },
  informational: {
    code: "informational",
    decisions: ["move"],
    definition:
      "The searcher wants to learn or do it themselves (what/how/why, recipes, laws, calculators, DIY), not to find a business. The term is valuable but belongs in the question, topic or content_title lane, not in a commercial lane. Always decision=move with to_lane. Not used when the judged lane is itself question/topic/content_title (then the term is a keep).",
    noteRule: "State why it is informational in a few words.",
    examples: [
      { category: "gcid:cannabis_store", term: "what is thc", why: "definition question -> to_lane question" },
      { category: "gcid:mexican_restaurant", term: "margarita recipies", why: "recipe/DIY intent -> to_lane topic" },
    ],
  },
  geo_specific: {
    code: "geo_specific",
    decisions: ["exclude"],
    definition:
      "The term contains a named place (city, state, county, neighbourhood, zip, a specific country as a place). It is excluded as a literal term and replaced by one {city}/{state} template that the geo pages fill. Many geo variants collapse into ONE template. Brand+geo is brand_or_business_name instead.",
    noteRule: "REQUIRED: the template containing at least one of {city} {state} {county} {neighborhood} {zip}, e.g. 'realtors {city}'.",
    examples: [
      { category: "gcid:real_estate_agents", term: "yuma realtors", why: "template: realtors {city}" },
      { category: "gcid:plumber", term: "plumbers in dallas tx", why: "template: plumbers in {city} {state}" },
    ],
  },
  ambiguous_meaning: {
    code: "ambiguous_meaning",
    decisions: ["exclude"],
    definition:
      "The words overlap with this category's vocabulary but the searcher means something else (another sense of the word, a person, a place, a substring coincidence). The decision is about meaning, not wording: shared words, acronyms or substrings are never enough to keep.",
    noteRule: "State the other meaning ('fruit bouquets', 'muscle injury', 'virus strains', 'Paris tourist site').",
    examples: [
      { category: "gcid:cannabis_store", term: "muscle strains", why: "'strains' = muscle injury" },
      { category: "gcid:mexican_restaurant", term: "catacombs in paris france", why: "contains the letters 'tacos'; the meaning is a tourist site" },
    ],
  },
  portal_owned: {
    code: "portal_owned",
    decisions: ["exclude"],
    definition:
      "The results page is owned by listing portals / aggregators / publishers (Zillow, Bankrate, Yelp...) and no local business can win it. ONLY use when local_pack is N or unknown. If local_pack=Y the term is a keep: a map pack of real businesses means a local business can win it.",
    noteRule: "State which kind of portal owns it and that no local pack is known.",
    examples: [
      { category: "gcid:real_estate_agents", term: "homes for sale", why: "listing portals own it; no map pack (local_pack=N)" },
      { category: "gcid:mortgage_lender", term: "mortgage calculator", why: "rate/calculator portals own it; no map pack" },
    ],
  },
  navigational_brand: {
    code: "navigational_brand",
    decisions: ["keep"],
    definition:
      "KEEP, but flag: people typing this word mostly mean a portal or brand (for example 'realtor' mostly means Realtor.com), so the reported volume is inflated by navigation. Downstream sets volume_inflated_by_navigation=true and discounts the volume. Use only when the term is genuinely also the generic word for the category.",
    noteRule: "Name the navigational target ('mostly Realtor.com').",
    examples: [
      { category: "gcid:real_estate_agents", term: "realtor", why: "generic professional word, but most volume is people seeking Realtor.com" },
      { category: "gcid:real_estate_agents", term: "realtors", why: "plural of the same word; same navigational pull (a close variant, so it shares the volume)" },
    ],
  },
  amenity_attribute: {
    code: "amenity_attribute",
    decisions: ["exclude"],
    definition:
      "The term is a feature a business may have (wifi, parking, wheelchair access) used as an adjective to a category, not something people search for. It is valid as a tag but not as a keyword. Purchase-method terms people really search ('takes card', 'open late') are keeps, not amenities.",
    noteRule: "Optional: suggest the tag ('tag: wifi').",
    examples: [
      { category: "gcid:cannabis_store", term: "cannabis store with wifi", why: "an amenity; belongs in the tag lane" },
      { category: "gcid:mexican_restaurant", term: "mexican restaurant with a ceiling fan", why: "an amenity, nobody searches this" },
    ],
  },
  compliance_conflict: {
    code: "compliance_conflict",
    decisions: ["exclude"],
    definition:
      "The term would require or promote a claim the category's compliance rules prohibit: it matches, or paraphrases, one of the prohibited phrases in the prompt, or invites steering by a protected class. Takes precedence over every other code.",
    noteRule: "REQUIRED: quote the prohibited phrase or rule that matched.",
    examples: [
      { category: "gcid:mortgage_lender", term: "guaranteed mortgage approval", why: "matches prohibited phrase 'guaranteed approval'" },
      { category: "gcid:real_estate_agents", term: "safe neighborhoods near me", why: "Fair Housing: steering by neighbourhood character" },
    ],
  },
  off_intent: {
    code: "off_intent",
    decisions: ["exclude"],
    definition:
      "The searcher's intent has nothing to do with hiring or finding this category: prayers, logos, memes, trivia, another market's usage of the same word, or any term where no sensible reading leads to a business in this category.",
    noteRule: "State the real intent in a few words.",
    examples: [
      { category: "gcid:real_estate_agents", term: "prayer to sell my house", why: "religious intent" },
      { category: "gcid:real_estate_agents", term: "estate agents near me", why: "UK usage of the word; a different market (no dedicated code, see README open question 2)" },
    ],
  },
  duplicate_meaning: {
    code: "duplicate_meaning",
    decisions: ["exclude"],
    definition:
      "The term means exactly the same as another candidate in this batch that is kept (typo, plural, word order, stopword, close variant). Google reports one shared volume for close variants, so the pair must not be counted twice. Exclude the weaker spelling and keep the canonical one.",
    noteRule: "REQUIRED: the surviving candidate term, verbatim.",
    examples: [
      { category: "gcid:plumber", term: "plumbers near me", why: "duplicate of 'plumber near me' (kept)" },
      { category: "gcid:mexican_restaurant", term: "mexican resturant near me", why: "typo duplicate of 'mexican restaurant near me'" },
    ],
  },
};

export const GEO_SLOTS = ["{city}", "{state}", "{county}", "{neighborhood}", "{zip}"] as const;

/** Where an `informational` move may be routed. */
export const INFORMATIONAL_TARGET_LANES: readonly Lane[] = LANES.filter((l) => LANE_DEFS[l].informationalTarget);

/**
 * Modifier words that must never be (or end) a family slug. Modifiers are tags.
 * (A previous version used 'best/top/good', 'near me/local' and a bare 'broker' as families.)
 */
export const FORBIDDEN_FAMILY_SLUGS: ReadonlySet<string> = new Set([
  "best", "top", "top_rated", "good", "great", "cheap", "cheapest", "affordable", "local", "near_me", "nearby", "near",
  "open_now", "open_late", "open", "free", "online", "24_hour", "24_7", "same_day", "emergency_modifier", "modifiers",
  "generic", "general_terms", "misc", "other", "keyword", "keywords",
]);

/** Precedence when several codes could apply (first match wins). Rendered into the prompt. */
export const DECISION_ORDER: readonly ReasonCode[] = [
  "compliance_conflict",
  "brand_or_business_name",
  "ambiguous_meaning",
  "off_intent",
  "different_audience",
  "other_category",
  "geo_specific",
  "informational",
  "portal_owned",
  "amenity_attribute",
  "duplicate_meaning",
  "navigational_brand",
  "keep",
];

export const isReasonCode = (v: unknown): v is ReasonCode => typeof v === "string" && (REASON_CODES as readonly string[]).includes(v);
export const isLane = (v: unknown): v is Lane => typeof v === "string" && (LANES as readonly string[]).includes(v);
export const isDecision = (v: unknown): v is Decision => typeof v === "string" && (DECISIONS as readonly string[]).includes(v);
