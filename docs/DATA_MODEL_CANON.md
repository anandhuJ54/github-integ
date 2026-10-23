# Data Model Canon (locked 2026-07-06) — one fact, one home
Rule: every fact has exactly ONE canonical store; all other appearances are
generation sources (inputs) or projections (outputs), never co-equal truths.

| Fact | CANON | Sources feeding it | Projections from it |
|---|---|---|---|
| Industry terms / vocab | exp_taxonomy(industry_term) | KM.terminology | agent vocab_ref, glossaries |
| Keywords (+intent) | exp_taxonomy(keyword/negative_keyword/modifier) | KM.search_intents | SRP targeting, SEM |
| Topics & content titles | exp_taxonomy(topic/content_title) | KM.content_topics | VOCE, Content ring about/mentions |
| Service terms | exp_taxonomy(product_service) | KM.services | Services ring nodes, offers |
| Structured nodes/fields | exp_vertical_node_registry (+exp_rings/ring_map) | KM.expertise_signals, RE 149 salvage | Schema tab JSON-LD, profile UI, signup forms |
| Compliance (enforceable) | exp_category_compliance | KM.compliance_rules | publish-path checks, agent guardrails |
| Conversion actions | exp_category_knowledge.conversion_actions (logic layer) | — | Conversion ring potentialAction, profile CTAs, agent goals |
| Category classification | exp_category_schema_type | resolver + hand pass | ring maps, everything |

UI rule: a tab renders the CANON only — never two stores for one fact (Overview
reads exp_category_intelligence, which must join canons, not sources).
Backfill rule: KM source columns are migrated into canons by the depth tool
(dedupe on uq_taxonomy_term), then marked read-only legacy in the UI.
exp_category_schema: the later public.* definition governs; earlier duplicate
CREATE is superseded (cleanup with next schema regeneration migration).
