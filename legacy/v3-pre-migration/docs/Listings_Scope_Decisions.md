# Listings Scope Decisions — Ruled Ledger (2026-07-12)

Doctrine: **no scope exclusion without a ledger row.** Every item below was ruled explicitly.
This file is the interim ledger until curation_proposals (20260711040000) is applied; future scope
changes go through that table.

| # | Item | Ruling | Status |
|---|------|--------|--------|
| 1 | Special / Holiday Hours | **ADD** (critical — Google-required) | ✅ Shipped: 2,676 universal nodes, 20260712010000 |
| 2 | moreHours (drive-through / senior / pickup) | **ADD, class-scoped** | ✅ Shipped: 26 + 27 + 1,413 nodes, same migration |
| 3 | Google Products / Merchant Center / Local Inventory | **ADD — Phase 3.** Retail Commerce module plugging into the graph; outside Listings core | 📋 Recorded; not built |
| 4 | WhatsApp Business | **ADD** (international value) | ✅ Shipped: 3,703 presence nodes + Meta card section |
| 5 | Nextdoor | **ADD — dedicated integration** (local trust signal) | ✅ Card shipped; runtime with the rest |
| 6 | Payment methods / ownership badges granularity | **Keep bundled** — enums on the entity instance, not separate template nodes | 📋 Doctrine confirmed |
| 7 | Events | **Keep as content** — published from the platform (content_items kind: event), not core listings model | 📋 Doctrine confirmed |
| 8 | Yelp solicitation rules | **Encode in runtime, machine-enforced** (critical) | ✅ Global block rule inserted into content_compliance_rules (20260712010000); runtime must honor severity=block |
| 9 | X / TikTok / YouTube | **Keep separate** — publishing destinations via the content engine (content_publications channels) | 📋 Doctrine confirmed |
| 10 | OSM / Snapchat / Pinterest | **Leave deferred** — OSM corrections possibly later; none justify Phase-1 engineering | 📋 Recorded |
| 11 | Adult + untyped categories | **Explicitly document — formal policy below** (critical) | ✅ This document |
| 12 | Vertical directories | **Phase 4** (critical long-term — the separation moat vs generic platforms) | 📋 Registry nodes exist per category; runtime adapters in Phase 4 |

## Category Universe Policy (item 11 — formal)

**Universe = 4,041 GBP gcids imported; 4,032 active.**

**Excluded — adult categories (4):** `gcid:adult_dvd_store`, `gcid:adult_entertainment_club`,
`gcid:adult_entertainment_store`, `gcid:erotic_massage`.
*Policy:* excluded from the active platform universe as a deliberate business decision (brand posture,
publisher-network compliance: several publishers restrict or prohibit adult listings; compliance and
age-gating burden exceeds category value at this stage). **Not a silent exclusion** — this policy is the
record. *Revisit trigger:* explicit executive decision; if activated, categories require full 7-layer
generation plus age-gate compliance rules before any profile onboarding.

**Excluded — untyped gcids (9):** categories present in Google's list without sufficient definition to
type against the schema fixture. *Policy (ruling):* remain excluded **until Google defines them**;
gbp_category_changes monitoring is the watch mechanism. On definition: type → gauntlet → generate →
activate.

**Enforcement:** the universe gate (`reference/gcid_universe.json`) is applied by every generator,
migration emitter, and crosswalk driver; non-universe gcids fail hard at authoring time.
