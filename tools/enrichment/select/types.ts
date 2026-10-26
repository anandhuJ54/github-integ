// Data contract for the keyword-lane selection engine. See README.md.
// Everything here is plain JSON-serialisable data: no classes, no Dates, no I/O.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

/** A search-evidence source. Any string is accepted; these are the four the pipeline emits. */
export type SourceName = "keyword_ideas" | "competitor" | "autocomplete" | "lookup" | (string & {});

/** Candidate term collected from one source. Same term may appear many times (once per source/domain). */
export interface Candidate {
  term: string;
  /** Monthly searches. null = the source returned no volume (NEVER treated as zero). */
  volume: number | null;
  source: SourceName;
  /** competitor-ranked source: the domain that ranks for the term. */
  domain?: string;
  /** autocomplete source: 0-based position in the suggestion list (0 = first suggestion). */
  position?: number;
  /** ISO date the volume was measured (optional; falls back to config.volumeAsOf). */
  volume_as_of?: string | null;
}

/** An existing keyword row (exp_taxonomy). Only `id` and `term` are required; the rest is used when present. */
export interface ExistingRow {
  id: string;
  term: string;
  term_display?: string | null;
  term_slug?: string | null;
  level?: string | null;
  search_volume_monthly?: number | null;
  volume_as_of?: string | null;
  volume_source?: string | null;
  search_intent?: string | null;
  priority?: number | null;
  validated?: boolean | null;
  [k: string]: unknown;
}

/** Decision supplied by the judge component. The library never decides brands/ambiguity itself. */
export interface JudgeResult {
  term: string;
  decision: "keep" | "exclude";
  /** Required for `exclude` (brand, other_category, off_intent, geo, amenity, compliance, portal_owned, informational ...). */
  reason_code: string;
  /** Family used for per-family caps and cluster collapse. Modifiers (near me, best ...) are tags, never families. */
  family: string;
  /** exclude only: the lane the term belongs in instead (turns RETIRE into MOVE). */
  to_lane?: string;
  /** keep only: optional taxonomy concept (passed through to the add payload). */
  concept_slug?: string;
}

export type JudgeLookup = (term: string) => JudgeResult | undefined;

export interface TagSpec {
  tag: string;
  /** Regex source (case-insensitive, matched against the canonical wording). Defaults to the tag text, whole-word, hyphen/space tolerant, optional plural. */
  pattern?: string;
}

export interface SelectConfig {
  /** Number of keywords to select (default 50). */
  n: number;
  /** Tier A volume floor (default 300). */
  floor: number;
  /** Max Tier B (hidden volume) terms (default 12). */
  tierBCap: number;
  /** Tier B: autocomplete position <= this qualifies on its own (default 4). */
  tierBMaxPosition: number;
  /** Tier B: autocomplete position <= this qualifies when two or more distinct sources agree (default = tierBMaxPosition). */
  tierBCorroboratedMaxPosition: number;
  familyCap: number;
  headFamilyCap: number;
  /** Name of the head family. Default: family of the highest-volume eligible term. */
  headFamily?: string;
  informationalCap: number;
  /** Intent labels counted as informational (case-insensitive). */
  informationalIntents: string[];
  /** Existing wording wins when its volume >= ratio * best variant volume (default 0.9). */
  canonicalExistingRatio: number;
  bandHigh: number;
  bandMedium: number;
  /** Cluster collapse: token Jaccard threshold (default 0.34). */
  clusterJaccard: number;
  /** Cluster collapse via same family also needs this many shared non-NEAR tokens (default 1; 0 = literal "same family"). */
  clusterFamilyMinSharedTokens: number;
  /** Candidate with no judge result: 'skip' (default, listed in result.unjudged) or 'keep' (family ''). */
  unjudgedCandidates: "skip" | "keep";
  tags: Array<string | TagSpec>;
  /** A plural token directly before one of these heads is singularised in the canonical wording ("weeds store" -> "weed store"). */
  pluralModifierHeads: string[];
  /** Judge reason_code -> destination lane for exclusions that are moves, not retirements. */
  moveLaneByReason: Record<string, string>;
  /** exp_taxonomy level for the keyword lane. */
  keywordLevel: string;
  entityScope?: string;
  /** Default volume_as_of for candidates that do not carry their own. */
  volumeAsOf?: string | null;
}

export interface SelectInput {
  gcid: string;
  existing: ExistingRow[];
  candidates: Candidate[];
  /** term -> intent label (head/local/service/transactional/question/informational/comparison/urgency). */
  intents?: Record<string, string>;
  /** term -> appears in a Google map pack. */
  local_pack?: Record<string, boolean>;
  /** Judge output: array of results or a lookup function. */
  judge: JudgeResult[] | JudgeLookup;
  config?: Partial<SelectConfig>;
}

export type Tier = "A" | "B";
export type Band = "High" | "Medium" | "Low" | "Unknown";
export type CanonicalBasis = "existing" | "autocomplete" | "shortest";

export type ClusterMember = {
  term: string;
  key: string;
  volume: number | null;
  row_ids: string[];
};

export interface Evidence {
  sources: string[];
  domains: string[];
  volume: number | null;
  volume_origin: "candidates" | "existing" | "none";
  volume_source: string | null;
  volume_as_of: string | null;
  variants: Array<{ term: string; volume: number | null }>;
  ac_best_position: number | null;
  family: string | null;
  judge: { decision: "keep" | "exclude"; reason_code: string } | null;
  judge_conflict: boolean;
  intent: string | null;
  local_pack: boolean;
  local_intent: boolean;
  tags: string[];
  canonical_basis: CanonicalBasis;
  tier?: Tier;
  hidden_volume?: boolean;
  band?: Band;
  rank?: number;
  cluster?: ClusterMember[];
  [k: string]: Json | undefined;
}

export interface SelectedKeyword {
  rank: number;
  term: string;
  key: string;
  tier: Tier;
  volume: number | null;
  hidden_volume: boolean;
  band: Band;
  family: string;
  intent: string | null;
  tags: string[];
  local_intent: boolean;
  local_pack: boolean;
  source: string;
  volume_source: string | null;
  volume_as_of: string | null;
  /** Id of the existing row that carries this keyword, or null (=> ADD). */
  row_id: string | null;
  cluster: ClusterMember[];
  canonical_basis: CanonicalBasis;
  evidence: Evidence;
}

export type OutcomeKind =
  | "KEEP_TOP"
  | "KEEP_TEMPLATE"
  | "KEEP_LONG_TAIL"
  | "KEEP_LONG_TAIL_UNVERIFIED"
  | "MERGE"
  | "MOVE"
  | "RETIRE";

export interface RowOutcome {
  id: string;
  term: string;
  outcome: OutcomeKind;
  reason: string;
  evidence: Evidence | null;
  /** MERGE: id of the surviving row. */
  into?: string;
  /** MOVE: destination lane. */
  to_lane?: string;
  /** RETIRE / MOVE: judge reason_code. */
  reason_code?: string;
  /** Canonical wording of the row's group (KEEP_*, MERGE). */
  canonical?: string;
  /** MERGE: why the rows are one (same normalized key vs identical-volume Google cluster). */
  merge_kind?: "duplicate" | "cluster";
  /** KEEP_TOP: rank in the selected set. */
  rank?: number;
  band?: Band;
}

export interface AddRecord {
  op: "ADD";
  rank: number;
  term: string;
  source: string;
  volume: number | null;
  volume_as_of: string | null;
  volume_source: string | null;
  intent: string | null;
  band: Band;
  tags: string[];
  local_intent: boolean;
  local_pack: boolean;
  family: string;
  tier: Tier;
  hidden_volume: boolean;
  concept_slug: string | null;
  evidence: Evidence;
}

export interface ExcludedGroup {
  term: string;
  key: string;
  reason_code: string;
  to_lane: string | null;
  volume: number | null;
}

export interface TemplateRow {
  id: string;
  term: string;
  slots: string[];
}

export interface SelectionResult {
  gcid: string;
  config: SelectConfig;
  selected: SelectedKeyword[];
  adds: AddRecord[];
  outcomes: RowOutcome[];
  templates: TemplateRow[];
  excluded: ExcludedGroup[];
  /** Candidate terms the judge had no result for (unjudgedCandidates='skip'). */
  unjudged: string[];
  /** requested n minus selected.length (>0 for niche categories or when candidates ran out). */
  short_by: number;
  /** Why groups were left out of the selected set, counted. */
  skipped: { below_floor: number; family_cap: number; informational_cap: number; tier_b_cap: number; no_evidence: number; clustered: number };
  head_family: string | null;
  warnings: string[];
}

export interface ChangeProposal {
  op: "add" | "merge" | "retire" | "set";
  target_table: "exp_taxonomy";
  target_key: Obj;
  payload: Obj;
  before: Obj;
  rationale: string;
  rule: string;
}

export interface TemplateDemand {
  template: string;
  total_volume: number;
  measured_count: number;
  null_count: number;
  variants: Array<{ term: string; volume: number | null; slots: Record<string, string> }>;
}

export interface Scorecard {
  selected: number;
  requested: number;
  short_by: number;
  outcomes: Record<string, number>;
  tier_a: number;
  tier_b: number;
  measured_share: number;
  wording_mix: Record<CanonicalBasis, number>;
  families: Record<string, number>;
  family_count: number;
  head_family: string | null;
  local_intent_share: number;
  local_pack_count: number;
  informational_count: number;
  bands: Record<Band, number>;
  templates: number;
}
