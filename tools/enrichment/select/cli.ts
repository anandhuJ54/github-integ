// Thin CLI around the pure library. Reads one JSON file, writes JSON files. No network, no DB.
//
//   bun tools/enrichment/select/cli.ts <input.json> [outDir]
//
// input.json: { gcid, existing[], candidates[], intents?, local_pack?, judge[], config?, template_variants? }
//   intents / local_pack may be {term: value} objects or arrays of {term, intent} / {term, local_pack}.
//   template_variants: [{term, volume}] city-specific variants to aggregate per local template.
// Writes <outDir>/selection.json, change_set.json, scorecard.json (default outDir: next to the input).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { aggregateTemplates, buildChangeSet, scorecard, selectKeywordLane } from "./index";
import type { SelectInput } from "./types";

function toMap<T>(v: unknown, field: string): Record<string, T> | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const out: Record<string, T> = {};
    for (const r of v as Array<Record<string, unknown>>) out[String(r.term)] = r[field] as T;
    return out;
  }
  return v as Record<string, T>;
}

const [inPath, outArg] = process.argv.slice(2);
if (!inPath) {
  console.error("usage: bun tools/enrichment/select/cli.ts <input.json> [outDir]");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(resolve(inPath), "utf8"));
const input: SelectInput = {
  gcid: raw.gcid,
  existing: raw.existing ?? [],
  candidates: raw.candidates ?? [],
  intents: toMap<string>(raw.intents, "intent"),
  local_pack: toMap<boolean>(raw.local_pack, "local_pack"),
  judge: raw.judge ?? [],
  config: raw.config,
};
if (!input.gcid) throw new Error("input.gcid is required");

const result = selectKeywordLane(input);
const cs = buildChangeSet(result, input.existing);
const demand = aggregateTemplates(
  result.templates.map((t) => t.term),
  raw.template_variants ?? [],
);
const outDir = resolve(outArg ?? dirname(resolve(inPath)));
mkdirSync(outDir, { recursive: true });
const w = (name: string, data: unknown) => writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + "\n");
w("selection.json", { ...result, template_demand: demand });
w("change_set.json", cs);
w("scorecard.json", scorecard(result));
console.log(
  `${input.gcid}: selected ${result.selected.length}/${result.config.n} (short_by ${result.short_by}), ` +
    `${cs.proposals.length} proposals, ${result.warnings.length + cs.warnings.length} warnings -> ${outDir}`,
);
