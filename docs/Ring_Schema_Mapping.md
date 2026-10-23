# Ring → Schema.org Mapping (SRP expertise graph backbone)

Verified against schema.org live spec (823 types, 1,529 properties, 96 enumerations,
535 enum members — confirmed via schema.org/docs/schemas.html). Confidence tags:
[C]=confirmed core type/property, [E]=edge property (connects rings via @id), [V]=verify
against the specific type page before use in production.

## Architecture principle (confirmed from schema.org tutorial)
The graph is built with @id references, not duplication. A GMB source emits SEPARATE
nodes into multiple rings; each node connects to the entity via an EDGE property + @id.
Example: GMB → presence node (sameAs), reviews node(s) (review/aggregateRating),
posts node(s) (author/about). One source, many nodes, many rings.

## The 8 rings

### 1. Identity — who the entity is
Types [C]: Organization, LocalBusiness (+ ~430 subtypes: Dentist, Attorney, AutoRepair,
  FoodEstablishment...), Person, Place
Props [C]: name, legalName, description, logo, image, url, telephone, address
  (PostalAddress: streetAddress, addressLocality, addressRegion, postalCode, addressCountry),
  geo (GeoCoordinates), openingHoursSpecification, priceRange, slogan, foundingDate
Identifier props [C]: identifier (PropertyValue w/ propertyID), duns, taxID, naics,
  isicV4, vatID, globalLocationNumber, leiCode
Edge [E]: @id (the canonical entity node every other ring references)

### 2. Presence — where the entity exists across the web
Primary prop [C]: sameAs  <-- THE presence edge; one per listing/profile URL
Props [C]: url, hasMap, mainEntityOfPage
Model: GMB-as-listing, Apple, Bing, Yelp, directories each = a sameAs edge to a distinct
  target. Presence is intentionally low-variety, high-repetition (same prop, many targets).

### 3. Authority — verifiable credentials & licenses
Props [C]: hasCredential (EducationalOccupationalCredential: credentialCategory,
  recognizedBy, validIn, competencyRequired), alumniOf, award/awards, hasOccupation
  (Occupation), memberOf (ProgramMembership/Organization), knowsAbout, knowsLanguage
Identifier pattern [C]: identifier + PropertyValue(propertyID='NMLS', value='123456')
  — license numbers as structured identifiers, recognizedBy → licensing Organization
Edge [E]: recognizedBy (@id → authority body), memberOf (@id → professional org)

### 4. Reputation — what others say
Types [C]: AggregateRating (ratingValue, reviewCount, ratingCount, bestRating, worstRating),
  Review (reviewRating → Rating, reviewBody, datePublished)
Edge [E]: author (@id → Person/Org who wrote it), publisher (@id → the SOURCE:
  distinguishes GMB review vs Healthgrades review vs Yelp review), itemReviewed (@id → entity)
Model: MANY sources emit review/aggregateRating nodes into this ONE ring; publisher @id
  tags provenance. This is the multi-source ring.

### 5. Content — what the entity publishes (incl. media)
Types [C]: CreativeWork, Article, BlogPosting, NewsArticle, WebPage, FAQPage
  (Question/Answer/acceptedAnswer), HowTo, Service, Product, OfferCatalog (hasOfferCatalog),
  Offer (makesOffer), VideoObject, ImageObject, AudioObject
Props [C]: about (Thing — topical relevance), mentions, keywords, datePublished,
  dateModified, headline, articleBody, inLanguage
Edge [E]: author (@id → Person — "authored by", the E-E-A-T expertise link),
  creator (@id), publisher (@id), mainEntityOfPage, isPartOf
Model: GMB posts, articles, service pages, videos each = a CreativeWork node with an
  author @id back to the person. THIS is where "authored by" lives.

### 6. Engagement — active audience interaction  [V — verify InteractionCounter enums]
Types [V]: InteractionCounter (interactionType, userInteractionCount)
Props [C]: interactionStatistic, agentInteractionStatistic
interactionType values [V]: LikeAction, ShareAction, FollowAction, CommentAction,
  ViewAction, SubscribeAction (these are Action subtypes — VERIFY each is current)
Note: thinnest ring in schema.org; much engagement is platform-observed, not marked up.

### 7. Transactions — proof of real business outcomes
Types [C]: Order, Reservation (FoodEstablishmentReservation, LodgingReservation,
  RentalCarReservation...), Offer (availability, price, priceCurrency)
Action props [C]: potentialAction → OrderAction, ReserveAction, ScheduleAction, BuyAction,
  PayAction  <-- THESE TIE DIRECTLY TO THE LOGIC-LAYER conversion_actions ALREADY GENERATED
Props [V]: seeks (Demand)
Note: most completed-transaction data is PLATFORM-OBSERVED, not public markup → trust-tier
  matters here. This ring is largely fed by the conversion agent's logged outcomes.

### 8. Context — upstream entity relationships & knowledge graph
Props [C]: parentOrganization, subOrganization, department, brand (Brand), owns, funder,
  sponsor, memberOf, areaServed, serviceArea, isPartOf, knowsAbout
Knowledge-graph edge [E]: sameAs (@id → Wikidata, Wikipedia, Crunchbase) — SAME property
  as Presence ring but target type = knowledge base, not listing. Router by target type.
Franchise [V]: 'Franchise'/franchisee/franchisor — VERIFY these exist (uncertain)
Note: this ring is the doc's "AI Entity Graph" layer — how AI situates the entity.

## Cross-ring edges (the connective tissue — the graph IS these)
- @id            : every node references the Identity entity node
- sameAs         : Presence (→listings) AND Context (→knowledge bases) — route by target
- author/creator : Content/Reputation → Person (E-E-A-T expertise & experience)
- publisher      : Reputation/Content → source Organization (provenance of the signal)
- recognizedBy   : Authority → licensing body
- itemReviewed   : Reputation → entity
- about          : Content → topic Thing (topical authority)

## Verification results (checked against live schema.org, 2026-07-05)
1. [CONFIRMED] InteractionCounter — slots: interactionType, userInteractionCount,
   interactionService, location, startTime, endTime. interactionType accepts any Action;
   confirmed real: LikeAction, ShareAction, FollowAction, CommentAction, ListenAction,
   WatchAction, WriteAction. BONUS: interactionStatistic (received) vs
   agentInteractionStatistic (performed by the entity) — two directions.
2. [CONFIRMED] ProfilePage + mainEntity — the canonical person-node pattern; sameAs on the
   Person for entity disambiguation.
3. [CONFIRMED] Org edges: parentOrganization (OWNERSHIP, up), subOrganization (down),
   memberOf (AFFILIATION — associations, not ownership), owns, funder, hasCredential,
   hasOfferCatalog, naics, nonprofitStatus, numberOfEmployees.
4. [NOT CONFIRMED — do not use] 'Franchise'/franchisee/franchisor and 'seeks'/'Demand'
   could not be verified. Not needed: a franchise is modeled by parentOrganization/
   subOrganization; transaction intent by potentialAction. Excluded rather than asserted.

EDGE SEMANTICS (critical): parentOrganization = ownership (office->brand); memberOf =
affiliation (agent->NAR). Do not conflate — they carry different meaning to Google.
