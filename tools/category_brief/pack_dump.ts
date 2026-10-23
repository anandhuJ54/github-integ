// Packs raw query_database exports (tools/category_brief/data/raw/*.json, each
// `{rows:[...]}`) into the compact gzipped dump compile_all.ts reads:
//   data/meta.json.gz      one row per gbp_categories gcid (shape, labels, volumes, taxonomy counts)
//   data/registry.json.gz  { gcid: "scope,ring,prop,cm,rq,rv,m,lane,class,pts,n|..." }
//
// Raw exports were fetched read-only with (batches of 500 gcids, ordered by gcid):
//
//   -- registry (raw/reg_*.json): active nodes collapsed to one row per
//   -- (scope, ring, property, method, required, verification) with a count n
//   with g as (select gcid from gbp_categories order by gcid offset $O limit 500),
//   r as (select gcid, entity_scope s, ring, schema_property p, connection_method cm,
//           required_for_score rq, requires_verification rv, bool_or(counts_toward_m) m,
//           max(owns_lane) l, max(node_class) c, max(score_points) sp, count(*) n
//         from exp_vertical_node_registry where is_active and gcid in (select gcid from g)
//         group by 1,2,3,4,5,6,7)
//   select gcid, string_agg(concat_ws(',', s, ring, coalesce(p,''), coalesce(cm,''), rq::int,
//     rv::int, m::int, coalesce(l,''), coalesce(c,''), coalesce(sp,0), n), '|') nodes
//   from r group by gcid;
//
//   -- meta (raw/meta.json): gbp_categories LEFT JOIN exp_category_shape, _profile_config,
//   -- _completeness, _schema_type, _ear/_eaa/_eaq/_eav + taxonomy level counts
//   -- (columns: gcid dn et shape a rq cl ik en sl crl cil cta pst st tn cn em ear eaa eaq eav tx)
//
// Usage: bun tools/category_brief/pack_dump.ts
import { gzipSync } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "data");
const raw = join(dir, "raw");

const registry: Record<string, string> = {};
for (const f of readdirSync(raw).filter((f) => f.startsWith("reg_"))) {
  const { rows } = (await Bun.file(join(raw, f)).json()) as {
    rows: { gcid: string; nodes: string }[];
  };
  for (const r of rows) registry[r.gcid] = r.nodes;
}
const { rows: meta } = (await Bun.file(join(raw, "meta.json")).json()) as { rows: unknown[] };

await Bun.write(join(dir, "registry.json.gz"), gzipSync(JSON.stringify(registry)));
await Bun.write(join(dir, "meta.json.gz"), gzipSync(JSON.stringify(meta)));
console.log(`packed ${Object.keys(registry).length} registry gcids, ${meta.length} meta rows`);
