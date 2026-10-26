// ============================================================================
// Deep-hydration pilot runner (operator tool).
// Uses the SAME parser + writer as /api/public/etl-deep-hydrate; the only
// difference is the HTML transport, which here goes through the operator's
// web-fetch gateway (State Farm edge blocks this sandbox's egress IP).
//
//   bun tools/etl/deep_hydrate_pilot.ts --limit 100 \
//     --include https://www.statefarm.com/agent/us/ca/san-jose/angela-frangieh-4j11153pqak
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import {
  hydrateStagingRow,
  loadFieldFloor,
  loadCoreStagingRows,
  summarize,
  type HydrationResult,
} from "../../src/lib/etl-deep-hydrate.server";

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? (args[i + 1] ?? fallback) : fallback;
};

const LIMIT = Number(arg("limit", "10"));
const CONCURRENCY = Number(arg("concurrency", "6"));
const INCLUDE = args
  .map((a, i) => (a === "--include" ? args[i + 1] : null))
  .filter((v): v is string => Boolean(v));

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const AGW_URL = process.env["AGW_URL"]!;
const AGW_TOKEN = process.env["AGW_TOKEN"]!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(`${AGW_URL}/f/website-fetch/v1/scrape`, {
    method: "POST",
    headers: { authorization: `Bearer ${AGW_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["rawHtml"] }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  const json = (await res.json()) as { data?: { rawHtml?: string; html?: string } };
  const html = json.data?.rawHtml ?? json.data?.html;
  if (!html) throw new Error("gateway returned no html");
  return html;
}

const floor = await loadFieldFloor(db as never, "gcid:insurance_agent");
const rows = await loadCoreStagingRows(db as never, LIMIT, INCLUDE);
console.log(`loaded ${rows.length} staging rows`);

const results: HydrationResult[] = [];
let cursor = 0;
async function worker(id: number) {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    if (!row?.detail_url) continue;
    try {
      const html = await fetchHtml(row.detail_url);
      const r = await hydrateStagingRow(db as never, row, html, floor, fetchHtml);
      results.push(r);
      console.log(`[w${id}] ok ${r.field_count} fields — ${row.detail_url}`);
    } catch (err) {
      results.push({
        stage_id: row.stage_id,
        detail_url: row.detail_url,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`[w${id}] FAIL ${row.detail_url}: ${String(err)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

const summary = summarize(results);
console.log("\n=== PILOT SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
await Bun.write("/tmp/deep_hydrate_pilot.json", JSON.stringify({ summary, results }, null, 2));
