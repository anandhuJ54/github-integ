# disco-ai-worker — Phase 2 handlers + definition-aware discovery

One file changes: `src/routes/api/public/disco-ai-worker.ts`. No migrations — the RPCs
(`disco_discover_ingest`, `disco_method_ingest`, `disco_map_site_ingest`) already exist as
SECURITY DEFINER functions. Shared-secret header and the propose-only/governed-RPC rule stay.

## 1. Boundary-aware `discover_companies`

- Read `prompt_input.boundary` and `prompt_input.complexity`.
- When `boundary` is present, build the prompt per spec §1: the definition, the joined
  `includes` list, a bulleted `excludes` list rendered as `type → goes_to`, and the
  `subtypes` names as available tags. Ask for 10–30 companies, official domain only.
- When `boundary` is absent (long-tail categories), keep the existing slug-only prompt.
- Add optional `subtype` (string) to the `return_top_companies` tool schema; keep
  `name` / `domain` / `authority_rank` required and the same name+domain validation filter.
- Write-back unchanged: `disco_discover_ingest(p_request_id, p_companies)`.

## 2. New handler: `classify_method`

Input `{ category, domain }`.

- Fetch `https://{domain}/`, and follow one roster-style link ("find a loan officer",
  "locations", "agents") when the homepage HTML exposes one.
- Classify mechanically first: 403 / anti-bot / CAPTCHA → `needs_proxy`; DNS failure,
  timeout, or persistent 5xx → `unreachable`; 200 with real entity data in raw HTML
  (names, JSON-LD, `__NEXT_DATA__`) → `server_crawl`; 200 with an empty JS shell →
  `needs_js_api`. Only when server-rendered vs JS-shell is genuinely ambiguous does it ask
  Sonnet to judge from a markup excerpt.
- Call `disco_method_ingest(p_request_id, p_domain, p_method, p_evidence)` with a short
  evidence string. The RPC mirrors the method to the source registry and auto-queues
  `map_site` for `server_crawl` — the worker never queues that itself.

## 3. New handler: `map_site`

Input `{ category, domain }`; only ever queued for `server_crawl` sources.

- Fetch the roster/directory page, collect candidate entity detail URLs, then fetch one
  deepest detail page.
- Send Sonnet the category boundary (for field relevance) plus the detail-page markup and
  have it emit the contract via a forced tool: `roster_pattern`, `detail_pattern`
  (required), `field_floor` (int), `extraction` map of our-field → source path.
- Call `disco_map_site_ingest(p_request_id, p_contract)`. The RPC rejects a contract with
  no `detail_pattern` or `field_floor < 5` and marks the request error — the worker
  surfaces that error rather than trying to soften the contract to pass.

## Shared behavior

- The existing drain loop, batch of 5, `pending → sent` transition, and per-row
  `status='error'` with the message in `response` all stay as-is; the three tools are
  branches of the same switch. Unknown tools still error that row.
- Network fetches get a timeout and a plain browser-ish User-Agent so a hang can't stall
  the batch; fetch failures become the `unreachable` / error path, never a thrown 500.

## Test after deploy

Trigger `POST /api/public/disco-ai-worker` once with the secret header. It picks up the
pending mortgage-lender discovery request; I'll report the returned list and confirm it
excludes wholesalers (UWM), brokers, and depository banks while tagging subtypes.

## Technical notes

- `DISCO_MODEL` is set to `claude-sonnet-5`; the route reads it at call time. If the
  Anthropic API rejects that model id, the run will error visibly and I'll report the exact
  response rather than silently substituting a different model.
- Per the route-splitting rule, prompt builders and fetch/classify helpers live as plain
  module functions in the same route file (it declares a file route, not `createServerFn`),
  so no splitting hazard applies.
