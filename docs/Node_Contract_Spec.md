# Node Contract + Entity-Chain Grid (SRP graph foundation)

## The correction: rings repeat at every entity level
The 8 rings are not a property of ONE entity. They apply at EACH level of the entity
chain. The graph is a GRID: (entity levels) × (8 rings), connected by schema.org edges.

## Entity chain (real estate worked example)
CATEGORY  gcid:real_estate_agent   (the template — generated, not an instance)
   ^ memberOf / additionalType
BRAND     RE/MAX                    (one node; 100k agents point to it)
   ^ parentOrganization / brand
LOCATION  RE/MAX Downtown Austin    (one node; many agents share it)
   ^ worksFor / location
PERSON    Jane Smith, agent         (the individual)

Dedup rule: BRAND and LOCATION are SHARED nodes. Agent A and Agent B at the same office
resolve to the SAME location @id and the SAME brand @id. That shared structure = the moat.

## The grid: what each ring holds at each level

| Ring | BRAND (RE/MAX) | LOCATION (office) | PERSON (agent) |
|------|----------------|-------------------|----------------|
| 1 Identity | Organization: RE/MAX, logo, legalName, url | LocalBusiness/RealEstateAgent: office NAP, geo, hours | Person: name, jobTitle, photo, license# (identifier) |
| 2 Presence | sameAs → remax.com, corp socials, Wikidata | sameAs → office GBP, Yelp, office FB | sameAs → agent Zillow, Realtor.com, agent GBP |
| 3 Authority | brand trademarks, franchise registration | office broker license, state registration | agent license (identifier+propertyID), NAR memberOf, designations (CRS, ABR) |
| 4 Reputation | brand-level aggregate (corp reviews) | office AggregateRating (GBP reviews) | agent reviews (Zillow/RateMyAgent) + author @id |
| 5 Content | brand campaigns, national listings feed | office listings, office blog | agent's listings, agent posts, author=agent @id |
| 6 Engagement | brand social following | office post engagement | agent social, response rate, booking volume |
| 7 Transactions | brand-wide volume (context only) | office closed transactions | agent closed deals, $ volume, potentialAction (ScheduleAction: book showing) |
| 8 Context | brand → franchise system, memberOf associations | office → parentOrganization=RE/MAX | agent → worksFor=office, brand=RE/MAX, memberOf=NAR |

## Connective edges (schema.org, verified)
person.worksFor        → @id location
person.brand / affil.  → @id brand
location.parentOrganization → @id brand
brand.memberOf         → @id category-level associations
person.additionalType  → gcid (the category template)
All are @id references — the graph IS a schema.org @graph.

## Node contract (every node, every level, every ring)
node = {
  id:            stable canonical @id (dedupable — shared nodes collapse)
  entity_level:  brand | location | person | (category=template)
  ring:          1-8
  schema_type:   e.g. RealEstateAgent, Organization, Review, EducationalOccupationalCredential
  schema_property: the edge/prop that attaches it (sameAs, hasCredential, review, worksFor...)
  belongs_to:    @id of the entity this node hangs on
  relates_to:    [ {edge, @id} ]  — relational edges to OTHER entities (worksFor, brand...)
  title:         human label
  description:   text payload for markup
  category:      gcid context
  tags:          [ ... ]  — topical/specialty tags (about, knowsAbout)
  value:         structured schema properties for this node's type
  provenance:    created | discovered | declared
  trust_tier:    self_declared | imported | platform_observed | authority_verified
  sourced_at:    timestamp
  valid_until:   freshness horizon (null = static)
  status:        verified | unverified | claimed
}

## How markup changes by subject (the projection)
The SAME graph renders DIFFERENT markup depending on whose page it is:
- Agent page: Person @id as primary, worksFor→office, brand→RE/MAX, agent's reviews/listings
- Office page: LocalBusiness @id as primary, employee→agents, parentOrg→RE/MAX
- Brand page: Organization @id as primary, subOrganization→offices
Same nodes, different root → different @graph projection. Build once, project many.

## Why this is the moat (scale math)
1.5M agents × but only ~X offices × ~Y brands. Shared brand/location nodes mean the graph
DENSIFIES as it grows: each new agent connects to existing office+brand nodes. Do it for
real_estate, then 4,040 more categories → the most comprehensive entity graph in local search.

## REVISIONS (2026-07-05) — corrections from category stress-testing

### Entity structure is EMERGENT from counts, not a fixed per-category shape
Do not tag a category with a fixed shape. Structure emerges from actual entity counts:
- LOCATION is the universal base node. EVERY business = at least one location node.
  (Solo dentist, taco truck, single insurance office = one node. Simple signup for all.)
- PERSON nodes spawn ONLY for public-facing, route-to-market professionals when there is
  MORE THAN ONE of them. Not "workers" — a cook/receptionist/paralegal gets NO node.
  The test: does a customer search for and choose this individual by name? (agent, lawyer,
  doctor, loan officer = yes; cook, dishwasher = no.) One such pro = collapses into the
  location node. Multiple = each gets a person node (real disambiguation Google wants).
- BRAND nodes spawn ONLY when location count > 1 (franchise/chain/DSO).

### Single node per business is the DEFAULT (Google anti-duplicate)
Google penalizes a separate practitioner page + location page anchored at the same address
for a single-professional office. So a single pro = ONE fused node, titled to carry both.
(Yext's fix, confirmed real-world: "Brandon Lee - State Farm".)

### title_template is a CATEGORY attribute
Each category carries a title style that decides how the single fused node is titled/typed:
- person-forward: "{person} - {brand}"  (insurance agent, real estate agent, loan officer)
- place-forward:  "{location_name}"      (dentist practice, restaurant, retail)
- brand-forward:  "{brand} {descriptor}" (franchise locations)
At count=1 the category's title_template decides person-forward vs place-forward. This is
what makes the single-pro node RANK instead of self-competing.

### Category also carries: has_client_facing_professionals (bool)
Restaurants: no (nobody picks the cook) -> person nodes never spawn.
Law firms / medical / real estate: yes -> person nodes spawn at count > 1.

### Per-level gcid
Each entity level has its OWN gcid(s): a RE/MAX office is real_estate_agency; its agents are
real_estate_agent. Category is not one tag on the chain — it is per level.

### Category is a TEMPLATE, not a parent entity
Category connects via additionalType (a TYPING edge to the template), never parentOrganization
(an ownership edge to a real parent). Do not put the category in the entity ownership chain.

### Native vs aggregated ring data
A node's ring data is either NATIVE (the agent's own Zillow reviews) or AGGREGATED/derived
(brand reputation = rollup of its offices). Mark which, so the score never double-counts.
Restaurant reviews are NATIVE to the location, NOT a rollup. (Real-estate-specific reasoning
that reviews roll up does NOT generalize — corrected.)

### THE HARD UNSOLVED PROBLEM: entity resolution / dedup
The moat depends on shared brand/location nodes: Agent A and Agent B at the same office must
resolve to ONE location @id and ONE brand @id. They enter as free text ("RE/MAX Downtown",
"Re/Max #4412"). Collapsing these to one @id is an entity-resolution problem and it is HARD.
If dedup fails the graph fragments and the moat evaporates. This is the #1 engineering risk;
the contract ASSUMES dedup, it does not SOLVE it. Must be designed before scale.
