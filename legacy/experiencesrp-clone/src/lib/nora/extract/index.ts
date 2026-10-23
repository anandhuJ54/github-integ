import { entityBrief, type CategoryBrief, type Collection } from "@/lib/category-brief";
import { deterministicFacts, toProposal, type Fact } from "./deterministic";
import { itemPropFor, normalizeValue, resolveNode, squash, tokens } from "./match";
import type {
  CandidateFacts,
  Conflict,
  ExtractResult,
  LlmCollectionRequest,
  LlmExtractFn,
  LlmItem,
  ProposedNode,
} from "./types";

export type * from "./types";
export { deterministicFacts } from "./deterministic";

/*
 * Category-aware extractor. Everything category-specific comes from the
 * CategoryBrief (collections, cardinality + expected counts, vocabulary): there is
 * no per-category code. Order: deterministic mapping first; then ONE Haiku call per
 * page, only for collections the deterministic pass left empty; every Haiku value
 * must quote page text or it is dropped.
 */

/** Connection methods whose facts can appear on the entity's own web pages. */
const PAGE_OBSERVABLE = new Set(["manual", "etl"]);
const CONF_HAIKU = 0.6;

const pageText = (p: CandidateFacts) =>
  squash(p.text.map((b) => b.text).join("\n"));

/** Collections worth asking the model for on this page. */
export function llmCollections(
  collections: Collection[],
  filled: Set<string>,
): LlmCollectionRequest[] {
  return collections
    .filter((c) => !filled.has(c.key) && c.connectionMethods.some((m) => PAGE_OBSERVABLE.has(m)))
    .map((c) => ({
      key: c.key,
      label: c.label,
      cardinality: c.cardinality,
      expected: c.expectedCount,
      vocabulary: c.vocabulary,
    }));
}

/** Keep only items whose evidence is verbatim page text and whose name is inside it. */
export function validateLlmItems(
  page: CandidateFacts,
  collection: Collection,
  items: LlmItem[],
): { kept: LlmItem[]; rejected: { name: string; reason: string }[] } {
  const text = pageText(page);
  const kept: LlmItem[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const onPage = (s: string | null | undefined) => (s && text.includes(squash(s)) ? s : null);
  for (const it of items.slice(0, collection.expectedCount.max)) {
    const name = (it.name ?? "").trim();
    const evidence = squash(it.evidence ?? "");
    if (!name) continue;
    if (evidence.length < 3 || !text.includes(evidence)) {
      rejected.push({ name, reason: "evidence not found in page text" });
      continue;
    }
    if (!evidence.includes(squash(name))) {
      rejected.push({ name, reason: "name not inside its evidence" });
      continue;
    }
    kept.push({
      name,
      evidence: it.evidence.trim(),
      price: it.price && evidence.includes(squash(it.price)) ? it.price : null,
      detail: onPage(it.detail),
      section: onPage(it.section),
      vocabulary_term:
        it.vocabulary_term && collection.vocabulary.includes(it.vocabulary_term)
          ? it.vocabulary_term
          : null,
    });
  }
  return { kept, rejected };
}

/** Dedupe proposals and split single-valued nodes with several values into conflicts. */
export function mergeProposals(all: ProposedNode[]): { nodes: ProposedNode[]; conflicts: Conflict[] } {
  const groupKey = (p: ProposedNode) =>
    p.registry_node_slug ?? `${p.node_type}:${p.schema_property}`;
  const best = new Map<string, ProposedNode>();
  for (const p of all) {
    const k = `${groupKey(p)}|${p.cardinality_group.collection ?? ""}|${normalizeValue(p.schema_property, p.value)}`;
    const cur = best.get(k);
    if (!cur || p.confidence > cur.confidence) best.set(k, p);
  }
  const ones = new Map<string, ProposedNode[]>();
  const nodes: ProposedNode[] = [];
  for (const p of best.values()) {
    if (p.cardinality_group.cardinality !== "one") {
      nodes.push(p);
      continue;
    }
    const k = groupKey(p);
    ones.set(k, [...(ones.get(k) ?? []), p]);
  }
  const conflicts: Conflict[] = [];
  for (const [key, ps] of ones) {
    if (ps.length === 1) {
      nodes.push(ps[0]);
      continue;
    }
    const top = ps[0];
    conflicts.push({
      key,
      registry_node_id: top.registry_node_id,
      registry_node_slug: top.registry_node_slug,
      node_type: top.node_type,
      schema_property: top.schema_property,
      candidates: [...ps]
        .sort((a, b) => b.confidence - a.confidence)
        .map((p) => ({
          value: p.value,
          evidence: p.evidence,
          source_url: p.source_url,
          method: p.method,
          confidence: p.confidence,
        })),
    });
  }
  return { nodes, conflicts };
}

export async function extractFacts(args: {
  brief: CategoryBrief;
  entityType?: string | null;
  pages: CandidateFacts[];
  /** Haiku call; omit for a deterministic-only (model-free) run. */
  llm?: LlmExtractFn | null;
}): Promise<ExtractResult> {
  const eb = entityBrief(args.brief, args.entityType);
  if (!eb) throw new Error(`category ${args.brief.gcid} has no entity type ${args.entityType}`);
  const proposals: ProposedNode[] = [];
  const stats = { deterministic: 0, haiku: 0, pages: args.pages.length, llm_calls: 0 };

  for (const page of args.pages)
    for (const f of deterministicFacts(page)) {
      const p = toProposal(eb, f, page);
      if (p) proposals.push(p);
    }
  stats.deterministic = proposals.length;

  const filled = new Set(
    proposals.map((p) => p.cardinality_group.collection).filter((k): k is string => !!k),
  );
  const requested = llmCollections(eb.collections, filled);
  const rejected: ExtractResult["rejected"] = [];

  if (args.llm && requested.length) {
    for (const page of args.pages) {
      if (page.blocked || !page.text.some((b) => b.text.trim())) continue;
      stats.llm_calls++;
      const out = await args.llm({ page, categoryName: args.brief.displayName, collections: requested });
      for (const req of requested) {
        const collection = eb.collections.find((c) => c.key === req.key)!;
        const { kept, rejected: rej } = validateLlmItems(page, collection, out[req.key] ?? []);
        rejected.push(...rej.map((r) => ({ collection: req.key, ...r })));
        const prop = itemPropFor(collection);
        for (const it of kept) {
          const fact: Fact = {
            prop,
            value: it.name,
            hint: tokens(it.name),
            evidence: it.evidence,
            confidence: CONF_HAIKU,
            method: "haiku",
            item: {
              name: it.name,
              price: it.price,
              section: it.section,
              description: it.detail,
              vocabulary_term: it.vocabulary_term,
            },
          };
          const p = toProposal(eb, fact, page, resolveNode(eb, prop, fact.hint, collection));
          if (p) {
            proposals.push(p);
            stats.haiku++;
          }
        }
      }
    }
  }

  const { nodes, conflicts } = mergeProposals(proposals);
  return {
    gcid: args.brief.gcid,
    entity_type: eb.type,
    nodes,
    conflicts,
    llm_requested: requested.map((r) => r.key),
    rejected,
    stats,
  };
}

/** Brief entity type → graph_nodes.entity_type (check: professional | organization | concept). */
export function graphEntityType(briefType: string): "professional" | "organization" {
  return briefType === "professional" ? "professional" : "organization";
}
