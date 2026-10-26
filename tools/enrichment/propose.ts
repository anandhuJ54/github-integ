// Deterministic category-cleanup proposals → exp_category_proposals (migration 0025).
//
// Flow (no DB writes from here — ever):
//   1. Run each read-only detector in tools/enrichment/detect/*.sql with query_database and
//      save the result verbatim ({rows:[...]}) as tools/enrichment/out/raw/<detector>.json
//      (t2, t3, t5, k1, r2, r3 — the filename prefix of the .sql file).
//   2. bun tools/enrichment/propose.ts [batch]          (default batch: det-<yyyymmdd>-1)
//      → out/proposals_<batch>.json         every proposal row (after validation + dedupe)
//      → out/proposals_<batch>.insert.sql   INSERT … ON CONFLICT DO NOTHING (idempotent)
//      → out/review_batch_1.md              20 stratified samples, before/after, for Scott
//   3. Scott reviews the sample. Only then does Claude run the INSERT file, then
//      exp_category_proposal_review(batch, …) with Scott's decision, then
//      exp_category_proposal_apply(batch) (snapshot → apply → ledger → validate per gcid).
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

interface Proposal {
  batch: string;
  gcid: string;
  lane: string;
  target_table: string;
  target_key: Obj;
  op: string;
  payload: Obj;
  before: Obj;
  rationale: string;
  rule: string;
  created_by: string;
}

const LANES = new Set([
  "location", "professional", "shared", "brand", "score_priors", "directories", "knowledge", "taxonomy",
]);
const OPS = new Set(["add", "retire", "rescope", "relabel", "merge", "set"]);
const TABLES = new Set(["exp_taxonomy", "exp_vertical_node_registry", "exp_category_knowledge"]);
const DETECTORS = ["t2", "t3", "t5", "k1", "r2", "r3"] as const;

const RATIONALE: Record<string, string> = {
  T2: "engine_v1 leaked internal GBP-verification jargon into consumer taxonomy; not a term a consumer searches or reads",
  "T3.relabel_geo": "geo-synonym slot rewritten to the standard slot the geo pages render ({city} {neighborhood} {state} {zip} {county})",
  "T3.retire_dup": "geo-synonym slot rewrite would duplicate an existing term in the same category and level",
  "T3.retire_slot": "entity/person slot ({name}, {professional_name}, {abbey}, {brand} …) cannot be filled at category level",
  "T3.retire_alias": "an alias must be a bare profession name; a templated slot makes it unusable for matching",
  T5: "question-level term missing its question mark",
  K1: "conversion_actions schema_action is not a schema.org type (checked against exp_schemaorg_types); mapped deterministically to a valid Action",
  "R2.set_person": "hasOccupation is a property of Person, not Occupation; subject corrected",
  "R2.retire_dup": "category already has an active Person.hasOccupation node in this ring; the Occupation-typed copy is redundant",
  R3: "shared node duplicates the scoped node of the same name and ring; the scoped node is the specific one and is kept",
};

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;
const keyOf = (p: Pick<Proposal, "target_table" | "target_key">) =>
  `${p.target_table}|${JSON.stringify(p.target_key, Object.keys(p.target_key).sort())}`;

// FNV-1a — deterministic sampling without Math.random
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const here = import.meta.dir;
const outDir = join(here, "out");
const rawDir = join(outDir, "raw");
const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const batch = process.argv[2] ?? `det-${today}-1`;
if (!/^[a-z0-9][a-z0-9_-]{2,60}$/.test(batch)) throw new Error(`bad batch id: ${batch}`);

const proposals: Proposal[] = [];
const rejected: { rule: string; reason: string; key: string }[] = [];
const seen = new Map<string, Proposal>();
const rawCounts: Record<string, number> = {};

for (const d of DETECTORS) {
  const file = join(rawDir, `${d}.json`);
  if (!existsSync(file)) throw new Error(`missing export ${file} — run detect/${d}_*.sql via query_database`);
  const { rows } = (await Bun.file(file).json()) as { rows: Record<string, unknown>[] };
  rawCounts[d] = rows.length;
  for (const r of rows) {
    const rule = String(r.rule ?? "");
    const p: Proposal = {
      batch,
      gcid: String(r.gcid ?? ""),
      lane: String(r.lane ?? ""),
      target_table: String(r.target_table ?? ""),
      target_key: isObj(r.target_key) ? r.target_key : {},
      op: String(r.op ?? ""),
      payload: isObj(r.payload) ? r.payload : {},
      before: isObj(r.before) ? r.before : {},
      rationale: RATIONALE[rule] ?? "",
      rule,
      created_by: "claude",
    };
    const key = keyOf(p);
    const bad =
      !p.gcid.startsWith("gcid:") ? "gcid missing/malformed"
      : !LANES.has(p.lane) ? `lane ${p.lane}`
      : !OPS.has(p.op) ? `op ${p.op}`
      : !TABLES.has(p.target_table) ? `target_table ${p.target_table}`
      : typeof p.target_key.id !== "string" ? "target_key.id missing"
      : !p.rationale ? `no rationale for rule ${rule}`
      : rule === "K1" && p.before.new_valid !== true ? "K1 mapped value not in exp_schemaorg_types"
      : null;
    if (bad) {
      rejected.push({ rule, reason: bad, key });
      continue;
    }
    // one open proposal per target (matches the partial unique index): retire beats edits,
    // otherwise first detector wins (T3 runs before T5 so slot fixes win over "?" fixes)
    const prev = seen.get(key);
    if (prev) {
      if (p.op === "retire" && prev.op !== "retire") {
        proposals[proposals.indexOf(prev)] = p;
        seen.set(key, p);
        rejected.push({ rule: prev.rule, reason: `superseded by ${rule} on same target`, key });
      } else {
        rejected.push({ rule, reason: `duplicate target (kept ${prev.rule})`, key });
      }
      continue;
    }
    seen.set(key, p);
    proposals.push(p);
  }
}

// ---- outputs ------------------------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const byRule: Record<string, { n: number; gcids: Set<string> }> = {};
for (const p of proposals) {
  byRule[p.rule] ??= { n: 0, gcids: new Set() };
  byRule[p.rule].n++;
  byRule[p.rule].gcids.add(p.gcid);
}
const summary = Object.fromEntries(
  Object.entries(byRule).sort().map(([k, v]) => [k, { rows: v.n, categories: v.gcids.size }]),
);

await Bun.write(
  join(outDir, `proposals_${batch}.json`),
  JSON.stringify({ batch, generated_at: new Date().toISOString(), raw: rawCounts, summary, rejected, proposals }, null, 1),
);

const cols = "batch, gcid, lane, target_table, target_key, op, payload, before, rationale, rule, created_by";
const values = proposals.map(
  (p) =>
    `(${[
      sqlStr(p.batch), sqlStr(p.gcid), sqlStr(p.lane), sqlStr(p.target_table),
      `${sqlStr(JSON.stringify(p.target_key))}::jsonb`, sqlStr(p.op),
      `${sqlStr(JSON.stringify(p.payload))}::jsonb`, `${sqlStr(JSON.stringify(p.before))}::jsonb`,
      sqlStr(p.rationale), sqlStr(p.rule), sqlStr(p.created_by),
    ].join(", ")})`,
);
const chunks: string[] = [];
for (let i = 0; i < values.length; i += 500) {
  chunks.push(
    `INSERT INTO public.exp_category_proposals (${cols}) VALUES\n${values.slice(i, i + 500).join(",\n")}\n` +
      `ON CONFLICT (target_table, target_key) WHERE state IN ('pending','approved') DO NOTHING;`,
  );
}
await Bun.write(
  join(outDir, `proposals_${batch}.insert.sql`),
  `-- ${proposals.length} proposals, batch ${batch}. DO NOT RUN until Scott has reviewed review_batch_1.md.\n` +
    `-- Idempotent: re-running inserts nothing new while the same targets are pending/approved.\n` +
    `BEGIN;\n${chunks.join("\n\n")}\nCOMMIT;\n`,
);

// ---- review sheet: 20 stratified, deterministic samples ------------------------------
const QUOTA: [string, number][] = [
  ["T2", 3], ["T3.relabel_geo", 2], ["T3.retire_slot", 2], ["T3.retire_alias", 2], ["T3.retire_dup", 1],
  ["T5", 3], ["K1", 4], ["R2.set_person", 1], ["R2.retire_dup", 1], ["R3", 1],
];
const sample: Proposal[] = [];
for (const [rule, n] of QUOTA) {
  const pool = proposals
    .filter((p) => p.rule === rule)
    .sort((a, b) => hash(keyOf(a)) - hash(keyOf(b)));
  const picked: Proposal[] = [];
  // diversity: prefer distinct gcids and (for K1) distinct source values
  for (const p of pool) {
    if (picked.length >= n) break;
    const dupG = picked.some((q) => q.gcid === p.gcid);
    const dupV = rule === "K1" && picked.some((q) => q.before.value === p.before.value);
    if (!dupG && !dupV) picked.push(p);
  }
  for (const p of pool) if (picked.length < n && !picked.includes(p)) picked.push(p);
  sample.push(...picked);
}

const show = (v: Json | undefined) => (v === undefined || v === null ? "—" : String(v)).replaceAll("|", "\\|");
function beforeAfter(p: Proposal): [string, string] {
  if (p.target_table === "exp_taxonomy") {
    const b = `${show(p.before.level ?? (p.rule === "T5" ? "question" : null))}: \`${show(p.before.term)}\``;
    return [b, p.op === "retire" ? "retired (is_active=false)" : `\`${show(p.payload.term)}\``];
  }
  if (p.target_table === "exp_category_knowledge") {
    return [`"${show(p.before.label)}" → \`${show(p.before.value)}\``, `\`${show(p.payload.value)}\``];
  }
  const b = `${show(p.before.node_name)} (${show(p.before.schema_type ?? p.before.entity_scope)}.${show(p.before.schema_property)})`;
  if (p.op === "retire") {
    const kept = p.before.kept_slug ? `; keeps ${show(p.before.kept_scope)} \`${show(p.before.kept_slug)}\`` : "";
    return [b, `retired (is_active=false)${kept}`];
  }
  return [b, Object.entries(p.payload).map(([k, v]) => `${k} = ${show(v)}`).join(", ")];
}

const md: string[] = [
  `# Review batch 1 — deterministic cleanup (\`${batch}\`)`,
  "",
  `Generated ${new Date().toISOString().slice(0, 10)} by tools/enrichment/propose.ts. Nothing has been inserted or applied.`,
  "",
  "## What is proposed",
  "",
  "| Rule | Rows | Categories | Op |",
  "|---|---:|---:|---|",
  ...Object.entries(summary).map(
    ([r, s]) => `| ${r} | ${s.rows} | ${s.categories} | ${proposals.find((p) => p.rule === r)?.op} |`,
  ),
  `| **Total** | **${proposals.length}** | **${new Set(proposals.map((p) => p.gcid)).size}** | |`,
  "",
  rejected.length
    ? `Dropped before proposing: ${rejected.length} (${[...new Set(rejected.map((r) => r.reason))].join("; ")}).`
    : "Nothing dropped.",
  "",
  "## Sample (20, stratified by rule, deterministic)",
  "",
  "| # | Rule | Category | Before | After |",
  "|---:|---|---|---|---|",
  ...sample.map((p, i) => {
    const [b, a] = beforeAfter(p);
    return `| ${i + 1} | ${p.rule} | ${p.gcid.replace("gcid:", "")} | ${b} | ${a} |`;
  }),
  "",
  "## Rules in one line each",
  "",
  ...Object.keys(summary).map((r) => `- **${r}** — ${RATIONALE[r]}.`),
  "",
  "## Judgement calls to confirm",
  "",
  "- T2 matches the word `gbp` only; 15 engine_v1 terms saying \"google business\" are left alone.",
  "- T3 treats `{county}` as a standard slot alongside city/neighborhood/state/zip; `{region}`/`{prefecture}` map to `{state}`, `{suburb}`/`{district}` to `{neighborhood}`.",
  "- K1 maps quote requests to `AskAction` (the curated precedent) rather than `QuoteAction` (schema.org: the *business* quotes a price).",
  "- R2 retires instead of fixing when the category already has a Person.hasOccupation node in the same ring.",
  "- Some conversion-action labels themselves contain slots (\"…from Dr. {name}\"); K1 only fixes schema_action, not labels.",
  "",
  "## Decision",
  "",
  "Approve all / approve by rule / reject by rule, plus any row numbers to exclude. On approval Claude runs",
  `\`proposals_${batch}.insert.sql\`, then \`exp_category_proposal_review('${batch}', NULL, true, '<note>', 'scott')\``,
  `and \`exp_category_proposal_apply('${batch}')\`. Each category is snapshotted first, every change is ledgered,`,
  "and a category whose validation regresses is rolled back and marked failed. Nothing is hard-deleted.",
  "",
];
await Bun.write(join(outDir, "review_batch_1.md"), md.join("\n"));

console.log(JSON.stringify({ batch, raw: rawCounts, proposals: proposals.length, rejected: rejected.length, summary }, null, 1));
