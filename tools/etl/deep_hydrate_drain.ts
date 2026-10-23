// ============================================================================
// Background drain: processes ALL pending exp_etl_staging rows for a gcid in
// bounded batches, applying the field-yield gate. Same parser/writer/gate as the
// cron tick route; the only difference is the HTML transport (web-fetch gateway,
// because the State Farm edge blocks this runtime's IP).
//
//   nohup bun tools/etl/deep_hydrate_drain.ts --batch 200 --concurrency 8 \
//     > /tmp/sf_drain.log 2>&1 &
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import {
  hydrateStagingRow,
  hydrationProgress,
  loadFieldFloor,
  loadPendingStagingRows,
  summarize,
  type HydrationResult,
} from "../../src/lib/etl-deep-hydrate.server";

const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 ? (args[i + 1] ?? d) : d;
};

const GCID = arg("gcid", "gcid:insurance_agent");
const JOB_KEY = arg("job", "statefarm_deep_hydrate");
const BATCH = Number(arg("batch", "200"));
const CONCURRENCY = Number(arg("concurrency", "8"));
const MAX_BATCHES = Number(arg("max-batches", "200"));

const db = createClient(
  process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const AGW_URL = process.env["AGW_URL"]!;
const AGW_TOKEN = process.env["AGW_TOKEN"]!;

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(`${AGW_URL}/f/website-fetch/v1/scrape`, {
      method: "POST",
      headers: { authorization: `Bearer ${AGW_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml"] }),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`gateway ${res.status}`);
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    const json = (await res.json()) as { data?: { rawHtml?: string; html?: string } };
    const html = json.data?.rawHtml ?? json.data?.html;
    if (!html) throw new Error("gateway returned no html");
    return html;
  } catch (err) {
    if (attempt >= 2) throw err;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) + Math.random() * 500));
    return fetchHtml(url, attempt + 1);
  }
}

const floor = await loadFieldFloor(db as never, GCID);
console.log("floor:", JSON.stringify(floor));

let batches = 0;
let totals = { processed: 0, promoted: 0, shallow: 0, failed: 0, team: 0 };

while (batches < MAX_BATCHES) {
  const rows = await loadPendingStagingRows(db as never, GCID, BATCH);
  if (!rows.length) {
    console.log("queue empty — drain complete");
    await db.from("exp_etl_hydrate_jobs").update({ status: "done" }).eq("job_key", JOB_KEY);
    break;
  }
  batches += 1;

  const results: HydrationResult[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row?.detail_url) continue;
      try {
        const html = await fetchHtml(row.detail_url);
        results.push(await hydrateStagingRow(db as never, row, html, floor, fetchHtml));
      } catch (err) {
        results.push({
          stage_id: row.stage_id,
          detail_url: row.detail_url,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const s = summarize(results);
  totals = {
    processed: totals.processed + s.processed,
    promoted: totals.promoted + s.promoted,
    shallow: totals.shallow + s.shallow,
    failed: totals.failed + s.failed,
    team: totals.team + s.team_members_created,
  };
  const progress = await hydrationProgress(db as never, GCID);

  const { data: job } = await db
    .from("exp_etl_hydrate_jobs")
    .select("processed, promoted, shallow, failed")
    .eq("job_key", JOB_KEY)
    .maybeSingle();
  await db
    .from("exp_etl_hydrate_jobs")
    .update({
      status: progress.remaining === 0 ? "done" : "running",
      last_run_at: new Date().toISOString(),
      processed: Number(job?.["processed"] ?? 0) + s.processed,
      promoted: Number(job?.["promoted"] ?? 0) + s.promoted,
      shallow: Number(job?.["shallow"] ?? 0) + s.shallow,
      failed: Number(job?.["failed"] ?? 0) + s.failed,
      last_error: s.failures[0]?.error ?? null,
    })
    .eq("job_key", JOB_KEY);

  console.log(
    `batch ${batches}: +${s.promoted} promoted, ${s.shallow} shallow, ${s.failed} failed | ` +
      `deep ${progress.deep} / ${progress.total}, remaining ${progress.remaining}`,
  );
  if (progress.remaining === 0) break;
}

console.log("totals:", JSON.stringify(totals));
