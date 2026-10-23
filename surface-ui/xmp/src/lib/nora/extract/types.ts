import type { Cardinality } from "@v3/xmp/lib/category-brief";

/*
 * Extractor contract. CandidateFacts is produced by the organize step
 * (src/lib/nora/organize/types.ts) — one definition, re-exported here.
 */
import type { CandidateFacts } from "@v3/xmp/lib/nora/organize/types";
export type {
  CandidateFacts,
  CredentialCandidate,
  SameAsLink,
  TextBlock,
} from "@v3/xmp/lib/nora/organize/types";

export type ExtractMethod = "deterministic" | "haiku";

export type ProposedNode = {
  /** exp_vertical_node_registry.id when the brief carries it (graph_nodes.node_registry_id). */
  registry_node_id: string | null;
  registry_node_slug: string | null;
  /** graph_nodes.node_type — generic across categories (product_service, credential, …). */
  node_type: string;
  schema_property: string;
  /** Brief ring key (one of the 10 rings); the DB keeps it only if exp_ring knows it. */
  ring: string | null;
  title: string;
  value: string;
  extracted_data: Record<string, unknown>;
  source_url: string;
  fetched_at: string;
  confidence: number;
  method: ExtractMethod;
  /** Verbatim source text the value was read from — every value cites one. */
  evidence: string;
  cardinality_group: {
    /** Brief collection key (offers, credentials, …); null for single-valued identity facts. */
    collection: string | null;
    cardinality: Cardinality;
    /** Vocabulary term the item matched (few/many collections with vocabulary). */
    vocabulary_term: string | null;
  };
};

export type ConflictCandidate = {
  value: string;
  evidence: string;
  source_url: string;
  method: ExtractMethod;
  confidence: number;
};

/** A single-valued ("one") node with more than one distinct value — for the resolve-conflicts step. */
export type Conflict = {
  key: string;
  registry_node_id: string | null;
  registry_node_slug: string | null;
  node_type: string;
  schema_property: string;
  candidates: ConflictCandidate[];
};

export type ExtractResult = {
  gcid: string;
  entity_type: string;
  nodes: ProposedNode[];
  conflicts: Conflict[];
  /** Collections the deterministic pass left empty (the only ones sent to Haiku). */
  llm_requested: string[];
  /** Haiku items dropped because their evidence/value was not found in the page text. */
  rejected: { collection: string; name: string; reason: string }[];
  stats: { deterministic: number; haiku: number; pages: number; llm_calls: number };
};

/** Haiku's per-collection answer (validated against page text before use). */
export type LlmItem = {
  name: string;
  detail: string | null;
  price: string | null;
  section: string | null;
  vocabulary_term: string | null;
  evidence: string;
};

export type LlmCollectionRequest = {
  key: string;
  label: string;
  cardinality: Cardinality;
  expected: { min: number; max: number };
  vocabulary: string[];
};

/** Injectable model call: one call per page; returns items keyed by collection key. */
export type LlmExtractFn = (args: {
  page: CandidateFacts;
  categoryName: string;
  collections: LlmCollectionRequest[];
}) => Promise<Record<string, LlmItem[]>>;
