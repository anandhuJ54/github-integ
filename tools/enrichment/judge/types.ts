// Judge input/output types. Output type is the contract the model must emit.
import type { Decision, Lane, ReasonCode } from "./reason-codes";

/** One row of the model's output: exactly these six keys, no others. */
export interface JudgeRow {
  term: string;
  decision: Decision;
  reason_code: ReasonCode;
  /** `<domain>:<slug>` for keep rows in family-bearing lanes, otherwise null. */
  family: string | null;
  /** Only for decision=move (reason informational): question | topic | content_title. Else null. */
  to_lane: Lane | null;
  /** Free text; rules per reason code (see REASON_CODE_DEFS[*].noteRule). "" allowed for plain keeps. */
  note: string;
}
export type JudgeOutput = JudgeRow[];

export interface SiblingCategory {
  gcid: string;
  display_name: string;
  /** What belongs to the sibling instead of this category (or the pooled-pack caveat). */
  belongs: string;
  /** true when Google's map pack for the shared terms mixes both categories: terms are ONE pool, do not exclude across it. */
  shares_pack?: boolean;
}

export interface FamilyOption {
  /** slug only; the domain prefix comes from CategoryContext.family_domains. */
  slug: string;
  label: string;
  /** Where the family comes from: this category's OWN data. */
  source: "product_service" | "specialization" | "profession_title" | "service" | "knowledge_model";
}

/** Everything about the category that is stable across lanes and chunks (the cached block). */
export interface CategoryContext {
  gcid: string;
  display_name: string;
  aliases: string[];
  /** Entity types that carry this category. Professionals and offices co-mingle. */
  entity_types: Array<"professional" | "location" | "brand" | "organization">;
  entity_note?: string;
  schema_type: string;
  /** Category group (display grouping). */
  group: string;
  siblings: SiblingCategory[];
  compliance: {
    flags: string[];
    prohibited_phrases: string[];
    notes?: string[];
  };
  /** Domain prefixes a family may use, e.g. ["real_estate"]. A family is `<domain>:<slug>`. */
  family_domains: string[];
  /** Menu of families drawn from the category's own data. */
  families: FamilyOption[];
}

export interface JudgeCandidate {
  term: string;
  /** Monthly search volume (Google's shared volume for close variants) or null when unknown. */
  volume: number | null;
  /** Intent label from the search-data tool (commercial, informational, navigational, transactional, local ...) or null. */
  intent: string | null;
  /** Does the SERP show a local map pack? null = unknown. */
  local_pack: boolean | null;
}

export interface JudgeRequest {
  category: CategoryContext;
  lane: Lane;
  candidates: JudgeCandidate[];
}

export interface ValidationIssue {
  /** Index into the output array, or -1 for whole-output problems. */
  index: number;
  term?: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Rows that passed every check (usable even when ok=false: caller may re-queue only the failures). */
  rows: JudgeRow[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Candidates (by normalised term) the model did not return a row for. */
  missing: string[];
  /** Returned terms that were not in the candidate list. */
  extra: string[];
}

export const normTerm = (t: string): string => t.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
