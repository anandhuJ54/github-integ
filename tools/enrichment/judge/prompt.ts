// Prompt template for the relevance judge, built for prompt caching.
//
// Layout (prefix order; a byte change anywhere invalidates everything after it):
//
//   1. SYSTEM   — identical for every category, lane and chunk (rules, vocabulary, schema).   [cache breakpoint 1]
//   2. USER #1  — CategoryContext block: stable per category, identical across all lanes
//                 and all chunks of that category.                                            [cache breakpoint 2]
//   3. USER #2  — lane being judged + the 200-300 candidates. Never cached.
//
// Nothing volatile (dates, ids, counters, random order) may appear in 1 or 2.
import {
  DECISION_ORDER,
  JUDGE_VOCAB_VERSION,
  LANES,
  LANE_DEFS,
  REASON_CODES,
  REASON_CODE_DEFS,
  type Lane,
} from "./reason-codes";
import { JUDGE_OUTPUT_SCHEMA } from "./schema";
import type { CategoryContext, JudgeCandidate } from "./types";

export const PROMPT_VERSION = `judge-prompt.v1/${JUDGE_VOCAB_VERSION}`;
export const MAX_CANDIDATES_PER_CALL = 300;
export const TARGET_CANDIDATES_PER_CALL = 250;

function vocabularyBlock(): string {
  return REASON_CODES.map((code) => {
    const d = REASON_CODE_DEFS[code];
    const ex = d.examples.map((e) => `    - [${e.category.replace("gcid:", "")}] "${e.term}": ${e.why}`).join("\n");
    return `${code}  (decision: ${d.decisions.join("|")})\n  ${d.definition}\n  note: ${d.noteRule}\n  examples:\n${ex}`;
  }).join("\n\n");
}

function laneBlock(): string {
  return LANES.map((l) => `- ${l}: keep = ${LANE_DEFS[l].keepMeans}. family: ${LANE_DEFS[l].takesFamily ? "required on keep" : "null"}${LANE_DEFS[l].informationalTarget ? ". Valid to_lane target" : ""}.`).join("\n");
}

/** The SYSTEM prompt. Stable across ALL categories. */
export function buildSystemPrompt(): string {
  return `You are the relevance judge in a taxonomy-enrichment pipeline for a search-rank platform organised around Google Business Profile (GBP) categories. Say "category", never "vertical".

TASK
You receive ONE category (its definition, siblings and compliance rules), ONE taxonomy lane, and a list of 200-300 candidate terms from search-data tools. The candidates are noisy. For every candidate decide whether it belongs in that lane for that category, and why. Judge the term as a searcher would mean it, for this category only. Do not judge whether the term is a good idea commercially; judge whether it is relevant.

HOW TO DECIDE
1. Meaning, not words. Shared words, acronyms and substrings are never enough ("strains" in a cannabis category vs "muscle strains"; "tacos" inside "catacombs"; "VA" as a loan vs "veterans benefits" in general). Ask what the person typing it wants.
2. Use the category's own data. The category block lists what its practitioners sell, specialise in and are titled. A term is relevant when a business in this category could honestly answer it.
3. Modifiers do not change relevance. "best", "top", "good", "cheap", "near me", "open late", "24 hour", "delivery" are qualifiers. Judge the head term and keep the qualified form when the head term is kept. Qualifiers become tags downstream; they are never families.
4. Volume sharing. Google reports one shared volume for close variants (plural, typo, word order, stopwords). A volume number is not evidence that a term is distinct, and low volume is not a reason to exclude. When two candidates mean the same thing keep the canonical one and mark the other duplicate_meaning, naming the survivor.
5. Local pack. Each candidate may carry local_pack = Y (the results page shows a map pack of local businesses), N (no map pack) or ? (unknown). A term whose results page is a map pack of businesses in this category is winnable by a local business, even if the head term is dominated by portals. Never use portal_owned when local_pack = Y. Use portal_owned only for local_pack = N or ? and only when listing portals / aggregators / publishers own the results.
6. Pooled packs (the boundary rule). Google's map pack for some terms mixes several GBP categories: individual agents and offices, brokers and agencies, labelled inconsistently (some individuals as "agency", some offices as "agent"). The category block marks such siblings with shares_pack. Terms that compete for the same pack are ONE pool: do not exclude a term merely because it sounds like a company, an office, a brokerage or a different professional title when the sibling shares the pack. other_category is only for terms whose right answer is a different set of businesses.
7. Entity types co-mingle. A category may be carried by professionals (a person with a licence), locations (an office or shop) and brands (a company). Do not exclude "agent" terms because the entity is an office, or "office" terms because the entity is a person, when the category block lists both entity types.
8. Compliance first. Prohibited phrases and compliance flags in the category block are hard rules. A term that matches or paraphrases a prohibited phrase, or invites steering by a protected class, is compliance_conflict regardless of volume.
9. When several codes could apply use the first that fits in this order:
   ${DECISION_ORDER.join(" > ")}
   (keep is the last resort; navigational_brand is a keep with a flag.)
10. Be decisive. Do not invent categories, brands, places or facts. If you do not recognise a term and nothing in the category block explains it, prefer ambiguous_meaning or off_intent over keep.

LANES
${laneBlock()}
For lane = negative_keyword, keep means "this is a valid negative keyword for the category".
If the lane is itself question, topic or content_title, an informational term is a keep (no move).

DECISIONS
keep    the term belongs in this lane for this category.
exclude the term does not belong in this lane (reason says why; geo_specific also supplies a template).
move    the term is valuable but belongs in a different lane: only with reason_code informational and to_lane in question | topic | content_title.

REASON CODES (fixed vocabulary; no other value is accepted)
${vocabularyBlock()}

FAMILIES
A family groups keep rows into a topic: the product, service, specialization or profession title the term is about, taken from THE CATEGORY'S OWN data (the family menu in the category block). Rules:
- Format: <domain>:<slug>, lower_snake_case, domain from the category's family_domains. Always domain-qualified: "broker" means different things in real estate, insurance, mortgage and investing, so write real_estate:brokerage or mortgage:broker_services, never "broker".
- Pick from the menu. If nothing fits, propose ONE new family in the same format that names a real product/service/specialization/title of this category; proposals are reviewed by a human.
- NEVER use a modifier or generic word as a family: not best, top, good, cheap, local, near me, open now, 24 hour, free, online, emergency (as a bare qualifier). A previous version did this and every family became meaningless. "emergency_repair" is a service and is fine; "emergency" alone is a qualifier and is not.
- Many terms share a family ("tacos near me", "best tacos near me", "taco delivery" -> mexican_food:tacos).
- family is null for every decision other than keep, and for every keep in a lane marked "family: null" above.

OUTPUT CONTRACT
Return ONLY a JSON array (no prose, no code fences, no trailing text). One object per candidate, in the input order, the term copied exactly. Each object has exactly these six keys:
{"term": string, "decision": "keep"|"exclude"|"move", "reason_code": <code above>, "family": string|null, "to_lane": "question"|"topic"|"content_title"|null, "note": string}
- note: "" for an unremarkable keep; otherwise at most 20 words, following the note rule of the code. Required for exclude and move.
- geo_specific: note is the template, e.g. "realtors {city}" (slots: {city} {state} {county} {neighborhood} {zip}).
- other_category: note names the other category (display name or gcid).
- duplicate_meaning: note is the surviving candidate, verbatim.
- compliance_conflict: note quotes the matched prohibited phrase or rule.
- Do not skip, merge, split, reorder or rewrite candidates. Do not add candidates.

JSON Schema (draft 2020-12) of one row (the array wraps it):
${JSON.stringify(JUDGE_OUTPUT_SCHEMA.items.properties)}

Example (category: Cannabis store, lane: keyword):
[{"term":"dispensary near me","decision":"keep","reason_code":"keep","family":"cannabis_retail:dispensary_storefront","to_lane":null,"note":""},{"term":"what is thc","decision":"move","reason_code":"informational","family":null,"to_lane":"question","note":"definition question"},{"term":"mint dispensary az","decision":"exclude","reason_code":"brand_or_business_name","family":null,"to_lane":null,"note":"brand plus geo"}]
`;
}

/** The CATEGORY block (user message, part 1). Stable per category: same bytes for every lane and chunk. */
export function buildCategoryBlock(c: CategoryContext): string {
  const lines: string[] = [];
  lines.push(`CATEGORY`);
  lines.push(`gcid: ${c.gcid}`);
  lines.push(`display_name: ${c.display_name}`);
  lines.push(`aliases: ${c.aliases.length ? c.aliases.join("; ") : "(none)"}`);
  lines.push(`group: ${c.group}`);
  lines.push(`schema_type: ${c.schema_type}`);
  lines.push(`entity_types: ${c.entity_types.join(", ")}${c.entity_note ? ` — ${c.entity_note}` : ""}`);
  lines.push(``);
  lines.push(`SIBLING CATEGORIES (what belongs to them, not to this category)`);
  if (c.siblings.length === 0) lines.push(`(none listed)`);
  for (const s of c.siblings) {
    lines.push(`- ${s.gcid} "${s.display_name}"${s.shares_pack ? " [shares_pack: pooled with this category]" : ""}: ${s.belongs}`);
  }
  lines.push(``);
  lines.push(`COMPLIANCE`);
  lines.push(`flags: ${c.compliance.flags.length ? c.compliance.flags.join(", ") : "(none)"}`);
  lines.push(`prohibited_phrases: ${c.compliance.prohibited_phrases.length ? c.compliance.prohibited_phrases.map((p) => `"${p}"`).join("; ") : "(none)"}`);
  for (const n of c.compliance.notes ?? []) lines.push(`note: ${n}`);
  lines.push(``);
  lines.push(`FAMILY MENU (domain(s): ${c.family_domains.join(", ")}; format <domain>:<slug>)`);
  for (const f of c.families) lines.push(`- ${f.slug} — ${f.label} [${f.source}]`);
  return lines.join("\n") + "\n";
}

const fmtLp = (v: boolean | null) => (v === true ? "Y" : v === false ? "N" : "?");

/** The CANDIDATE block (user message, part 2). Not cached. Sorted by volume desc, then term, for reproducibility. */
export function buildCandidateBlock(lane: Lane, candidates: JudgeCandidate[]): string {
  if (candidates.length === 0) throw new Error("no candidates");
  if (candidates.length > MAX_CANDIDATES_PER_CALL) throw new Error(`too many candidates (${candidates.length} > ${MAX_CANDIDATES_PER_CALL})`);
  const sorted = [...candidates].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.term.localeCompare(b.term));
  const rows = sorted.map((c) => `${c.term}\t${c.volume ?? "?"}\t${c.intent ?? "?"}\t${fmtLp(c.local_pack)}`);
  return `LANE TO JUDGE: ${lane}\nkeep means: ${LANE_DEFS[lane].keepMeans}\nfamily: ${LANE_DEFS[lane].takesFamily ? "required on keep" : "null"}\n\nCANDIDATES (${sorted.length}) — columns: term<TAB>monthly_volume (shared across close variants)<TAB>intent<TAB>local_pack (Y/N/?)\n${rows.join("\n")}\n\nReturn the JSON array now, ${sorted.length} rows, in this order.`;
}

export interface CachedPromptParts {
  system: string;
  categoryBlock: string;
  candidateBlock: string;
  /** Candidate order actually sent (the order the output must follow). */
  orderedTerms: string[];
}

export function buildJudgePrompt(category: CategoryContext, lane: Lane, candidates: JudgeCandidate[]): CachedPromptParts {
  const candidateBlock = buildCandidateBlock(lane, candidates);
  const orderedTerms = [...candidates].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.term.localeCompare(b.term)).map((c) => c.term);
  return { system: buildSystemPrompt(), categoryBlock: buildCategoryBlock(category), candidateBlock, orderedTerms };
}

/** Anthropic Messages API params (plain object; no SDK dependency). Two cache breakpoints. */
export function toMessagesParams(
  parts: CachedPromptParts,
  opts: { model: string; maxTokens?: number; cacheTtl?: "5m" | "1h" } = { model: "claude-haiku-4-5" },
) {
  const cc = { type: "ephemeral" as const, ...(opts.cacheTtl === "1h" ? { ttl: "1h" as const } : {}) };
  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: [{ type: "text" as const, text: parts.system, cache_control: cc }],
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: parts.categoryBlock, cache_control: cc },
          { type: "text" as const, text: parts.candidateBlock },
        ],
      },
    ],
  };
}

/** One entry for POST /v1/messages/batches. custom_id encodes category|lane|chunk so results can be keyed back (results arrive in any order). */
export function toBatchRequest(parts: CachedPromptParts, key: { gcid: string; lane: Lane; chunk: number }, opts: Parameters<typeof toMessagesParams>[1]) {
  return { custom_id: `${key.gcid}|${key.lane}|${key.chunk}`, params: toMessagesParams(parts, opts) };
}

/** Split a category's candidates for one lane into chunks of ~TARGET size (balanced, never above MAX). */
export function chunkCandidates<T>(items: T[], target = TARGET_CANDIDATES_PER_CALL): T[][] {
  if (items.length === 0) return [];
  const n = Math.ceil(items.length / target);
  const size = Math.ceil(items.length / n);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
