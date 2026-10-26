// Modifier tags. Modifiers are tags on a keyword, never families.
import { LOCAL_PLACEHOLDERS, NEAR, tokenSet } from "./normalize";
import type { TagSpec } from "./types";

export const DEFAULT_TAGS: Array<string | TagSpec> = [
  "near me",
  "best",
  "top",
  "cheap",
  "affordable",
  "open now",
  { tag: "delivery", pattern: String.raw`\bdeliver(?:y|ies|s|ed|ing)?\b` },
  "online",
  "same day",
  { tag: "24 hour", pattern: String.raw`\b24\s*(?:-|/)?\s*(?:hours?|hrs?|7)\b` },
  "for sale",
  "emergency",
  "free",
  "mobile",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function regexFor(spec: string | TagSpec): { tag: string; re: RegExp | null } {
  const tag = typeof spec === "string" ? spec : spec.tag;
  if (tag === "near me") return { tag, re: null }; // handled via the NEAR token
  const src =
    typeof spec !== "string" && spec.pattern
      ? spec.pattern
      : String.raw`\b${tag.split(/\s+/).map(esc).join(String.raw`[\s-]+`)}s?\b`;
  return { tag, re: new RegExp(src, "i") };
}

export function detectTags(wording: string, specs: Array<string | TagSpec> = DEFAULT_TAGS): string[] {
  const out: string[] = [];
  const hasNear = tokenSet(wording).includes(NEAR);
  for (const spec of specs) {
    const { tag, re } = regexFor(spec);
    if (re === null ? hasNear : re.test(wording)) out.push(tag);
  }
  return out;
}

/** local_intent: a NEAR token or a {city}/{state}/{zip} style placeholder. */
export function hasLocalIntent(wording: string): boolean {
  if (tokenSet(wording).includes(NEAR)) return true;
  const lc = wording.toLowerCase();
  return LOCAL_PLACEHOLDERS.some((p) => lc.includes(p));
}
