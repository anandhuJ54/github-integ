import type { EntityBrief } from "@/lib/category-brief";
import { baseProp, hostTokens, nodeTypeFor, resolveNode, tokens, type Resolved } from "./match";
import type { CandidateFacts, ExtractMethod, ProposedNode } from "./types";
import { matchVocabulary } from "./match";

/*
 * Deterministic pass (no model): JSON-LD properties → registry nodes by
 * schema_property, sameAs → presence nodes, credentials → hasCredential nodes (+ the
 * brief's credential identity key), NAP → identity nodes. Only properties the
 * category brief models are kept — the brief drives everything.
 */

export type Fact = {
  /** schema.org property the fact was found under. */
  prop: string;
  value: string;
  hint: string[];
  evidence: string;
  confidence: number;
  method: ExtractMethod;
  item?: {
    name: string;
    price?: string | null;
    section?: string | null;
    description?: string | null;
    vocabulary_term?: string | null;
  };
  extra?: Record<string, unknown>;
};

const CONF = { jsonld: 0.9, sameAs: 0.9, nap: 0.85, credential: 0.8 } as const;

/** Structural web types that never describe the entity itself. */
const NON_ENTITY_TYPES = new Set([
  "WebPage", "WebSite", "BreadcrumbList", "ListItem", "SearchAction", "ReadAction",
  "ImageObject", "VideoObject", "SiteNavigationElement", "WPHeader", "WPFooter",
  "CollectionPage", "AboutPage", "ContactPage", "FAQPage", "Question", "Answer",
  "Article", "BlogPosting", "NewsArticle", "ItemList", "EntryPoint",
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const types = (o: Obj) => arr(o["@type"]).filter((t): t is string => typeof t === "string");
const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ev = (prop: string, frag: unknown) => clip(`JSON-LD ${prop}: ${JSON.stringify(frag)}`);

/** Entity objects in a page's JSON-LD (flattens @graph, skips structural web types). */
export function entityObjects(jsonld: unknown[]): Obj[] {
  const out: Obj[] = [];
  const visit = (v: unknown) => {
    for (const x of arr(v)) {
      if (!isObj(x)) continue;
      if (x["@graph"]) visit(x["@graph"]);
      const t = types(x);
      if (t.length && t.every((y) => NON_ENTITY_TYPES.has(y))) continue;
      if (t.length) out.push(x);
    }
  };
  visit(jsonld);
  return out;
}

function formatAddress(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (!isObj(v)) return null;
  const parts = [
    v.streetAddress,
    v.addressLocality,
    [str(v.addressRegion), str(v.postalCode)].filter(Boolean).join(" "),
    v.addressCountry && typeof v.addressCountry === "string" ? v.addressCountry : null,
  ]
    .map(str)
    .filter((s): s is string => !!s);
  return parts.length ? parts.join(", ") : null;
}

function priceOf(o: Obj): string | null {
  for (const off of arr(o.offers)) {
    if (!isObj(off)) continue;
    const p = str(off.price);
    if (p) return `${str(off.priceCurrency) === "USD" || !off.priceCurrency ? "$" : ""}${p}`;
  }
  return str(o.price);
}

/** Summarise a nested value for a single-valued property. */
function scalar(prop: string, v: unknown): string | null {
  if (baseProp(prop) === "address") return formatAddress(v);
  if (isObj(v)) {
    if (baseProp(prop) === "geo" && v.latitude != null && v.longitude != null)
      return `${v.latitude},${v.longitude}`;
    return str(v.name) ?? str(v.url) ?? str(v.text) ?? str(v["@id"]) ?? null;
  }
  return str(v);
}

function menuFacts(prop: string, menu: unknown): Fact[] {
  const facts: Fact[] = [];
  const walk = (node: unknown, section: string | null) => {
    for (const x of arr(node)) {
      if (typeof x === "string") {
        // hasMenu as a URL: a single menu link, not an item.
        facts.push({ prop, value: x, hint: tokens("menu"), evidence: ev(prop, x), confidence: CONF.jsonld, method: "deterministic" });
        continue;
      }
      if (!isObj(x)) continue;
      const t = types(x);
      const sec = t.includes("MenuSection") ? (str(x.name) ?? section) : section;
      if (x.hasMenuSection) walk(x.hasMenuSection, sec);
      if (x.hasMenuItem) walk(x.hasMenuItem, sec);
      if (t.includes("MenuItem") || (!t.length && x.name && !x.hasMenuItem && !x.hasMenuSection)) {
        const name = str(x.name);
        if (!name) continue;
        facts.push({
          prop: "hasMenuItem",
          value: name,
          hint: tokens(name),
          evidence: ev("hasMenuItem", x),
          confidence: CONF.jsonld,
          method: "deterministic",
          item: { name, price: priceOf(x), section: sec, description: str(x.description) },
        });
      }
    }
  };
  walk(menu, null);
  return facts;
}

function offerFacts(prop: string, v: unknown): Fact[] {
  const facts: Fact[] = [];
  const walk = (x: unknown) => {
    for (const o of arr(x)) {
      if (typeof o === "string") {
        facts.push({ prop, value: o, hint: tokens(o), evidence: ev(prop, o), confidence: CONF.jsonld, method: "deterministic", item: { name: o } });
        continue;
      }
      if (!isObj(o)) continue;
      if (o.itemListElement) {
        walk(o.itemListElement);
        continue;
      }
      const inner = isObj(o.itemOffered) ? o.itemOffered : isObj(o.item) ? o.item : o;
      const name = str(inner.name) ?? str(o.name);
      if (!name) continue;
      facts.push({
        prop,
        value: name,
        hint: tokens(name),
        evidence: ev(prop, o),
        confidence: CONF.jsonld,
        method: "deterministic",
        item: { name, price: priceOf(o), description: str(inner.description) ?? str(o.description) },
      });
    }
  };
  walk(v);
  return facts;
}

function credentialFact(c: { text: string; identifier?: string | null; issuer?: string | null; validIn?: string | null }, evidence: string, confidence: number): Fact[] {
  const facts: Fact[] = [
    {
      prop: "hasCredential",
      value: c.text,
      hint: tokens(`${c.text} ${c.issuer ?? ""}`),
      evidence,
      confidence,
      method: "deterministic",
      item: { name: c.text },
      extra: { identifier: c.identifier ?? null, issuer: c.issuer ?? null, valid_in: c.validIn ?? null },
    },
  ];
  if (c.identifier)
    facts.push({
      prop: "hasCredential.identifier",
      value: c.identifier,
      hint: tokens(`${c.text} identifier number`),
      evidence,
      confidence,
      method: "deterministic",
      extra: { credential: c.text, issuer: c.issuer ?? null, valid_in: c.validIn ?? null },
    });
  return facts;
}

/** All deterministic facts on one page (before brief resolution). */
export function deterministicFacts(page: CandidateFacts): Fact[] {
  const facts: Fact[] = [];
  for (const o of entityObjects(page.jsonld)) {
    for (const [prop, v] of Object.entries(o)) {
      if (prop.startsWith("@") || v == null) continue;
      if (prop === "hasMenu" || prop === "menu" || prop === "hasMenuSection" || prop === "hasMenuItem") {
        facts.push(...menuFacts(prop, v));
      } else if (prop === "makesOffer" || prop === "hasOfferCatalog" || prop === "availableService") {
        facts.push(...offerFacts(prop, v));
      } else if (prop === "sameAs") {
        for (const u of arr(v).map(str).filter((s): s is string => !!s))
          facts.push({ prop, value: u, hint: hostTokens(u), evidence: ev(prop, u), confidence: CONF.jsonld, method: "deterministic" });
      } else if (prop === "hasCredential" || prop === "hasCertification") {
        for (const c of arr(v)) {
          const text = isObj(c) ? (str(c.name) ?? str(c.credentialCategory)) : str(c);
          if (!text) continue;
          const id = isObj(c) ? (str(c.identifier) ?? (isObj(c.identifier) ? str(c.identifier.value) : null)) : null;
          const issuer = isObj(c) && isObj(c.recognizedBy) ? str(c.recognizedBy.name) : null;
          const validIn = isObj(c) && isObj(c.validIn) ? str(c.validIn.name) : null;
          facts.push(...credentialFact({ text, identifier: id, issuer, validIn }, ev(prop, c), CONF.jsonld));
        }
      } else {
        for (const x of arr(v)) {
          const value = scalar(prop, x);
          if (!value) continue;
          facts.push({ prop, value, hint: tokens(`${prop} ${value}`), evidence: ev(prop, x), confidence: CONF.jsonld, method: "deterministic" });
        }
      }
    }
  }
  for (const s of page.sameAs ?? []) {
    const u = str(s.url);
    if (u)
      facts.push({
        prop: "sameAs",
        value: u,
        hint: [...hostTokens(u), ...tokens(s.platform)],
        evidence: `${s.via === "page_link" ? "page link" : "JSON-LD sameAs"}: ${u}`,
        confidence: CONF.sameAs,
        method: "deterministic",
      });
  }
  // JSON-LD credentials were read above; organize's page-text credentials add the rest.
  for (const c of page.credentials ?? [])
    if (c.via !== "jsonld_hasCredential" && str(c.text))
      facts.push(
        ...credentialFact(
          {
            text: c.text,
            identifier: c.parsed?.number ?? null,
            issuer: c.parsed?.issuer ?? c.label ?? null,
            validIn: c.parsed?.state ?? null,
          },
          clip(c.text),
          CONF.credential,
        ),
      );
  const nap = page.nap;
  const napParts: [string, string | null][] = [
    ["name", str(nap?.name)],
    ["address", nap?.address ? (formatAddress(nap.address) ?? str(nap.address.text)) : null],
    ["telephone", str(nap?.phone)],
  ];
  for (const [prop, value] of napParts)
    if (value)
      facts.push({ prop, value, hint: tokens(prop), evidence: `NAP ${prop}: ${value}`, confidence: CONF.nap, method: "deterministic" });
  return facts;
}

/** Turn one fact into a ProposedNode against the entity brief (null = brief does not model it). */
export function toProposal(
  eb: EntityBrief,
  fact: Fact,
  page: Pick<CandidateFacts, "source_url" | "fetched_at">,
  resolved?: Resolved | null,
): ProposedNode | null {
  const r = resolved ?? resolveNode(eb, fact.prop, fact.hint);
  if (!r) return null;
  const { node, collection } = r;
  const cardinality = node?.cardinality ?? collection?.cardinality ?? "one";
  const inCollection = cardinality !== "one" && collection ? collection : null;
  const vocab = inCollection?.vocabulary ?? [];
  const proposed = fact.item?.vocabulary_term;
  const vocabulary_term =
    (proposed && vocab.includes(proposed) ? proposed : null) ??
    (vocab.length ? matchVocabulary(fact.item?.name ?? fact.value, vocab) : null);
  const schemaProperty = node?.schemaProperty ?? r.tier;
  const extracted: Record<string, unknown> = {
    value: fact.value,
    ...(fact.item
      ? {
          name: fact.item.name,
          price: fact.item.price ?? null,
          section: fact.item.section ?? null,
          description: fact.item.description ?? null,
        }
      : {}),
    ...(fact.extra ?? {}),
    collection: inCollection?.key ?? null,
    vocabulary_term,
    found_under: fact.prop,
  };
  return {
    registry_node_id: node?.nodeId ?? null,
    registry_node_slug: node?.nodeSlug ?? null,
    node_type: nodeTypeFor(fact.prop),
    schema_property: schemaProperty,
    ring: node?.ring ?? inCollection?.rings[0] ?? null,
    title: fact.item?.name ?? fact.value,
    value: fact.value,
    extracted_data: extracted,
    source_url: page.source_url,
    fetched_at: page.fetched_at,
    confidence: vocabulary_term && fact.method === "haiku" ? Math.min(1, fact.confidence + 0.1) : fact.confidence,
    method: fact.method,
    evidence: fact.evidence,
    cardinality_group: {
      collection: inCollection?.key ?? null,
      cardinality: inCollection ? inCollection.cardinality : "one",
      vocabulary_term,
    },
  };
}
