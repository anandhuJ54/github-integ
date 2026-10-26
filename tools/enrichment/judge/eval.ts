// Offline evaluation harness for the relevance judge. No model calls, no network, no database.
//
//   bun tools/enrichment/judge/eval.ts --results <results.json> [--golden golden/golden.json]
//        [--gate strict|decision] [--min 0.95] [--json report.json] [--exclude-contested]
//
// results.json (what the pilot batch runner writes after collecting model output):
//   { "calls": [ { "gcid": "gcid:cannabis_store", "lane": "keyword", "output": <array | JSON string>,
//                  "candidates": [ {term, volume, intent, local_pack} ]   // optional, enables completeness checks
//                } ] }
// Every call is passed through validateJudgeOutput. Rows that fail validation never count as a
// prediction: the golden row is scored as "<invalid>" (disagreement), and the call is counted invalid.
//
// Exit code 0 = pilot exit gate passed, 1 = failed, 2 = usage error.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DECISIONS, REASON_CODES, type Decision, type Lane, type ReasonCode } from "./reason-codes";
import { normTerm, type CategoryContext, type JudgeCandidate, type JudgeRow } from "./types";
import { validateJudgeOutput } from "./validate";

// ---------------------------------------------------------------- types
export interface GoldenRow {
  id: string;
  gcid: string;
  lane: Lane;
  term: string;
  local_pack: boolean | null;
  expected: { decision: Decision; reason_code: ReasonCode; to_lane: Lane | null };
  /** Expected family for keep rows, domain-qualified (informational; not part of the gate). */
  family_hint: string | null;
  provenance: "observed" | "synthetic";
  contested: boolean;
  note: string;
  /** Long-form human explanation (not sent to the model, not scored). */
  rationale?: string;
}
export interface GoldenFile {
  version: string;
  categories: Record<string, CategoryContext>;
  rows: GoldenRow[];
}
export interface ResultCall {
  gcid: string;
  lane: Lane;
  output: unknown;
  candidates?: JudgeCandidate[];
}
export interface ResultsFile {
  calls: ResultCall[];
}

export const INVALID = "<invalid>";
export const MISSING = "<missing>";
export type PredLabel = ReasonCode | typeof INVALID | typeof MISSING;

export interface Prf {
  support: number;
  predicted: number;
  tp: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}
export interface GateCheck {
  name: string;
  pass: boolean;
  value: number;
  threshold: number;
  detail?: string;
}
export interface Disagreement {
  id: string;
  gcid: string;
  lane: Lane;
  term: string;
  expected: GoldenRow["expected"];
  predicted: { decision: Decision | null; reason_code: PredLabel; to_lane: Lane | null; note: string | null };
  contested: boolean;
}
export interface EvalReport {
  golden_version: string;
  n: number;
  judged: number;
  missing: number;
  invalid_rows: number;
  calls: number;
  invalid_calls: number;
  agreement: { decision: number; strict: number; strict_excluding_contested: number; family: number | null; family_n: number };
  by_reason_code: Record<string, Prf & { strict_agreement: number | null }>;
  exclude: Prf; // positive class: expected/predicted decision === "exclude"
  not_keep: Prf; // positive class: decision !== "keep" (exclude or move)
  false_keeps: number; // expected not-keep, predicted keep
  false_excludes: number; // expected keep, predicted not-keep
  decision_confusion: Record<string, Record<string, number>>;
  reason_confusion: Record<string, Record<string, number>>;
  by_category: Record<string, { n: number; strict: number }>;
  by_lane: Record<string, { n: number; strict: number }>;
  by_provenance: Record<string, { n: number; strict: number }>;
  disagreements: Disagreement[];
  gate: { mode: "strict" | "decision"; min: number; pass: boolean; checks: GateCheck[] };
}

export interface EvalOptions {
  gate?: "strict" | "decision";
  min?: number;
  excludeContested?: boolean;
}

// ---------------------------------------------------------------- core
const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
const keyOf = (gcid: string, lane: string, term: string) => `${gcid}|${lane}|${normTerm(term)}`;

function prf(tp: number, predicted: number, support: number): Prf {
  const precision = ratio(tp, predicted);
  const recall = ratio(tp, support);
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === null || recall === null ? null : 0;
  return { support, predicted, tp, precision, recall, f1 };
}

interface Pred {
  decision: Decision | null;
  reason: PredLabel;
  to_lane: Lane | null;
  family: string | null;
  note: string | null;
}

export function evaluate(golden: GoldenFile, results: ResultsFile, opts: EvalOptions = {}): EvalReport {
  const mode = opts.gate ?? "strict";
  const min = opts.min ?? 0.95;

  // 1. validate every call, collect predictions
  const preds = new Map<string, Pred>();
  const invalidTerms = new Set<string>();
  let invalidCalls = 0;
  for (const call of results.calls) {
    const category = golden.categories[call.gcid];
    const v = validateJudgeOutput(call.output, { lane: call.lane, category, candidates: call.candidates, allowMissing: true });
    if (!v.ok) invalidCalls++;
    for (const r of v.rows as JudgeRow[]) {
      const k = keyOf(call.gcid, call.lane, r.term);
      if (!preds.has(k)) preds.set(k, { decision: r.decision, reason: r.reason_code, to_lane: r.to_lane, family: r.family, note: r.note });
    }
    for (const e of v.errors) if (e.term) invalidTerms.add(keyOf(call.gcid, call.lane, e.term));
  }

  // 2. score
  const rows = golden.rows.filter((g) => !(opts.excludeContested && g.contested));
  const labels: string[] = [...REASON_CODES, INVALID, MISSING];
  const zero = () => Object.fromEntries(labels.map((l) => [l, 0])) as Record<string, number>;
  const reasonConfusion: Record<string, Record<string, number>> = Object.fromEntries(REASON_CODES.map((c) => [c, zero()]));
  const decLabels = [...DECISIONS, INVALID, MISSING];
  const decZero = () => Object.fromEntries(decLabels.map((l) => [l, 0])) as Record<string, number>;
  const decisionConfusion: Record<string, Record<string, number>> = Object.fromEntries(DECISIONS.map((d) => [d, decZero()]));

  let judged = 0, missing = 0, invalidRows = 0, decOk = 0, strictOk = 0, strictNoContested = 0, nNoContested = 0;
  let famOk = 0, famN = 0;
  let falseKeeps = 0, falseExcludes = 0;
  const predictedCount: Record<string, number> = {};
  const tpCount: Record<string, number> = {};
  const supportCount: Record<string, number> = {};
  const bucket = (m: Record<string, { n: number; strict: number }>, k: string, ok: boolean) => {
    (m[k] ??= { n: 0, strict: 0 }).n++;
    if (ok) m[k].strict++;
  };
  const byCategory: Record<string, { n: number; strict: number }> = {};
  const byLane: Record<string, { n: number; strict: number }> = {};
  const byProv: Record<string, { n: number; strict: number }> = {};
  const disagreements: Disagreement[] = [];
  let exTp = 0, exPred = 0, exSup = 0, nkTp = 0, nkPred = 0, nkSup = 0;

  for (const g of rows) {
    const k = keyOf(g.gcid, g.lane, g.term);
    const p = preds.get(k);
    const exp = g.expected;
    supportCount[exp.reason_code] = (supportCount[exp.reason_code] ?? 0) + 1;
    let predLabel: PredLabel;
    let ok = false;
    let decisionMatch = false;
    if (!p) {
      predLabel = invalidTerms.has(k) ? INVALID : MISSING;
      if (predLabel === INVALID) invalidRows++;
      else missing++;
    } else {
      judged++;
      predLabel = p.reason as PredLabel;
      predictedCount[p.reason] = (predictedCount[p.reason] ?? 0) + 1;
      decisionMatch = p.decision === exp.decision;
      ok = decisionMatch && p.reason === exp.reason_code && (exp.to_lane === null || p.to_lane === exp.to_lane);
      if (decisionMatch) decOk++;
      if (ok) tpCount[exp.reason_code] = (tpCount[exp.reason_code] ?? 0) + 1;
      // exclude / not-keep metrics
      if (exp.decision === "exclude") exSup++;
      if (exp.decision !== "keep") nkSup++;
      if (p.decision === "exclude") exPred++;
      if (p.decision !== "keep") nkPred++;
      if (exp.decision === "exclude" && p.decision === "exclude") exTp++;
      if (exp.decision !== "keep" && p.decision !== "keep") nkTp++;
      if (exp.decision !== "keep" && p.decision === "keep") falseKeeps++;
      if (exp.decision === "keep" && p.decision !== "keep") falseExcludes++;
      if (g.family_hint !== null && exp.decision === "keep") {
        famN++;
        if (p.family !== null && p.family === g.family_hint) famOk++;
      }
    }
    if (!p) {
      if (exp.decision === "exclude") exSup++;
      if (exp.decision !== "keep") nkSup++;
    }
    if (ok) strictOk++;
    if (!g.contested) {
      nNoContested++;
      if (ok) strictNoContested++;
    }
    reasonConfusion[exp.reason_code][predLabel]++;
    decisionConfusion[exp.decision][p ? (p.decision as string) : (predLabel as string)]++;
    bucket(byCategory, g.gcid, ok);
    bucket(byLane, g.lane, ok);
    bucket(byProv, g.provenance, ok);
    if (!ok) {
      disagreements.push({
        id: g.id, gcid: g.gcid, lane: g.lane, term: g.term, expected: exp,
        predicted: { decision: p?.decision ?? null, reason_code: predLabel, to_lane: p?.to_lane ?? null, note: p?.note ?? null },
        contested: g.contested,
      });
    }
  }

  const n = rows.length;
  const byReason: EvalReport["by_reason_code"] = {};
  for (const c of REASON_CODES) {
    const base = prf(tpCount[c] ?? 0, predictedCount[c] ?? 0, supportCount[c] ?? 0);
    byReason[c] = { ...base, strict_agreement: base.recall };
  }

  const decisionAgreement = n ? decOk / n : 0;
  const strict = n ? strictOk / n : 0;
  const coverage = n ? judged / n : 0;
  const compSupport = rows.filter((g) => g.expected.reason_code === "compliance_conflict");
  const compKeeps = compSupport.filter((g) => preds.get(keyOf(g.gcid, g.lane, g.term))?.decision === "keep").length;
  const gateValue = mode === "strict" ? strict : decisionAgreement;
  const checks: GateCheck[] = [
    { name: `agreement (${mode})`, pass: gateValue >= min, value: gateValue, threshold: min },
    { name: "coverage (golden rows with a valid prediction)", pass: coverage >= 0.99, value: coverage, threshold: 0.99 },
    { name: "invalid call rate", pass: results.calls.length > 0 && invalidCalls / results.calls.length <= 0.02, value: results.calls.length ? invalidCalls / results.calls.length : 1, threshold: 0.02 },
    { name: "compliance_conflict rows predicted keep (hard zero)", pass: compKeeps === 0, value: compKeeps, threshold: 0, detail: `${compSupport.length} compliance_conflict rows in set` },
  ];

  return {
    golden_version: golden.version,
    n, judged, missing, invalid_rows: invalidRows,
    calls: results.calls.length, invalid_calls: invalidCalls,
    agreement: { decision: decisionAgreement, strict, strict_excluding_contested: nNoContested ? strictNoContested / nNoContested : 0, family: famN ? famOk / famN : null, family_n: famN },
    by_reason_code: byReason,
    exclude: prf(exTp, exPred, exSup),
    not_keep: prf(nkTp, nkPred, nkSup),
    false_keeps: falseKeeps,
    false_excludes: falseExcludes,
    decision_confusion: decisionConfusion,
    reason_confusion: reasonConfusion,
    by_category: byCategory,
    by_lane: byLane,
    by_provenance: byProv,
    disagreements,
    gate: { mode, min, pass: checks.every((c) => c.pass), checks },
  };
}

// ---------------------------------------------------------------- rendering
const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(1).padStart(5)}%`);

function matrixText(m: Record<string, Record<string, number>>, rowLabels: string[], colLabels: string[]): string {
  const short = (s: string) => (s.length > 9 ? s.slice(0, 9) : s);
  const cols = colLabels.filter((c) => rowLabels.some((r) => (m[r]?.[c] ?? 0) > 0) || false);
  const head = ["expected\\pred".padEnd(24), ...cols.map((c) => short(c).padStart(9))].join(" ");
  const lines = [head];
  for (const r of rowLabels) {
    const total = colLabels.reduce((a, c) => a + (m[r]?.[c] ?? 0), 0);
    if (total === 0) continue;
    lines.push([r.padEnd(24), ...cols.map((c) => String(m[r]?.[c] ?? 0).padStart(9))].join(" "));
  }
  return lines.join("\n");
}

export function renderReport(r: EvalReport): string {
  const L: string[] = [];
  L.push(`Relevance judge evaluation vs ${r.golden_version}`);
  L.push(`golden rows ${r.n} | judged ${r.judged} | missing ${r.missing} | invalid rows ${r.invalid_rows} | calls ${r.calls} (invalid ${r.invalid_calls})`);
  L.push("");
  L.push(`AGREEMENT  decision ${pct(r.agreement.decision)}   strict (decision+reason+to_lane) ${pct(r.agreement.strict)}   strict excl. contested ${pct(r.agreement.strict_excluding_contested)}   family (info only) ${pct(r.agreement.family)} of ${r.agreement.family_n}`);
  L.push("");
  const f = (name: string, p: Prf) => `${name.padEnd(12)} precision ${pct(p.precision)}  recall ${pct(p.recall)}  f1 ${pct(p.f1)}  (tp ${p.tp}, predicted ${p.predicted}, support ${p.support})`;
  L.push(f("exclude", r.exclude));
  L.push(f("exclude|move", r.not_keep));
  L.push(`false keeps (should have been removed) ${r.false_keeps}   false excludes (valid term lost) ${r.false_excludes}`);
  L.push("");
  L.push("BY REASON CODE (strict match)         support predicted   precision   recall");
  for (const c of REASON_CODES) {
    const p = r.by_reason_code[c];
    if (p.support === 0 && p.predicted === 0) continue;
    L.push(`  ${c.padEnd(28)} ${String(p.support).padStart(7)} ${String(p.predicted).padStart(9)}   ${pct(p.precision)}   ${pct(p.recall)}`);
  }
  L.push("");
  L.push("DECISION CONFUSION");
  L.push(matrixText(r.decision_confusion, [...DECISIONS], [...DECISIONS, INVALID, MISSING]));
  L.push("");
  L.push("REASON-CODE CONFUSION (rows expected, columns predicted; non-empty columns only)");
  L.push(matrixText(r.reason_confusion, [...REASON_CODES], [...REASON_CODES, INVALID, MISSING]));
  L.push("");
  const seg = (title: string, m: Record<string, { n: number; strict: number }>) => {
    L.push(title);
    for (const [k, v] of Object.entries(m).sort()) L.push(`  ${k.padEnd(32)} ${String(v.n).padStart(4)} rows  ${pct(v.strict / v.n)}`);
    L.push("");
  };
  seg("BY CATEGORY (strict)", r.by_category);
  seg("BY LANE (strict)", r.by_lane);
  seg("BY PROVENANCE (strict)", r.by_provenance);
  L.push(`DISAGREEMENTS (${r.disagreements.length})`);
  for (const d of r.disagreements) {
    L.push(`  ${d.id} [${d.gcid.replace("gcid:", "")}/${d.lane}] "${d.term}"${d.contested ? " (contested)" : ""}: expected ${d.expected.decision}/${d.expected.reason_code}${d.expected.to_lane ? "->" + d.expected.to_lane : ""}, got ${d.predicted.decision ?? "-"}/${d.predicted.reason_code}${d.predicted.to_lane ? "->" + d.predicted.to_lane : ""}`);
  }
  L.push("");
  L.push(`PILOT EXIT GATE (${r.gate.mode} agreement >= ${(r.gate.min * 100).toFixed(0)}%): ${r.gate.pass ? "PASS" : "FAIL"}`);
  for (const c of r.gate.checks) L.push(`  [${c.pass ? "ok" : "FAIL"}] ${c.name}: ${c.value <= 1 && c.threshold <= 1 && c.threshold > 0 ? pct(c.value) : c.value} (threshold ${c.threshold})${c.detail ? " - " + c.detail : ""}`);
  return L.join("\n");
}

// ---------------------------------------------------------------- CLI
function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const resultsPath = arg("results", argv);
  if (!resultsPath) {
    console.error("usage: bun tools/enrichment/judge/eval.ts --results results.json [--golden golden/golden.json] [--gate strict|decision] [--min 0.95] [--json out.json] [--exclude-contested]");
    process.exit(2);
  }
  const goldenPath = arg("golden", argv) ?? new URL("./golden/golden.json", import.meta.url).pathname;
  const golden = JSON.parse(readFileSync(resolve(goldenPath), "utf8")) as GoldenFile;
  const results = JSON.parse(readFileSync(resolve(resultsPath), "utf8")) as ResultsFile;
  const gate = (arg("gate", argv) ?? "strict") as "strict" | "decision";
  if (gate !== "strict" && gate !== "decision") {
    console.error("--gate must be strict or decision");
    process.exit(2);
  }
  const report = evaluate(golden, results, { gate, min: arg("min", argv) ? Number(arg("min", argv)) : 0.95, excludeContested: argv.includes("--exclude-contested") });
  console.log(renderReport(report));
  const jsonOut = arg("json", argv);
  if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(report, null, 2) + "\n");
  process.exit(report.gate.pass ? 0 : 1);
}
