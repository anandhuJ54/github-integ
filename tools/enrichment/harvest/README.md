# Evidence harvest

Collects search-demand evidence for ONE category (or one sibling cluster) from DataForSEO and writes
it as JSON. Input to taxonomy enrichment; it does not touch the database and does not call any LLM.

## Setup

Put credentials in `tools/enrichment/.env.local` (already gitignored by the repo's `*.local` rule):

```
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
```

Values are never printed and the Authorization header is never logged. `process.env` is used only if the
file does not provide the variable. Basic auth against `https://api.dataforseo.com/v3/`.

## Usage

```
bun tools/enrichment/harvest/cli.ts <config.json> [--dry-run] [--resume] [--budget <usd>] [--env <path>]
```

- `--dry-run` prints every planned call and a worst-case cost estimate. No credentials needed, no calls.
- `--resume` skips any step whose output file already exists (delete a file to redo that step).
- `--budget` overrides the per-category cap for this run.

Always dry-run first, then run `lean` on a new category before `full`.

## Config

See `example.config.json`.

| field | meaning |
| --- | --- |
| `gcid`, `name` | category identity (gcid must be a real GBP gcid, as everywhere in this repo) |
| `aliases[]`, `existing_keywords[]` | looked up in `keyword_overview` (one task per 700 terms) to get volume for what we already have |
| `seeds[]` | each seed is a `keyword_suggestions` call (empty: falls back to `name`). Lean uses the first 3 |
| `head_queries[]` | each is a SERP call; organic domains are counted across them to find competitors (empty: `name`) |
| `patterns[]` | substrings for the ranked-keywords filter (`%x%`, OR-ed). Split into groups of 6 per request |
| `stems[]` | autocomplete queries; suggestion order is kept (empty: seeds). Lean uses the first 3 |
| `out_dir` | output folder (relative to the cwd) |
| `mode` | `full` or `lean` |

Optional: `budget_usd`, `domain_blocklist` (replaces the default list: wikipedia, youtube, reddit, quora,
pinterest, facebook, instagram, tiktok, linkedin, twitter/x), `top_domains` (5), `pack_keyword_limit`
(40 full / 15 lean), `intent_keyword_limit` (1000 full / 300 lean), `suggestion_min_volume` (500),
`ranked_min_volume` (1000), `location_code` (2840), `language_code` (`en`),
`pack_location_name` (`Austin,Texas,United States`).

## Steps and outputs

| file | endpoint | what |
| --- | --- | --- |
| `existing_overview.json` | `keyword_overview/live` | volume/CPC for existing terms; terms the API did not return are kept with `search_volume: null, found: false` |
| `suggestions.json` | `keyword_suggestions/live` | per-seed and merged keyword ideas (volume >= 500) |
| `domains.json` | `serp/google/organic/live/regular` | organic domains per head query, counts, blocked list, `top` 5 competitors |
| `ranked.json` | `ranked_keywords/live` | per top competitor x pattern group (<= 7 filter conditions each), merged by keyword. Lean: written with `skipped: "lean mode"` |
| `autocomplete.json` | `serp/google/autocomplete/live/advanced` | ordered suggestions per stem |
| `intent.json` | `search_intent/live` | intent label for the highest-volume harvested keywords (nulls kept, listed after known volumes) |
| `serp_pack.json` | `serp/google/organic/live/advanced` | per keyword (mobile, Austin): `pack` true/false and the business titles in the map pack. Head queries and seeds first, then highest volume |
| `spend.json` | n/a | every billed call with its `cost`, totals by step and endpoint, the cap |

Null volume means Google did not report one (cannabis and other regulated categories). It is never turned
into 0, and keywords with null volume are still sent to the intent and map-pack steps. Note that the
`suggestion_min_volume` / `ranked_min_volume` filters are applied by DataForSEO and will exclude null-volume
terms there; autocomplete, existing terms and head queries are how null-volume terms enter the evidence.

API or network errors on one call are recorded in that file's `errors[]` and the step continues (the cost of a
billed failure is still counted). A budget abort stops the run.

## Cost and the budget guard

Spend is summed from each response's `cost` field and saved to `spend.json` after every call. Before each call
the guard aborts (exit code 2) if `spent >= cap` or `spent + estimate > cap`. The estimate is only a
pre-flight check; the recorded spend is always the real `cost`. Spend is cumulative per `out_dir`, so
`--resume` runs share one cap. To deliberately start over, delete `spend.json` (and the other files).

Default caps: **$3.00 full, $0.60 lean**. Worst-case estimates (UNVERIFIED rough prices; labs calls ~$0.01 + $0.0001
per item, SERP calls ~$0.002 per 10 results):

- lean (3 seeds, 2 head queries, no ranked step): about $0.15 to $0.40, dry-run shows ~$0.2
- full (all seeds, 5 competitors x pattern groups of ranked keywords): roughly $1 to $2.5 depending on seeds and patterns

A step that is aborted part way writes no file, so `--resume` re-runs that whole step; completed steps are kept.

## Tests

```
bun test tools/enrichment/harvest
```

All HTTP is mocked; nothing calls DataForSEO.

## Files

`cli.ts` entry point, `pipeline.ts` steps, `client.ts` HTTP + guard, `budget.ts`, `endpoints.ts` request builders
and response parsers, `filters.ts` filter-group splitting, `plan.ts` dry-run plan and estimates, `config.ts`,
`env.ts`, `harvest.test.ts`.
