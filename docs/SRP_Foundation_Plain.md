# SRP Foundation — plain-language summary (2026-07-05)

What we agreed in the design conversation. Most of this is DESIGN, not yet BUILT.
Formal specs: Ring_Schema_Mapping.md, Node_Contract_Spec.md.

## 1. The graph has 8 rings (LOCKED — verified against schema.org)
Each ring = one thing Google/AI checks about a business:
1 Identity  2 Presence  3 Authority  4 Reputation
5 Content   6 Engagement  7 Transactions  8 Context
It is 8, not 9/10. "Media" folds into Content; "AI knowledge" folds into Context.
Each ring maps to real schema.org types/properties (verified; see Ring_Schema_Mapping.md).

## 2. How the graph gets built (node logic)
Three ways a node enters: (a) we CREATE it (our listings/reviews), (b) we DISCOVER + map it
(their existing GBP, license records), (c) user ENTERS it and we CHECK + map it.
Every node carries: id, ring, schema type+property, EDGES to other entities, title, tags/
keywords, description, structured values, PROVENANCE + TRUST tier, FRESHNESS, status.
The graph -> schema.org markup on their page -> tells Google who they are -> ranking.

## 3. Business structure emerges from counts (not a fixed shape)
- Everyone starts as ONE location node. Simple signup for all (solo dentist = taco truck flow).
- PERSON nodes appear only for public-facing, customer-chosen professionals when there's
  MORE THAN ONE (lawyer/agent/doctor = yes; cook/receptionist = no). One pro = fused into
  the location node.
- BRAND appears only when there's more than one location (franchise/chain).
- Single pro = ONE node titled to carry identity ("Brandon Lee - State Farm") because Google
  penalizes duplicate anchors at one address. Category decides the title style.

## 4. Citations (where a business gets listed)
- UNIVERSAL (~31: Google, Apple, Bing, Yelp, Waze, Alexa, Experience.com, aggregators):
  DONE + LIVE, mapped to all 4,041 categories.
- INDUSTRY-SPECIFIC + map/voice (Healthgrades, Avvo, OpenTable, etc.): catalog built + safely
  scope-tagged (125 dirs). NOT yet mapped to categories. Directories are SOURCES that emit
  signals into multiple RINGS (GMB -> presence + reviews + content). Sources never define a
  category's identity (the Thumbtack fix).

## BUILD ORDER (agreed)
DONE/LIVE: Knowledge Model (4,041), Logic layer (4,024), universal citation mapping
(125,271), directory catalog + scopes (125).
NEXT, in order:
  1. Lock foundation specs (this doc + the two specs) — DONE this session.
  2. Solve entity resolution / dedup design — the hard blocker for the moat.
  3. Map industry + map/voice directories to categories (source->signal->ring), safely.
  4. Node registry per category, built on the locked node contract; sample-tested +
     human-reviewed before scaling (the standing rule).
  5. Project everything from the registry: signup forms, markup, scoring.

## STANDING RULE (learned from the Thumbtack error)
Every semantic batch: generate a diverse sample, a HUMAN reviews every row, THEN scale.
Structural gates catch malformed data; they do NOT catch plausible-but-wrong data.

## KNOWN HARD PROBLEM
Entity resolution/dedup: shared brand/location nodes are the moat, but matching free-text
entities ("RE/MAX Downtown" vs "Re/Max #4412") to one @id is hard and unsolved. Design
before scale. #1 risk.
