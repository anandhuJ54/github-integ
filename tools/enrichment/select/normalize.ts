// Normalisation (dedupe key), canonical wording and slugging. Pure functions, no I/O.

export const STOPWORDS: ReadonlySet<string> = new Set(
  "the a an of in for to my that are is i you with at on and or any some".split(" "),
);
export const PROXIMITY: ReadonlySet<string> = new Set(
  ["near", "me", "nearby", "closest", "local", "around", "closeby", "area"],
);
/** Token every proximity word collapses to. Upper case so it can never collide with a real (lower-case) token. */
export const NEAR = "NEAR";

export const LOCAL_PLACEHOLDERS = ["{city}", "{state}", "{zip}", "{neighborhood}", "{county}"];

const PLACEHOLDER = /\{[a-z_]+\}/;
export const hasPlaceholder = (term: string): boolean => PLACEHOLDER.test(term.toLowerCase());
export const placeholdersOf = (term: string): string[] => term.toLowerCase().match(/\{[a-z_]+\}/g) ?? [];

const RADIUS: RegExp[] = [
  // "within 5 mi", "within 0.5 miles of me", "in a 10 mile radius"
  /\b(?:within|inside|in\s+a)\s+(?:a\s+)?\d+(?:\.\d+)?\s*-?\s*(?:mi|miles?|km|kms|kilometers?|meters?|m|blocks?)\b(?:\s+radius)?(?:\s+of\s+(?:me|here|my\s+location))?/g,
  // bare "5 mi", "10 miles radius"
  /\b\d+(?:\.\d+)?\s*-?\s*(?:mi|miles?|km|kms|kilometers?)\b(?:\s+(?:radius|away))?(?:\s+of\s+(?:me|here|my\s+location))?/g,
];

/** Remove radius phrases ("within 5 mi", "10 miles radius"). Input is lower-cased by the caller. */
export function stripRadius(s: string): string {
  let out = s;
  for (const re of RADIUS) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

function words(term: string): string[] {
  const s = stripRadius(term.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")).replace(/['’`]/g, "");
  return s.match(/\{[a-z_]+\}|[\p{L}\p{N}]+/gu) ?? [];
}

/** Stem a lower-case word: delivery family -> delivery, ies -> y, trailing s (not ss) dropped. */
export function stem(w: string): string {
  if (w.startsWith("{")) return w;
  if (/^deliver(?:y|ies|s|ed|ing)?$/.test(w)) return "delivery";
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Plural -> singular for wording (not for keys): ies -> y, trailing s (not ss) dropped. Leaves delivery words alone. */
export function singularize(w: string): string {
  if (w.startsWith("{") || /^deliver/.test(w)) return w;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Ordered normalised tokens with the original word each came from (stopwords/digits dropped, stemmed, proximity -> NEAR). */
export function orderedPairs(term: string): Array<{ tok: string; raw: string }> {
  const out: Array<{ tok: string; raw: string }> = [];
  for (const w of words(term)) {
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    let t = stem(w);
    if (PROXIMITY.has(t)) t = NEAR;
    if (t === NEAR && out[out.length - 1]?.tok === NEAR) continue;
    out.push({ tok: t, raw: w });
  }
  return out;
}

/** Ordered normalised tokens: stopwords and digit-only tokens dropped, stemmed, proximity words -> NEAR (deduped in place). */
export const orderedTokens = (term: string): string[] => orderedPairs(term).map((p) => p.tok);

/** Sorted unique token set. */
export function tokenSet(term: string): string[] {
  return [...new Set(orderedTokens(term))].sort();
}

/**
 * Dedupe key. Terms with the same key are one group.
 * Falls back to the trimmed lower-case text when every token is dropped.
 */
export function normalizeKey(term: string): string {
  const t = tokenSet(term);
  return t.length ? t.join(" ") : term.toLowerCase().trim();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const x of new Set(a)) if (sb.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

export function slugify(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const DEFAULT_HEADS = [
  "store", "shop", "service", "delivery", "dispensary", "clinic", "center", "office",
  "company", "agency", "restaurant", "place", "spot", "location",
];

/**
 * Canonical wording hygiene for ONE wording:
 *  - lower-case, whitespace collapsed, radius phrases stripped
 *  - leading "near me" moved to the end; doubled proximity ("near me near me") collapsed
 *  - trailing "near" -> "near me"
 *  - plural noun-adjunct before a head noun singularised ("weeds store" -> "weed store")
 * Idempotent.
 */
export function cleanWording(term: string, heads: readonly string[] = DEFAULT_HEADS): string {
  let s = stripRadius(term.toLowerCase().trim().replace(/\s+/g, " "));
  s = s.replace(/^[^\p{L}\p{N}{]+|[^\p{L}\p{N}}?]+$/gu, "").trim();
  // leading "near me" -> end (loop: "near me near me x")
  for (let i = 0; i < 4; i++) {
    const m = /^near me\s+(.+)$/.exec(s);
    if (!m) break;
    s = `${m[1]} near me`;
  }
  // doubled proximity phrases
  s = s.replace(/\bnear me(?:\s+(?:near me|nearby))+/g, "near me");
  s = s.replace(/\bnearby(?:\s+(?:near me|nearby))+/g, "nearby");
  // trailing bare "near"
  s = s.replace(/\bnear$/, "near me");
  // plural modifier -> singular
  const headSet = new Set(heads);
  const parts = s.split(" ");
  for (let i = 0; i < parts.length - 1; i++) {
    const w = parts[i];
    const sing = singularize(w);
    if (sing !== w && headSet.has(singularize(parts[i + 1]))) parts[i] = sing;
  }
  return parts.join(" ").trim();
}

/** Wording defects that force a rewrite of an existing row's term (beyond case/whitespace). */
export function wordingDiffers(a: string, b: string): boolean {
  return a.toLowerCase().trim().replace(/\s+/g, " ") !== b.toLowerCase().trim().replace(/\s+/g, " ");
}
