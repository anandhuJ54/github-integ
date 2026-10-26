// Strict validator for judge output. Pure; no I/O. Rejects malformed output and unknown reason codes.
//
// Usage:
//   const r = validateJudgeOutput(modelText, { lane, candidates, category });
//   if (!r.ok) requeue(r.missing, r.errors)       // rows that passed are still in r.rows
import { FAMILY_PATTERN } from "./schema";
import {
  DECISIONS,
  FORBIDDEN_FAMILY_SLUGS,
  GEO_SLOTS,
  LANES,
  LANE_DEFS,
  REASON_CODE_DEFS,
  isDecision,
  isLane,
  isReasonCode,
  type Lane,
} from "./reason-codes";
import { normTerm, type CategoryContext, type JudgeCandidate, type JudgeRow, type ValidationIssue, type ValidationResult } from "./types";

export interface ValidateOptions {
  /** The lane that was judged. Enables the family / to_lane lane rules. */
  lane?: Lane;
  /** The candidates sent. Enables completeness, unknown-term, duplicate_meaning and portal_owned/local_pack checks. */
  candidates?: JudgeCandidate[];
  /** Enables domain / menu / sibling / prohibited-phrase checks. */
  category?: CategoryContext;
  /** Accept a single ```json fence around the array (default false: the contract is bare JSON). */
  allowFences?: boolean;
  /** Do not fail when candidates are missing from the output (default false). */
  allowMissing?: boolean;
}

const ROW_KEYS = ["term", "decision", "reason_code", "family", "to_lane", "note"] as const;
const MODIFIER_TOKENS = new Set(["best", "top", "good", "great", "cheap", "cheapest", "affordable", "nearby"]);
const NOTE_MAX = 240;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseJudgeJson(text: string, allowFences = false): { value?: unknown; error?: string } {
  let s = text.trim();
  if (allowFences) {
    const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(s);
    if (m) s = m[1].trim();
  }
  try {
    return { value: JSON.parse(s) };
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
}

/** Why a family string is unacceptable, or null if its shape is fine. Shape only; menu/domain checks are separate. */
export function familyShapeProblem(family: string): string | null {
  if (!new RegExp(FAMILY_PATTERN).test(family)) {
    return "family must be domain-qualified '<domain>:<slug>' in lower_snake_case (a bare word like 'broker' is ambiguous across real estate, insurance, mortgage and investing)";
  }
  const slug = family.split(":")[1];
  if (FORBIDDEN_FAMILY_SLUGS.has(slug)) return `'${slug}' is a modifier/generic word, not a family (modifiers are tags)`;
  if (slug.includes("near_me")) return "'near me' is a modifier, not a family (modifiers are tags)";
  const bad = slug.split("_").find((t) => MODIFIER_TOKENS.has(t));
  if (bad) return `family slug contains the modifier '${bad}' (modifiers are tags, never families)`;
  return null;
}

export function validateJudgeOutput(raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const rows: JudgeRow[] = [];
  const allReturned: string[] = [];
  const result = (): ValidationResult => {
    const missing: string[] = [];
    const extra: string[] = [];
    if (opts.candidates) {
      const returned = new Set(rows.map((r) => normTerm(r.term)));
      for (const c of opts.candidates) if (!returned.has(normTerm(c.term))) missing.push(c.term);
      const known = new Set(opts.candidates.map((c) => normTerm(c.term)));
      for (const t of allReturned) if (!known.has(t)) extra.push(t);
    }
    const ok = errors.length === 0 && (opts.allowMissing || missing.length === 0);
    return { ok, rows, errors, warnings, missing, extra };
  };

  let value = raw;
  if (typeof raw === "string") {
    const p = parseJudgeJson(raw, opts.allowFences);
    if (p.error) {
      errors.push({ index: -1, code: "NOT_JSON", message: p.error });
      return result();
    }
    value = p.value;
  }
  if (!Array.isArray(value)) {
    errors.push({ index: -1, code: "NOT_ARRAY", message: "output must be a JSON array of rows" });
    return result();
  }
  if (value.length === 0 && (opts.candidates?.length ?? 1) > 0) {
    errors.push({ index: -1, code: "EMPTY", message: "output array is empty" });
    return result();
  }

  const lane = opts.lane;
  const laneDef = lane ? LANE_DEFS[lane] : undefined;
  const byNorm = new Map<string, JudgeCandidate>();
  for (const c of opts.candidates ?? []) byNorm.set(normTerm(c.term), c);
  const seen = new Set<string>();

  value.forEach((item, i) => {
    const bad: ValidationIssue[] = [];
    const err = (code: string, message: string, term?: string) => bad.push({ index: i, term, code, message });

    if (!isRec(item)) {
      errors.push({ index: i, code: "ROW_NOT_OBJECT", message: "row must be an object" });
      return;
    }
    const term = typeof item.term === "string" ? item.term : undefined;
    if (term) allReturned.push(normTerm(term));

    const keys = Object.keys(item);
    for (const k of ROW_KEYS) if (!(k in item)) err("MISSING_KEY", `missing key '${k}'`, term);
    for (const k of keys) if (!(ROW_KEYS as readonly string[]).includes(k)) err("EXTRA_KEY", `unexpected key '${k}'`, term);

    if (typeof item.term !== "string" || item.term.trim() === "") err("BAD_TERM", "term must be a non-empty string", term);
    if (!isDecision(item.decision)) err("BAD_DECISION", `decision must be one of ${DECISIONS.join("|")}`, term);
    if (!isReasonCode(item.reason_code)) {
      err("UNKNOWN_REASON_CODE", `unknown reason_code ${JSON.stringify(item.reason_code)}`, term);
    }
    if (typeof item.note !== "string") err("BAD_NOTE", "note must be a string (empty string allowed for plain keeps)", term);
    if (item.family !== null && typeof item.family !== "string") err("BAD_FAMILY", "family must be a string or null", term);
    if (item.to_lane !== null && !isLane(item.to_lane)) err("BAD_TO_LANE", `to_lane must be null or one of ${LANES.join("|")}`, term);

    // Stop here if the basic shape is broken; the cross-field rules assume a sane row.
    if (bad.length) {
      errors.push(...bad);
      return;
    }

    const r = item as unknown as JudgeRow;
    const def = REASON_CODE_DEFS[r.reason_code];
    const note = r.note.trim();

    if (!def.decisions.includes(r.decision)) {
      err("DECISION_REASON_MISMATCH", `reason_code '${r.reason_code}' requires decision ${def.decisions.join("|")}, got '${r.decision}'`, r.term);
    }
    if (note.length > NOTE_MAX) err("NOTE_TOO_LONG", `note longer than ${NOTE_MAX} chars`, r.term);
    if (r.decision !== "keep" && note === "") err("NOTE_REQUIRED", `note is required for decision '${r.decision}'`, r.term);

    // to_lane
    if (r.decision === "move") {
      if (r.to_lane === null) err("TO_LANE_REQUIRED", "decision=move requires to_lane", r.term);
      else if (!LANE_DEFS[r.to_lane].informationalTarget) err("TO_LANE_NOT_ALLOWED", `to_lane must be one of the informational lanes (question|topic|content_title), got '${r.to_lane}'`, r.term);
      else if (lane && r.to_lane === lane) err("TO_LANE_SAME_LANE", "to_lane equals the lane being judged (then it is a keep, not a move)", r.term);
    } else if (r.to_lane !== null) {
      err("TO_LANE_NOT_ALLOWED", "to_lane must be null unless decision=move", r.term);
    }

    // family
    if (r.decision !== "keep") {
      if (r.family !== null) err("FAMILY_NOT_ALLOWED", "only keep rows carry a family", r.term);
    } else if (laneDef && !laneDef.takesFamily) {
      if (r.family !== null) err("FAMILY_NOT_ALLOWED", `lane '${lane}' does not use families (null required; modifiers/tags are attached to families downstream)`, r.term);
    } else if (laneDef && r.family === null) {
      err("FAMILY_REQUIRED", "keep rows need a family in this lane", r.term);
    }
    if (r.family !== null) {
      const problem = familyShapeProblem(r.family);
      if (problem) err("BAD_FAMILY_SHAPE", problem, r.term);
      else if (opts.category) {
        const [domain, slug] = r.family.split(":");
        if (!opts.category.family_domains.includes(domain)) {
          err("FAMILY_DOMAIN", `family domain '${domain}' is not one of this category's domains (${opts.category.family_domains.join(", ")})`, r.term);
        } else if (!opts.category.families.some((f) => f.slug === slug)) {
          warnings.push({ index: i, term: r.term, code: "PROPOSED_FAMILY", message: `family '${r.family}' is not in the category's family menu; treated as a proposal for review` });
        }
      }
    }

    // note rules per code
    if (r.reason_code === "geo_specific" && !GEO_SLOTS.some((s) => note.includes(s))) {
      err("GEO_TEMPLATE_REQUIRED", `geo_specific note must contain a template with one of ${GEO_SLOTS.join(" ")}`, r.term);
    }
    if (r.reason_code === "other_category" && note !== "" && opts.category) {
      const hay = note.toLowerCase();
      const hit = opts.category.siblings.some((s) => hay.includes(s.display_name.toLowerCase()) || hay.includes(s.gcid.toLowerCase()) || hay.includes(s.gcid.replace(/^gcid:/, "").replace(/_/g, " ")));
      if (!hit) warnings.push({ index: i, term: r.term, code: "OTHER_CATEGORY_NOT_A_LISTED_SIBLING", message: "note does not name a listed sibling category; verify it names a real GBP category" });
    }
    if (r.reason_code === "compliance_conflict" && opts.category && opts.category.compliance.prohibited_phrases.length) {
      const hay = note.toLowerCase();
      if (!opts.category.compliance.prohibited_phrases.some((p) => hay.includes(p.toLowerCase()))) {
        warnings.push({ index: i, term: r.term, code: "COMPLIANCE_PHRASE_NOT_QUOTED", message: "note does not quote a listed prohibited phrase" });
      }
    }

    // candidate-aware rules
    const cand = byNorm.get(normTerm(r.term));
    if (opts.candidates) {
      if (!cand) err("UNKNOWN_TERM", "term was not in the candidate list (the judge must not invent or rewrite terms)", r.term);
      if (seen.has(normTerm(r.term))) err("DUPLICATE_ROW", "term appears more than once in the output", r.term);
    } else if (seen.has(normTerm(r.term))) {
      err("DUPLICATE_ROW", "term appears more than once in the output", r.term);
    }
    if (cand) {
      if (r.reason_code === "portal_owned" && cand.local_pack === true) {
        err("PORTAL_OWNED_WITH_LOCAL_PACK", "local_pack=Y: a map pack of real businesses means the term is winnable; it must be kept, not portal_owned", r.term);
      }
      if (r.reason_code === "duplicate_meaning") {
        const survivor = (opts.candidates ?? []).find((c) => normTerm(c.term) !== normTerm(r.term) && note.toLowerCase().includes(c.term.toLowerCase()));
        if (!survivor) err("DUPLICATE_SURVIVOR_REQUIRED", "duplicate_meaning note must name the surviving candidate term verbatim", r.term);
      }
    }

    seen.add(normTerm(r.term));
    if (bad.length) errors.push(...bad);
    else rows.push(r);
  });

  return result();
}
