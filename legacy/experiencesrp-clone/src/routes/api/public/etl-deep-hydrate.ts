import { createFileRoute } from "@tanstack/react-router";

/**
 * Background deep-hydration tick (deterministic parsing, no AI).
 *
 *  GET  /api/public/etl-deep-hydrate                 -> progress snapshot (no auth needed, no PII)
 *  POST /api/public/etl-deep-hydrate                 -> process one bounded batch
 *       body: { job_key?, batch_size?, action?: 'run'|'pause'|'resume' }
 *
 * Single-flight: a lease on exp_etl_hydrate_jobs; a second concurrent tick exits.
 * Bounded: batch_size rows per tick. Idempotent: rows already deep are skipped and
 * every write is keyed on detail_url. Paused jobs exit at the entry point.
 */
const DEFAULT_JOB = "statefarm_deep_hydrate";
const MAX_BATCH = 250;
const LEASE_MINUTES = 5;
const CONCURRENCY = 6;

export const Route = createFileRoute("/api/public/etl-deep-hydrate")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const jobKey = new URL(request.url).searchParams.get("job_key") ?? DEFAULT_JOB;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const mod = await import("@/lib/etl-deep-hydrate.server");
        const { data: job } = await supabaseAdmin
          .from("exp_etl_hydrate_jobs")
          .select("*")
          .eq("job_key", jobKey)
          .maybeSingle();
        if (!job) return new Response("Unknown job", { status: 404 });
        const progress = await mod.hydrationProgress(supabaseAdmin as never, String(job["gcid"]));
        return Response.json({ job, progress });
      },

      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          job_key?: string;
          batch_size?: number;
          action?: string;
        };
        const jobKey = body.job_key ?? DEFAULT_JOB;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const mod = await import("@/lib/etl-deep-hydrate.server");
        const db = supabaseAdmin as never;

        const { data: job } = await supabaseAdmin
          .from("exp_etl_hydrate_jobs")
          .select("*")
          .eq("job_key", jobKey)
          .maybeSingle();
        if (!job) return new Response("Unknown job", { status: 404 });

        // job control
        if (body.action === "pause" || body.action === "resume") {
          const status = body.action === "pause" ? "paused" : "idle";
          await supabaseAdmin
            .from("exp_etl_hydrate_jobs")
            .update({ status, lease_until: null, last_error: null })
            .eq("job_key", jobKey);
          return Response.json({ job_key: jobKey, status });
        }

        // paused-state guard: the scheduler keeps firing regardless of job state
        if (job["status"] === "paused" || job["status"] === "done") {
          return Response.json({ skipped: `job ${job["status"]}` });
        }

        // single-flight lease
        const now = Date.now();
        const lease = job["lease_until"] ? Date.parse(String(job["lease_until"])) : 0;
        if (job["status"] === "running" && lease > now) {
          return Response.json({ skipped: "another tick holds the lease", lease_until: job["lease_until"] });
        }
        const { data: claimed } = await supabaseAdmin
          .from("exp_etl_hydrate_jobs")
          .update({
            status: "running",
            lease_until: new Date(now + LEASE_MINUTES * 60_000).toISOString(),
            last_run_at: new Date().toISOString(),
          })
          .eq("job_key", jobKey)
          .eq("updated_at", job["updated_at"])
          .select("job_key");
        if (!claimed?.length) return Response.json({ skipped: "lease race lost" });

        const gcid = String(job["gcid"]);
        const batch = Math.min(
          Math.max(Number(body.batch_size ?? job["batch_size"] ?? 50), 1),
          MAX_BATCH,
        );

        try {
          const floor = await mod.loadFieldFloor(db, gcid);
          const rows = await mod.loadPendingStagingRows(db, gcid, batch);
          const results: Awaited<ReturnType<typeof mod.hydrateStagingRow>>[] = [];

          let cursor = 0;
          const worker = async () => {
            while (cursor < rows.length) {
              const row = rows[cursor++];
              if (!row?.detail_url) continue;
              try {
                const html = await mod.fetchAgentHtml(row.detail_url);
                results.push(
                  await mod.hydrateStagingRow(db, row, html, floor, mod.fetchAgentHtml),
                );
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

          const summary = mod.summarize(results);
          const progress = await mod.hydrationProgress(db, gcid);
          const done = progress.remaining === 0;

          // circuit breaker: the source edge blocks this runtime's egress —
          // stop instead of burning ticks on requests that can never succeed.
          const blocked =
            results.length > 0 &&
            summary.parsed === 0 &&
            summary.failures.every((f) => /fetch (401|403|429)/.test(f.error ?? ""));
          if (blocked) {
            await supabaseAdmin
              .from("exp_etl_hydrate_jobs")
              .update({
                status: "paused",
                lease_until: null,
                failed: Number(job["failed"] ?? 0) + summary.failed,
                last_error: `source blocked this runtime (${summary.failures[0]?.error}); paused`,
              })
              .eq("job_key", jobKey);
            return Response.json({ job_key: jobKey, paused: "source_blocked", summary, progress });
          }

          await supabaseAdmin
            .from("exp_etl_hydrate_jobs")
            .update({
              status: done ? "done" : "idle",
              lease_until: null,
              processed: Number(job["processed"] ?? 0) + summary.processed,
              promoted: Number(job["promoted"] ?? 0) + summary.promoted,
              shallow: Number(job["shallow"] ?? 0) + summary.shallow,
              failed: Number(job["failed"] ?? 0) + summary.failed,
              last_error: summary.failures[0]?.error ?? null,
            })
            .eq("job_key", jobKey);

          return Response.json({ job_key: jobKey, batch, summary, progress });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await supabaseAdmin
            .from("exp_etl_hydrate_jobs")
            .update({ status: "paused", lease_until: null, last_error: message })
            .eq("job_key", jobKey);
          return Response.json({ error: message, status: "paused" }, { status: 500 });
        }
      },
    },
  },
});
