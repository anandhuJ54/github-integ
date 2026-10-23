// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY BRIEF — the single object every NORA interview step reads.
//
// One engine serves all 4,041 Google GBP categories: the brief is compiled from
// category DATA (exp_category_shape, exp_category_profile_config,
// exp_vertical_node_registry, exp_taxonomy, exp_category_completeness,
// exp_category_schema_type, exp_category_compliance, exp_category_ear/eaa/eaq/eav,
// exp_rings). There is no per-category code here: a restaurant gets a
// many-cardinality "Menu" collection and a mortgage lender a few-cardinality
// "Products" collection purely because of their rows.
//
// This module is PURE (no I/O) so it runs in tests, in the gate script
// (tools/category_brief/compile_all.ts) and on the server. The authenticated
// loader lives in category-brief.functions.ts.
//
// FALLBACK RULES (documented; each is replaced by data the moment it lands):
//  1. Cardinality — `cardinality` / `expected_count_min` / `expected_count_max`
//     on exp_vertical_node_registry are optional. When absent, cardinality is
//     derived from the node's base schema_property via PROPERTY_SEMANTICS
//     (schema.org meaning, identical for every category): menu-like properties
//     (hasMenu, menu, hasMenuItem, hasMenuSection), review/comment and photo
//     are "many"; other list-like properties (hasOfferCatalog, makesOffer,
//     employee, hasCredential, award, sameAs, memberOf, areaServed, …) are
//     "few"; everything else is "one". Expected counts fall back to
//     DEFAULT_EXPECTED_COUNT per cardinality.
//  2. Identity keys — exp_category_shape.identity_keys is optional (today it is
//     `{}` for every category). Accepted shapes: `{ [entityType]: keys[] }` or
//     `keys[]` (all types), each key a property string or `{key,label?,
//     schemaProperty?}`. When empty, keys are derived per ENTITY TYPE (not per
//     category): location → name + address + telephone (GBP NAP), brand →
//     name + url, team → name + parentOrganization, professional → name +
//     email, plus (non-location types) a credential id key whenever the category's registry has a
//     verification-required credential node in that type's OWN scope (labelled
//     from compliance.license_label → profile_config.credential_id_label).
//  3. Entity scope — registry nodes are scoped location | professional |
//     brand | shared. An entity type reads its own scope + shared. When the
//     category has no nodes for that scope, organisation types (brand, team)
//     read the location scope; others read shared only.
//  4. Rings — the registry still carries legacy ring keys (media, social,
//     transactions). Nodes are mapped onto the 10 exp_rings by: exact ring_key,
//     else the ring whose schema_properties list the node's base property,
//     else LEGACY_RING_ALIAS.
//  5. Labels — exp_category_profile_config; missing values fall back to
//     gbp_categories.display_name / neutral defaults and `labels.source`
//     reports "fallback".
// ─────────────────────────────────────────────────────────────────────────────

import type { OfficeModeKind } from "./office-mode";

// ── Raw row types (match live columns; optional = may be absent/null) ───────

export type GbpCategoryRow = {
  gcid: string;
  display_name: string | null;
  slug?: string | null;
  entity_type?: string | null;
  status?: string | null;
};

export type IdentityKeySpec = string | { key: string; label?: string; schemaProperty?: string };

export type CategoryShapeRow = {
  gcid: string;
  shape: string | null;
  allowed_entity_types: string[] | null;
  required_entity_types: string[] | null;
  claimable_types: string[] | null;
  monetizable_types?: string[] | null;
  teams_allowed?: boolean | null;
  multi_affiliation_allowed?: boolean | null;
  /** Being designed in parallel — `{}` today. */
  identity_keys?: Record<string, IdentityKeySpec[]> | IdentityKeySpec[] | null;
  allowed_relationships?: string[] | null;
};

export type ProfileConfigRow = {
  gcid: string;
  entity_noun: string | null;
  service_label: string | null;
  credential_label: string | null;
  credential_id_label: string | null;
  cta_label: string | null;
  schema_type: string | null;
  show_prequalify?: boolean | null;
};

export type Cardinality = "one" | "few" | "many";

export type RegistryNodeRow = {
  /** exp_vertical_node_registry.id — optional; graph writes use it as graph_nodes.node_registry_id. */
  id?: string | null;
  node_slug: string;
  node_name: string | null;
  ring: string | null;
  entity_scope: string | null;
  node_class: string | null;
  connection_method: string | null;
  schema_type: string | null;
  schema_property: string | null;
  required_for_score: boolean | null;
  score_points: number | null;
  priority?: number | null;
  counts_toward_m: boolean | null;
  owns_lane: string | null;
  requires_verification: boolean | null;
  /** Optional until the cardinality columns land. */
  cardinality?: Cardinality | null;
  expected_count_min?: number | null;
  expected_count_max?: number | null;
};

export type TaxonomyRow = {
  level: string;
  term: string;
  term_display?: string | null;
  entity_scope?: string | null;
  schema_property?: string | null;
  is_required?: boolean | null;
  priority?: number | null;
};

export type CompletenessRow = {
  total_node_types: number | null;
  core_node_types: number | null;
  expected_m: number | string | null;
};

export type SchemaTypeRow = {
  schema_type: string | null;
  confidence?: string | null;
  rule?: string | null;
};

export type ComplianceRow = {
  license_label?: string | null;
  required_disclaimers?: string[] | null;
  content_restrictions?: string[] | null;
  prohibited_phrases?: string[] | null;
  required_disclosures?: string[] | null;
  regulated_by?: string[] | null;
  hipaa_applies?: boolean | null;
  glba_applies?: boolean | null;
  coppa_applies?: boolean | null;
  ferpa_applies?: boolean | null;
  age_gate_required?: boolean | null;
  age_gate_minimum?: number | null;
  review_verification_required?: boolean | null;
  review_transaction_required?: boolean | null;
  compliance_notes?: string | null;
};

type Num = number | string | null | undefined;
export type EarRow = {
  ear: Num;
  ear_professional?: Num;
  band?: string | null;
  non_reviewable?: boolean | null;
};
export type EaaRow = {
  eaa: Num;
  eaa_professional?: Num;
  band?: string | null;
  non_authored?: boolean | null;
};
export type EaqRow = {
  eaq: Num;
  eaq_professional?: Num;
  band?: string | null;
  non_qa?: boolean | null;
};
export type EavRow = {
  eav: Num;
  eav_professional?: Num;
  band?: string | null;
  non_video?: boolean | null;
};

export type RingRow = {
  position: number;
  ring_key: string;
  ring_name: string;
  schema_properties: string[] | null;
};

export type CategoryBriefRows = {
  gcid: string;
  category: GbpCategoryRow | null;
  shape: CategoryShapeRow | null;
  profileConfig: ProfileConfigRow | null;
  nodes: RegistryNodeRow[] | null;
  taxonomy?: TaxonomyRow[] | null;
  completeness?: CompletenessRow | null;
  schemaTypes?: SchemaTypeRow[] | null;
  compliance?: ComplianceRow | null;
  ear?: EarRow | null;
  eaa?: EaaRow | null;
  eaq?: EaqRow | null;
  eav?: EavRow | null;
  rings?: RingRow[] | null;
};

// ── Brief types ─────────────────────────────────────────────────────────────

export type BriefNode = {
  nodeId: string | null;
  nodeSlug: string;
  nodeName: string;
  ring: string; // one of the 10 exp_rings keys
  rawRing: string | null;
  entityScope: string;
  nodeClass: string | null;
  connectionMethod: string;
  schemaType: string | null;
  schemaProperty: string | null;
  requiredForScore: boolean;
  scorePoints: number;
  priority: number;
  countsTowardM: boolean;
  ownsLane: string | null;
  requiresVerification: boolean;
  cardinality: Cardinality;
  cardinalitySource: "registry" | "derived";
};

export type IdentityKey = {
  key: string;
  label: string;
  schemaProperty: string;
  source: "shape" | "derived";
};

export type FormField = {
  key: string;
  label: string;
  schemaProperty: string;
  required: boolean;
  source: "identity_key" | "identity_ring" | "required_node";
  nodeSlugs: string[];
};

export type Collection = {
  key: string;
  label: string;
  rings: string[];
  schemaType: string | null;
  schemaProperty: string; // primary (most frequent) property
  schemaProperties: string[];
  connectionMethod: string; // primary (most frequent) method
  connectionMethods: string[];
  cardinality: Cardinality;
  cardinalitySource: "registry" | "derived";
  expectedCount: { min: number; max: number };
  expectedAnnualVolume: number | null; // from exp_category_ear/eaa/eaq/eav via owns_lane
  requiredForScore: boolean;
  nodeSlugs: string[];
  vocabulary: string[]; // taxonomy terms the organize step can match extracted facts against
};

export type ClaimSpec = {
  claimable: boolean;
  keys: IdentityKey[];
  verifiableNodes: {
    nodeSlug: string;
    nodeName: string;
    schemaProperty: string | null;
    connectionMethod: string;
  }[];
};

export type EntityBrief = {
  type: string;
  required: boolean;
  primary: boolean;
  claimable: boolean;
  monetizable: boolean;
  nodeScopes: string[]; // registry scopes actually read
  scopeFallback: boolean;
  identityKeys: IdentityKey[];
  formFields: FormField[];
  claim: ClaimSpec;
  collections: Collection[];
  nodes: BriefNode[];
};

export type VocabularyTerm = { term: string; scope: string };

export type CategoryBrief = {
  gcid: string;
  displayName: string;
  joinsGbp: boolean;
  shape: string | null;
  primaryEntityType: string | null;
  schemaType: string | null;
  labels: {
    entityNoun: string;
    serviceLabel: string;
    credentialLabel: string;
    credentialIdLabel: string;
    ctaLabel: string;
    source: "profile_config" | "fallback";
  };
  entityTypes: EntityBrief[];
  relationships: string[];
  teamsAllowed: boolean;
  vocabulary: {
    productService: VocabularyTerm[];
    specialization: VocabularyTerm[];
    professionTitle: VocabularyTerm[];
    alias: VocabularyTerm[];
    industryTerm: VocabularyTerm[];
  };
  completeness: {
    totalNodeTypes: number | null;
    coreNodeTypes: number | null;
    expectedM: number | null;
  };
  expected: {
    reviews: ExpectedVolume;
    articles: ExpectedVolume;
    qa: ExpectedVolume;
    videos: ExpectedVolume;
  };
  compliance: {
    licenseLabel: string | null;
    requiredDisclaimers: string[];
    requiredDisclosures: string[];
    contentRestrictions: string[];
    prohibitedPhrases: string[];
    regulatedBy: string[];
    flags: { hipaa: boolean; glba: boolean; coppa: boolean; ferpa: boolean };
    ageGate: { required: boolean; minimum: number | null };
    reviewVerificationRequired: boolean;
    reviewTransactionRequired: boolean;
    notes: string | null;
  };
  rings: { key: string; name: string; position: number }[];
};

export type ExpectedVolume = {
  annual: number | null;
  annualProfessional: number | null;
  band: string | null;
  notApplicable: boolean;
};

// ── Data-free semantics (schema.org meaning, identical for every category) ──

/** Fallback for the 10 rings when exp_rings rows are not supplied. */
const DEFAULT_RINGS: RingRow[] = [
  "identity",
  "presence",
  "location",
  "authority",
  "services",
  "content",
  "reputation",
  "engagement",
  "conversion",
  "entity_graph",
].map((k, i) => ({
  position: i + 1,
  ring_key: k,
  ring_name: humanize(k),
  schema_properties: null,
}));

/** Legacy registry ring keys → canonical exp_rings key (last-resort mapping). */
const LEGACY_RING_ALIAS: Record<string, string> = {
  media: "content",
  social: "presence",
  transactions: "conversion",
};

type Family = { key: string; label: string };
const FAMILY = {
  offers: { key: "offers", label: "Services" }, // label overridden by profile_config.service_label
  credentials: { key: "credentials", label: "Credentials" }, // overridden by credential_label
  people: { key: "people", label: "Team" },
  affiliations: { key: "affiliations", label: "Affiliations" },
  reviews: { key: "reviews", label: "Reviews" },
  media: { key: "media", label: "Photos & videos" },
  content: { key: "content", label: "Articles & content" },
  profiles: { key: "profiles", label: "Profiles & links" },
  areas: { key: "areas", label: "Areas served" },
  attributes: { key: "attributes", label: "Features" },
  hours: { key: "hours", label: "Hours" },
  contacts: { key: "contacts", label: "Contact channels" },
  actions: { key: "actions", label: "Actions" },
} satisfies Record<string, Family>;

/** Base schema_property → collection family + fallback cardinality. */
export const PROPERTY_SEMANTICS: Record<
  string,
  { family: Family; cardinality: Exclude<Cardinality, "one"> }
> = {
  hasMenu: { family: FAMILY.offers, cardinality: "many" },
  menu: { family: FAMILY.offers, cardinality: "many" },
  hasMenuItem: { family: FAMILY.offers, cardinality: "many" },
  hasMenuSection: { family: FAMILY.offers, cardinality: "many" },
  hasOfferCatalog: { family: FAMILY.offers, cardinality: "few" },
  makesOffer: { family: FAMILY.offers, cardinality: "few" },
  availableService: { family: FAMILY.offers, cardinality: "few" },
  hasCourse: { family: FAMILY.offers, cardinality: "few" },
  hasCredential: { family: FAMILY.credentials, cardinality: "few" },
  hasCertification: { family: FAMILY.credentials, cardinality: "few" },
  award: { family: FAMILY.credentials, cardinality: "few" },
  awards: { family: FAMILY.credentials, cardinality: "few" },
  alumniOf: { family: FAMILY.credentials, cardinality: "few" },
  employee: { family: FAMILY.people, cardinality: "few" },
  employees: { family: FAMILY.people, cardinality: "few" },
  member: { family: FAMILY.people, cardinality: "few" },
  members: { family: FAMILY.people, cardinality: "few" },
  alumni: { family: FAMILY.people, cardinality: "few" },
  memberOf: { family: FAMILY.affiliations, cardinality: "few" },
  affiliation: { family: FAMILY.affiliations, cardinality: "few" },
  worksFor: { family: FAMILY.affiliations, cardinality: "few" },
  sponsor: { family: FAMILY.affiliations, cardinality: "few" },
  funder: { family: FAMILY.affiliations, cardinality: "few" },
  subOrganization: { family: FAMILY.affiliations, cardinality: "few" },
  review: { family: FAMILY.reviews, cardinality: "many" },
  reviews: { family: FAMILY.reviews, cardinality: "many" },
  comment: { family: FAMILY.reviews, cardinality: "many" },
  photo: { family: FAMILY.media, cardinality: "many" },
  image: { family: FAMILY.media, cardinality: "few" },
  video: { family: FAMILY.media, cardinality: "few" },
  associatedMedia: { family: FAMILY.media, cardinality: "few" },
  author: { family: FAMILY.content, cardinality: "few" },
  subjectOf: { family: FAMILY.content, cardinality: "few" },
  event: { family: FAMILY.content, cardinality: "few" },
  sameAs: { family: FAMILY.profiles, cardinality: "few" },
  areaServed: { family: FAMILY.areas, cardinality: "few" },
  serviceArea: { family: FAMILY.areas, cardinality: "few" },
  containsPlace: { family: FAMILY.areas, cardinality: "few" },
  amenityFeature: { family: FAMILY.attributes, cardinality: "few" },
  servesCuisine: { family: FAMILY.attributes, cardinality: "few" },
  paymentAccepted: { family: FAMILY.attributes, cardinality: "few" },
  knowsAbout: { family: FAMILY.attributes, cardinality: "few" },
  knowsLanguage: { family: FAMILY.attributes, cardinality: "few" },
  currenciesAccepted: { family: FAMILY.attributes, cardinality: "few" },
  openingHoursSpecification: { family: FAMILY.hours, cardinality: "few" },
  specialOpeningHoursSpecification: { family: FAMILY.hours, cardinality: "few" },
  contactPoint: { family: FAMILY.contacts, cardinality: "few" },
  potentialAction: { family: FAMILY.actions, cardinality: "few" },
};

export const DEFAULT_EXPECTED_COUNT: Record<Cardinality, { min: number; max: number }> = {
  one: { min: 1, max: 1 },
  few: { min: 1, max: 12 },
  many: { min: 20, max: 500 },
};

const CARD_RANK: Record<Cardinality, number> = { one: 0, few: 1, many: 2 };

/** owns_lane → which expected-volume table sizes the collection. */
const LANE_VOLUME: Record<string, keyof CategoryBrief["expected"]> = {
  reviews: "reviews",
  articles: "articles",
  qa: "qa",
  videos: "videos",
};

/** Properties that never dedupe into one form field (one field per node). */
const GENERIC_PROPERTIES = new Set(["additionalProperty", "identifier"]);

/** Organisation-shaped entity types read the location scope when they have none of their own. */
const ORG_SCOPE_FALLBACK: Record<string, string> = { brand: "location", team: "location" };

const PROPERTY_LABEL: Record<string, string> = {
  name: "Name",
  address: "Address",
  telephone: "Phone",
  email: "Email",
  url: "Website",
  parentOrganization: "Parent organization",
  "hasCredential.identifier": "License #",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function humanize(s: string): string {
  const t = s
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const baseProp = (p: string | null | undefined) => (p ? p.split(".")[0] : null);

const toNum = (v: Num): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const nonEmpty = (s: string | null | undefined): s is string =>
  typeof s === "string" && s.trim() !== "";

function mostFrequent(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

function byFrequency(values: (string | null)[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}

function canonicalRing(raw: string | null, property: string | null, rings: RingRow[]): string {
  if (raw && rings.some((r) => r.ring_key === raw)) return raw;
  const bp = baseProp(property);
  if (bp) {
    const hit = rings.find((r) => (r.schema_properties ?? []).includes(bp));
    if (hit) return hit.ring_key;
  }
  if (raw && LEGACY_RING_ALIAS[raw]) return LEGACY_RING_ALIAS[raw];
  return raw ?? "identity";
}

function nodeCardinality(n: RegistryNodeRow): {
  cardinality: Cardinality;
  source: "registry" | "derived";
} {
  if (n.cardinality) return { cardinality: n.cardinality, source: "registry" };
  const bp = baseProp(n.schema_property);
  const sem = bp ? PROPERTY_SEMANTICS[bp] : undefined;
  return { cardinality: sem?.cardinality ?? "one", source: "derived" };
}

function parseIdentityKeys(
  spec: CategoryShapeRow["identity_keys"],
  entityType: string,
): IdentityKey[] {
  if (!spec) return [];
  const list = Array.isArray(spec) ? spec : (spec[entityType] ?? []);
  if (!Array.isArray(list)) return [];
  return list
    .map((k): IdentityKey | null => {
      if (typeof k === "string") {
        return {
          key: k,
          label: PROPERTY_LABEL[k] ?? humanize(k),
          schemaProperty: k,
          source: "shape",
        };
      }
      if (k && typeof k === "object" && nonEmpty(k.key)) {
        const prop = k.schemaProperty ?? k.key;
        return {
          key: k.key,
          label: k.label ?? PROPERTY_LABEL[prop] ?? humanize(k.key),
          schemaProperty: prop,
          source: "shape",
        };
      }
      return null;
    })
    .filter((k): k is IdentityKey => k !== null);
}

function derivedIdentityKeys(
  entityType: string,
  nodes: BriefNode[],
  credentialIdLabel: string,
): IdentityKey[] {
  const k = (key: string, schemaProperty = key, label?: string): IdentityKey => ({
    key,
    label: label ?? PROPERTY_LABEL[schemaProperty] ?? humanize(key),
    schemaProperty,
    source: "derived",
  });
  const base: Record<string, IdentityKey[]> = {
    location: [k("name"), k("address"), k("telephone")],
    brand: [k("name"), k("url")],
    team: [k("name"), k("parentOrganization")],
    professional: [k("name"), k("email")],
  };
  const keys = [...(base[entityType] ?? [k("name")])];
  // Locations verify through their GBP listing (NAP); every other type adds the
  // credential id when the category's registry demands a verified credential.
  const verifiedCredential =
    entityType !== "location" &&
    nodes.some(
      (n) =>
        n.requiresVerification &&
        baseProp(n.schemaProperty) === "hasCredential" &&
        n.entityScope === entityType,
    );
  if (verifiedCredential)
    keys.push(k("credential_id", "hasCredential.identifier", credentialIdLabel));
  return keys;
}

function expected(
  v: number | null,
  vp: number | null,
  band: string | null | undefined,
  na: boolean | null | undefined,
): ExpectedVolume {
  return { annual: v, annualProfessional: vp, band: band ?? null, notApplicable: !!na };
}

const VOCAB_LEVELS = {
  product_service: "productService",
  specialization: "specialization",
  profession_title: "professionTitle",
  alias: "alias",
  industry_term: "industryTerm",
} as const;

// ── Compile ─────────────────────────────────────────────────────────────────

export function compileCategoryBrief(rows: CategoryBriefRows): CategoryBrief {
  const { gcid, category, shape, profileConfig: pc, compliance: cc } = rows;
  const rings =
    rows.rings && rows.rings.length
      ? [...rows.rings].sort((a, b) => a.position - b.position)
      : DEFAULT_RINGS;
  const ringPos = new Map(rings.map((r) => [r.ring_key, r.position]));
  const displayName = category?.display_name ?? gcid.replace(/^gcid:/, "").replace(/_/g, " ");

  const labelsFromConfig = !!pc && nonEmpty(pc.entity_noun) && nonEmpty(pc.service_label);
  const labels: CategoryBrief["labels"] = {
    entityNoun: nonEmpty(pc?.entity_noun) ? pc.entity_noun : displayName,
    serviceLabel: nonEmpty(pc?.service_label) ? pc.service_label : "Services",
    credentialLabel: nonEmpty(pc?.credential_label) ? pc.credential_label : "Credentials",
    credentialIdLabel: nonEmpty(cc?.license_label)
      ? cc.license_label
      : nonEmpty(pc?.credential_id_label)
        ? pc.credential_id_label
        : "License #",
    ctaLabel: nonEmpty(pc?.cta_label) ? pc.cta_label : "Contact",
    source: labelsFromConfig ? "profile_config" : "fallback",
  };

  const schemaType =
    mostFrequent((rows.schemaTypes ?? []).map((s) => s.schema_type)) ?? pc?.schema_type ?? null;

  // Normalise registry nodes once.
  const allNodes: BriefNode[] = (rows.nodes ?? []).map((n) => {
    const card = nodeCardinality(n);
    return {
      nodeId: n.id ?? null,
      nodeSlug: n.node_slug,
      nodeName: n.node_name ?? humanize(n.node_slug),
      ring: canonicalRing(n.ring, n.schema_property, rings),
      rawRing: n.ring,
      entityScope: n.entity_scope ?? "shared",
      nodeClass: n.node_class,
      connectionMethod: n.connection_method ?? "manual",
      schemaType: n.schema_type,
      schemaProperty: n.schema_property,
      requiredForScore: !!n.required_for_score,
      scorePoints: n.score_points ?? 0,
      priority: n.priority ?? 0,
      countsTowardM: !!n.counts_toward_m,
      ownsLane: n.owns_lane,
      requiresVerification: !!n.requires_verification,
      cardinality: card.cardinality,
      cardinalitySource: card.source,
    };
  });
  const scopesPresent = new Set(allNodes.map((n) => n.entityScope));

  // Vocabulary.
  const vocabulary: CategoryBrief["vocabulary"] = {
    productService: [],
    specialization: [],
    professionTitle: [],
    alias: [],
    industryTerm: [],
  };
  for (const t of rows.taxonomy ?? []) {
    const bucket = VOCAB_LEVELS[t.level as keyof typeof VOCAB_LEVELS];
    if (!bucket) continue;
    const term = nonEmpty(t.term_display) ? t.term_display : t.term;
    if (nonEmpty(term)) vocabulary[bucket].push({ term, scope: t.entity_scope ?? "shared" });
  }

  const vol = {
    reviews: expected(
      toNum(rows.ear?.ear),
      toNum(rows.ear?.ear_professional),
      rows.ear?.band,
      rows.ear?.non_reviewable,
    ),
    articles: expected(
      toNum(rows.eaa?.eaa),
      toNum(rows.eaa?.eaa_professional),
      rows.eaa?.band,
      rows.eaa?.non_authored,
    ),
    qa: expected(
      toNum(rows.eaq?.eaq),
      toNum(rows.eaq?.eaq_professional),
      rows.eaq?.band,
      rows.eaq?.non_qa,
    ),
    videos: expected(
      toNum(rows.eav?.eav),
      toNum(rows.eav?.eav_professional),
      rows.eav?.band,
      rows.eav?.non_video,
    ),
  };

  const allowed = shape?.allowed_entity_types ?? [];
  const required = shape?.required_entity_types ?? [];
  const claimable = new Set(shape?.claimable_types ?? []);
  const monetizable = new Set(shape?.monetizable_types ?? []);
  const primaryEntityType =
    required.find((t) => allowed.includes(t)) ??
    allowed.find((t) => shape?.shape?.startsWith(`${t}_`)) ??
    allowed[0] ??
    null;

  const entityTypes: EntityBrief[] = allowed.map((type) => {
    let scopes = [type, "shared"];
    let scopeFallback = false;
    if (!scopesPresent.has(type)) {
      scopeFallback = true;
      const fb = ORG_SCOPE_FALLBACK[type];
      scopes = fb ? [fb, "shared"] : ["shared"];
    }
    const nodes = allNodes.filter((n) => scopes.includes(n.entityScope));

    // Identity keys: shape data first, derived fallback otherwise.
    const shapeKeys = parseIdentityKeys(shape?.identity_keys, type);
    const identityKeys = shapeKeys.length
      ? shapeKeys
      : derivedIdentityKeys(type, nodes, labels.credentialIdLabel);

    // Add-profile form: identity keys, then manual single-valued identity-ring and required nodes.
    const fields = new Map<string, FormField>();
    for (const k of identityKeys) {
      fields.set(k.schemaProperty, {
        key: k.key,
        label: k.label,
        schemaProperty: k.schemaProperty,
        required: true,
        source: "identity_key",
        nodeSlugs: [],
      });
    }
    for (const n of nodes) {
      if (!n.schemaProperty || n.cardinality !== "one" || n.connectionMethod !== "manual") continue;
      if (n.ring !== "identity" && !n.requiredForScore) continue;
      const bp = baseProp(n.schemaProperty)!;
      const dedupeKey = GENERIC_PROPERTIES.has(bp) ? `node:${n.nodeSlug}` : n.schemaProperty;
      const existing = fields.get(dedupeKey);
      if (existing) {
        existing.nodeSlugs.push(n.nodeSlug);
        existing.required ||= n.requiredForScore;
        continue;
      }
      fields.set(dedupeKey, {
        key: dedupeKey.startsWith("node:") ? n.nodeSlug : n.schemaProperty,
        label: n.nodeName,
        schemaProperty: n.schemaProperty,
        required: n.requiredForScore,
        source: n.ring === "identity" ? "identity_ring" : "required_node",
        nodeSlugs: [n.nodeSlug],
      });
    }
    const formFields = [...fields.values()].sort(
      (a, b) =>
        Number(b.source === "identity_key") - Number(a.source === "identity_key") ||
        Number(b.required) - Number(a.required),
    );

    // Claim verification.
    const claim: ClaimSpec = {
      claimable: claimable.has(type),
      keys: claimable.has(type) ? identityKeys : [],
      verifiableNodes: claimable.has(type)
        ? nodes
            .filter((n) => n.requiresVerification)
            .map((n) => ({
              nodeSlug: n.nodeSlug,
              nodeName: n.nodeName,
              schemaProperty: n.schemaProperty,
              connectionMethod: n.connectionMethod,
            }))
        : [],
    };

    // Collections: list-like nodes grouped by property family.
    const groups = new Map<string, { family: Family; nodes: BriefNode[] }>();
    for (const n of nodes) {
      if (n.cardinality === "one") continue;
      const bp = baseProp(n.schemaProperty);
      const family = (bp && PROPERTY_SEMANTICS[bp]?.family) || {
        key: bp ?? "other",
        label: humanize(bp ?? "other"),
      };
      const g = groups.get(family.key) ?? { family, nodes: [] };
      g.nodes.push(n);
      groups.set(family.key, g);
    }
    const isProfessional = type === "professional";
    const collections: Collection[] = [...groups.values()].map(({ family, nodes: gn }) => {
      const cardinality = gn.reduce<Cardinality>(
        (c, n) => (CARD_RANK[n.cardinality] > CARD_RANK[c] ? n.cardinality : c),
        "one",
      );
      const fromRegistry = gn.filter((n) => n.cardinalitySource === "registry");
      const rawFromRegistry = (rows.nodes ?? []).filter((r) =>
        fromRegistry.some((n) => n.nodeSlug === r.node_slug),
      );
      const mins = rawFromRegistry
        .map((r) => r.expected_count_min)
        .filter((v): v is number => v != null);
      const maxs = rawFromRegistry
        .map((r) => r.expected_count_max)
        .filter((v): v is number => v != null);
      const lane = mostFrequent(
        gn.map((n) => (n.ownsLane && LANE_VOLUME[n.ownsLane] ? n.ownsLane : null)),
      );
      const lv = lane ? vol[LANE_VOLUME[lane]] : null;
      const annual = lv ? ((isProfessional ? lv.annualProfessional : null) ?? lv.annual) : null;
      const label =
        family.key === "offers"
          ? labels.serviceLabel
          : family.key === "credentials"
            ? labels.credentialLabel
            : family.label;
      const vocab =
        family.key === "offers"
          ? vocabulary.productService
          : family.key === "attributes" && isProfessional
            ? vocabulary.specialization
            : [];
      return {
        key: family.key,
        label,
        rings: [...new Set(gn.map((n) => n.ring))].sort(
          (a, b) => (ringPos.get(a) ?? 99) - (ringPos.get(b) ?? 99),
        ),
        schemaType: mostFrequent(gn.map((n) => n.schemaType)) ?? schemaType,
        schemaProperty: mostFrequent(gn.map((n) => baseProp(n.schemaProperty)))!,
        schemaProperties: byFrequency(gn.map((n) => n.schemaProperty)),
        connectionMethod: mostFrequent(gn.map((n) => n.connectionMethod))!,
        connectionMethods: byFrequency(gn.map((n) => n.connectionMethod)),
        cardinality,
        cardinalitySource: fromRegistry.length ? "registry" : "derived",
        expectedCount: {
          min: mins.length ? Math.min(...mins) : DEFAULT_EXPECTED_COUNT[cardinality].min,
          max: maxs.length ? Math.max(...maxs) : DEFAULT_EXPECTED_COUNT[cardinality].max,
        },
        expectedAnnualVolume: annual,
        requiredForScore: gn.some((n) => n.requiredForScore),
        nodeSlugs: gn.map((n) => n.nodeSlug),
        vocabulary: vocab
          .filter((v) => v.scope === "shared" || scopes.includes(v.scope))
          .map((v) => v.term),
      };
    });
    collections.sort(
      (a, b) =>
        Number(b.requiredForScore) - Number(a.requiredForScore) ||
        CARD_RANK[b.cardinality] - CARD_RANK[a.cardinality] ||
        b.nodeSlugs.length - a.nodeSlugs.length,
    );

    return {
      type,
      required: required.includes(type),
      primary: type === primaryEntityType,
      claimable: claimable.has(type),
      monetizable: monetizable.has(type),
      nodeScopes: scopes,
      scopeFallback,
      identityKeys,
      formFields,
      claim,
      collections,
      nodes,
    };
  });

  return {
    gcid,
    displayName,
    joinsGbp: !!category,
    shape: shape?.shape ?? null,
    primaryEntityType,
    schemaType,
    labels,
    entityTypes,
    relationships: shape?.allowed_relationships ?? [],
    teamsAllowed: !!shape?.teams_allowed,
    vocabulary,
    completeness: {
      totalNodeTypes: rows.completeness?.total_node_types ?? null,
      coreNodeTypes: rows.completeness?.core_node_types ?? null,
      expectedM: toNum(rows.completeness?.expected_m),
    },
    expected: vol,
    compliance: {
      licenseLabel: cc?.license_label ?? null,
      requiredDisclaimers: cc?.required_disclaimers ?? [],
      requiredDisclosures: cc?.required_disclosures ?? [],
      contentRestrictions: cc?.content_restrictions ?? [],
      prohibitedPhrases: cc?.prohibited_phrases ?? [],
      regulatedBy: cc?.regulated_by ?? [],
      flags: {
        hipaa: !!cc?.hipaa_applies,
        glba: !!cc?.glba_applies,
        coppa: !!cc?.coppa_applies,
        ferpa: !!cc?.ferpa_applies,
      },
      ageGate: { required: !!cc?.age_gate_required, minimum: cc?.age_gate_minimum ?? null },
      reviewVerificationRequired: !!cc?.review_verification_required,
      reviewTransactionRequired: !!cc?.review_transaction_required,
      notes: cc?.compliance_notes ?? null,
    },
    rings: rings.map((r) => ({ key: r.ring_key, name: r.ring_name, position: r.position })),
  };
}

// ── Accessors ───────────────────────────────────────────────────────────────

export function entityBrief(brief: CategoryBrief, entityType?: string | null): EntityBrief | null {
  const t = entityType ?? brief.primaryEntityType;
  return brief.entityTypes.find((e) => e.type === t) ?? null;
}

/**
 * Registry node types not yet filled for an entity type, most valuable first:
 * required_for_score → score_points → lane-owning nodes → ring order → priority.
 * `filled` holds node slugs (or objects with a nodeSlug).
 */
export function nextGaps(
  brief: CategoryBrief,
  filled: Iterable<string | { nodeSlug: string }>,
  entityType?: string | null,
): BriefNode[] {
  const eb = entityBrief(brief, entityType);
  if (!eb) return [];
  const done = new Set<string>();
  for (const f of filled) done.add(typeof f === "string" ? f : f.nodeSlug);
  const pos = new Map(brief.rings.map((r) => [r.key, r.position]));
  return eb.nodes
    .filter((n) => !done.has(n.nodeSlug))
    .sort(
      (a, b) =>
        Number(b.requiredForScore) - Number(a.requiredForScore) ||
        b.scorePoints - a.scorePoints ||
        Number(!!b.ownsLane) - Number(!!a.ownsLane) ||
        (pos.get(a.ring) ?? 99) - (pos.get(b.ring) ?? 99) ||
        a.priority - b.priority ||
        a.nodeSlug.localeCompare(b.nodeSlug),
    );
}

export type BriefFailure =
  | "no_gbp_join"
  | "no_entity_type"
  | "no_identity_key"
  | "no_collections"
  | "no_labels";

/** Structural gate used by tools/category_brief/compile_all.ts. */
export function briefFailures(brief: CategoryBrief): BriefFailure[] {
  const f: BriefFailure[] = [];
  if (!brief.joinsGbp) f.push("no_gbp_join");
  if (!brief.entityTypes.length) f.push("no_entity_type");
  if (brief.entityTypes.some((e) => !e.identityKeys.length)) f.push("no_identity_key");
  if (!brief.entityTypes.length || brief.entityTypes.some((e) => !e.collections.length))
    f.push("no_collections");
  if (brief.labels.source !== "profile_config") f.push("no_labels");
  return f;
}

// ── Single-professional office (Scott 2026-10-11; docs/SRP_Foundation_Plain.md §3) ──
//
// In single_pro mode (decided by the DB function exp_office_mode — see src/lib/office-mode.ts)
// the office ACTS AS the professional — identity keys, form fields, claim keys (licence key),
// interview collections, public profile — and LISTS AS the location: NAP keys, the Place ID
// claim path, and the location's listing collections. A listing collection is one whose nodes
// all sit on the canonical `location` ring (where/when the place is: hours, geo, address…);
// it is chosen by ring, never by category. In every other mode the requested entity type is
// returned for both sides, unchanged.

export type OfficeCollection = Collection & { sourceEntityType: string };

export type OfficeBrief = {
  mode: OfficeModeKind | null;
  /** True only when the fusion applied (single_pro AND the brief has both types). */
  singlePro: boolean;
  /** Entity type whose identity / claim / interview / public profile is used. */
  actAs: string | null;
  /** Entity type whose listings (GBP Place ID, directories, NAP) are used. */
  listAs: string | null;
  identityKeys: IdentityKey[];
  formFields: FormField[];
  claim: ClaimSpec & {
    /** NAP keys of the listing entity (the Place ID / T2 path reads the location). */
    listingKeys: IdentityKey[];
    listingEntityType: string | null;
  };
  /** NAP keys the listings payload is built from (always the listing entity's). */
  napKeys: IdentityKey[];
  /** actAs collections, with listing collections taken from listAs. */
  collections: OfficeCollection[];
  /** The listing entity's location-ring collections. */
  listingCollections: OfficeCollection[];
};

const LISTING_RING = "location";
const isListingCollection = (c: Collection) =>
  c.rings.length > 0 && c.rings.every((r) => r === LISTING_RING);

/**
 * Office-mode-aware view of the brief. `entityType` is the brief type of the record asked
 * about ('professional' | 'location' | …); it is ignored in single_pro mode, where the answer
 * is always "act as professional, list as location".
 */
export function entityBriefForOffice(
  brief: CategoryBrief,
  mode: OfficeModeKind | null | undefined,
  entityType?: string | null,
): OfficeBrief | null {
  const pro = entityBrief(brief, "professional");
  const loc = entityBrief(brief, "location");
  const single = mode === "single_pro" && !!pro && !!loc;
  const act = single ? pro : entityBrief(brief, entityType);
  const list = single ? loc : act;
  if (!act || !list) return null;
  const tag = (e: EntityBrief) => (c: Collection) => ({ ...c, sourceEntityType: e.type });
  const listingCollections = list.collections.filter(isListingCollection).map(tag(list));
  const collections = single
    ? [...act.collections.filter((c) => !isListingCollection(c)).map(tag(act)), ...listingCollections]
    : act.collections.map(tag(act));
  return {
    mode: mode ?? null,
    singlePro: single,
    actAs: act.type,
    listAs: list.type,
    identityKeys: act.identityKeys,
    formFields: act.formFields,
    claim: { ...act.claim, listingKeys: list.identityKeys, listingEntityType: list.type },
    napKeys: list.identityKeys,
    collections,
    listingCollections,
  };
}
