# Station 6 → Publish: generic rollout plan

*Written 2026-10-10, updated 2026-10-12 after merging main (PR #61: live search projection, governed graph-node writer, single-professional office rule, claim gate). Plan only: nothing in this document has been applied. Every step needs its own approval (structural database changes need a specific approval that names them).*

This plan takes harvested records from staging all the way to public profiles (`professionals`, `organizations`, `graph_nodes`, `search_documents`). It follows the stations in `docs/Always-On-Profile-Engine-Master-Checklist.md` and covers three cross-cutting needs:

1. duplicates of the same person, office or brand coming from different source websites within a gcid;
2. sources that are not the brand's own site (portals, directories, associations, licence registries, review platforms);
3. location-first gcids (restaurants, hotels and the other 3,637 location-type categories).

Rules that apply to every step: generic only (no site-specific code), governed writes only (`exp_graph_create_entity` / `exp_graph_add_rel` for the graph), real evidence only (missing is flagged, never invented), no AI prediction for values, small batches with an advisory lock so the database is not overburdened, crons at rest when there is no work, and claimed profiles are never touched by ETL.

---

## 1. Where we are (verified live, 2026-10-10)

| Station | What exists | State | Gap |
|---|---|---|---|
| 0 Activate | `exp_etl_activate_category` → `disco_activate` → `disco_dispatch` | works | — |
| 1 Discover | `disco_discover_ingest`, `disco_confirm_companies`, `exp_etl_approve_companies` | works; a person approves | — |
| 2 Method checker | `classifyMethod()` → `disco_method_ingest` (runs when cron 89 is on) | works | failed maps are not retried (old DR-6, not rechecked) |
| 3 Site mapper | v1 site contracts with staging schema v1 (`-disco-site-contract.ts`); v2 agent mapper parked | works | — |
| 4 Field-yield gate | `exp_etl_gate_full_pull`, `test_pull` → `active` / `paused` | works | — |
| 5 Run | crons 90/91, `disco-harvest-worker`, `exp_etl_stage_ingest`; 40 pages in flight | running | robots.txt Disallow and `pull_window` not enforced |
| 6 Node creator | `exp_etl_resolve` contract branch, cron 96 | running again since 2026-10-12 | Phase 1A (full record, update path, reasons, GIN lookup) and 1B (non-brand sources, cross-source keys, location-first, office moves) applied 2026-10-12; duplicates found for existing records are left for Station 7 |
| 7 Enhancer | `exp_etl_enhance` + cron `etl-enhance-tick` (102), `exp_etl_match_term`, `exp_etl_merge_entities` | running since 2026-10-12 | review screen for proposals / duplicates (2.4); medium-evidence duplicates |
| 8 Gauntlet | `exp_validate_profile`, `exp_etl_profile_gate` + cron `etl-profile-gate-tick` (103), `exp_etl_launch_category`; 14 category validators | running since 2026-10-12 | financial advisor and real estate agent launched 2026-10-12; gate / launch screen |
| Publish | `exp_etl_publish_entity`, `exp_etl_publish_tick`, `exp_etl_entity_nodes`, `exp_etl_slug` (State Farm keeps `exp_sf_apply` / `exp_sf_nodalize`) | Schwab pilot published 2026-10-12 (91 profiles); no cron yet | publish cron for all sources; location-first publishing; gate / launch / publish screen |
| 9 Refresh | manual re-harvest button (`exp_etl_reharvest_source`) | not built | off-by-default scheduler |

Volumes for the four active sources:

| Source | Frontier queued | Staging pending | In graph (professionals) | Public profiles |
|---|---|---|---|---|
| edwardjones.com | 14,856 | 7,243 | 4,453 | 0 |
| morganstanley.com | 4,090 | 3,983 | 2,179 | 0 |
| schwab.com | 823 | 633 | 1,787 | 0 |
| compass.com | 34,138 | 1,484 | 265 | 0 |

The graph also holds 5,305 ETL offices and the brands. Public tables, `search_documents` (39,514 rows) and `exp_index_queue` (39,464 rows, mostly `held`) contain only State Farm, a few real-estate / mortgage records and demo data.

**Applied on main on 2026-10-11 (verified live 2026-10-12) and used by this plan:**
- **Live search projection:** `exp_search_projection` / `exp_search_project`, the `exp_search_dirty` queue filled by statement-level triggers on `professionals`, `organizations`, `aggregate_ratings`, `reviews`, `graph_nodes`, `search_rank_scores` and `credentials`, drained by `exp_search_project_tick(p_batch)`. The cron `search-project-tick` is **not installed** (`exp_search_job_install()` exists); the queue is drained by hand today.
- **Governed graph-node writer:** `graph_nodes.trust_tier` (`self_declared | imported | platform_observed | authority_verified | owner_verified`) and `value_hash`; `exp_graph_upsert_nodes(p_entity_type, p_entity_id, p_nodes, p_source, p_trust)` (idempotent, never lowers trust); owner firewall trigger `trg_graph_nodes_owner_firewall` (owner-confirmed facts cannot be changed by `exp.actor = 'etl'`; blocked rows are skipped with a notice).
- **Graph ↔ public link:** 19,726 `exp_entity` professionals carry `identity_keys.professional_id` (State Farm, matched by URL). No location or brand entity has an equivalent key yet. 557 professionals have two or more `exp_entity` rows.
- **Single-professional office rule:** `exp_office_mode(p_entity_type, p_entity_id)` returns `single_pro | multi_pro | location_only | professional_only`; in a single-pro office (404 categories that allow both professionals and locations) the professional is the profile (identity, claim, public page) and the location holds the listings (Place ID, directories, NAP). Score v5 (`exp_score_v5_explain` / `_persist`) follows it; persist has not been run.
- **Claim gate:** claim trust tiers and 18 claim-gate functions; claimed / verified entities stay protected.

## 2. What was read for this plan

- **Database functions (all 248 public functions listed; relevant ones read in full):** `exp_etl_resolve`, `exp_graph_create_entity`, `exp_graph_add_rel`, `exp_guard_attribution`, `exp_etl_guard_claimed`, `exp_entity_profile_domain`, `exp_brand_domain`, `exp_url_domain`, `exp_norm_address`, `exp_norm_brand`, `exp_resolve_offices`, `exp_etl_stage_ingest`, `exp_etl_fetch_tick`, `exp_etl_fetch_collect`, `exp_etl_record_complete`, `exp_etl_reconcile_value`, `exp_etl_map_or_add_product`, `exp_should_insert`, the 14 `exp_validate_*`, `exp_sf_parse`, `exp_sf_parse_tick`, `exp_sf_apply`, `exp_sf_nodalize`, `exp_sf_renodalize_tick`, `sf_resolve`, `sfh_collect`, `exp_graph_nodes_ring_autofill`, `exp_ring_stamp_tick` / `_finish` / `_finalize`, `exp_provisional_score_tick`, `exp_facet_lang_tick`, `exp_compute_score_v2` (head), `exp_sitemap_rebuild`, `exp_index_submit_tick`, `exp_claim_request`, `exp_claim_adjudicate`, `disco_activate`, `exp_gbp_capture_tick` / `_collect`, `exp_scope_canon`.
- **Triggers:** `trg_etl_claim_firewall` (exp_entity, before update), `trg_attribution_firewall` (exp_rel, before insert), `trg_graph_nodes_ring_autofill` and `trg_invalidate_schema_cache` (graph_nodes).
- **Tables:** `exp_entity`, `exp_rel`, `exp_rel_types`, `exp_etl_staging`, `exp_etl_sources` (incl. CHECKs on `source_type`, `role_in_discovery`), `exp_etl_field_floors`, `exp_etl_source_contract`, `exp_etl_candidates`, `exp_category_shape`, `exp_category_boundary`, `exp_category_secondaries`, `gbp_categories`, `exp_vertical_node_registry` (`required_for_score`), `exp_ring`, `exp_ring_crosswalk`, `professionals`, `organizations`, `graph_nodes`, `graph_edges`, `credentials`, `search_documents`, `exp_index_queue`, and their indexes.
- **Code:** `src/lib/public-profile.ts`, `src/lib/profile-render.ts`, `src/lib/etl-deep-hydrate.server.ts` (State Farm TS hydrator that reads `exp_etl_field_floors`), `src/components/discovery/field-yield-tab.tsx`, `src/routes/_authenticated/categories.$gcid.tsx`.
- **Merged from main (2026-10-12):** `docs/ETL-Enhancements.md` entries of 2026-10-11 (live search projection, graph upsert, single-professional office, claim gate) and the live functions `exp_search_project_tick`, `exp_graph_upsert_nodes`, `exp_office_mode`, `exp_score_v5_persist`.

## 3. Decisions already taken

| # | Decision | Source |
|---|---|---|
| T1 | Brand, location and professional keep the **same gcid** (the category being populated). `exp_category_boundary` is not used for per-level gcids. | ruling 2026-10-10 |
| T2 | Required fields are defined **per gcid** in `exp_etl_field_floors`, editable from the UI (Discovery → Field-yield). Bio is optional unless ticked. A gcid without a row publishes nothing. The State Farm row stays as it is. Each `required_keys` entry is either one staging key (required on its own, e.g. `person.name`) or an **any-one-of group**: 2+ keys joined by `|` (at least one must have a value, e.g. `person.email|person.phone`); both kinds can be combined in one row (ruling 2026-10-12). | ruling 2026-10-10 / 2026-10-12 |
| T3 | Station 6 writes the governed graph only; the public copy happens only after Station 8. | ruling 2026-09-29 |
| T4 | Profiles show the source's own labels for services / specialties; term matching is a review aid and never auto-adds taxonomy terms. | ruling 2026-10-10 |
| T5 | Site mapper version 2 is parked. | ruling 2026-10-10 |
| T6 | Trust tier of ETL-written graph nodes (D9): `platform_observed` for a `brand_site` source, `imported` for every other source type. Order in `exp_trust_rank`: self_declared 1 < imported 2 < platform_observed 3 < authority_verified 4 < owner_verified 5. | ruling 2026-10-12 |
| T7 | The `search-project-tick` cron stays off (D10). Published profiles are queued in `exp_search_dirty` by the triggers; they reach `search_documents` only after an explicit release decision to drain the queue or switch the cron on. | ruling 2026-10-12 |
| T8 | Non-brand sources (portal, directory, association, licence registry, review platform) **create people** (D2). The brand comes from the firm named on the page, never the source site; offices use the domain-free address key; people are matched to existing ones by cross-source keys (4.1, 4.2). | ruling 2026-10-12 |
| T9 | `professionals.canonical_url` / `organizations.canonical_url` stay **empty** for ETL profiles (D3): the JSON-LD identity is our own page; the source page is kept in `detail_url` and shown as a sameAs link. | ruling 2026-10-12 |
| T10 | **Readable slugs** (D4): people `name-city-state` (e.g. `john-garon-portsmouth-nh`), offices `brand-city-state`, brands the brand name; a short number is added when taken; a published slug never changes. | ruling 2026-10-12 |

---

## 4. Cross-cutting design

### 4.1 Duplicates from different sources within a gcid

**How it works today**
- `exp_graph_create_entity(type, name, gcid, identity_keys, …)` loops over the given identity keys and returns the first existing entity of the same type with an equal key; otherwise it inserts. It already supports several keys per entity.
- `exp_etl_resolve` passes only one key per level: brand `domain`, office `location_key = domain|street|ZIP`, professional `<domain>_url`. Every key contains the source domain, so the same person, office or brand from two websites always becomes two entities.
- `exp_resolve_offices` already merges locations with the same normalised `identity_keys.address` (keep the oldest, repoint current rels, `status='merged'`, `merged_into`). ETL offices use `location_key`, so it does not see them.
- The lookup `identity_keys->>k = v` does not use the existing GIN index `idx_entity_ikeys` (~135 ms per lookup).
- Public tables: `professionals` is unique only on `detail_url`; there is no link to `exp_entity`.
- Today: 0 cross-source duplicates among the ETL sources (they do not overlap). It becomes real as soon as a portal or association runs next to the brand sites. The State Farm side already has 557 professionals with two or more `exp_entity` rows; the same merge function (point 3) can clean them up later, as a separate approved job.

**Design**
1. **Identity keys per level, written at Station 6 from page evidence only:**

   | Level | Per-source key (kept) | Cross-source keys (new, only when present on the page) |
   |---|---|---|
   | Professional | `<domain>_url` | `lic:<type>:<state>:<number>` from `person.licenses`; registration ids (CRD, NMLS) from the registration fields; `email:<address>` when it is personal (not a role mailbox, not a site-wide value listed in the contract's `boilerplate_values`); `place:<gbp_place_id>` from `person.gbp_place_id` |
   | Location | `location_key` | `place:<place_id>`; `addr:<exp_norm_address(street)>|<ZIP5>` (no domain) |
   | Brand | `domain` | `name:<exp_norm_brand(firm name)>`; `domain:<firm website domain>` when the page states the firm's website |

2. **Match strength.**
   - Strong keys (licence, registration id, place id, personal email, firm website domain) → automatic reuse, through the existing multi-key lookup.
   - Medium evidence (same normalised name + same phone, or same name + same street/ZIP) → a duplicate candidate for review (Station 7E); no automatic merge.
   - Name only → nothing.
   - If two strong keys point to two different existing entities → no write to either; the staging row records `rejected_reason = 'identity_conflict: …'` for review.
3. **Merging** is one generic governed function modelled on `exp_resolve_offices`: keep the older entity (a claimed entity always survives; two claimed entities are never merged), repoint current rels, set `status='merged'` and `merged_into`, write `exp_curation_ledger`. Used by approved review candidates and by strong-key conflicts resolved by a person.
4. **Values from several sources** (Station 7A): per field, the value from the source with the best `authority_rank` wins (1 brand site, 2 association / registry, 3 portal / review site), then the most recent observation. Each value keeps its source in `attributes._sources`.
5. **Public side:** one public row per surviving entity; a merged entity's public row is deactivated. The link between a graph entity and its public row follows the convention already live for State Farm: `exp_entity.identity_keys.professional_id` = `professionals.id`; for offices and brands the same convention with an `organization_id` key (decision D1).
6. **Lookup speed:** `identity_keys @> jsonb_build_object(k, v)` uses `idx_entity_ikeys`. No new index.

### 4.2 Sources that are not the brand's own site

**How it works today**
- `exp_etl_sources.source_type` already records `brand_site`, `portal`, `directory`, `license_registry`, `association`, `social`, `review_platform`, `other`; `role_in_discovery` records `census_spine`, `hierarchy_source`, `hydration`, `cross_check`, `evidence`. Real estate already has zillow.com and realtor.com (portal, cross_check), nar.realtor (association, hydration) and a licence-registry row.
- `exp_etl_resolve` always makes the **source domain** the brand. A zillow.com run would create a "Zillow" brand and wire every agent to it with `REPRESENTS`. The attribution firewall would not stop it, because the profile domain equals the brand domain.
- The reverse is also broken: wiring a zillow profile to the correct brand (Compass, `compass.com`) is refused by `exp_guard_attribution`, because the person's profile domain (zillow.com) is not the brand domain.
- `exp_entity_profile_domain` takes the first URL-looking identity key (`LIMIT 1`). Once a person has keys from two sites, the firewall result depends on which key comes first.

**Design**
1. **Brand = the firm stated on the page**, never the source site, unless `source_type = 'brand_site'`. Brand lookup order: firm website domain on the page → `name:` key → create a brand keyed by `name:` (+ `domain:` when known). No firm on the page → no brand and no `REPRESENTS` edge; the person keeps the stated firm text as an attribute for review.
2. **Office** from the page's `location.*` with the domain-free `addr:` / `place:` keys, so a portal-listed office meets the brand-site office.
3. **Person** with the per-source key plus cross-source keys (4.1), so a portal profile lands on the brand-site profile when both exist.
4. **Attribution firewall:** change it to pass when **any** URL key of the person is on the brand's domain or subdomain, or when the page states the brand's website domain (evidence kept in the rel's `evidence`). Any other mismatch is still refused.
5. **What a non-brand source may create** follows `role_in_discovery` (decision D2): `hierarchy_source` creates brand, office and person; `hydration` / `cross_check` / `evidence` enrich entities that already exist and, depending on D2, create new persons without creating brands.
6. **Independent professionals** (no firm on the page): person and their own location; no brand. Categories with `supports_single_pro_office` allow this today.
7. **Reviews and ratings** from review platforms go to reputation-ring nodes with their source; they never create entities.

### 4.3 Location-first gcids (restaurants, hotels, …)

**How it works today**
- `exp_category_shape.shape` is `location_first` (required type `location`) for 3,637 gcids and `professional_first` for 404. `gbp_categories.entity_type` is `location` or `both` accordingly.
- The site mapper already labels pages person or business (`detail_entity_type`), and staging schema v1 has `location.*` keys.
- `exp_etl_resolve` requires `person.name` and rejects every other record as `malformed`, so no location-first category can pass Station 6 today.
- `exp_category_shape.identity_keys` exists for every gcid but is empty.
- `exp_gbp_attributes` holds Google attribute definitions per gcid (198K rows), not per-place values.

**Design**
1. **Station 6 branches on the gcid's shape** (`exp_category_shape.shape`) and the record's entity type: `location_first` builds brand (chain) → location; no professional is created unless the gcid allows professionals (`allowed_entity_types`).
2. **Location identity:** `place:<place_id>` first, then `addr:<street>|<ZIP5>`, then the per-source key. Name from `location.business_name`.
3. **Single-location businesses:** the location is the top entity; a brand is created only when the page names a chain or franchisor (`FRANCHISE_OF` for franchise locations).
4. **Field floors row** per location gcid uses `location.*` keys (hours, phone, address, …).
5. **Publish** writes `organizations` (entity type `office`/location) and `graph_nodes` with `entity_type='organization'` (hours, menu / services, amenities, media, reviews) through `exp_graph_upsert_nodes`; the live search projection then builds the `search_documents` row with `entity_type='location'`.
6. **Directories** for these categories (Yelp-type sites) follow 4.2.
7. **First pilot:** one location gcid chosen by decision D7, after the professional pilot is published.

---

## 5. Rollout steps

Each step lists what changes, whether it is structural, and how it is verified. "Function change" = replacing an existing function body or creating a function (structural under the approval rules). Verification uses rolled-back tests (15–18 records) and dry runs before any live write.

### Phase 0 — Prerequisites

| Step | What | Change type | Verify |
|---|---|---|---|
| 0.1 | **Required fields UI.** Make the Discovery → Field-yield tab editable: per gcid, pick required keys from the staging key lists (`PERSON_KEYS`, `LOCATION_KEYS`, `FIRM_KEYS`), set `min_fields`, `min_products` (applied to `person.services`) and `min_licenses` (applied to `person.licenses`). Writes one `exp_etl_field_floors` row per gcid. Optional: a warning on Activate / Run when the gcid has no row. | UI code; data rows written from the UI | rows for `gcid:financial_advisor` and `gcid:real_estate_agents` saved and read back |
| 0.2 | **Station 5 compliance.** Skip frontier URLs disallowed by the source's robots.txt (recon already stores the rules); respect `pull_window` in `exp_etl_fetch_tick`. | function change (`exp_etl_fetch_tick`, possibly `exp_etl_frontier_discover`) | disallowed URL test, window test |
| 0.3 | **Link graph ↔ public tables** (decision D1): reuse `identity_keys.professional_id` (live for State Farm) and add `organization_id` for offices / brands. No new column. | written by 4.1 | keys present after the Schwab pilot |

### Phase 1 — Station 6 fixes (`exp_etl_resolve`, `exp_graph_create_entity`, `exp_guard_attribution`)

| Step | What | Change type |
|---|---|---|
| 1.1 | Lookup with `@>` in `exp_graph_create_entity` and in the direct lookups inside `exp_etl_resolve` (uses `idx_entity_ikeys`). | function change |
| 1.2 | Copy **every static field** of staging schema v1 onto the entities (person → professional, location → office, firm → brand), in the agreed formats, with `_sources`. Includes the person-website rule (ruling 2026-10-12): `brand_site` source → own site shown on the page, else the profile page (`_sources` = `derived_from_profile_url`); any other source type → only a site shown on the page, never the profile page; a shown site beats a derived one. | function change |
| 1.3 | **Update path.** Re-process rows whose staging observation is newer than their resolution (`observed_at > resolved_at`) for `created` / `matched` rows; `exp_etl_stage_ingest` refreshes the payload of resolved rows instead of skipping them (status unchanged). Claimed entities stay untouched (firewall). | function change (2 functions) |
| 1.4 | **Failure reasons.** The exception handler stores a short `rejected_reason` (error text) instead of a bare `conflicted`. | function change |
| 1.5 | **Non-brand sources** (4.2): brand from the page's firm, firewall checks every URL key and the stated firm website. | function change (`exp_etl_resolve`, `exp_guard_attribution`, `exp_entity_profile_domain`) |
| 1.6 | **Location-first branch** (4.3). | function change |
| 1.7 | **Cross-source identity keys** (4.1) written from page evidence; strong-key conflicts recorded as `identity_conflict`. | function change |
| 1.8 | **Refresh existing entities** (8,684 professionals, 5,305 offices) from staging through 1.2 / 1.7, in batches. | data write (dry run first) |
| 1.9 | **Cron 96 back on** (80 records per run). | cron change |

Verify: rolled-back run on 15–18 Schwab records (attributes complete and in the new formats, keys present, no rejections), then on Morgan Stanley / Edward Jones / compass samples; after 1.9, one hour of live runs (rows per minute, `rejected_reason` counts, run time).

### Phase 2 — Station 7 Enhancer

| Step | What | Change type |
|---|---|---|
| 2.1 | `exp_etl_enhance()` + cron `etl-enhance-tick` (about 100 entities per minute, advisory lock, at rest when nothing changed). Jobs: **A** reconcile values across sources by `authority_rank` and freshness; **B** office phone: the advisor keeps their own number, the office gets the number shared by most of its advisors, or none (verified 2026-10-10: shared offices with differing advisor phones — EJ 91/104, MS 339/341, Schwab 265/303, compass 54/54); **C** term matching of services / specialties against `exp_taxonomy`, proposals into `exp_etl_candidates`, never auto-added; **D** missing-for-score flags from `exp_vertical_node_registry.required_for_score`; **E** duplicate candidates (medium evidence, 4.1). | new function + cron |
| 2.2 | Generic governed merge function (model: `exp_resolve_offices`), used for approved duplicates. | new function |
| 2.3 | Generic map-or-add replacing the insurance-only `exp_etl_map_or_add_product` and the uncalled `exp_etl_reconcile_value` for the generic path (State Farm callers keep the old function). | new function |
| 2.4 | Review screens: term candidates, duplicate candidates (approve → merge). | UI code |

### Phase 3 — Station 8 Gauntlet

| Step | What | Change type |
|---|---|---|
| 3.1 | `exp_validate_profile(entity)`: reads the gcid's `exp_etl_field_floors` row; checks required keys (single keys must all be present; for each `a|b|c` group at least one must be present), `min_fields`, list minimums, formats (E.164 phone, US state, ZIP, URL), not merged, not in an identity conflict. Returns pass + reasons. Replaces `exp_etl_record_complete` (legacy table, no caller) for the generic path. | new function |
| 3.2 | `exp_etl_profile_gate()` + cron: stores the verdict on the entity (`attributes._gate = {passed, reasons, checked_at}`), re-checks after every update. | new function + cron |
| 3.3 | **Category gate:** `exp_validate_category_full(gcid)` must pass and an admin sets `is_launched` before the first publish of a gcid. The public page itself keeps not reading the flag (reading it would hide the live State Farm profiles). | data write per gcid (admin action) |

### Phase 4 — Publish

| Step | What | Change type |
|---|---|---|
| 4.1 | `exp_etl_publish(entity)`: generic version of `exp_sf_apply`. Upserts `organizations` (brand `entity_type='brand'`, office `'office'`, `parent_org_id`), `professionals` (`primary_org_id`, headline from the job title, licence columns from `person.licenses[0]`, `website_url` from `person.website`, languages, photo, bio when present), `credentials` from `person.licenses`. Writes the link back on the entity (`identity_keys.professional_id` / `organization_id`). Follows `exp_office_mode`: in a single-pro office the professional is the profile and the office row carries the listing data (Place ID, NAP); no separate office profile is shown. Only entities that passed 3.2 in a launched gcid; claimed public rows untouched. | new function |
| 4.2 | `exp_etl_nodalize(entity)`: maps static keys to node payloads (identity, contact, address, geo, hours, photos, bio, languages, services, social links, credentials, team, plus videos, gallery, actions, awards, education) and writes them through the existing **`exp_graph_upsert_nodes`** with source `etl` and trust `platform_observed` for a brand's own site, `imported` for other sources (T6). No delete-and-insert: the writer is idempotent, never lowers trust and the owner firewall keeps owner-confirmed facts. Nodes that disappeared from the page are deactivated, not deleted. `node_registry_id` from `exp_vertical_node_registry`; ring via the writer / `exp_ring_crosswalk`; ring number convention checked against the score functions before building. | new function (mapper) + existing writer |
| 4.3 | **Search:** nothing to write. The triggers on `professionals`, `organizations`, `graph_nodes` and `credentials` queue every published entity in `exp_search_dirty`; `exp_search_project_tick` builds the `search_documents` row (completeness, rank, languages, geo). The `search-project-tick` cron stays off (T7): published profiles wait in the queue until an explicit release decision drains it or switches the cron on. **Indexing:** an `exp_index_queue` row (state `held`) per published profile; index crons 77/78 stay off until an explicit release decision switches them on. | cron approval + inside 4.1 |
| 4.4 | Publish tick + retry cron (generic `exp_sf_renodalize_tick`), advisory lock, batches. | new function + cron |
| 4.5 | Merged or failed entities: public row set inactive (no redirect table exists; decision D5). | inside 4.1 / 4.4 |
| 4.6 | **Pilot order:** Schwab → check pages render (`/p/<slug>`) → Morgan Stanley → Edward Jones → compass. | live run per source |

### Phase 5 — Station 9 Refresh

| Step | What | Change type |
|---|---|---|
| 5.1 | Off-by-default refresh scheduler per source (armed by a person); changed pages flow through 1.3 → 2.1 → 3.2 → 4.4. | new function + cron |

---

## 6. Order of approvals

1. 0.1 Required fields UI → owner fills rows for financial advisors and real estate agents.
2. Decision D1 (below).
3. Phase 1: 1.1–1.7 as one reviewed function change (or split, if decided), rolled-back tests → 1.8 refresh (dry run first) → 1.9 cron on.
4. Phase 2: 2.1 → 2.2 / 2.3 → 2.4.
5. Phase 3: 3.1 / 3.2 → 3.3 for `gcid:financial_advisor`.
6. Phase 4: 4.1–4.5 → 4.6 Schwab pilot → other sources.
7. 0.2 compliance can run in parallel with Phase 1; Phase 5 last.
8. Location-first pilot (D7) after the first professional category is published.

## 7. Decisions needed

| # | Question | Options |
|---|---|---|
| D1 | How are public rows linked to graph entities? | (a) **recommended:** reuse the live convention `exp_entity.identity_keys.professional_id` (19,726 State Farm entities already use it) and add `organization_id` for offices and brands; no structural change; (b) add an `entity_id` column to `professionals` and `organizations` (structural); (c) join on `detail_url` (breaks once a person has several source URLs) |
| D5 | What happens to the page of a merged profile | (a) deactivate only; (b) add a redirect table (structural) |
| D6 | Should the public page respect `is_launched`? | today it does not; turning it on hides the live State Farm profiles |
| D7 | First location-first gcid to pilot | needs a decision |
| D8 | Required fields for `gcid:financial_advisor` and `gcid:real_estate_agents` | set in the UI (0.1); needs a decision |

## 8. Database load and safety

- Every tick uses an advisory lock, a batch limit and `FOR UPDATE SKIP LOCKED`; crons return immediately when there is nothing to do.
- Identity lookups use the existing GIN index (1.1); no new indexes are planned.
- Station 6 at 80 records per minute clears the current backlog (~13,300 pending) in about 3 hours; the refresh of existing entities (1.8) runs in batches outside peak harvest.
- Rollback for every function change: the saved previous definition (`pg_get_functiondef` before the change); crons can be switched off individually.
- Claimed / verified entities: `trg_etl_claim_firewall` blocks ETL updates (`exp.actor='etl'`); publish skips claimed public rows.
- Every change gets an appended entry in `docs/ETL-Enhancements.md`.
