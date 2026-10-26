// GATE: compile the category brief for every gcid in the exported dump and
// report structural failures (no entity type, no identity key, no collections,
// no labels, gcid not joining gbp_categories).
//
// Input: tools/category_brief/data/{meta,registry}.json.gz (see pack_dump.ts for
// the read-only SQL) + data/exp_rings.json. Registry rows in the dump are
// collapsed with a count `n`; they are expanded back into n synthetic node rows
// so cardinality / collection logic sees the same shape as the live loader.
//
// Usage: bun tools/category_brief/compile_all.ts [--json] [--strict]
//   --strict exits 1 when any category fails.
import { gunzipSync } from "bun";
import { join } from "node:path";
import {
  briefFailures,
  compileCategoryBrief,
  type BriefFailure,
  type CategoryBriefRows,
  type CategoryShapeRow,
  type RegistryNodeRow,
  type RingRow,
} from "../../src/lib/category-brief";

type MetaRow = {
  gcid: string;
  dn: string | null;
  shape: string | null;
  a: string[] | null;
  rq: string[] | null;
  cl: string[] | null;
  ik: CategoryShapeRow["identity_keys"];
  en: string | null;
  sl: string | null;
  crl: string | null;
  cil: string | null;
  cta: string | null;
  pst: string | null;
  st: string | null;
  tn: number | null;
  cn: number | null;
  em: string | null;
  ear: string | null;
  eaa: string | null;
  eaq: string | null;
  eav: string | null;
};

const dir = join(import.meta.dir, "data");
const gz = async <T>(f: string): Promise<T> =>
  JSON.parse(
    new TextDecoder().decode(
      gunzipSync(new Uint8Array(await Bun.file(join(dir, f)).arrayBuffer())),
    ),
  ) as T;

const meta = await gz<MetaRow[]>("meta.json.gz");
const registry = await gz<Record<string, string>>("registry.json.gz");
const rings = (await Bun.file(join(dir, "exp_rings.json")).json()) as RingRow[];

let malformed = 0;
function expandNodes(gcid: string, packed: string | undefined): RegistryNodeRow[] {
  if (!packed) return [];
  const out: RegistryNodeRow[] = [];
  for (const rec of packed.split("|")) {
    const f = rec.split(",");
    if (f.length !== 11) {
      malformed++;
      continue;
    }
    const [s, ring, p, cm, rq, rv, m, l, c, sp, n] = f;
    for (let i = 0; i < Number(n); i++) {
      out.push({
        node_slug: `${s}.${ring}.${p}.${cm}.${rq}${rv}.${i}`,
        node_name: null,
        ring: ring || null,
        entity_scope: s || null,
        node_class: c || null,
        connection_method: cm || null,
        schema_type: null,
        schema_property: p || null,
        required_for_score: rq === "1",
        score_points: Number(sp),
        counts_toward_m: m === "1",
        owns_lane: l || null,
        requires_verification: rv === "1",
      });
    }
  }
  return out;
}

const byFailure: Record<BriefFailure, string[]> = {
  no_gbp_join: [],
  no_entity_type: [],
  no_identity_key: [],
  no_collections: [],
  no_labels: [],
};
const stats = {
  categories: 0,
  failing: 0,
  scopeFallbackTypes: 0,
  identityKeysFromShape: 0,
  identityKeysDerived: 0,
  cardinalityFromRegistry: 0,
  shapes: {} as Record<string, number>,
  offersByCardinality: { one: 0, few: 0, many: 0, none: 0 } as Record<string, number>,
};

const gcids = new Set([...meta.map((m) => m.gcid), ...Object.keys(registry)]);
const metaBy = new Map(meta.map((m) => [m.gcid, m]));

for (const gcid of [...gcids].sort()) {
  const m = metaBy.get(gcid);
  const rows: CategoryBriefRows = {
    gcid,
    category: m ? { gcid, display_name: m.dn } : null,
    shape: m?.shape
      ? {
          gcid,
          shape: m.shape,
          allowed_entity_types: m.a,
          required_entity_types: m.rq,
          claimable_types: m.cl,
          identity_keys: m.ik,
        }
      : null,
    profileConfig: m?.en
      ? {
          gcid,
          entity_noun: m.en,
          service_label: m.sl,
          credential_label: m.crl,
          credential_id_label: m.cil,
          cta_label: m.cta,
          schema_type: m.pst,
        }
      : null,
    nodes: expandNodes(gcid, registry[gcid]),
    completeness: m ? { total_node_types: m.tn, core_node_types: m.cn, expected_m: m.em } : null,
    schemaTypes: m?.st ? [{ schema_type: m.st }] : [],
    ear: m ? { ear: m.ear } : null,
    eaa: m ? { eaa: m.eaa } : null,
    eaq: m ? { eaq: m.eaq } : null,
    eav: m ? { eav: m.eav } : null,
    rings,
  };
  const brief = compileCategoryBrief(rows);
  const failures = briefFailures(brief);
  stats.categories++;
  if (failures.length) stats.failing++;
  for (const f of failures) byFailure[f].push(gcid);
  stats.shapes[brief.shape ?? "null"] = (stats.shapes[brief.shape ?? "null"] ?? 0) + 1;
  for (const e of brief.entityTypes) {
    if (e.scopeFallback) stats.scopeFallbackTypes++;
    if (e.identityKeys.some((k) => k.source === "shape")) stats.identityKeysFromShape++;
    else stats.identityKeysDerived++;
    stats.cardinalityFromRegistry += e.collections.filter(
      (c) => c.cardinalitySource === "registry",
    ).length;
  }
  const primary = brief.entityTypes.find((e) => e.primary);
  const offers = primary?.collections.find((c) => c.key === "offers");
  stats.offersByCardinality[offers?.cardinality ?? "none"]++;
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ stats, malformed, failures: byFailure }, null, 2));
} else {
  console.log(`category brief gate — ${stats.categories} categories compiled`);
  console.log(`  failing categories: ${stats.failing}`);
  for (const [k, v] of Object.entries(byFailure)) {
    console.log(
      `  ${k.padEnd(16)} ${String(v.length).padStart(5)}${v.length ? `  e.g. ${v.slice(0, 5).join(", ")}` : ""}`,
    );
  }
  console.log(`  malformed packed registry records: ${malformed}`);
  console.log(`  shapes: ${JSON.stringify(stats.shapes)}`);
  console.log(
    `  primary-type offers collection cardinality: ${JSON.stringify(stats.offersByCardinality)}`,
  );
  console.log(
    `  entity types reading a fallback scope: ${stats.scopeFallbackTypes}; identity keys from shape: ${stats.identityKeysFromShape}, derived: ${stats.identityKeysDerived}; collections with registry cardinality: ${stats.cardinalityFromRegistry}`,
  );
}
if (process.argv.includes("--strict") && stats.failing) process.exit(1);
