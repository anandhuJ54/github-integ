import type { LlmCollectionRequest, LlmExtractFn, LlmItem } from "./types";

/*
 * Haiku extraction call (model tier: haiku — directive §8). One structured-output
 * request per page asking ONLY for the brief's unfilled collection keys, each with
 * its cardinality, expected count and vocabulary. The caller (index.ts) still
 * verifies every item against the page text; this prompt only asks for honesty.
 */

export const EXTRACT_MODEL = "claude-haiku-5-5";
/** Page text sent to the model; longer pages are cut and the cut is reported. */
const MAX_PAGE_CHARS = 200_000;

const nullable = (type: "string") => ({ anyOf: [{ type }, { type: "null" }] });
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    detail: nullable("string"),
    price: nullable("string"),
    section: nullable("string"),
    vocabulary_term: nullable("string"),
    evidence: { type: "string" },
  },
  required: ["name", "detail", "price", "section", "vocabulary_term", "evidence"],
  additionalProperties: false,
} as const;

export function outputSchema(collections: LlmCollectionRequest[]) {
  return {
    type: "object",
    properties: {
      collections: {
        type: "object",
        properties: Object.fromEntries(
          collections.map((c) => [c.key, { type: "array", items: ITEM_SCHEMA }]),
        ),
        required: collections.map((c) => c.key),
        additionalProperties: false,
      },
    },
    required: ["collections"],
    additionalProperties: false,
  };
}

const SIZE: Record<string, string> = {
  one: "exactly one value",
  few: "a short list",
  many: "a long list — list every item on the page",
};

export function buildPrompt(args: Parameters<LlmExtractFn>[0]): { system: string; user: string; truncated: boolean } {
  const system = [
    `You read one web page belonging to a ${args.categoryName} and list the facts it states for the requested collections.`,
    "Only report items that are literally written on the page. Do not infer, complete or add anything.",
    "For every item, `evidence` must be a short verbatim quote (under 200 characters) copied from the page that contains the item's name.",
    "`price`, `section` and `detail` must also be copied from the page, or null.",
    "When a collection lists vocabulary, set `vocabulary_term` to the one term that names the same thing, or null when none does.",
    "Return an empty array for a collection the page does not mention.",
  ].join("\n");
  const spec = args.collections
    .map((c) =>
      [
        `- ${c.key} ("${c.label}"): cardinality ${c.cardinality} (${SIZE[c.cardinality]}; typically ${c.expected.min}–${c.expected.max})`,
        c.vocabulary.length ? `  vocabulary: ${c.vocabulary.join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n");
  let text = args.page.text
    .map((b) => (b.kind === "heading" || b.kind === "title" ? `## ${b.text}` : b.text))
    .join("\n");
  const truncated = text.length > MAX_PAGE_CHARS;
  if (truncated) text = text.slice(0, MAX_PAGE_CHARS);
  const user = `Collections to fill:\n${spec}\n\nPage: ${args.page.source_url}\n<page>\n${text}\n</page>`;
  return { system, user, truncated };
}

/**
 * Haiku-backed LlmExtractFn — raw fetch to the Messages API, the way the rest of the
 * repo calls Claude (disco-ai-worker.ts, reviews.functions.ts); structured output via
 * output_config.format json_schema. `fetchImpl` is injectable for tests.
 */
export function haikuExtractor(
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): LlmExtractFn {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const doFetch = opts.fetchImpl ?? fetch;
  return async (args) => {
    if (!args.collections.length) return {};
    const { system, user } = buildPrompt(args);
    const res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: outputSchema(args.collections) },
        },
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const msg = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (msg.stop_reason === "refusal") throw new Error("extraction model declined the page");
    if (msg.stop_reason === "max_tokens") throw new Error("extraction output hit max_tokens");
    const text = (msg.content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
    const parsed = JSON.parse(text) as { collections?: Record<string, LlmItem[]> };
    return parsed.collections ?? {};
  };
}
