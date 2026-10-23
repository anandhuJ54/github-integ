# Category Generation Spec (component 2) — target: RE/mortgage exemplar grade
One request per category. Inputs injected: gcid, display_name, entity_type, schema_type,
KM canon sources (terminology, search_intents, content_topics, services, expertise_signals,
compliance_rules, conversion_actions). Output: STRICT JSON, no prose.

## Output contract
Emit MINIFIED JSON (no indentation, no newlines inside the object) — output budget is finite.

{
  "taxonomy": [ {"level": EXACTLY one of: profession_title|alias|specialization|product_service|audience|topic|content_title|industry_term|tag|keyword|negative_keyword|question|review_aspect (never numbers, never other names; modifier is global-only — do NOT emit it), "term": str,
                 "search_intent": head|local|service|transactional|question|informational|comparison|urgency (keywords only),
                 "schema_type": str|null, "schema_property": str|null } ],
  // TAXONOMY convention: schema_type = the schema.org type OF THE TERM ITSELF
  // (DefinedTerm for specializations/industry terms/topics, Service, Audience, Article,
  //  Question, Review, Occupation); schema_property = the edge that attaches it
  //  (knowsAbout, hasOfferCatalog, audience, headline, name, reviewAspect, jobTitle).
  "nodes":    [ {"node_name": str, "ring": EXACTLY one of: identity|presence|location|authority|services|content|reputation|engagement|entity_graph (conversion comes from the logic layer — do NOT emit it),
                 "connection_method": manual|platform|etl|oauth|crm_sync|rss,
                 "schema_type": str|null, "schema_property": str|null, "note": str} ],
  // NODE convention: schema_type = the entity that EMITS the property (the SUBJECT):
  // Person, the category's business type (e.g. Electrician, Hotel, Dentist), or the
  // CreativeWork for reversed authorship (Article/Answer). NEVER the value/range type.
  // WRONG (all seen and rejected): geo on GeoCoordinates, address on PostalAddress,
  // aggregateRating on AggregateRating, areaServed on City/AdministrativeArea,
  // makesOffer on Offer, logo on ImageObject, medicalSpecialty on MedicalSpecialty.
  // RIGHT: {"node_name":"Geo Coordinates","schema_type":"Electrician","schema_property":"geo"},
  //        {"node_name":"Google Rating","schema_type":"Hotel","schema_property":"aggregateRating.ratingValue"},
  //        {"node_name":"Blog Bylines","schema_type":"Article","schema_property":"author"}.
  "conversion_actions": [ {"label": str, "schema_action": valid schema.org Action} ]  // only if input lacked them
}

## Round-3 hard rules
- search_intent values (head/local/comparison/...) are NEVER taxonomy levels.
- The business facet is EXACTLY the schema_type provided in the input — never invent
  types (Chiropractor does not exist; the input tells you what does).
- If the input business type is a Place subtype (e.g. Church), org edges (memberOf,
  foundingDate, knowsAbout, award) emit on the Organization facet.
- Credential dates/IDs always ride hasCredential.* paths (hasCredential.expires,
  hasCredential.dateCreated, hasCredential.credentialId) — never bare on Person.
- Aim ABOVE the floors: 160+ taxonomy terms, 120+ nodes.

## Depth floors (exemplar-calibrated)
taxonomy >= 150 terms covering all 14 levels; nodes >= 110 across >= 9 rings
(conversion ring left empty — logic layer fills at projection); every metric node
uses additionalProperty.value on the business facet; counters note interactionType;
credential dates use expires/dateCreated; content authorship reversed (CreativeWork
carries author); worksFor emitted from Person facet; license-status-like fields
schema_type null (platform-only). Category-specific depth beats generic breadth:
mortgage got lender panels + realtor referral partners, not renamed RE nodes.

## Trust model
Generation is NOT trusted. Every output row passes the gauntlet in process_results.py
(vocabulary, domain/range per hop, usage rules, binding gate, uniqueness, depth floors).
Rejects are reported per category and resubmitted with the reject reasons injected.

## Expert-pass class rules (main batch)
- Healthcare categories: national board certifications BY NAME (NBCE, ABPD, boards),
  NPI, Medicare/Medicaid acceptance node, sedation/emergency availability where real.
- Regulated professions: license number as hasCredential.identifier, regulator-hosted
  profile URLs as presence sameAs (BrokerCheck/IAPD/NMLS Consumer Access class).
- Every category: an intro/acquisition OFFER node (makesOffer) and an availability
  node when urgency keywords exist ('emergency X near me' must have a backing node).
- Partner/referral relationships: affiliation (Person facet) or memberOf — never knowsAbout.
- Directory citations must belong to THIS vertical (no Psychology Today for chiropractors,
  no Healthgrades for veterinarians).
- SIBLING CATEGORIES (auto/home/life/health insurance etc.): must differentiate on the
  distinguishing line of business — shared boilerplate across siblings is a defect.
- ENTITY TYPE governs facets: entity_type='location' categories have NO Person facet —
  staff/owners ride employee edges on the business; partners ride memberOf; credentials
  are held at establishment level. Person facets only for 'professional' and 'both'.

## Compliance object (REQUIRED in every output — same pass, no separate phase)
"compliance": {
  "display_license_on_profile": bool,
  "license_display_format": str|null,      // jurisdiction-generic label, e.g. "State License #"
  "regulated_by": [str],                   // regulators/boards by real name
  "prohibited_phrases": [str],             // claims this category must never make
  "required_disclaimers": [str],
  "age_restricted": bool, "hipaa_applicable": bool, "financial_regulations_apply": bool,
  "advertising_restrictions": [str]
}
Floors: regulated categories must name their actual regulator(s); prohibited_phrases >= 4
for licensed/medical/financial/legal categories; empty arrays acceptable only for
genuinely unregulated retail/venue categories.
