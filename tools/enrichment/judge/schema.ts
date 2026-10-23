// JSON Schema for the judge's output (draft 2020-12). Also emitted to judge-output.schema.json
// by `bun tools/enrichment/judge/schema.ts` and checked for drift by judge.test.ts.
//
// The conditional rules (allOf) document the cross-field contract; validate.ts enforces
// them (and the context-dependent ones JSON Schema cannot express). If the model API's
// structured-output mode rejects `allOf`, use structuredOutputsSubset().
import { writeFileSync } from "node:fs";
import { DECISIONS, INFORMATIONAL_TARGET_LANES, JUDGE_VOCAB_VERSION, LANES, REASON_CODES, REASON_CODE_DEFS } from "./reason-codes";

export const FAMILY_PATTERN = "^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$";

const decisionsFor = (code: string) => REASON_CODE_DEFS[code as keyof typeof REASON_CODE_DEFS].decisions;

export const JUDGE_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://experience.com/srp/taxonomy/judge-output.schema.json",
  title: `Relevance judge output (${JUDGE_VOCAB_VERSION})`,
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["term", "decision", "reason_code", "family", "to_lane", "note"],
    properties: {
      term: { type: "string", minLength: 1, description: "The candidate, copied verbatim from the input." },
      decision: { enum: [...DECISIONS] },
      reason_code: { enum: [...REASON_CODES] },
      family: {
        type: ["string", "null"],
        pattern: FAMILY_PATTERN,
        description: "<domain>:<slug> drawn from the category's own products/services/specializations/profession titles. Required for keep in family-bearing lanes, else null. Never a modifier.",
      },
      to_lane: { enum: [...INFORMATIONAL_TARGET_LANES, null], description: "Only when decision=move." },
      note: { type: "string", maxLength: 240 },
    },
    allOf: [
      // decision <-> reason_code pairing
      ...REASON_CODES.map((code) => ({
        if: { properties: { reason_code: { const: code } }, required: ["reason_code"] },
        then: { properties: { decision: { enum: [...decisionsFor(code)] } } },
      })),
      // move needs to_lane; everything else must not have one
      { if: { properties: { decision: { const: "move" } }, required: ["decision"] }, then: { properties: { to_lane: { type: "string" } } }, else: { properties: { to_lane: { type: "null" } } } },
      // only keep rows carry a family
      { if: { properties: { decision: { const: "keep" } }, required: ["decision"] }, else: { properties: { family: { type: "null" } } } },
      // non-keep decisions explain themselves
      { if: { properties: { decision: { enum: ["exclude", "move"] } }, required: ["decision"] }, then: { properties: { note: { minLength: 1 } } } },
    ],
  },
} as const;

/** Schema without conditionals, for API structured-output modes that reject allOf/if-then. */
export function structuredOutputsSubset(): unknown {
  const items = { ...JUDGE_OUTPUT_SCHEMA.items } as Record<string, unknown>;
  delete items.allOf;
  return { ...JUDGE_OUTPUT_SCHEMA, items };
}

export const LANE_ENUM = LANES;

if (import.meta.main) {
  const out = new URL("./judge-output.schema.json", import.meta.url);
  writeFileSync(out, JSON.stringify(JUDGE_OUTPUT_SCHEMA, null, 2) + "\n");
  console.log(`wrote ${out.pathname}`);
}
