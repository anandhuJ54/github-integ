# The Always-On Profile Engine — How It's Supposed to Work

*A briefing for the ETL team · 2026-09-22*

*(Imported as the master checklist for this workflow on 2026-09-24. All future ETL/discovery/mapping work should be checked against the stations, functions, and non-negotiables below.)*

## The one sentence

> An admin types a category — Mortgage lender, Insurance agency, Dentist — clicks Activate, and the platform discovers the real companies, figures out how to crawl each one, teaches itself to read their pages, pulls the full brand → location → professional hierarchy from the detail pages with every field mapped, passes the graph gauntlet, and inserts great profiles — with a human clicking nothing but "Activate" and "Approve."

That is the whole goal. Everything below is the machine that makes that sentence true, run over and over, across thousands of categories, every day.

The north star is not "a scraper." It's an assembly line where every step that a smart engineer does by hand today is a named, reusable function the platform runs itself. The proof that it works is not that it populates *one* category — it's that it populates the *next* category with **zero new code.**

## The governing principle: the AI proposes, the platform writes

Read this first, because it's the thing most people get wrong when they picture an "AI crawler."

The intelligent steps — *who are the real companies, is this page a directory or a profile, how do I read this site, what field is this* — need an LLM in the loop. But **the AI never writes to the database.** It only ever hands a **proposal** to a governed function, and that function is the only thing allowed to write.

- The AI runs in **Edge Functions** (JavaScript), reads a job, calls the model, and **validates the model's output against a strict schema**.
- It writes results back **only through governed `SECURITY DEFINER` functions** — never a raw table insert.
- Deterministic **pg_net workers** do the heavy crawling for free.

Why this matters: it means the entire safety model holds no matter how the AI behaves. Identity-key dedup, the attribution firewall, the claim firewall, the row-level-security lock, the audit ledger — all of them live in the governed insert. **The AI cannot write to the wrong company, the wrong location, or a claimed customer's profile, because it cannot write at all.** It proposes; `exp_graph_create_entity` decides.

Keep that frame the whole way down the line: **intelligence proposes, governed rails write.**

## The assembly line, station by station

Think of it as one conveyor belt. A category rides from left to right. Each station has a job, a guardrail, and a real function behind it.

### Station 0 — Activate (turn intent into a job)

A human activates a category. That doesn't just "record intent" — it drops a job onto the queue (`disco_jobs`) that the dispatcher (`disco_dispatch`, on pg_cron) picks up. From here, the belt moves on its own.

> **Under the hood:** `exp_etl_activate_category` → `disco_activate` → enqueues `disco_jobs`.

### Station 1 — Discover the real companies (the "who")

The AI is asked one question: *who are the top real companies in this category, and what are their official domains?* It returns a ranked list with authority evidence — not a guess, a defensible shortlist. A human sees the list in the wizard and **confirms or prunes it.** Approval is the only thing that promotes those companies into the pipeline.

> **Under the hood:** the discovery tool lands a proposal in `disco_proposals` (`kind='company_list'`); `disco_confirm_companies` / `exp_etl_approve_companies` write the approved domains into `exp_etl_sources`. *(This is exactly the approve step your teammate is wiring into the Discovery tab right now — there are 3 proposals sitting in `awaiting_human` today.)*

### Station 2 — The Method Checker (easy & free, or hard & expensive?)

Before we crawl a single page in bulk, we ask of **each domain**: *how hard is this site to read?* Two buckets:

- **Easy / free** — the site is openly reachable and its pages carry structured data (JSON-LD, clean HTML). We crawl it with the free pg_net substrate. **This is the vast majority and it costs us essentially nothing.**
- **Complex / costly** — the site blocks bots, hides content behind JavaScript, or needs a proxy or an API. We *flag* it with the method it needs rather than hammering it. These are the exceptions we spend money on deliberately, not by accident.

The whole point of this station is **cost discipline**: spend free where we can, spend real money only where the value justifies it, and never let a hard site silently stall the line.

> **Under the hood:** `exp_probe_methods` / `exp_probe_collect` test reachability; the AI classifier (`disco_method_ingest`, `disco_check_method_complete`) assigns the bucket.

### Station 3 — The Site Mapper / Parser Builder (learn the site once)

This is the crown jewel, and it's where the single most important distinction in the whole engine lives:

> **A directory/roster page is NOT a profile page.**

A roster page ("all our agents in Texas") is an **expansion** node — its only job is to *yield the links* to the real profiles. A detail page (one agent, one branch, one lender) is an **extraction** node — it is the **only** place we are allowed to pull final fields from. The Site Mapper learns the difference for each source *once*: it finds the roster pages, finds the detail-page template behind them, separates the page tiers, and emits a **deterministic parser + field map** the engine reuses for every record on that site.

We built this the hard way. Early on (State Farm) we pulled fields off directory-style pages and got **skeleton profiles — five fields and a name.** The fix is structural, not a reminder: extracting a final field from anything that isn't a detail node is **forbidden** by the pipeline. That's why "detail page not directory page" is a rule the machine enforces, not a best practice we hope people follow.

> **Under the hood:** `disco_map_site_ingest` emits the parser, page-tier map, and field map; `exp_etl_map_fields` binds discovered fields to the model.

### Station 4 — The Field-Yield Gate (no skeletons allowed)

Before any bulk run, the engine fetches the **deepest detail page** on the source, enumerates **every field that page actually offers**, and records that as the source's **field-floor**. Then it samples records — and the bulk run stays **blocked until the sample hits ≥ 70% of that floor.**

This is the quality gate that guarantees we build *great* profiles, not thin ones. A source cannot reach "done" as skeletons. If a lender's detail page offers NMLS ID, licensed states, branch address, phone, and a "Get Pre-Approved" CTA, then a profile with just name + city **fails the gate** and the run doesn't proceed.

> **Under the hood:** `exp_etl_gate_full_pull` + `exp_etl_check_saturation` enforce the floor.

### Station 5 — The Run (crawl the frontier, deterministically)

Now the belt moves at volume. A **generic frontier builder** walks the learned site map — roster pages yield URLs, detail pages get queued — and the free deterministic workers fetch and extract on the parser we learned in Station 3. No bespoke per-company code; the same engine drives every source.

> **Under the hood:** `exp_etl_frontier_discover` → `exp_etl_fetch_tick` / `exp_etl_fetch_collect` → `exp_etl_extract_tick` / `exp_etl_extract_jsonld` → staged in `exp_etl_staging`.

### Station 6 — The Node Creator (governed insert of the hierarchy)

Extracted records become graph nodes — the full **brand → location → professional** hierarchy — but only through the one governed door. That door does identity-key dedup (so re-running never duplicates), runs the attribution firewall and the **claim firewall** (so we never overwrite a customer who has claimed their profile), and writes the audit ledger.

> **Under the hood:** `exp_graph_create_entity` is the only writer; `exp_etl_guard_claimed` protects claimed profiles.

### Station 7 — The Enhancer / Reconciler (make the profile rich and correct)

Raw insert isn't the finish line — enrichment is. This station reconciles conflicting values across sources, fills the deeper fields, and runs every discovered product / CTA / attribute through **map-or-add**: match it to the existing taxonomy, or add it tagged as NEW and report it — deduped, never silently invented. **Missing data is flagged, never fabricated.**

> **Under the hood:** `exp_etl_start_recon` / `exp_etl_recon_ingest` / `exp_etl_reconcile_value`; `exp_etl_map_or_add_product` for taxonomy discipline.

### Station 8 — The Gauntlet (prove it before it counts)

Nothing is "done" until it passes validation: structural checks, richness floors, cross-layer integrity, schema.org correctness, person-lane and brand-lane rules, GBP coverage. If a category fails the gauntlet, it does not launch.

> **Under the hood:** `exp_validate_graph` plus the family — `exp_validate_category_full`, `exp_validate_richness`, `exp_validate_crosslayer`, `exp_validate_schemaorg`, `exp_validate_pro_lane`, `exp_validate_brand_lane`, and more.

### Station 9 — Refresh (always-on, but at rest by default)

When a category is live, it needs to stay fresh. The refresh updater re-runs a source on a schedule — but it is **OFF by default** and armed only when a human clicks "Refresh." No idle crons burning money after a run finishes. The engine is *capable* of always-on; it is *not* carelessly always-on.

## When it's NOT the easy way — the acquisition ladder

Station 5 on the belt is the *free* lane. But the Method Checker sorts every source, and most categories have some sites that don't give it up for free. Here's the honest, complete answer to "how do we get the hard ones" — a ladder we climb only as far as we must, cheapest and safest rung first. **Every lane rejoins the exact same governed pipeline** (yield gate → node creator → gauntlet); only the *acquisition* differs.

| # | Method | When we use it | Cost | Status today |
|---|--------|-----------------|------|---------------|
| 1 | Free deterministic crawl | Open HTML + JSON-LD (pg_net workers) | Free | built — the easy lane |
| 2 | Rendered fetch (headless) | JavaScript-only pages — execute JS, then read | Low $ | to build |
| 3 | Structured feeds / APIs | GBP, sitemaps, licensing boards, official datasets | Low $ | partial — GBP feed is live: ~198K attribute rows; others to add |
| 4 | First-party / claim | The entity supplies its own data — Nora claim interview + connectors | Free / earned | partial — hooks exist (`oauth_connections`, `claim_queue`, `exp_claim*`); harvester planned |
| 5 | Proxy + polite throttle | Bot-blocked sites, within robots/ToS | Med $ | to build |
| 6 | Licensed data providers | Buy the dataset when the value justifies it | $$$ | to build (policy + spend decision) |
| 7 | Human-assisted capture | Long-tail one-offs the machine can't reach | Labor | to build |

**How the Method Checker knows which lane:** every source row already carries `access_method`, `crawl_method`, `robots_tos_status`, and `page_kinds`. The classifier writes the lane; the run engine is what has to *act* on it. Lane 1 is built and being generalized (Phase 3). The GBP structured feed (Lane 3) is already powering coverage at scale. Lanes 2, 5, 6, 7 are classified-and-flagged today but their executors are the **next frontier of the build** — this is the part to be candid about in the room.

**The rule that makes the hard lane safe:** climbing the ladder changes only *how* we acquire — never the guardrails. A hard site still faces the **field-yield floor**: if we can't get it to ≥70% of what a real detail page offers, it stays **flagged, not shipped as a skeleton.** We never fabricate to fill a gap, and we never crawl outside robots/ToS. So "we couldn't get it the easy way" resolves to one of two honest outcomes: we climb to a method that works, or the source waits — it never becomes a fake profile.

### The methods we have NOT handled yet — what each one takes to build

This is the candid part for the team. Lane 1 (free crawl) is built and Lane 3 is partly live through the GBP feed. The rest are *recognized and flagged by the Method Checker* but their **executors do not exist yet.** Each is a discrete, buildable module that plugs into the same governed pipeline — here is what each one is, when we need it, and what standing it up actually involves.

**Rendered fetch (headless browser) — Lane 2.** Many modern sites ship an empty HTML shell and paint the real content with JavaScript after load; our free deterministic fetcher sees the shell and comes back with nothing. The fix is a headless-browser worker (e.g. a Playwright/Chromium runner in an edge function or a small service) that loads the page, lets the scripts run, and *then* hands the rendered DOM to the same parser + field map the Site Mapper already produces. **What it takes:** a rendering runtime we don't have in the pure pg_net path, a per-render time/cost budget, and a rule for when to escalate a URL from free-fetch to rendered-fetch (usually: free fetch returned below the field floor). Everything downstream is unchanged.

**Structured feeds & APIs beyond GBP — Lane 3.** We already ingest Google Business Profile attributes at scale (~198K rows), which proves the pattern: when an authoritative machine-readable source exists, prefer it over crawling anything. The unhandled part is the *long tail* of other feeds — XML sitemaps for fast URL discovery, state licensing-board lookups (NMLS for loan officers, DOI for insurance agents, real-estate commissions), association directories, and official open datasets. **What it takes:** a small per-feed adapter each (auth, rate limits, response mapping into our field model) and a source-precedence rule so a feed value beats a crawled value when they disagree. High trust, low cost — this is often the *best* data, not a fallback.

**First-party / claim — Lane 4.** The highest-quality data comes from the entity itself. When a professional or brand claims their profile (or connects a system through OAuth), they can supply and verify their own fields — and we already have the hooks: `oauth_connections`, `claim_queue`, and the `exp_claim*` tables exist. The unhandled part is the **Nora claim interview** (a guided flow that asks the owner for the fields we're missing) and the **connector harvesters** that pull from a system they authorize. **What it takes:** the interview UX + a governed write path for owner-supplied fields (still through the same insert, tagged as first-party so it can outrank crawled data), and per-connector adapters. This is the strategic end-state — data given to us, not taken — and it feeds the flywheel because a claimed profile is both richer *and* a sales relationship.

**Proxy + polite throttle — Lane 5.** Some sites actively block bots — IP bans, rate caps, geo-walls — even though their content is public and within their terms. Reaching them politely needs rotating/residential IPs and conservative pacing (we already store `min_delay_seconds` and `pull_window` per source, so the throttle scaffolding is there). **What it takes:** a proxy provider integration and a hard compliance gate — we only ever do this *within* robots/ToS (`robots_tos_status` must be clear), never to defeat a site that has said no. This one is as much a policy decision as an engineering task.

**Licensed data providers — Lane 6.** For some categories the fastest, cleanest path is simply to *buy* a vetted dataset rather than assemble it ourselves. **What it takes:** a commercial decision (which providers, what it costs, license terms about redistribution and displaying the data), then a straightforward bulk-import adapter into the governed insert with clear provenance tagging. The engineering is easy; the diligence is the work — the license has to permit how we publish it, and provenance has to be recorded so we can honor takedown/refresh terms.

**Human-assisted capture — Lane 7.** There will always be a long tail the machine can't reach economically — a handful of high-value entities behind a login, a PDF, or an idiosyncratic site. For those, a person captures the fields into the same governed forms the claim flow uses. **What it takes:** an internal capture queue and UI (small), plus the discipline to reserve it for high-value one-offs rather than letting it become a crutch. It exists so the pipeline degrades gracefully to "a human did it correctly," never to "we made it up."

**The through-line:** none of these change the graph, the gauntlet, or the insert rules — they are all just *ways to fill the same bucket*, and each one still has to clear the field-yield floor before it counts. Building them is additive and independent; we can stand them up one lane at a time, in the order the categories we care about actually demand.

## The two ideas to hammer this morning

**1. Detail page, never directory page.** The difference between a world-class profile and an embarrassing five-field stub is entirely about *which page tier you extract from*. Roster pages give you links; detail pages give you people. The engine enforces this structurally, and the field-yield gate makes it measurable — a source literally cannot finish as skeletons.

**2. Easy-and-free first, complex-and-costly only when it's worth it.** The method checker sorts every domain so we crawl the open web for free at massive scale and spend real money only on the sites that block us and are worth the fight. That's what makes "thousands of categories daily" affordable instead of ruinous.

## The vision in one picture

*The belt, drawn out and color-coded by who does the work: Activate (human) → Discover (AI+human) → Method Checker (AI) → Site Mapper (AI) → Field-Yield Gate (machine) → Run/Acquire (Lane 1-7) → Node Creator (governed) → Enhancer (AI) → Gauntlet (machine) → Refresh (armed by human). Every source is routed by the Method Checker into Lane A (easy & free, deterministic crawl — built) or Lane B (the hard-site ladder — mostly to build); both lanes rejoin the same governed pipeline at the Field-Yield Gate.*

```
———————————— the belt runs itself, thousands of categories deep ————————————

Activate → Discover → Method → Site-Map → Yield-Gate → Run → Node-Create → Enhance → Gauntlet → (Refresh)
 human     AI+human     AI       AI         machine    free   governed      AI       machine    armed by human
 click     approve    checker  builder     validate    crawl   insert     reconcile

          the AI PROPOSES at every smart step ————————————————————————|
          governed FUNCTIONS are the only writers ————————————————————|
```

Every day the queue fills with categories; the belt turns them into great, deduped, gauntlet-passed profiles; humans touch only the two decision points (approve the companies, arm the refresh). That is the always-on profile engine.

## Where we honestly are today (so the team knows what's real vs. goal)

| Station | Function(s) | Status |
|---------|-------------|--------|
| 0 Activate | `exp_etl_activate_category`, `disco_activate`, `disco_dispatch` | built |
| 1 Discover | `disco_discover_ingest`, `disco_confirm_companies`, `exp_etl_approve_companies` | built · approve UI being wired now (3 proposals `awaiting_human`) |
| 2 Method checker | `exp_probe_methods`, `disco_method_ingest`, `disco_check_method_complete` | built |
| 3 Site mapper / parser | `disco_map_site_ingest`, `exp_etl_map_fields` | built |
| 4 Field-yield gate | `exp_etl_gate_full_pull`, `exp_etl_check_saturation` | built (permanent gate; ran on the 19K State Farm hydration) |
| 5 Run engine | `exp_etl_frontier_discover`, `exp_etl_fetch_*`, `exp_etl_extract_*` | active build (Phase 3): retiring the last bespoke `sf_*` code so one generic engine drives every source |
| 6 Node creator | `exp_graph_create_entity`, `exp_etl_guard_claimed` | built |
| 7 Enhancer / reconcile | `exp_etl_start_recon`, `exp_etl_reconcile_value`, `exp_etl_map_or_add_product` | built |
| 8 Gauntlet | `exp_validate_graph` + family | built |
| 9 Refresh | `disco_refresh_schedule` | to build (off-by-default scheduler) |

**The remaining work, plainly:** finish the generic run engine so no category needs hand-written crawl code (Phase 3), build the off-by-default refresh scheduler (Phase 4), then prove the whole line end-to-end on **Mortgage lender** and immediately re-run on a **second category with zero new code** (Phase 5). That reusability re-run is the real acceptance test — everything before it is rehearsal.

## The non-negotiables (the rules that never bend)

1. **Page-role separation** — extract only from detail nodes; roster pages yield links only.
2. **Field-yield floor** — no bulk run, and no "done," below the detail page's field floor.
3. **Governed inserts only** — every write through `exp_graph_create_entity`; dedup + attribution + claim firewalls always on.
4. **Real data only** — missing is flagged, never invented, ever.
5. **Taxonomy discipline** — every new field/product mapped-or-added and reported, never silently created.
6. **At rest by default** — no idle crons; refresh armed only by a human.

---

*Validation note (added 2026-09-24, this session):* every function and table named above was checked against the live database. All exist except `disco_refresh_schedule`, which the table above itself already marks "to build" — so that is expected, not a gap. The quantitative claims held up too: `exp_gbp_attributes` has 198,429 rows (doc says ~198K), and State Farm entities with a hydrated bio number 19,750 (doc says ~19K). The `disco_proposals` "3 awaiting_human" count from 2026-09-22 has since moved to 0 as approvals were processed — expected drift, not a discrepancy. This session's sameAs and hasCredential classifier work (in `disco-ai-worker.ts`'s `mapSite()`) plugs into Station 3 above and produces exactly the `extraction`/field-map shape that `disco_map_site_ingest` and Station 5's `exp_etl_fetch_collect` expect.

---

## Doc vs. reality — station-by-station validation (2026-09-24)

**Scope and method.** Every station, "Under the hood" function, ladder lane and non-negotiable above was checked against the live system on 2026-09-24, using three sources:

- the live function definitions (`pg_get_functiondef`), triggers, CHECK constraints and `cron.job`;
- a repo-wide grep of `src/` for every `.rpc(...)` call site;
- live rows in `disco_jobs`, `disco_llm_requests`, `disco_proposals`, `disco_site_contract`, `exp_etl_sources`, `exp_etl_frontier` and `exp_etl_staging`, using `gcid:financial_advisor` as the live test category.

This section **supersedes the "Validation note" directly above**. That note only checked that the named objects exist. Existence is true, but most of the stations are not wired together or do not do what the text says. Its "0 awaiting_human" is also out of date: three discover jobs are `awaiting_human` today (mortgage lender, accountant, real estate agents), and the financial-advisor company list is still `pending` after partial approval.

**Bottom line.**

- Stations 0–3 run end to end today. Activate, Discover, Approve, method classification and site mapping all ran for `gcid:financial_advisor` through `exp_disco_ai_worker_tick` (cron, every 2 minutes) and `disco-ai-worker.ts`.
- Station 3's output is wrong for every source.
- Stations 4, 6 (automatic), 7 and 8 (for crawled profiles) are not connected to the generic pipeline. Station 9 is not built, as stated above.
- Nothing produced by the generic engine has ever reached `exp_etl_staging`: the newest staged row is from 2026-08-03 (State Farm and RE/MAX legacy runs).
- **The line is not ready to use as the document claims.**

Gap IDs (`DR-n`) below are for reference in tickets and in `docs/ETL-Enhancements.md`.

### Station by station

| # | Doc claim | Reality (verified 2026-09-24) | Verdict |
|---|---|---|---|
| 0 Activate | Enqueues a `disco_jobs` row that `disco_dispatch` picks up **on pg_cron** | Works: Activate → `exp_etl_activate_category` → `disco_activate` → `disco_dispatch`. But `disco_dispatch` is **not** in `cron.job`; only `disco_activate` and `disco_confirm_companies` call it inline (DR-1). `exp_etl_activate_category` swallows every exception from `disco_activate` (`EXCEPTION WHEN others THEN NULL`), so an unknown category (no `exp_category_shape` row) returns success and nothing happens (DR-2). | Works, with gaps |
| 1 Discover | AI returns the top real companies; a human approves | Works. For `gcid:financial_advisor`, 25 were proposed and 11 approved via `disco_confirm_companies` → `exp_etl_approve_companies`. For `gcid:real_estate_agents` (activated 2026-09-24 11:36), the AI returned 20 **individual celebrity agents' personal sites** (hometown.com / Ben Caballero, serhant.com, joshflagg.com…), because that category's boundary excludes brokerages and franchisors. The "companies → hierarchy" model does not fit person-level categories whose firms live in a different gcid (DR-3). `exp_etl_approve_companies` also now starts recon on approval, which is not documented anywhere (DR-4). | Works; wrong for person categories |
| 2 Method checker | `exp_probe_methods` / `exp_probe_collect` test reachability; never let a hard site silently stall the line | The two named functions are legacy code: not in cron, not called by any function or UI (DR-5). The real classifier is `classifyMethod()` in `disco-ai-worker.ts` → `disco_method_ingest`, and it works. **The line stalls silently**: method job 7 (`gcid:financial_advisor`) has been `awaiting_ai` since 2026-09-22. `disco_check_method_complete` needs every approved source resolved and every `server_crawl` source mapped with `field_floor > 0`. rwbaird.com is still `unprobed`, and ameriprise/fidelity/ml/wellsfargoadvisors all failed site mapping (`field_floor = 0`). Failed `map_site` requests are final: no retry, no timeout, no alert (DR-6). | Works, but stalls |
| 3 Site mapper | Learns roster vs. detail once; emits a deterministic parser and field map; `exp_etl_map_fields` binds fields | 4 of 10 sources have a learned layout, and **none points at an individual advisor profile page** (table below, DR-7). The ingest gate in `disco_map_site_ingest` is only "`detail_pattern` present and the AI's self-reported `field_floor >= 5`", so it cannot catch a directory or article posing as a detail page (DR-8). `exp_etl_map_fields` is a State-Farm-shaped copier (`bio`, `hobbies`, `civic_activities`…) with no callers, so the learned `registry_field_map` is never consumed (DR-9). | Runs; output is wrong |
| 4 Field-yield gate | Bulk run blocked until a sample reaches ≥70% of the detail-page floor | `exp_etl_gate_full_pull` reads `exp_etl_source_contract`, a different table from `disco_site_contract` with one row (State Farm, `gcid:insurance_agent`). It measures 80% expected-field coverage with a 90% sample pass rate, not 70% of a floor. **No caller** in any function, cron job or UI. `exp_etl_check_saturation` detects repeated boilerplate values, is not a floor, and has no caller. `exp_etl_run_source` checks only `crawl_method`. The disco `field_floor` integer is never compared with anything after ingest (DR-10). | Not connected |
| 5 Run | Generic frontier builder; free deterministic workers extract using the Station 3 parser | The cron chain is live (`etl-fetch-*`, `etl-extract-*`). As of 2026-09-24 the 40-URL cap (Gap D1) is fixed and recon sitemaps seed the walk. The gaps: see the four rows below. | Partly works; critical bug |
| 5a Run trigger | — | Run is a **manual per-source click** (`exp_etl_run_source` from the Category Population tab), a third human touchpoint. The `run` job that `disco_check_method_complete` queues is decorative: nothing dispatches it, and `disco_dispatch` only flips it to `running` (DR-11). | — |
| 5b Extraction | — | Detail pages are extracted by one generic LLM prompt per page (`exp_etl_extract_tick`, worded "AGENT/OFFICE page"). The learned parser and field map are not used, and `exp_etl_extract_jsonld` (named above) has no callers (DR-12). | — |
| 5c **Mis-tag bug (critical)** | — | `exp_etl_extract_collect` sets a professional's gcid from a source whose `page_kinds` contains `agent_page`, otherwise it falls back to a **hardcoded `gcid:real_estate_agents`**. The disco flow only ever sets `roster_page`/`detail_page`, so every financial advisor it extracted would be filed as a real estate agent (DR-13). | — |
| 5d `page_kinds` empty | — | lpl.com, morganstanley.com and schwab.com have `page_kinds = NULL`. Their contracts pre-date the `disco_map_site_ingest` `page_kinds` fix, so `exp_etl_fetch_collect` marks their pages `error` (DR-14). | — |
| 6 Node creator | `exp_graph_create_entity` is the only writer; dedup, attribution firewall, claim firewall and audit ledger; brand → location → professional | `exp_etl_resolve` (staging → graph) has **no caller**: no cron, no function, no UI. Staged records never become profiles (DR-15). What is real: identity-key dedup and the `exp_curation_ledger` write in `exp_graph_create_entity`, and `trg_attribution_firewall` (BEFORE INSERT on `exp_rel`). The claim firewall `trg_etl_claim_firewall` only raises when `exp.actor = 'etl'`, and no function ever sets it, so the ETL path can modify claimed profiles (DR-16). `exp_etl_resolve` and `exp_etl_map_fields` also `UPDATE exp_entity` directly (status, confidence, attributes), bypassing the single door (DR-17). Hierarchy: a professional gets `REPRESENTS` → brand only; locations get no links, so brand → location → professional is never built (DR-18). | Not connected; claim firewall inert |
| 7 Enhancer | Reconcile across sources; map-or-add | `exp_etl_reconcile_value` has no caller. `exp_etl_map_or_add_product` is called only by legacy `sfh_collect` (State Farm) and is insurance-specific: it strips "insurance/coverage/policy" and appends " Insurance" to any new product (DR-19). `exp_etl_start_recon` / `exp_etl_recon_ingest` are listed here, but they are robots.txt/sitemap probes, not enrichment (doc mislabel). | Not connected |
| 8 Gauntlet | Nothing is done until validation passes; a failing category does not launch | The validators exist and work, but they validate the **category model** (knowledge, registry, taxonomy, compliance, schema.org config). `exp_validate_graph` is a global structural check shown on a UI card. Nothing validates ETL-produced profiles, and there is no launch flag or gate between staging/resolve and "live" (DR-20). | Exists; doesn't cover ETL output |
| 9 Refresh | To build | `disco_refresh_schedule` does not exist. | Matches doc |

**Station 3 output in detail (DR-7).** These are the 4 learned `disco_site_contract` rows.

| Domain | `detail_pattern` learned | Problem |
|---|---|---|
| edwardjones.com | `/us-en/search/financial-advisor/results(\?.*)?$`; roster = homepage | A search-results **directory**. Real profiles are `/us-en/financial-advisor/<name>` and will not match. |
| lpl.com | `/about-us/careers/locations/[a-z0-9-]+\.html$` | Careers office pages |
| morganstanley.com | `/about-us/global-offices/[a-z-]+/[a-z-]+$` | Corporate offices |
| schwab.com | `^https?://(www\.)?schwab\.com/(?!branches)[a-z0-9\-/]+/?$` | Matches almost every page on the site. With Gap D1 fixed, this would queue the whole site. |

All four were learned before the 2026-09-24 `mapSite()` fixes (entity-page check, sitemap walk) and need a remap.

### Non-negotiables

| Rule | Reality | Status |
|---|---|---|
| 1 Page-role separation | `exp_etl_fetch_collect`'s `roster_page` branch stages entities straight off roster pages when `list_source = 'jsonld'`. Office-page extraction creates professional "R28" stubs from rosters. Edward Jones' learned detail page is a directory. Not enforced (DR-21). | Violated |
| 2 Field-yield floor | Not enforced anywhere in the generic path (DR-10). | Violated |
| 3 Governed inserts only | Creation goes through `exp_graph_create_entity`. Updates bypass it; claim firewall inert (DR-16, DR-17). | Partly |
| 4 Real data only | The extraction prompt says "do not invent". But map-or-add rewrites product names (DR-19), and brand display names are derived from the domain (`initcap(split_part(domain,'.',1))`, e.g. "Edwardjones") (DR-22). | Mostly |
| 5 Taxonomy discipline | map-or-add is not wired into the generic path (DR-19). | Violated |
| 6 At rest by default | The every-minute ticks are no-ops when idle, and `exp_disco_ai_worker_tick` only posts when requests are pending. `etl-recon-retry-sweep` re-probes 404 robots.txt every 6 hours indefinitely. | Roughly holds |

### Acquisition ladder

| Lane / claim | Reality | Doc accuracy |
|---|---|---|
| 1 "Free deterministic crawl (pg_net)" | pg_net only calls `disco-webscraper-worker`. The worker routes **every** fetch through paid Oxylabs unless the env var `FORCE_PROXY=false` is set (env vars were not visible to this check). Every detail page also costs one Claude extraction call. "Costs us essentially nothing" is not true as built (DR-23). | Overstated |
| 2 Rendered fetch — "to build" | Built through Oxylabs `render: 'html'`, including automatic escalation to rendered fetch when a response looks blocked. | Understated |
| 3 Structured feeds | GBP feed is live (see the earlier note's row count). As of 2026-09-24, robots.txt sitemaps feed both mapSite and the harvest seed. | Accurate |
| 4 First-party / claim | `oauth_connections`, `claim_queue`, `exp_claim*` exist; no harvester. | Accurate |
| 5 Proxy + polite throttle — "to build", only within robots/ToS | The proxy is built (Oxylabs), but **the compliance gate does not exist**. `robots_tos_status` is `unreviewed` on every source and no function reads it. robots.txt `Disallow` rules are counted by recon and never enforced on frontier URLs. `pull_window` is never enforced (Gap D2). Auto-escalating to rendered fetch on block signals, with no robots/ToS check, contradicts "never defeat a site that has said no" (DR-24). | **Policy gap** |
| "The classifier writes the lane" | `access_method` is NULL on every source and no function reads or writes it. `fetch_tier` is NULL for all 11 financial-advisor sources (classified before `fetch_tier` existed) (DR-25). | Not true |

### Blocking `gcid:financial_advisor` right now (fix order)

1. Restore the 11 sources to `approved`. The recon status clobber was fixed on 2026-09-24 but the rows were not restored, so the Remap button stays hidden and `disco_check_method_complete` counts 0 approved. This needs sign-off because it is a production data write.
2. Unstick method job 7 (DR-6): classify rwbaird.com, and retry or park ameriprise/fidelity/ml/wellsfargoadvisors, whose site mapping failed.
3. Remap edwardjones/schwab/lpl/morganstanley with the 2026-09-24 `mapSite()`, and backfill `page_kinds` (DR-7, DR-14).
4. Remove the hardcoded `gcid:real_estate_agents` fallback in `exp_etl_extract_collect` (DR-13) before any extraction runs.
5. Wire staging → graph (`exp_etl_resolve`), set `exp.actor = 'etl'` on that path, and put a generic field-yield gate in front of Run (DR-15, DR-16, DR-10).
6. Enforce robots.txt `Disallow` and a `robots_tos_status` gate before any proxied or rendered fetch (DR-24).
