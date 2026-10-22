# disco-ai-worker — deployed as a server endpoint, not an Edge Function

The uploaded worker is Deno/Edge-Function code. This project runs on TanStack Start, where
new backend logic goes in server routes that deploy with the app — and Lovable Cloud gives
no dashboard to paste Edge Function code into. So I'll port the same worker, verbatim in
behavior, to an endpoint I can deploy and trigger from here.

## What gets built

`src/routes/api/public/disco-ai-worker.ts` — POST endpoint that does exactly what your file does:

1. Reads up to 5 `pending` rows from `disco_llm_requests` (service-role client, loaded inside
   the handler).
2. Marks each `sent`.
3. For `tool = 'discover_companies'`: calls Anthropic Messages API with the same
   `return_top_companies` forced-tool contract and the same prompt (10–30 US companies,
   official domain only, ranked by authority).
4. Filters out entries missing name/domain, then writes back **only** through
   `disco_discover_ingest(p_request_id, p_companies)` — no direct table writes to the graph.
5. On any failure: sets that row to `status='error'` with the message in `response`, same as
   your version.
6. Any other tool value → `tool not yet implemented` error on that row. Phase 2 (`map_site`,
   `classify_method`) leaves the same switch slots.
7. Returns `{ processed: [...] }` JSON.

## Secrets

- `ANTHROPIC_API_KEY` — already configured on this project; no action needed unless you want
  a different key on it.
- `DISCO_MODEL` — I'll read it if set, defaulting to `claude-sonnet-4-6` (repo canon; I can't
  verify `claude-sonnet-5` exists as a model id). Say the word if you want it pinned instead.
- Supabase URL / service-role key are already injected server-side.

## Access control

`/api/public/*` bypasses site auth, so the handler requires a shared-secret header
(`x-disco-worker-key`) checked against a `DISCO_WORKER_KEY` secret I'll generate. Without it
the endpoint would be a public, credit-spending trigger. Requests without the header get 401.

## Triggering

Once deployed I invoke it once from here and we watch the ranked mortgage-lender list land in
`disco_proposals` (state pending) via `disco_discover_ingest`, then it shows in the Category
Population review queue. If you want it to self-drain every minute later, that's a pg_cron
`net.http_post` to the stable project URL with the header — separate, opt-in step.

## Not doing

- No Edge Function is created (stack rule, and no dashboard exists on Lovable Cloud).
- No changes to the disco tables, RPCs, or any `exp_*` model table.
