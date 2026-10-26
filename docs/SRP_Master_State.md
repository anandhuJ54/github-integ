# Experience.com SRP — Master State Document
_Last updated: 2026-07-05. Grounded in live repo (BuyersRoad/experiencesrp-10e10c7e, branch `main`) and verified Supabase counts. Where a number is stated, it was counted in the live DB or read from the repo, not recalled._

---

## PART 1 — WHAT THE PLATFORM IS AND WHY

### The one-sentence thesis
Experience.com SRP (Search Rank Platform) makes local businesses and professionals win in search and AI answers by building, for each one, a **living expertise graph** — a connected, verified set of signals that Google and AI engines use to understand and rank an entity — and by measuring completeness of that graph as a **Search Rank Score**.

### The strategic framing
"Winning locally online." We do not sell "we submit you to 300 directories." We sell:
_"We connect your entity to the trusted sources — Google, AI engines, maps, apps, and consumers — that decide who you are, where you operate, and why you should rank."_

### Why this is defensible (the moat)
The moat is not the records; it is the **connections between shared nodes at scale**. Map
1.5M real estate agents, their offices, and their brands into ONE connected graph — where
agents share offices and offices share brands — and you have the most comprehensive entity
graph in real estate. Do that across 4,041 categories and you have a measurable, compounding
impact on search that a competitor cannot replicate by scraping, because the *connections*
(not the rows) are the value, and they densify as the graph grows.

### The three surfaces (products on top of the same core)
- **SRP** — public search rank profiles.
- **XMP** — enterprise management.
- **EMP** — internal category-builder (where the intelligence layers are authored).

### Platform-as-substrate (architecture destination)
Build core graph + intelligence + data model + identity once; every feature (first-party
now, partners later) touches the core through the same internal API. Public multi-tenant API
is designed-to-be-possible but built later, after first-party features prove the shape.

---

## PART 2 — THE GRAPH (design, LOCKED this session)

### The 8 rings (verified against schema.org)
Each ring = one category of signal search engines/AI evaluate. Complete graph = all 8
populated with verified nodes. It is 8 — not 9/10 (media folds into Content; AI-knowledge
folds into Context).

1. **Identity** — who they are. `Organization`/`LocalBusiness`(+~430 subtypes)/`Person`; name, address, geo, identifiers (duns, naics, license#).
2. **Presence** — where they exist online. `sameAs` → each listing (GMB, Apple, Bing, Yelp…).
3. **Authority** — provable credentials. `hasCredential`, `EducationalOccupationalCredential`, license identifiers, `memberOf` professional bodies.
4. **Reputation** — what others say. `AggregateRating`, `Review` (with `author`/`publisher` @id — publisher distinguishes GMB vs Healthgrades vs Yelp reviews).
5. **Content** — what they publish. `Article`, `Service`, `OfferCatalog`, `FAQPage`, `VideoObject`/`ImageObject` (media folded in); `author` @id = the "authored by" E-E-A-T edge; `about` = topical relevance.
6. **Engagement** — interaction. `InteractionCounter` (`interactionStatistic` = received; `agentInteractionStatistic` = performed).
7. **Transactions** — real outcomes. `Order`, `Reservation`, `potentialAction` → Order/Reserve/Schedule/BuyAction — **ties directly to the logic-layer conversion_actions already generated.**
8. **Context** — upstream relationships & knowledge graph. `parentOrganization` (ownership), `memberOf` (affiliation), `brand`, `sameAs` → Wikidata/Crunchbase.

The 8 rings map almost exactly onto Google's E-E-A-T — a check that they correspond to real
ranking signals, not invented buckets. Full detail: `docs/Ring_Schema_Mapping.md`.

### Sources emit signals into MULTIPLE rings (many-to-many)
A directory is a **source**, not a ring member. Google Business Profile emits presence (Ring 2)
+ reviews (Ring 4) + posts (Ring 5) simultaneously. The score reads RING completeness and
counts a signal regardless of which source produced it. This is the key model correction of
the session.

### The node contract (what every node carries)
`{ id (canonical, dedupable) · entity_level · ring · schema_type · schema_property ·
belongs_to · relates_to[edges] · title · description · category(gcid) · tags/keywords ·
value(structured) · provenance(created|discovered|declared) · trust_tier(self_declared|
imported|platform_observed|authority_verified) · sourced_at · valid_until · status }`.
The three most-forgotten and most-important: **edges, provenance/trust, freshness** — they
are what make it a graph, not a spreadsheet. Full detail: `docs/Node_Contract_Spec.md`.

### Entity structure EMERGES from counts (not a fixed shape)
- **Location** = universal base node. Every business is ≥1 location. (Solo dentist = taco truck = one node → one simple signup flow.)
- **Person nodes** spawn ONLY for public-facing, route-to-market professionals (customer searches them by name — agent/lawyer/doctor yes; cook/receptionist no) AND only when there is more than one. One such pro fuses into the location node.
- **Brand nodes** spawn ONLY when location count > 1 (franchise/chain), and the brand is itself a hierarchy (corporate → franchisee — see Part 7).
- **Single-node default**: Google penalizes duplicate anchors at one address, so a single pro = one fused node, titled via the category's `title_template` ("Brandon Lee - State Farm").

---

## PART 3 — CATEGORIES (the foundation unit)

Built "category-out": all **4,041 Google Business Profile categories** (real gcids only —
category-integrity is a hard rule; no invented gcids). "Category" = one gcid; a category can
carry up to 10 gcids per business. Each category is a TEMPLATE (generated, regenerable) that
carries its knowledge model, logic layer, ring requirements, directory set, title_template,
and — future — its node resolvers. Everything user-facing (signup form, markup, score, agent)
is PROJECTED from the template + the entity's filled nodes. This is why forms are not
hand-built per category; they fall out of the template.

---

## PART 4 — THE DATA MODEL (49-table Supabase schema)

Universal tables + per-category rows keyed by gcid. Key tables and VERIFIED live counts:

| Table | Purpose | Live coverage (verified) |
|---|---|---|
| gbp_categories | Category master (gcid, name, entity_type, tier) | 4,041 (100%) |
| exp_category_knowledge | KM + logic layer (terminology, services, journey, value_props, search_intents, conversion_actions, ai_agents…) | KM 4,041 (100%); logic 4,024 (99.6%) |
| exp_directory_packs | Canonical citation catalog (source + scope + tier + citation_push) | 125 dirs (31 universal, 82 single_field, 12 cross_category, 0 unverified) |
| exp_category_directory_map | Category→directory mapping | universal DONE: 125,271 rows (4,041 × 31); family: 0 (frozen) |
| exp_vertical_node_registry | 8-ring node instances per category | 1 category, 34 nodes (mortgage seed) |
| exp_category_compliance | Structured compliance | 8 (Tier-1 seed) |
| exp_taxonomy | Specialization tree | 1 (seed) |
| exp_category_schema | Stored schema.org output | 1 (real_estate proof) |
| exp_category_ui_config | UI config | 1 (seed) |

**Known drift**: value_props/search_intents/conversion_actions columns were added by ALTER
TABLE in Lovable and are not in a committed migration — back-commit needed.

---

## PART 5 — THE TRAINING / GENERATION MODEL (how the intelligence was built)

Universal layers (KM, logic) were generated with the **Anthropic Batch API run from Google
Colab** on a **Drive-mounted, resumable, gated pipeline** (input JSON in Drive, per-category
output to logic_out/, SQL chunks to full_sql/, batch id persisted for resume). Gates enforce
lane discipline and valid schema_action enums. The full logic run: batch of 4,027, 99.5% clean
first pass, applied to the live DB. This same pipeline is the template for remaining
generative layers (node registry, agent block).

**THE STANDING RULE (learned from the Thumbtack error, non-negotiable):** every semantic
batch = generate a diverse sample → a HUMAN reviews every row → THEN scale. Structural gates
catch malformed data; they do NOT catch plausible-but-wrong data. Human sample-review is the
only safeguard against semantic error.

---

## PART 6 — COMMIT HISTORY: THE ORDER AND REASON FOR THE WORK

(Reverse chronological; Lovable's own "Changes"/"Applied"/"Lovable update" commits are the
mirror-backs when migrations are applied — the sync is bidirectional.)

**Foundation era (Jun 28–29):** the 49-table data model, node registry schema, taxonomy,
compliance, UI config seeded — the ~32 migrations dated 20260628–29. Reason: build the
universal data model before any feature (foundation-first hard rule).

**Schema generator (Jun 30):** `1a7a926` added exp_category_schema; `dcf7541` wrote it via
service_role with KM fingerprint; `eee0b78` ported the proven decomposed generation method;
`20260630130000_category_relationships` added relationship modeling. Reason: prove schema.org
projection on one real category (real_estate).

**Logic layer (Jul 2–4):** `1eaa83e` wired the logic layer as source of truth; the bulk-upsert
commits (`2c6e1eb`, `5ba8fbb`) landed the full 4,024-category logic batch. Reason: give every
category its conversion/intent intelligence — the second universal layer.

**This session (Jul 4–5) — directory/citation layer + foundation lock:**
- `3f5f5cd` — corrected stale STATUS.md to verified layer coverage. Reason: the map was 5 days stale (said "24 seeds / 297 categories") and would misdirect the next session.
- `eade475` — directory-pack model + universal network + vertical packs (2 tables, 95 dirs). Reason: begin the citations layer with a reusable pack model (not per-category duplication).
- `2433831` — added Experience.com as universal Tier-1 + financial/real_estate/insurance/veterinary families. Reason: mortgage (the flagship) fell through the first cut; Experience.com is our own platform and belongs on every category.
- `cf302b3` — hardened universal pack with map/voice/nav surfaces (Waze, HERE, Alexa, Siri, Assistant, TomTom). Reason: the "must-be-perfect" universal layer was missing the surfaces that matter for get-found-everywhere.
- `ea130ba` — **re-modeled directory scope** (directory_scope + field, unverified default, CHECK constraint). Reason: THE THUMBTACK FIX — a cross-category marketplace (Thumbtack) had been mislabeled single-field (home_services), which would have conferred false identity on categories. This re-model makes that error *unrepresentable*.
- `b83387c` — recorded the directory state + the critical semantic-error safeguard rule in STATUS.md. Reason: so the lesson survives.
- `13f6c3d` — confirmed scopes for all 94 non-universal dirs (82 single_field, 12 cross_category) after human review. Reason: unblock family mapping safely.
- `23a14ed` — marked scope confirmation DONE (125 dirs, 0 unverified). Reason: checkpoint.
- `7343b75` — **locked the graph foundation**: 8 rings (schema-verified), node contract, plain-language summary, build order. Reason: capture all of this session's design before building on it.

---

## PART 7 — THIS CONVERSATION: THE DESIGN WE WORKED THROUGH

This session moved from "finish citations" up to "design the graph foundation," driven by a
series of user challenges that each corrected a flaw:

1. **Ring vocabulary** — named/locked the 8 rings, mapped to schema.org, verified the 4 open items (InteractionCounter confirmed; ProfilePage pattern; parentOrganization=ownership vs memberOf=affiliation; Franchise/seeks excluded as unverified rather than asserted).
2. **Sources vs rings** — corrected "one directory = one ring" to "sources emit signals into many rings" (the GMB insight).
3. **Node contract** — defined what every node carries.
4. **Entity chain** — corrected "rings belong to one entity" to "rings repeat at each entity level (brand/location/person), connected by schema edges."
5. **Entity shape** — corrected "fixed shape per category" (real-estate model) to "structure emerges from counts" (restaurant broke the fixed model; reviews are native to a location, not always a rollup).
6. **Person nodes** — corrected "more than one worker" to "more than one public-facing, route-to-market professional" (a cook gets no node).
7. **Single-node + title_template** — a single pro is one node titled to carry identity (Google anti-duplicate; "Brandon Lee - State Farm").

---

## PART 8 — WHERE WE ARE STUCK (current open problem)

**Entity resolution / dedup — the #1 risk, actively being designed, not yet solved.**

The problem (user's own framing, correct): a professional signs up and types "123 Main
Street, Nantucket." A second professional at the same office types "123 Main Street, #101."
Exact-text matching sees two different strings → creates TWO office nodes → the shared node
that the moat depends on fragments. At 1.5M agents this turns the graph into confetti.

Why it's genuinely hard: entities enter as dirty free text; the same thing is written many
ways; different things look identical; the two error types (fragment vs over-merge) pull in
opposite directions and can't both be minimized; entities move (agents change brokerages);
and at scale you can't compare everything to everything. Over-merge is unrecoverable
(corrupts two real entities); under-merge is recoverable. This is a known-hard CS problem.

The emerging fix (designed this session, NOT yet written to spec or built):
- **Don't join on typed text. Resolve every node to a computed canonical ID.**
- **Location** → force Google Places autocomplete at signup → capture the **Google Place ID** (Google already resolved addresses; "123 Main St" and "123 Main St #101" → same Place ID). Show "is this your office? 4 agents already here" → user confirms with a click. This converts the hardest computation into a one-tap confirmation.
- **Person** → strong key is CATEGORY-DEPENDENT: license number where a licensing authority exists (NMLS, bar, RE license, NPI); best-effort + confirm where none does (life coach, photographer).
- **Brand** → NOT one node. It is a hierarchy: **corporate brand (RE/MAX LLC) → franchisee brand (RE/MAX Victory, the real operating brand a customer sees and that drives title/markup) → location**. Franchisees may not use standalone corporate branding. Corporate resolves against a small canonical list; franchisee brand (thousands, changing) resolves from GBP business name — the new hard sub-problem.

**The design decision that supersedes "4 targets" (last, most important):** do NOT hardcode a
fixed list of resolution targets. The long-term design is a **single canonical-resolution
mechanism** where each node type declares its own resolver as a template attribute
`{strong_key_type, resolver, confirm_policy, merge_bias}`; the platform applies it uniformly;
entity depth is whatever the real business has (1 for a solo coach, 4 for RE/MAX, 5 for a
hospital system). Location/person/franchisee/corporate are EXAMPLES of the mechanism, not the
definition. This mirrors every good decision this session: general mechanism, per-category
attribute — never hardcoded structure. **This spec is what we are stuck on writing, and it is
the immediate next deliverable.**

---

## PART 9 — STATUS SUMMARY: COMPLETE / WIP / TODO

### COMPLETE (live in DB, committed)
- Category master: 4,041 gcids (100%).
- Knowledge Model: 4,041 (100%).
- Logic layer (value_props, search_intents, conversion_actions): 4,024 (99.6%).
- Directory catalog: 125 dirs, fully scoped (0 unverified).
- Universal citation mapping: 125,271 rows — every category × 31 universal directories.
- Directory scope re-model + safeguard (Thumbtack fix): committed and applied.
- Graph foundation design (8 rings, node contract, build order): committed as docs.
- Schema.org verification of the ring backbone.
- GitHub read/write access + repeatable Colab/Batch generation pipeline.

### WIP (designed, not built)
- **Entity resolution mechanism** — designed this session (Google Place ID + per-node
  resolvers + confirm flow + general mechanism), spec not yet written. THE BLOCKER.
- Conversion agent block (fields 1–5 designed; field 6 needs entity model). Not generated (0 categories).
- Layer-4 entity model (person + brand, trust-tiered) — designed, not built.

### TODO (in build order)
1. Write the entity-resolution spec (general mechanism, per-node resolvers). ← next.
2. Solve/spec franchisee-brand resolution (the new hard sub-problem).
3. Map industry + map/voice directories to categories (source→signal→ring), safely, sample-reviewed.
4. Build the node registry per category on the locked node contract; sample-tested + human-reviewed before scaling. (Prerequisite fix: node-registry template is keyed to nonexistent `gcid:mortgage_broker` — must re-key to `gcid:mortgage_lender`.)
5. Generate the conversion agent block (fields 1–5).
6. Compliance + directories at scale; then schema + UI config (project from registry+logic).
7. Project the signup forms, markup, and Search Rank Score from the registry + node contract.
8. Regenerate the ~17 logic-layer straggler categories.

### KNOWN ISSUES / DEBT
- Logic-layer columns not in a committed migration (ALTER-in-Lovable drift) — back-commit.
- Node-registry template keyed to nonexistent `gcid:mortgage_broker` (real: `mortgage_lender`) — category-integrity violation to fix before registry build.
- ~17 categories lack conversion_actions (batch gate failures).
- Franchisee-brand resolution unsolved (the hard sub-problem inside entity resolution).

---
_This document is the single source of truth for platform state. Formal specs it references:
`Ring_Schema_Mapping.md`, `Node_Contract_Spec.md`, `SRP_Foundation_Plain.md`. When in doubt,
verify counts against the live DB — this doc's numbers were verified 2026-07-05._
