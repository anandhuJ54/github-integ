# Experience.com SRP — Build Status & Operating Context

> Single source of truth for "where we are." Read this first in any new session.
> Last updated: 2026-07-04

## What we are building (one paragraph)
Experience.com SRP is an AI-powered Search Rank Platform built **category-out**: the
entire system is organized around Google Business Profile categories (4,041 of them).
Every vertical inherits from a category knowledge model, so launching a new vertical is
**configuration, not code**. Each professional/business gets a living **expertise graph**
(8 rings) that generates schema.org markup, powers an 850-point **Search Rank Score**, and
drives AI-search visibility. Three surfaces: **SRP** (public profiles + graph + score),
**XMP** (enterprise management), **EMP** (internal ops).

## The build discipline (do not violate)
Build each category's spine fully before any downstream feature:

```
Category → entity-type → Node Registry (8 rings) → Knowledge Model → Taxonomy
  → Compliance → Scoring → AI Config → Schema output
  → claim/onboard → public pages → search → connectors
  → THEN listings / reviews / content / VOCE
```

**Hard rule:** Do NOT build listings management (or any connector/ETL sync) until the
target verticals have complete node registries. Listing directories are *defined per
category in the node registry* — building listings against an empty registry is wasted work.

## The 10 rings (CANONICAL as of 2026-07-05 — supersedes the 8; see exp_rings)
1 Identity · 2 Presence · 3 Location (NEW) · 4 Authority (+DefinedTerm clustering) ·
5 Services (NEW) · 6 Content · 7 Reputation · 8 Engagement · 9 Conversion · 10 Entity Graph.
Location and Services promoted per structural adjudication (geographic relevance and
query-intent match are distinct ranking signals). All designators vocabulary-gated.
Property->ring map reassigned (skills/occupationalCategory->authority, audience->services
promoted from none-list). Per-type intersections regenerated: 12,601 rows / 171 types.
gcid->schema-type: 4,037/4,046 resolved (99.8%), 9 pending decision, standing rule applies.

## Status — verified layer coverage (2026-07-04, counted in live Supabase)

Category-out foundation. Counts are `count(distinct gcid)` in the live DB.

| Layer | Categories | Coverage | State |
|-------|-----------:|---------:|-------|
| Category master (gbp_categories) | 4,041 | 100% | complete |
| Knowledge Model (exp_category_knowledge.terminology…) | 4,041 | 100% | complete |
| Logic layer (value_props, search_intents, conversion_actions) | 4,024 | 99.6% | complete — 17-cat gap (gate failures) |
| Compliance (exp_category_compliance) | 8 | 0.2% | seed only (Tier-1 legal/medical) |
| Node Registry (exp_vertical_node_registry, 8 rings) | 1 | — | seed only (mortgage_broker, 34 nodes) |
| Taxonomy (exp_taxonomy) | 1 | — | seed only |
| Stored schema (exp_category_schema) | 1 | — | proof only (real_estate) |
| UI Config (exp_category_ui_config) | 1 | — | seed only |
| Agent block (ai_agents.conversion_agent) | 0 | 0% | designed, not generated |
| Directories (exp_category_directories) | 0 | 0% | empty — not seeded for any category |
| Launched (is_launched) | 1 | — | real_estate |

**One-line truth:** the two highest-volume intelligence layers (Knowledge Model, logic)
are complete across the whole taxonomy; every downstream structural layer exists for only
1–8 seed categories. A typical category (e.g. barber_shop) correctly shows KM + logic
populated and everything below empty — it is representative, not broken.

## How the two universal layers were built (repeatable pipeline)
Base KM + logic layer were generated via the Anthropic **Batch API** run from Google
Colab with a **Drive-mounted, resumable, gated** pipeline (input `base_km_input.json` in
`MyDrive/srp_run/`, per-category JSON to `logic_out/`, SQL chunks to `full_sql/`, batch id
persisted for resume). Gates enforce lane discipline + valid schema_action enum. Combined
base+logic UPSERTs applied in Lovable. This same pipeline is the template for the
remaining layers. NOTE: the logic-layer columns (value_props/search_intents/
conversion_actions) were added by ALTER TABLE in Lovable and are **not yet in a committed
migration** — back-commit needed.

## Directory / citation layer (built 2026-07-04)
Model: `exp_directory_packs` (canonical catalog, 125 directories) + `exp_category_directory_map`.
- **Universal pack (31 dirs, scope=universal): DONE + APPLIED.** Every category (4,041) mapped
  to all 31 via `exp_category_directory_map` (source='universal', 125,271 rows). Includes
  Google, Apple, Bing, Yelp, Facebook, Waze, Foursquare, HERE, Alexa, Siri, Google Assistant,
  aggregators (Data Axle/Localeze), and **Experience.com as Tier 1** (own platform home node).
- **Family/authority dirs (94, scope=unverified): FROZEN.** NOT mapped to any category.

### CRITICAL SAFEGUARD (learned the hard way — do not remove)
A hand-built classification error mislabeled cross-category marketplaces (Thumbtack, Angi,
HomeAdvisor, Houzz, TripAdvisor, LinkedIn) as single-field directories, which would have
conferred FALSE identities on categories (e.g. accountant→home_services because accountants
list on Thumbtack). Caught by human row-review before it shipped; nothing was corrupted.

Fixes now enforced:
1. **Directories NEVER determine category identity.** Causal arrow is category → directory,
   never reverse. A category's field comes from classifying the CATEGORY (its services), not
   from which directories it uses.
2. **Scope re-model makes the error unrepresentable.** `directory_scope` ∈
   universal/cross_category/single_field/unverified (default unverified); `field` allowed
   ONLY when scope=single_field (CHECK constraint). All non-universal dirs reset to
   'unverified' — they cannot drive family mapping until a human confirms scope.
3. **STANDING RULE for ALL semantic batches (directories, node registry, agent block):**
   generate a diverse sample (10-20), a human reads every row and confirms correctness,
   THEN scale. Structural gates catch malformed data; they do NOT catch plausible-but-wrong
   data. Human sample-review is the only safeguard against semantic error. Mandatory.

### Directory layer — remaining work
- [DONE 2026-07-04] Scope confirmed for all 125 dirs: 31 universal, 82 single_field
  (field set), 12 cross_category (Thumbtack/Angi/HomeAdvisor/Bark/TripAdvisor/Mindbody/
  WellnessLiving/Kompass/D&B/LinkedIn/Eventbrite/NerdWallet — field=NULL, cannot confer
  identity). 0 unverified.
- [NEXT] Step 2: category-field classifier (identity from CATEGORY services, closed
  15-label set, gated). MUST test on ~15-category sample + human sign-off BEFORE scaling.
- [THEN] Step 3: map single_field dirs to categories by matching field (Vitals etc. land
  on medical categories). Step 4: map cross_category dirs by KM-usage (no identity effect).


## Status — next (in order, foundation-first)
1. **Node Registry for all ~4,040 categories** — the structural keystone. MUST be exact:
   wrong nodes corrupt scoring, listings, and schema. Method (agreed): constrained
   generation filling the fixed 8-ring template with per-vertical instances; **directories
   grounded by SELECTING from canonical per-vertical directory lists (built first), never
   invented**; hard structural gates (ring/method enums, real schema.org type+property,
   score_points band, unique slugs); prove on 10 diverse verticals + hand-verify before
   scaling.
2. **Agent block (conversion_agent, fields 1–5)** — designed; universal guardrail floor in
   code + per-category additions; field 6 (personalization) stubbed until entity model.
3. **Compliance + Directories** at scale (derivable once registry exists).
4. **Schema + UI Config** — project from registry + logic; do not generate independently.

## Status — WIP / parked
- SRP profile + claim flow: built on sample data; claim matching/OAuth not wired.
- 17 logic-layer straggler categories: regenerate with a targeted pass.
- Deep per-lane schema generator: proven on real_estate; not run at scale.

## Status — NOT STARTED (correctly parked)
Search & discovery, OAuth/ETL/CRM connectors, email/SMS, Stripe, VOCE writer.
**Listings management frozen** until node registries (incl. directories) are complete —
per the hard rule above.

## Layer 4 — entity model (designed this session, not yet built)
Resolved entity = **person layer** (credentials, license, volume, specialties,
availability) + **brand layer** (voice, will/won't say, promotions, hours, inventory).
Binds to category template; spawns expertise-graph node **instances**. Every fact carries
**provenance + trust tier** (self_declared / imported / platform_observed /
authority_verified) from day one; score weights by trust, agent confidence bounded by
trust, freshness clock per tier. This is the agent's "brand + person" half and the moat.
