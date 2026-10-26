// ============================================================================
// Category brief derivation: node cardinality + category identity keys.
//
// PROPOSAL GENERATOR ONLY. Reads read-only exports of the live DB (fetched via
// query_database SELECTs; see export.sql) plus the vendored schema.org
// vocabulary, and writes:
//   out/node_cardinality_rules.csv      one row per distinct derivation signature
//                                        (covers every registry row; row_count sums
//                                        to the registry total)
//   out/registry_node_cardinality.csv.gz one row per registry node (id, gcid,
//                                        node_slug, cardinality, min, max, rule)
//   out/category_identity_keys.json     proposed exp_category_shape.identity_keys
//                                        for all 4,041 categories
//   out/category_identity_keys.csv      flat view of the same
//   out/category_collections.csv.gz     interview collections per category: nodes that
//                                        describe the same collection count once (max)
//   out/professional_licence_audit.csv  professional_first licence key status
//   out/enrichment_flags.csv            model errors surfaced for enrichment (not fixed)
//   out/review_sample_20.md             human-review sample
//   out/gates.json                      structural gate results (exit 1 if any fails)
// It never writes to the database. No per-category code: every decision below
// is a function of schema.org definitions + registry/shape/compliance data.
//
//   bun tools/category_brief/derive.ts
// ============================================================================
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const IN = join(HERE, "in");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
type RegRow = [
  id: string,
  gcid: string,
  node_slug: string,
  node_name: string,
  schema_property: string | null,
  schema_type: string | null,
  ring: string | null,
  node_class: string | null,
  connection_method: string | null,
  entity_scope: string | null,
  requires_verification: boolean | null,
];

interface CategoryRow {
  gcid: string;
  display_name: string;
  shape: string | null;
  req: string[] | null;
  allowed: string[] | null;
  identity_keys: Record<string, unknown> | null;
  cid: string | null; // exp_category_profile_config.credential_id_label
  cl: string | null; // exp_category_profile_config.credential_label
  regulated_by: string[] | null;
  hipaa_applies: boolean | null;
  glba_applies: boolean | null;
  license_label: string | null; // exp_category_compliance.license_label
}

// [gcid, annual_transactions, ear, ear_band, eaa, eap, eaq, eav, expected_m,
//  total_node_types, estimated_locations, estimated_profiles]
type VolumeRow = [
  string,
  number | null,
  number | null,
  string | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

function readExport(path: string): { rows: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(path, "utf8")) as { rows: Record<string, unknown>[] };
}

const categories = readExport(join(IN, "categories.json")).rows as unknown as CategoryRow[];

const volRaw = readExport(join(IN, "volumes.json")).rows[0]!["j"];
const volumes = (typeof volRaw === "string" ? JSON.parse(volRaw) : volRaw) as VolumeRow[];

const registry: RegRow[] = [];
const regDir = join(IN, "registry");
for (const f of readdirSync(regDir).filter((f) => f.endsWith(".json")).sort()) {
  const r = readExport(join(regDir, f)).rows[0]!;
  const arr = (typeof r["j"] === "string" ? JSON.parse(r["j"] as string) : r["j"]) as RegRow[];
  if (arr.length !== Number(r["n"])) throw new Error(`chunk ${f} truncated`);
  for (const x of arr) registry.push(x);
}

// ---------------------------------------------------------------------------
// schema.org vocabulary (vendored, release 29.2)
// ---------------------------------------------------------------------------
type Ref = { "@id": string };
type GraphNode = {
  "@id": string;
  "@type": string | string[];
  "rdfs:subClassOf"?: Ref | Ref[];
  "schema:rangeIncludes"?: Ref | Ref[];
  "schema:supersededBy"?: Ref | Ref[];
  "schema:domainIncludes"?: Ref | Ref[];
};
const asArr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const local = (id: string) => id.replace(/^schema:/, "");

const graph = (
  JSON.parse(readFileSync(join(ROOT, "reference", "schemaorg-current.jsonld"), "utf8")) as {
    "@graph": GraphNode[];
  }
)["@graph"];

const parentsOf = new Map<string, string[]>();
const rangeOf = new Map<string, string[]>();
const domainOf = new Map<string, string[]>();
const supersededBy = new Map<string, string[]>(); // old -> new
const DATATYPES = new Set(["Text", "URL", "Number", "Integer", "Float", "Boolean", "Date", "DateTime", "Time", "CssSelectorType", "XPathType", "PronounceableText"]);
for (const n of graph) {
  const t = asArr(n["@type"]);
  const id = local(n["@id"]);
  if (t.includes("rdfs:Class")) parentsOf.set(id, asArr(n["rdfs:subClassOf"]).map((r) => local(r["@id"])));
  if (t.includes("rdf:Property")) {
    rangeOf.set(id, asArr(n["schema:rangeIncludes"]).map((r) => local(r["@id"])));
    domainOf.set(id, asArr(n["schema:domainIncludes"]).map((r) => local(r["@id"])));
    const s = asArr(n["schema:supersededBy"]).map((r) => local(r["@id"]));
    if (s.length) supersededBy.set(id, s);
  }
}
function ancestors(type: string): Set<string> {
  const seen = new Set<string>();
  const stack = [type];
  while (stack.length) {
    const t = stack.pop()!;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const p of parentsOf.get(t) ?? []) stack.push(p);
  }
  return seen;
}
const isA = (type: string, base: string) => ancestors(type).has(base);
const isDatatype = (type: string) => DATATYPES.has(type) || isA(type, "DataType");

// (1) Plural-alias signal straight from schema.org: a property is multi-valued
//     when schema.org retired a plural spelling in its favour
//     (reviews->review, employees->employee, photos->photo, awards->award,
//      maps->hasMap, contactPoints->contactPoint, ...).
const pluralAliased = new Set<string>();
for (const [oldP, news] of supersededBy) {
  for (const p of news) {
    const o = oldP.toLowerCase();
    const n = p.toLowerCase();
    if (o === `${n}s` || o === `${n}es` || (o.endsWith("s") && n.endsWith(o.slice(0, -1)))) pluralAliased.add(p);
  }
}

// (2) Generic multi-valued seed. schema.org has no cardinality metadata, so the
//     properties that are conventionally repeated on an entity and have no plural
//     alias are listed once here. Schema-level, applies to every category alike.
const MULTI_VALUED_SEED = new Set([
  "sameAs", "makesOffer", "offers", "hasCredential", "knowsAbout", "knowsLanguage", "areaServed",
  "amenityFeature", "memberOf", "paymentAccepted", "servesCuisine", "availableService", "hasOccupation",
  "subjectOf", "author", "affiliation", "alumniOf", "department", "subOrganization", "containsPlace",
  "medicalSpecialty", "hospitalAffiliation", "owns", "sponsor", "funder", "mentions", "potentialAction",
  "image", "video", "audio", "associatedMedia", "hasPart", "itemListElement", "hasMenuItem",
  "hasMenuSection", "comment", "keywords", "openingHoursSpecification",
  "specialOpeningHoursSpecification", "hasOfferCatalog", "hasMenu", "blogPost", "workExample",
  "interactionStatistic", "contactPoint", "availableLanguage", "identifier",
]);
const isMultiValued = (prop: string) => pluralAliased.has(prop) || MULTI_VALUED_SEED.has(prop);

// (3) Container depth from the vocabulary: how many levels of item-membership a
//     value of this type expands into. Membership properties are schema.org's
//     list/section relations; depth is computed by walking their ranges.
const MEMBERSHIP_PROPS = ["itemListElement", "hasMenuSection", "hasMenuItem"];
const membershipDomain = new Map<string, string[]>(); // prop -> domain types
for (const n of graph) {
  const id = local(n["@id"]);
  if (MEMBERSHIP_PROPS.includes(id))
    membershipDomain.set(id, asArr((n as unknown as { "schema:domainIncludes"?: Ref | Ref[] })["schema:domainIncludes"]).map((r) => local(r["@id"])));
}
const depthMemo = new Map<string, number>();
function containerDepth(type: string, visiting = new Set<string>()): number {
  if (depthMemo.has(type)) return depthMemo.get(type)!;
  if (visiting.has(type) || isDatatype(type)) return 0;
  visiting.add(type);
  const anc = ancestors(type);
  let best = 0;
  for (const p of MEMBERSHIP_PROPS) {
    if (!(membershipDomain.get(p) ?? []).some((d) => anc.has(d))) continue;
    for (const r of rangeOf.get(p) ?? []) {
      if (isDatatype(r) || r === "Thing" || r === "ListItem") {
        best = Math.max(best, 1);
        continue;
      }
      best = Math.max(best, 1 + containerDepth(r, visiting));
    }
  }
  visiting.delete(type);
  depthMemo.set(type, best);
  return best;
}
function propContainerDepth(prop: string): number {
  let d = 0;
  for (const r of rangeOf.get(prop) ?? []) if (!isDatatype(r)) d = Math.max(d, containerDepth(r));
  return d;
}

// (4) Stream class: which expected-volume table measures a stream of this type.
type Stream = "review" | "article" | "video" | "qa" | "post" | "image" | null;
function streamOfType(type: string | null): Stream {
  if (!type || !parentsOf.has(type)) return null;
  const a = ancestors(type);
  if (a.has("Review")) return "review";
  if (a.has("Question") || a.has("Answer") || a.has("FAQPage") || a.has("QAPage")) return "qa";
  if (a.has("VideoObject") || a.has("AudioObject") || a.has("Clip") || a.has("Episode") || a.has("Movie")) return "video";
  if (a.has("ImageObject") || a.has("ImageGallery")) return "image";
  if (a.has("SocialMediaPosting") || a.has("Event")) return "post";
  // Authored written content only; credentials, maps, menus, catalogs etc. are
  // CreativeWork subtypes too but are not publication streams.
  if (type === "CreativeWork" || ["Article", "Blog", "Comment", "HowTo", "WebPage", "DigitalDocument", "Guide", "Book", "CreativeWorkSeries"].some((t) => a.has(t)))
    return "article";
  return null;
}

// (5) Transaction-record properties: properties schema.org defines on Order,
//     Invoice, Reservation or Action. A system-fed node of one of these is a
//     record stream that scales with the category's annual_transactions.
const TX_DOMAINS = ["Order", "Invoice", "Reservation", "Action"];
// Every declared domain must be a transaction type (orderStatus, orderNumber,
// actionStatus, result...); mixed-domain properties (comment, about,
// priceSpecification) are not records.
const isTransactionProp = (prop: string) => {
  const doms = domainOf.get(prop) ?? [];
  return doms.length > 0 && doms.every((d) => TX_DOMAINS.some((t) => isA(d, t)));
};

// (6) Domain fit: a container property used on a type outside its schema.org
//     domain (e.g. hasMenu, domain FoodEstablishment, on a Dentist) is a loose
//     price/service list, not a nested menu; it gets single-level fan-out.
function domainFits(prop: string, type: string | null): boolean {
  if (!type || !parentsOf.has(type)) return true;
  const doms = domainOf.get(prop) ?? [];
  return doms.length === 0 || doms.some((d) => isA(type, d));
}
function streamOfProp(prop: string): Stream {
  const ranges = (rangeOf.get(prop) ?? []).filter((r) => !isDatatype(r));
  if (!ranges.length) return null;
  const s = ranges.map(streamOfType);
  return s.every((x) => x !== null && x === s[0]) ? s[0]! : null;
}

// ---------------------------------------------------------------------------
// Node-name features (data written by the category authors, generic regexes)
// ---------------------------------------------------------------------------
const CONTAINER_WORDS = /\b(gallery|library|catalog(ue)?|menu|feed|hub|series|portfolio|directory|archive|collection|list|listings|inventory)\b/i;
function headNoun(name: string): string {
  const base = name.split(/\s[—–-]\s|\(|:/)[0]!.trim();
  const words = base.split(/\s+/);
  return (words[words.length - 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
}
function nameFlag(name: string): "container" | "plural" | "singular" {
  if (CONTAINER_WORDS.test(name)) return "container";
  const h = headNoun(name);
  if (h.length > 3 && h.endsWith("s") && !/(ss|us|is|ics|news|status|access|address|business|hours?)$/.test(h)) return "plural";
  if (/(hours|records|reviews|photos|videos|posts)$/.test(h)) return "plural";
  return "singular";
}

// ---------------------------------------------------------------------------
// Volumes per category (expected-volume tables, all annual per entity)
// ---------------------------------------------------------------------------
interface Vol {
  tx: number | null;
  ear: number | null;
  eaa: number | null;
  eap: number | null;
  eaq: number | null;
  eav: number | null;
}
const volByGcid = new Map<string, Vol>();
for (const v of volumes) {
  if (!v[0]) continue;
  const n = (x: number | string | null) => (x === null || x === undefined ? null : Number(x));
  volByGcid.set(v[0], { tx: n(v[1]), ear: n(v[2]), eaa: n(v[4]), eap: n(v[5]), eaq: n(v[6]), eav: n(v[7]) });
}
// Platform-wide medians used when a category has no row in a volume table.
function median(xs: number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}
const allVols = [...volByGcid.values()];
const MEDIAN: Record<keyof Vol, number> = {
  tx: median(allVols.map((v) => v.tx ?? NaN)),
  ear: median(allVols.map((v) => v.ear ?? NaN)),
  eaa: median(allVols.map((v) => v.eaa ?? NaN)),
  eap: median(allVols.map((v) => v.eap ?? NaN)),
  eaq: median(allVols.map((v) => v.eaq ?? NaN)),
  eav: median(allVols.map((v) => v.eav ?? NaN)),
};
const STREAM_TABLE: Record<Exclude<Stream, null>, keyof Vol | null> = {
  review: "ear",
  article: "eaa",
  video: "eav",
  qa: "eaq",
  post: "eap",
  image: null,
};

// ---------------------------------------------------------------------------
// Cardinality derivation (per registry node). First matching rule wins.
// ---------------------------------------------------------------------------
type Card = "one" | "few" | "many";
interface Derived {
  cardinality: Card;
  min: number;
  max: number;
  rule: string;
  basis: string; // volume table or fan-out used for the range
}
const FEEDS = new Set(["api", "oauth", "platform", "crm_sync", "etl"]);
const POINTER_RINGS = new Set(["identity", "presence", "social"]);
const FAN = { lo: 4, hi: 20 }; // per-level fan-out of a schema.org container
const FEW = { lo: 2, hi: 10 };
const IMAGE_STREAM = { lo: 10, hi: 100 }; // no expected-volume table for photos yet
const TX_CAP = 100000;

function cardOf(max: number): Card {
  return max <= 1 ? "one" : max <= 25 ? "few" : "many";
}
function annualRange(v: number): [number, number] {
  return [Math.max(1, Math.round(v * 0.5)), Math.max(1, Math.ceil(v * 1.5))];
}

interface Features {
  prop: string | null; // full schema_property (may be a path)
  base: string | null; // first path segment
  isPath: boolean;
  stream: Stream;
  depth: number;
  multi: boolean;
  ring: string | null;
  cm: string | null;
  flag: "container" | "plural" | "singular";
  tx: boolean; // transaction-record property
  domainFit: boolean;
}
function features(r: RegRow, categoryType: string | null): Features {
  const prop = r[4];
  const base = prop ? prop.split(".")[0]! : null;
  // A node's schema_type names the value type when it is a stream type (Article,
  // Review, ...); only then does it decide the stream. Otherwise use the range.
  const typeStream = streamOfType(r[5]);
  const hasObjectRange = base ? (rangeOf.get(base) ?? []).some((t) => !isDatatype(t)) : false;
  const stream = (hasObjectRange ? typeStream : null) ?? (base ? streamOfProp(base) : null);
  const ownDepth = base ? propContainerDepth(base) : 0;
  const typeDepth = r[5] && parentsOf.has(r[5]) && containerDepth(r[5]) > 0 ? containerDepth(r[5]) : 0;
  return {
    prop,
    base,
    isPath: !!prop && prop.includes("."),
    stream,
    depth: Math.max(ownDepth, typeDepth),
    multi: base ? isMultiValued(base) : false,
    ring: r[6],
    cm: r[8],
    flag: nameFlag(r[3] ?? ""),
    tx: base ? isTransactionProp(base) : false,
    domainFit: base ? domainFits(base, categoryType) : true,
  };
}

function derive(f: Features, vol: Vol | undefined): Derived {
  const one = (rule: string): Derived => ({ cardinality: "one", min: 1, max: 1, rule, basis: "-" });
  if (!f.base) return one("R0_no_property");
  if (f.isPath) return one("R1_property_path_leaf");

  const feed = f.cm === "rss" || FEEDS.has(f.cm ?? "");

  // R2 schema.org container (Menu -> MenuSection -> MenuItem, OfferCatalog -> items)
  if (f.depth >= 1) {
    if (POINTER_RINGS.has(f.ring ?? "") && f.flag !== "container") return one("R2p_container_pointer");
    const depth = f.domainFit ? Math.min(f.depth, 2) : 1;
    // A single-level catalog node named in the singular is one catalog entry
    // (e.g. "FHA Home Loan Service"); the catalog is the sum of its nodes.
    if (depth === 1 && f.flag === "singular") return one("R2s_catalog_entry");
    const min = depth >= 2 ? FAN.lo ** depth : FEW.lo;
    const max = FAN.hi ** depth;
    const rule = f.domainFit ? `R2_container_depth_${depth}` : "R2d_container_off_domain";
    return { cardinality: cardOf(max), min, max, rule, basis: `fanout ${FAN.lo}-${FAN.hi}^${depth}` };
  }

  // R3 transaction records: a system-fed node of an Order/Invoice/Reservation/Action
  // property scales with the category's annual_transactions.
  if (f.tx && feed && f.cm !== "rss") {
    const tx = vol?.tx ?? MEDIAN.tx;
    const [mn, mx] = annualRange(Math.min(tx, TX_CAP));
    return { cardinality: cardOf(mx), min: mn, max: mx, rule: "R3_transaction_stream", basis: vol?.tx != null ? "annual_transactions" : "annual_transactions(median)" };
  }

  // R4 content/review streams: multi-valued stream property fed by a feed, or any rss node
  if (f.stream && ((f.multi && feed) || f.cm === "rss")) {
    const table = STREAM_TABLE[f.stream];
    if (!table) {
      return { cardinality: cardOf(IMAGE_STREAM.hi), min: IMAGE_STREAM.lo, max: IMAGE_STREAM.hi, rule: `R4_stream_${f.stream}`, basis: "fixed(no volume table)" };
    }
    const v = vol?.[table] ?? MEDIAN[table];
    const [mn, mx] = annualRange(v);
    return { cardinality: cardOf(mx), min: mn, max: mx, rule: `R4_stream_${f.stream}`, basis: vol?.[table] != null ? table : `${table}(median)` };
  }
  if (f.cm === "rss") {
    const v = vol?.eaa ?? MEDIAN.eaa;
    const [mn, mx] = annualRange(v);
    return { cardinality: cardOf(mx), min: mn, max: mx, rule: "R4_stream_rss", basis: vol?.eaa != null ? "eaa" : "eaa(median)" };
  }

  // R5 multi-valued property whose node names a set (plural / container noun)
  if (f.multi && (f.flag === "plural" || f.flag === "container")) {
    return { cardinality: "few", min: FEW.lo, max: FEW.hi, rule: `R5_multi_${f.flag}`, basis: `fixed ${FEW.lo}-${FEW.hi}` };
  }
  // R6 multi-valued property, node names one item -> one instance (the collection is the sum of nodes)
  if (f.multi) return one("R6_multi_single_item");
  // R7 single-valued (datatype or structured) property
  return one("R7_single_valued");
}

// ---------------------------------------------------------------------------
// Run cardinality over every registry row
// ---------------------------------------------------------------------------
const gbpSet = new Set(categories.map((c) => c.gcid));
const catByGcid = new Map(categories.map((c) => [c.gcid, c]));
const sigRows = new Map<string, { f: Features; d: Derived; n: number; example: string }>();
// Keyed by (gcid, node_slug), which is unique in the registry (checked below).
const perRow: string[] = ["gcid,node_slug,cardinality,expected_count_min,expected_count_max,rule"];
const seenKey = new Set<string>();
let dupKeys = 0;
const catTypeRaw = readExport(join(IN, "category_schema_type.json")).rows[0]!["j"];
const catType = new Map(((typeof catTypeRaw === "string" ? JSON.parse(catTypeRaw) : catTypeRaw) as [string, string | null][]).map((x) => [x[0], x[1]]));
const byGcid = new Map<string, { r: RegRow; d: Derived }[]>();
const featureCache = new Map<string, Features>();
let missingCard = 0;
let badRange = 0;
const regOrphans = new Set<string>();
const csvq = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

for (const r of registry) {
  const ct = catType.get(r[1]) ?? null;
  const fk = [r[4], r[5], r[6], r[8], nameFlag(r[3] ?? ""), ct].join("|");
  let f = featureCache.get(fk);
  if (!f) {
    f = features(r, ct);
    featureCache.set(fk, f);
  }
  const rk = `${r[1]}|${r[2]}`;
  if (seenKey.has(rk)) dupKeys++;
  seenKey.add(rk);
  const d = derive(f, volByGcid.get(r[1]));
  if (!d.cardinality) missingCard++;
  if (!(d.min >= 0 && d.min <= d.max) || cardOf(d.max) !== d.cardinality) badRange++;
  if (!gbpSet.has(r[1])) regOrphans.add(r[1]);
  // Signature excludes gcid volume so the rules table stays category-agnostic.
  const sk = [r[4] ?? "", r[5] ?? "", r[6] ?? "", r[8] ?? "", f.flag, d.rule, d.basis.replace(/\(median\)/, "")].join("|");
  const s = sigRows.get(sk);
  if (s) s.n++;
  else sigRows.set(sk, { f, d, n: 1, example: r[3] });
  perRow.push([r[1], csvq(r[2]), d.cardinality, d.min, d.max, d.rule].join(","));
  let list = byGcid.get(r[1]);
  if (!list) byGcid.set(r[1], (list = []));
  list.push({ r, d });
}

writeFileSync(join(OUT, "registry_node_cardinality.csv.gz"), gzipSync(perRow.join("\n") + "\n", { level: 9 }));
{
  // Category-agnostic rule table: cardinality is fixed per signature; for stream
  // rules the count range is v*[0.5,1.5] of the named per-category volume table.
  const out = ["schema_property,schema_type,ring,connection_method,name_flag,multi_valued,container_depth,stream,rule,cardinality,expected_count_min,expected_count_max,count_basis,row_count,example_node_name"];
  for (const [k, s] of [...sigRows.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const [p, t, ring, cm] = k.split("|");
    const perCat = /^R[34]_/.test(s.d.rule) && !s.d.basis.startsWith("fixed");
    out.push(
      [p, t, ring, cm, s.f.flag, s.f.multi, s.f.depth, s.f.stream ?? "", s.d.rule, perCat ? "per-category" : s.d.cardinality, perCat ? "" : s.d.min, perCat ? "" : s.d.max, perCat ? `${s.d.basis.replace(/\(median\)/, "")} x [0.5,1.5]` : s.d.basis, s.n, csvq(s.example)].join(","),
    );
  }
  writeFileSync(join(OUT, "node_cardinality_rules.csv"), out.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Identity keys (per category)
// ---------------------------------------------------------------------------
// Generic key lexicon. Each key: the registry/compliance evidence that implies it,
// the entity scope it identifies, and the public registry used to verify silently.
// Key names reuse the vocabulary already present in exp_entity.identity_keys
// (gbp_place_id, state_license, npn_or_producer, domain).
interface KeyDef {
  key: string;
  scope: "professional" | "location" | "brand";
  verify_via: string;
  rx: RegExp;
  // Issued to whoever practises (the person or sole trader), so the key follows
  // the category's required entity type instead of the fixed default scope.
  holder?: boolean;
}
const KEY_LEXICON: KeyDef[] = [
  { key: "nmls_id", scope: "professional", verify_via: "NMLS Consumer Access", rx: /\bNMLS\b|Nationwide Multistate Licensing/i },
  { key: "npi", scope: "professional", verify_via: "CMS NPPES NPI Registry", rx: /\bNPI\b|National Provider Identifier|\bNPPES\b|usNPI/i },
  { key: "npn_or_producer", scope: "professional", verify_via: "NIPR / state DOI producer lookup", rx: /\bNPN\b|National Producer|producer licen[cs]e|insurance (agent |producer )?licen[cs]e|Department of Insurance|Insurance Commissioner|Division of Insurance/i },
  { key: "bar_number", scope: "professional", verify_via: "State bar attorney lookup", rx: /\bbar (number|#|no\.?|admission|license|licen[cs]e number|id)\b|\bstate bar\b|\bBar #/i },
  { key: "finra_crd", scope: "professional", verify_via: "FINRA BrokerCheck / SEC IAPD", rx: /\bCRD\b|\bFINRA\b|\bIARD\b|Investment Adviser Registration/i },
  { key: "dea_registration", scope: "professional", verify_via: "DEA registration validation", rx: /\bDEA (registration|number|#)/i },
  { key: "cpa_license", scope: "professional", verify_via: "CPAverify / state board of accountancy", rx: /\bCPA licen[cs]e|Board of Accountancy|\bCPAverify\b/i },
  { key: "usdot_number", scope: "brand", verify_via: "FMCSA SAFER", rx: /\bUS ?DOT\b|\bFMCSA\b|\bMC number\b|motor carrier number/i },
  { key: "fdic_cert", scope: "brand", verify_via: "FDIC BankFind", rx: /\bFDIC (cert|certificate|number|insured)|\bFDIC\b/i },
  { key: "ncua_charter", scope: "brand", verify_via: "NCUA credit union locator", rx: /\bNCUA\b/i },
  { key: "irs_ein", scope: "brand", verify_via: "IRS Tax Exempt Organization Search", rx: /501\(c\)\(3\)|IRS determination|tax[- ]exempt (status|determination)/i },
  { key: "liquor_license", scope: "location", verify_via: "State ABC license lookup", rx: /\b(liquor|alcohol(ic)? beverage|alcohol) licen[cs]e\b/i },
  // Occupational licences issued by a public board/register to the practitioner.
  { key: "architect_license", scope: "professional", holder: true, verify_via: "State architecture board / NCARB lookup", rx: /\b(?<!landscape )architect(ure|ural)? licen[cs]e\b|\bresidential designer registration\b/i },
  { key: "engineer_license", scope: "professional", holder: true, verify_via: "State board of professional engineers lookup (NCEES)", rx: /\b(professional engineer|PE)\b( \(PE\))? licen[cs]e\b|\bengineering registration\b/i },
  { key: "land_surveyor_license", scope: "professional", holder: true, verify_via: "State board of land surveyors lookup", rx: /\b(professional )?land surveyor licen[cs]e\b/i },
  { key: "gas_safe_number", scope: "professional", holder: true, verify_via: "Gas Safe Register engineer check", rx: /\bGas Safe Regist(er|ration)\b/i },
  { key: "uscg_mariner_credential", scope: "professional", holder: true, verify_via: "USCG National Maritime Center credential verification", rx: /\bmerchant mariner\b|\bcaptain('?s)? licen[cs]e\b|\bUSCG (MMC|captain)\b/i },
  { key: "childcare_license", scope: "professional", holder: true, verify_via: "State child care licensing agency / conseil départemental (agrément)", rx: /\bchild ?care licen[cs]e\b|\bagr[ée]ment\b/i },
  // Facility registration of a repair business (e.g. California BAR "ARD").
  { key: "automotive_repair_registration", scope: "location", verify_via: "State automotive repair dealer registry (e.g. CA Bureau of Automotive Repair)", rx: /\bauto(motive)? repair dealer\b/i },
  { key: "dealer_license", scope: "location", verify_via: "State DMV dealer license lookup", rx: /\b(?<!(livestock|secondhand|second-hand|repair) )dealer licen[cs]e\b/i },
  { key: "contractor_license", scope: "location", holder: true, verify_via: "State contractor license board lookup", rx: /\bcontractor('?s)? licen[cs]e\b|Contractors State License Board/i },
  { key: "business_license", scope: "location", verify_via: "State/local business license or SOS registry lookup", rx: /\bbusiness (operating )?licen[cs]e\b|\boperating licen[cs]e\b|\bsales tax (permit|registration)\b/i },
];
// Primary-key preference among keys of the required scope (lower wins):
// individual licensing registries, then generic state licence, then location
// identifiers (Place ID first), then permits/registrations.
const PRIMARY_ORDER = [
  "nmls_id", "npi", "npn_or_producer", "bar_number", "finra_crd", "cpa_license", "architect_license",
  "engineer_license", "land_surveyor_license", "gas_safe_number", "uscg_mariner_credential", "childcare_license",
  "contractor_license", "state_license", "automotive_repair_registration",
  "gbp_place_id", "dealer_license", "liquor_license", "usdot_number", "fdic_cert",
  "ncua_charter", "dea_registration", "irs_ein", "business_license", "domain",
];
// A state (professional) licence is implied by a licence-number credential node
// or the category's own licence label, when no more specific key above matched it.
const STATE_LICENSE_RX = /\b(state |professional |medical |dental |veterinary |nursing |real estate |pharmacy |board )?licen[cs]e (number|#|no\.?|id)\b|\blicen[cs]e #|\bRE License\b|licensing board|Board of (Medicine|Medical|Dentistry|Dental|Nursing|Pharmacy|Veterinary|Optometry|Chiropractic|Psychology|Physical Therapy|Real Estate|Cosmetology|Barbering)|Real Estate Commission|Department of Real Estate|Medical Board/i;

interface IdentityKey {
  key: string;
  scope: string;
  role: "primary" | "secondary";
  verify_via: string;
  evidence: string[];
  conditional: boolean; // every piece of evidence says "if/where applicable"
}

// Identity evidence from the registry: verification-required credential nodes and
// identifier-valued nodes (hasCredential.identifier, identifier, usNPI, taxID).
const IDENT_PROPS = new Set(["hasCredential.identifier", "identifier", "usNPI", "taxID", "hasCredential", "worksFor.hasCredential.identifier", "hasCredential.name"]);
interface Ev {
  text: string;
  src: string;
  scope: string | null; // registry entity_scope; null for category-level evidence
  regulator: boolean; // evidence is a regulator name (compliance.regulated_by)
  licence?: boolean; // a public occupational licence/registration segment (licenceSegments)
  conditional?: boolean;
}
function registryEvidence(gcid: string): Ev[] {
  const out: Ev[] = [];
  for (const { r } of byGcid.get(gcid) ?? []) {
    const prop = r[4] ?? "";
    const isIdent = r[10] === true || (r[7] === "credentials" && IDENT_PROPS.has(prop)) || prop === "usNPI";
    if (isIdent) out.push({ text: `${r[3]} ${prop}`, src: `registry:${r[2]}`, scope: r[9], regulator: false });
  }
  return out;
}
// Keys issued by regulators that license individuals; only these may be implied
// by a regulator name alone.
const LICENSING_KEYS = new Set(["nmls_id", "npn_or_producer", "bar_number", "cpa_license"]);

// Professional licence display format (exp_category_compliance.license_display_format,
// where display_license_on_profile) for categories that allow a professional entity.
// Each alternative ("A # / B # | C #") is classified generically:
//   - public occupational licence: a licence/register/agrément word, not a business,
//     seller, zoning, entertainment, music-rights or food-handler permit, and either a
//     public-issuer word (State, Board, Federal, ...) or not led by a private-body
//     acronym (USEF License, SESAC License are private federations / PROs);
//   - a "Registration" counts only with a public-issuer word (State Wildlife Agency
//     Registration yes; PRO / Yoga Alliance / FRC Registration no);
//   - certifications, memberships, credentials (NASM, PADI, ICF, ASE, FAA Part 107
//     certificate) are not licences: they never become identity keys.
const licenceFormat = new Map<string, string>();
{
  const r = readExport(join(IN, "license_format.json")).rows[0]!;
  const arr = (typeof r["j"] === "string" ? JSON.parse(r["j"] as string) : r["j"]) as [string, string][];
  if (arr.length !== Number(r["n"])) throw new Error("license_format truncated");
  for (const [g, f] of arr) licenceFormat.set(`gcid:${g}`, f);
}
const LICENCE_WORD = /\blicen[cs]e\b|\bregister\b|\bagr[ée]ment\b/i;
const REGISTRATION_WORD = /\bregistration\b/i;
const NOT_OCCUPATIONAL = /\b(business|seller'?s|zoning|entertainment|music|food handler|secondhand|membership|member)\b/i;
const PUBLIC_ISSUER = /\b(state|provincial|federal|government|county|municipal|board|department|agency|commission|council|conseil|USCG|USDA|FAA|CBP|USPTO|IRS|DOJ)\b/i;
const CONDITIONAL = /\b(if|where|as) (applicable|required|operating|state-required)\b|\(if\b|\(where\b/i;
function licenceSegments(fmt: string): { text: string; conditional: boolean }[] {
  const out: { text: string; conditional: boolean }[] = [];
  for (const raw of fmt.split(/\s[|/;]\s|;\s/)) {
    const seg = raw.trim();
    if (!seg || NOT_OCCUPATIONAL.test(seg)) continue;
    const lead = seg.split(/\s+/)[0]!.replace(/[^A-Za-z-]/g, "");
    const privateLead = /^[A-Z][A-Z-]{2,}$/.test(lead) && !PUBLIC_ISSUER.test(lead) && !PUBLIC_ISSUER.test(seg);
    const isLicence = (LICENCE_WORD.test(seg) && !privateLead) || (REGISTRATION_WORD.test(seg) && PUBLIC_ISSUER.test(seg));
    if (isLicence) out.push({ text: seg, conditional: CONDITIONAL.test(seg) });
  }
  return out;
}

const identity = new Map<string, { shape: string | null; keys: IdentityKey[] }>();
for (const c of categories) {
  const allowed = new Set(c.allowed ?? []);
  const ev: Ev[] = [];
  if (c.license_label) ev.push({ text: c.license_label, src: "compliance.license_label", scope: null, regulator: false });
  if (c.cid && c.cid !== "ID") ev.push({ text: c.cid, src: "profile_config.credential_id_label", scope: null, regulator: false });
  for (const reg of c.regulated_by ?? []) ev.push({ text: reg, src: "compliance.regulated_by", scope: null, regulator: true });
  const fmt = allowed.has("professional") ? licenceFormat.get(c.gcid) : undefined;
  for (const seg of fmt ? licenceSegments(fmt) : [])
    ev.push({ text: seg.text, src: "compliance.license_display_format", scope: null, regulator: false, licence: true, conditional: seg.conditional });
  ev.push(...registryEvidence(c.gcid));
  const required = (c.req ?? [])[0] ?? (c.shape === "professional_first" ? "professional" : "location");

  const keys: IdentityKey[] = [];
  const add = (key: string, scope: string, verify_via: string, evidence: string[], conditional = false) => {
    const k = keys.find((x) => x.key === key);
    if (k) {
      for (const e of evidence) if (!k.evidence.includes(e) && k.evidence.length < 4) k.evidence.push(e);
      k.conditional &&= conditional;
    } else keys.push({ key, scope, role: "secondary", verify_via, evidence: evidence.slice(0, 4), conditional });
  };
  const allConditional = (hits: Ev[]) => hits.every((h) => h.conditional === true);
  // Scope: the lexicon default when the category allows it, else the entity_scope
  // the registry evidence was authored at.
  const pickScope = (dflt: string, hits: Ev[]): string => {
    if (allowed.has(dflt)) return dflt;
    const scopes = hits.map((h) => h.scope).filter((x): x is string => !!x && allowed.has(x));
    if (scopes.includes("location")) return "location";
    return scopes[0] ?? (allowed.has("location") ? "location" : "brand");
  };
  const consumed = new Set<Ev>();
  for (const def of KEY_LEXICON) {
    const hits = ev.filter((e) => def.rx.test(e.text) && (!e.regulator || LICENSING_KEYS.has(def.key)));
    if (!hits.length) continue;
    for (const h of hits) consumed.add(h);
    const scope = def.holder && allowed.has(required) ? required : pickScope(def.scope, hits);
    add(def.key, scope, def.verify_via, [...new Set(hits.map((h) => h.src))], allConditional(hits));
  }
  // Generic state licence: licence-number evidence not explained by a more
  // specific key above, unless a professional licensing key already covers it.
  // Public licence segments from the display format count even without a number word.
  const licHits = ev.filter((e) => !consumed.has(e) && (e.licence === true || STATE_LICENSE_RX.test(e.text)));
  if (licHits.length && !keys.some((k) => k.scope === "professional" && LICENSING_KEYS.has(k.key))) {
    const proEvidence = licHits.some((h) => h.scope === "professional" || h.scope === null);
    const scope = allowed.has("professional") && proEvidence ? "professional" : pickScope("location", licHits);
    add("state_license", scope, "State licensing board lookup", [...new Set(licHits.map((h) => h.src))], allConditional(licHits));
  }
  // Location identity: every category that allows a location entity is a Google
  // Business Profile category, so the Place ID identifies a location.
  if (allowed.has("location") || c.shape === "location_first")
    add("gbp_place_id", "location", "Google Places API (place_id)", [c.shape === "location_first" ? "shape:location_first" : "allowed_entity_types:location"]);
  // Brand identity: verified website domain.
  if (allowed.has("brand")) add("domain", "brand", "DNS/website ownership check", ["allowed_entity_types:brand"]);

  // Primary key: the key that identifies the shape's required entity type.
  const scopeRank = (k: IdentityKey) => (k.scope === required ? 0 : k.scope === "location" ? 1 : 2);
  const lexOrder = (k: IdentityKey) => {
    if (required === "location" && k.key === "gbp_place_id") return -1; // a location is identified by its Place ID
    const i = PRIMARY_ORDER.indexOf(k.key);
    return i === -1 ? 99 : i;
  };
  // A licence that applies only "if/where applicable" never identifies the entity.
  keys.sort((a, b) => Number(a.conditional) - Number(b.conditional) || scopeRank(a) - scopeRank(b) || lexOrder(a) - lexOrder(b));
  if (keys[0]) keys[0].role = "primary";
  identity.set(c.gcid, { shape: c.shape, keys });
}

{
  const json: Record<string, unknown> = {};
  const csv = ["gcid,shape,primary_key,primary_scope,all_keys"];
  for (const c of categories) {
    const id = identity.get(c.gcid)!;
    json[c.gcid] = {
      primary: id.keys[0]?.key ?? null,
      keys: id.keys.map((k) => ({ key: k.key, scope: k.scope, role: k.role, verify_via: k.verify_via, evidence: k.evidence, ...(k.conditional ? { conditional: true } : {}) })),
      method_version: "category_brief.v2",
    };
    csv.push([c.gcid, c.shape ?? "", id.keys[0]?.key ?? "", id.keys[0]?.scope ?? "", id.keys.map((k) => k.key).join(";")].join(","));
  }
  writeFileSync(join(OUT, "category_identity_keys.json"), JSON.stringify(json, null, 1) + "\n");
  writeFileSync(join(OUT, "category_identity_keys.csv"), csv.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Interview collections (per category): nodes that describe the same collection
// count once.
// ---------------------------------------------------------------------------
// Several registry nodes can describe one collection (restaurant: "Menu", "Menu PDF
// and Digital Menu", "Children's Menu", "Menu URL" are all hasMenu/menu). In the
// interview a collection is asked once, so:
//   - collection key = canonical schema.org property (supersededBy resolved, so
//     menu -> hasMenu) + entity_scope; volume-stream nodes instead key on the
//     expected-volume table that measures them (every review node draws on the
//     same EAR, every transaction node on the same annual_transactions);
//   - nodes whose own cardinality is few/many each describe the whole collection:
//     the collection range is the MAX of their ranges, never the sum;
//   - nodes whose cardinality is one are single entries of the collection (one
//     catalog entry, one profile link): they add up, and the collection is at
//     least as large as the number of entries;
//   - different canonical properties or scopes are genuinely separate collections
//     (hasMenu vs hasOfferCatalog vs makesOffer).
// Per-node values are unchanged in registry_node_cardinality.csv.gz.
function canonicalProp(p: string): string {
  let x = p;
  const seen = new Set<string>();
  while (supersededBy.has(x) && !seen.has(x)) {
    seen.add(x);
    x = supersededBy.get(x)![0]!;
  }
  return x;
}
const isStreamRule = (rule: string) => /^R[34]_/.test(rule);
interface Collection {
  key: string;
  kind: "interview" | "stream";
  scope: string;
  nodes: number;
  wholeNodes: number;
  entries: number;
  sumMin: number;
  sumMax: number;
  min: number;
  max: number;
  card: Card;
  method: string;
}
const collectionsByGcid = new Map<string, Collection[]>();
let collectionRows = 0;
let collectionBad = 0;
const collCsv = ["gcid,collection,kind,entity_scope,nodes,whole_nodes,entry_nodes,node_sum_min,node_sum_max,collection_min,collection_max,cardinality,method"];
for (const [g, list] of byGcid) {
  const m = new Map<string, Collection & { wMin: number; wMax: number }>();
  for (const { r, d } of list) {
    const stream = isStreamRule(d.rule);
    const base = (r[4] ?? "(none)").split(".")[0]!;
    const scope = r[9] ?? "-";
    const key = stream ? `stream:${d.basis.replace(/\(median\)/, "").replace(/^fixed.*/, "image")}` : canonicalProp(base);
    const mk = `${key}|${scope}`;
    let c = m.get(mk);
    if (!c) m.set(mk, (c = { key, kind: stream ? "stream" : "interview", scope, nodes: 0, wholeNodes: 0, entries: 0, sumMin: 0, sumMax: 0, min: 0, max: 0, card: "one", method: "", wMin: 0, wMax: 0 }));
    c.nodes++;
    c.sumMin += d.min;
    c.sumMax += d.max;
    if (d.cardinality === "one" && !stream) c.entries++;
    else {
      c.wholeNodes++;
      c.wMin = Math.max(c.wMin, d.min);
      c.wMax = Math.max(c.wMax, d.max);
    }
  }
  const out: Collection[] = [];
  for (const c of m.values()) {
    c.min = Math.max(c.wMin, c.entries);
    c.max = Math.max(c.wMax, c.entries);
    // Single-valued properties (additionalProperty, name, ...) are not collections:
    // their nodes are distinct one-value questions, so the group stays "one".
    const single = c.kind === "interview" && c.wholeNodes === 0 && !isMultiValued(c.key);
    c.card = single ? "one" : cardOf(c.max);
    c.method = c.nodes === 1 ? "single_node" : single ? "distinct_single_values" : c.wholeNodes === 0 ? "sum_of_entries" : c.entries === 0 ? "max_of_overlapping_nodes" : "max(whole_nodes, entry_count)";
    if (!(c.min <= c.max && c.max <= c.sumMax && c.min >= 1)) collectionBad++;
    collectionRows += c.nodes;
    const { wMin: _a, wMax: _b, ...pub } = c;
    out.push(pub);
    collCsv.push([g, csvq(c.key), c.kind, c.scope, c.nodes, c.wholeNodes, c.entries, c.sumMin, c.sumMax, c.min, c.max, c.card, csvq(c.method)].join(","));
  }
  collectionsByGcid.set(g, out);
}
writeFileSync(join(OUT, "category_collections.csv.gz"), gzipSync(collCsv.join("\n") + "\n", { level: 9 }));

// ---------------------------------------------------------------------------
// Enrichment flags (report only; enrichment owns the fix)
// ---------------------------------------------------------------------------
// Generic checks that surface model errors the derivation exposes:
//   F1 transaction volume without a transactional conversion action: the category
//      has transaction-record nodes (R3) or annual_transactions > 0, yet none of its
//      conversion_actions is a schema.org TradeAction/PlanAction (order, buy, pay,
//      quote, reserve, schedule; "view ..." schedule actions excluded). Input:
//      in/no_tx_actions.json (export.sql), whose type list must equal the one
//      derived here from the vocabulary.
//   F2 person shape on a place/business name: professional_first while the
//      category's head noun names a place or business (shop, center, studio, ...).
//   F3 place shape on a person name: location_first while the head noun names a
//      practitioner (dentist, physician, plumber, ...).
const TX_ACTION_TYPES = [...parentsOf.keys()]
  .filter((t) => (isA(t, "TradeAction") || isA(t, "PlanAction")) && !isA(t, "CancelAction"))
  .sort();
const noTxRaw = JSON.parse(readFileSync(join(IN, "no_tx_actions.json"), "utf8")) as { tx_action_types: string[]; rows: { n: number; j: [string, string][] }[] };
const noTxTypesMatch = JSON.stringify([...noTxRaw.tx_action_types].sort()) === JSON.stringify(TX_ACTION_TYPES);
const noTx = new Map(noTxRaw.rows[0]!.j.map(([g, a]) => [`gcid:${g}`, a]));
const PLACE_NOUNS = new Set(["shop", "store", "center", "centre", "clinic", "studio", "salon", "agency", "company", "firm", "office", "school", "academy", "hospital", "restaurant", "bar", "cafe", "hotel", "motel", "gym", "spa", "market", "gallery", "museum", "church", "club", "park", "station", "garage", "dealership", "warehouse", "factory", "plant", "supplier", "wholesaler", "manufacturer", "association", "organization", "institute", "laboratory", "lab", "pharmacy", "bakery", "facility", "lounge", "library", "theater", "theatre", "venue", "hall", "court", "rink", "pool", "zoo", "farm", "ranch", "mall", "outlet", "boutique", "depot", "yard", "kennel", "cattery", "stable", "nursery", "camp", "resort", "inn", "lodge", "hostel", "parlor", "parlour", "workshop", "bank", "department", "temple", "mosque", "synagogue", "chapel", "shelter", "college", "university", "practice", "group"]);
const PERSON_NOUNS = new Set(["attorney", "lawyer", "doctor", "physician", "dentist", "surgeon", "nurse", "therapist", "agent", "broker", "consultant", "coach", "instructor", "trainer", "teacher", "tutor", "planner", "designer", "photographer", "artist", "musician", "dj", "chef", "engineer", "architect", "surveyor", "carpenter", "plumber", "electrician", "mechanic", "painter", "welder", "locksmith", "gardener", "landscaper", "inspector", "appraiser", "accountant", "advisor", "adviser", "counselor", "midwife", "doula", "notary", "translator", "interpreter", "investigator", "guide", "groomer", "sitter", "walker", "nanny", "babysitter", "tailor", "dressmaker", "jeweler", "goldsmith", "blacksmith", "cobbler", "upholsterer", "roofer", "mason", "bricklayer", "glazier", "handyman", "installer", "technician", "practitioner", "priest", "pastor", "minister", "rabbi", "imam", "clergyman", "celebrant", "officiant", "healer", "masseur", "masseuse", "barber", "hairdresser", "realtor", "auctioneer", "bookkeeper", "mediator", "solicitor", "barrister", "paralegal", "entertainer", "magician", "performer", "chiropractor", "veterinarian", "optician", "audiologist", "pediatrician", "psychologist", "psychiatrist", "pharmacist", "herbalist", "hypnotherapist"]);
// Head noun = last token before any "of ..." complement (church_of_christ -> church).
const headToken = (gcid: string) => gcid.slice(5).split("_of_")[0]!.split("_").filter(Boolean).pop() ?? "";
// Trade modifiers that make any noun a business (wholesale_florist is a business).
const BUSINESS_MODIFIER = /(^|_)(wholesale|wholesaler|retail|supplier|manufacturer|distributor)(_|$)/;
const isPersonNoun = (t: string) => PERSON_NOUNS.has(t) || /(ologist|iatrist|ician|arian|apist|ist)$/.test(t);
const flagCsv = ["gcid,display_name,shape,flag,detail,evidence"];
const flagCounts: Record<string, number> = {};
const flagged = new Set<string>();
const addFlag = (c: CategoryRow, flag: string, detail: string, evidence: string) => {
  flagCsv.push([c.gcid, csvq(c.display_name ?? ""), c.shape ?? "", flag, csvq(detail), csvq(evidence)].join(","));
  flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  flagged.add(c.gcid);
};
for (const c of categories) {
  const list = byGcid.get(c.gcid) ?? [];
  const txNodes = list.filter(({ d }) => d.rule === "R3_transaction_stream");
  const tx = volByGcid.get(c.gcid)?.tx ?? null;
  if (noTx.has(c.gcid) && (txNodes.length || (tx ?? 0) > 0)) {
    const coll = (collectionsByGcid.get(c.gcid) ?? []).find((x) => x.key === "stream:annual_transactions");
    addFlag(
      c,
      "F1_transaction_volume_without_transactional_conversion",
      `annual_transactions=${tx ?? "null(median)"}; ${txNodes.length} transaction-record node(s)${coll ? ` -> ${coll.min}-${coll.max}/yr` : ""}; no Trade/Plan conversion action`,
      `conversion_actions: ${noTx.get(c.gcid)}; nodes: ${txNodes.map(({ r }) => r[2]).slice(0, 4).join(" ")}`,
    );
  }
  const h = headToken(c.gcid);
  if (c.shape === "professional_first" && PLACE_NOUNS.has(h))
    addFlag(c, "F2_person_shape_on_place_name", `professional_first but head noun "${h}" names a place/business`, `gcid head noun: ${h}`);
  if (c.shape === "location_first" && !PLACE_NOUNS.has(h) && isPersonNoun(h) && !BUSINESS_MODIFIER.test(c.gcid.slice(5)))
    addFlag(c, "F3_place_shape_on_person_name", `location_first but head noun "${h}" names a practitioner`, `gcid head noun: ${h}`);
}
writeFileSync(join(OUT, "enrichment_flags.csv"), flagCsv.join("\n") + "\n");

// ---------------------------------------------------------------------------
// Professional licence audit (professional_first categories)
// ---------------------------------------------------------------------------
// Status per category: the professional key chosen, a licence key held at another
// scope, a conditional licence only, or none -- unlicensed (no public occupational
// licence in the display format: certification, membership or business licence only).
const auditCsv = ["gcid,shape,status,primary_key,licence_key,license_display_format,reason"];
const licensedWithoutKey: string[] = [];
const auditCounts: Record<string, number> = {};
for (const c of categories) {
  if (c.shape !== "professional_first") continue;
  const id = identity.get(c.gcid)!;
  const fmt = licenceFormat.get(c.gcid) ?? "";
  const segs = licenceSegments(fmt);
  const pro = id.keys.find((k) => k.scope === "professional" && !k.conditional);
  const fmtKey = id.keys.find((k) => k.evidence.includes("compliance.license_display_format"));
  let status: string;
  let reason: string;
  if (pro) {
    status = "professional_key";
    reason = `professional-scope key ${pro.key} from ${pro.evidence.join(" + ")}`;
  } else if (fmtKey && !fmtKey.conditional) {
    status = "licence_key_other_scope";
    reason = `licence is issued to the ${fmtKey.scope} (${fmtKey.key}); see enrichment_flags for shape`;
  } else if (fmtKey) {
    status = "conditional_licence_only";
    reason = `licence applies only conditionally ("${segs.find((s) => s.conditional)?.text ?? ""}"); not used as primary`;
  } else {
    status = "none_unlicensed";
    reason = !fmt ? "no licence display format (no licence shown on profile)" : "display format lists only certifications / memberships / business or rights licences";
    if (segs.some((s) => !s.conditional)) licensedWithoutKey.push(c.gcid);
  }
  auditCounts[status] = (auditCounts[status] ?? 0) + 1;
  auditCsv.push([c.gcid, c.shape, status, id.keys[0]?.key ?? "", (pro ?? fmtKey)?.key ?? "", csvq(fmt), csvq(reason)].join(","));
}
writeFileSync(join(OUT, "professional_licence_audit.csv"), auditCsv.join("\n") + "\n");

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------
const noShape = categories.filter((c) => !c.shape).map((c) => c.gcid);
const noKeys = categories.filter((c) => !(identity.get(c.gcid)?.keys.length)).map((c) => c.gcid);
const noRegistry = categories.filter((c) => !byGcid.has(c.gcid)).map((c) => c.gcid);
const proWithoutProKey = categories
  .filter((c) => c.shape === "professional_first" && !identity.get(c.gcid)!.keys.some((k) => k.scope === "professional"))
  .map((c) => c.gcid);
const ruleCounts: Record<string, number> = {};
const cardCounts: Record<string, number> = {};
const medianFallback: Record<string, number> = {};
for (const [, list] of byGcid)
  for (const { d } of list) {
    ruleCounts[d.rule] = (ruleCounts[d.rule] ?? 0) + 1;
    cardCounts[d.cardinality] = (cardCounts[d.cardinality] ?? 0) + 1;
    if (d.basis.includes("median")) medianFallback[d.basis] = (medianFallback[d.basis] ?? 0) + 1;
  }
const keyCounts: Record<string, number> = {};
const primaryCounts: Record<string, number> = {};
for (const [, id] of identity) {
  for (const k of id.keys) keyCounts[k.key] = (keyCounts[k.key] ?? 0) + 1;
  if (id.keys[0]) primaryCounts[id.keys[0].key] = (primaryCounts[id.keys[0].key] ?? 0) + 1;
}
const gates = {
  categories: categories.length,
  registry_rows: registry.length,
  G1_registry_gcids_join_gbp_categories: { pass: regOrphans.size === 0, orphans: [...regOrphans] },
  G1b_every_category_has_registry_rows: { pass: noRegistry.length === 0, missing: noRegistry },
  G1c_every_category_has_shape: { pass: noShape.length === 0, missing: noShape },
  G2_every_category_has_identity_key: { pass: noKeys.length === 0, missing: noKeys },
  G2b_licensed_professional_first_has_licence_key: {
    pass: licensedWithoutKey.length === 0,
    note: "every professional_first category whose licence display format names a public occupational licence has a licence key; the rest are unlicensed trades (see professional_licence_audit.csv)",
    licensed_without_key: licensedWithoutKey,
    audit_status_counts: auditCounts,
    professional_first_without_professional_key: proWithoutProKey.length,
    gcids: proWithoutProKey,
  },
  G3_every_registry_row_has_cardinality: { pass: missingCard === 0 && perRow.length - 1 === registry.length, missing: missingCard },
  G3b_ranges_consistent: { pass: badRange === 0, bad: badRange },
  G3c_gcid_node_slug_unique: { pass: dupKeys === 0, duplicates: dupKeys },
  G3d_collections_cover_every_node_once: { pass: collectionRows === registry.length && collectionBad === 0, rows: collectionRows, bad: collectionBad },
  G4_tx_action_types_match_vocabulary: { pass: noTxTypesMatch, types: TX_ACTION_TYPES },
  enrichment_flag_counts: { ...flagCounts, categories_flagged: flagged.size },
  distinct_signatures: sigRows.size,
  cardinality_counts: cardCounts,
  rule_counts: ruleCounts,
  median_fallback_rows: medianFallback,
  identity_key_counts: keyCounts,
  primary_key_counts: primaryCounts,
};
writeFileSync(join(OUT, "gates.json"), JSON.stringify(gates, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 20-category human-review sample
// ---------------------------------------------------------------------------
// Review list only (presentation, not behaviour). There is no gcid:school, so
// public_school stands in for "school".
const SAMPLE_WANT = [
  "restaurant", "mexican_restaurant", "mortgage_lender", "insurance_agency", "dentist", "barber_shop",
  "plumber", "lawyer", "hotel", "real_estate_agents", "car_dealer", "church", "gym", "veterinarian",
  "accountant", "florist", "hospital", "farm", "public_school", "auto_repair_shop",
];
const resolve = (want: string): string | null => (gbpSet.has(`gcid:${want}`) ? `gcid:${want}` : null);
const md: string[] = [
  "# Category brief — 20-category review sample",
  "",
  "Generated by `tools/category_brief/derive.ts` (proposal only; nothing written to the DB).",
  "",
  "- **Interview collections**: one row per collection NORA asks about, keyed by canonical",
  "  schema.org property (supersededBy resolved: menu → hasMenu) and entity scope. Nodes that",
  "  each describe the whole collection count once (range = max of their ranges); single-entry",
  "  nodes add up. `n` = nodes in the collection; when the old per-node sum differs it is shown",
  "  as `Σnodes`. Per-node values are unchanged in `registry_node_cardinality.csv.gz`; all",
  "  collections are in `category_collections.csv.gz`.",
  "- **Volume streams**: system/feed nodes measured by the same expected-volume table",
  "  (EAR/EAA/EAP/EAQ/EAV, annual_transactions) are one stream: range = max, not sum.",
  "- **Flags**: enrichment_flags.csv entries (model errors for enrichment to fix; not applied).",
  "- No `gcid:school` exists among the 4,041 GBP categories; `public_school` is shown instead.",
  "",
  "| # | category | shape | identity keys (primary in bold) | interview collections (top 6) | volume streams (top 3) | flags |",
  "|---|---|---|---|---|---|---|",
];
const flagsByGcid = new Map<string, string[]>();
for (const line of flagCsv.slice(1)) {
  const g = line.split(",")[0]!;
  const f = line.match(/,(F\d_[a-z_]+),/)?.[1] ?? "";
  flagsByGcid.set(g, [...(flagsByGcid.get(g) ?? []), f]);
}
const rank = { one: 0, few: 1, many: 2 } as const;
const keyList = (g: string) =>
  identity
    .get(g)!
    .keys.map((k) => `${k.role === "primary" ? "**" : ""}${k.key}${k.role === "primary" ? "**" : ""} (${k.scope}${k.conditional ? ", conditional" : ""})`)
    .join(", ");
let i = 0;
for (const want of SAMPLE_WANT) {
  const g = resolve(want);
  i++;
  if (!g) {
    md.push(`| ${i} | ${want} (not a gcid) | — | — | — | — | — |`);
    continue;
  }
  const id = identity.get(g)!;
  const colls = collectionsByGcid.get(g) ?? [];
  const order = (a: Collection, b: Collection) => rank[b.card] - rank[a.card] || b.max - a.max || b.nodes - a.nodes;
  const rng = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
  const fmt = (c: Collection) =>
    `${c.key.replace(/^stream:/, "")}${c.scope !== "location" && c.scope !== "-" ? ` (${c.scope})` : ""} — ${c.nodes}n, ${c.card}, ${rng(c.min, c.max)}` +
    (c.sumMin !== c.min || c.sumMax !== c.max ? ` (Σnodes ${rng(c.sumMin, c.sumMax)})` : "");
  const tops = colls.filter((c) => c.kind === "interview").sort(order).slice(0, 6).map(fmt).join("<br>");
  const strs = colls.filter((c) => c.kind === "stream").sort(order).slice(0, 3).map(fmt).join("<br>") || "—";
  md.push(`| ${i} | ${g.slice(5)} | ${id.shape ?? "—"} | ${keyList(g)} | ${tops} | ${strs} | ${(flagsByGcid.get(g) ?? []).join("<br>") || "—"} |`);
}
// Licence spot-check: professional_first trades from the review (presentation only).
const LICENCE_SPOT = ["architect", "carpenter", "auto_repair_shop", "mechanic", "gas_engineer", "structural_engineer", "surveyor", "tattoo_artist", "babysitter", "dj", "artist", "yoga_instructor", "photographer"];
md.push("", "## Licence spot-check (professional_first)", "", "| category | status | identity keys | licence display format | reason |", "|---|---|---|---|---|");
for (const w of LICENCE_SPOT) {
  const row = auditCsv.find((l) => l.startsWith(`gcid:${w},`));
  if (!row) continue;
  const status = row.split(",")[2];
  const fmtv = licenceFormat.get(`gcid:${w}`) ?? "—";
  const reason = row.slice(row.lastIndexOf(",") + 1).replace(/^"|"$/g, "");
  md.push(`| ${w} | ${status} | ${keyList(`gcid:${w}`)} | ${fmtv} | ${reason} |`);
}
md.push(
  "",
  "## Gate summary",
  "",
  "```json",
  JSON.stringify(
    {
      G1: gates.G1_registry_gcids_join_gbp_categories.pass,
      G1b: gates.G1b_every_category_has_registry_rows.pass,
      G1c: gates.G1c_every_category_has_shape.pass,
      G2: gates.G2_every_category_has_identity_key.pass,
      G2b: gates.G2b_licensed_professional_first_has_licence_key.pass,
      G2b_audit: auditCounts,
      G3: gates.G3_every_registry_row_has_cardinality.pass,
      G3b: gates.G3b_ranges_consistent.pass,
      G3c: gates.G3c_gcid_node_slug_unique.pass,
      G3d: gates.G3d_collections_cover_every_node_once.pass,
      G4: gates.G4_tx_action_types_match_vocabulary.pass,
      enrichment_flags: gates.enrichment_flag_counts,
      cardinality_counts: cardCounts,
    },
    null,
    2,
  ),
  "```",
  "",
);
writeFileSync(join(OUT, "review_sample_20.md"), md.join("\n"));

console.log(JSON.stringify({ ...gates, G2b_licensed_professional_first_has_licence_key: { ...gates.G2b_licensed_professional_first_has_licence_key, gcids: undefined } }, null, 2));
const failed = Object.entries(gates).filter(([k, v]) => /^G\d/.test(k) && !(v as { pass: boolean }).pass).map(([k]) => k);
if (failed.length) {
  console.error(`GATES FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
