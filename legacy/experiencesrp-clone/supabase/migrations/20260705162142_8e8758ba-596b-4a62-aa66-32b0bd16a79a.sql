-- The 8 rings of the expertise graph — canonical reference (locked 2026-07-05).
-- Every schema designator validated against reference/schemaorg-current.jsonld (v29.2).
-- legacy_key maps the old ring vocabulary used by exp_vertical_node_registry seed data.
-- NOTE mapping: old media_voice content is absorbed by 'content'; reputation is NEW
-- (was implicitly inside profiles/social). legacy_key marks nearest-old-name only.

CREATE TABLE IF NOT EXISTS exp_rings (
  position          int PRIMARY KEY CHECK (position BETWEEN 1 AND 8),
  ring_key          text UNIQUE NOT NULL,
  ring_name         text NOT NULL,
  legacy_key        text,                -- old vocabulary (registry seed) for migration
  seo_function      text NOT NULL,
  schema_types      text[] NOT NULL,     -- validated against vendored schema.org
  schema_properties text[] NOT NULL,
  edge_properties   text[] NOT NULL,     -- the @id connective tissue
  notes             text
);
ALTER TABLE exp_rings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rings readable" ON exp_rings FOR SELECT USING (true);

INSERT INTO exp_rings (position,ring_key,ring_name,legacy_key,seo_function,schema_types,schema_properties,edge_properties,notes) VALUES
(1,'identity','Identity','core_identity','Entity disambiguation — Google knowing this is a distinct, real thing',ARRAY['Organization','LocalBusiness','Person','Corporation','ProfilePage','PostalAddress','GeoCoordinates']::text[],ARRAY['name','legalName','alternateName','description','logo','image','url','telephone','address','geo','openingHoursSpecification','priceRange','identifier','duns','taxID','naics','vatID','leiCode','iso6523Code','tickerSymbol','foundingDate','numberOfEmployees']::text[],ARRAY['@id']::text[],'Root node. Public co = Corporation + tickerSymbol; private = Organization + legalName/taxID (schema.org does not model legal form).'),
(2,'presence','Presence','profiles_presence','Citation consistency and coverage — the classic local-SEO signal',ARRAY['WebPage']::text[],ARRAY['sameAs','url','hasMap','mainEntityOfPage']::text[],ARRAY['sameAs']::text[],'One sameAs edge per listing (GMB, Apple, Bing, Yelp...). Low variety, high repetition by design.'),
(3,'authority','Authority','verifiable_authority','Provable qualification — the Trust and Expertise in E-E-A-T',ARRAY['EducationalOccupationalCredential','Occupation','ProgramMembership']::text[],ARRAY['hasCredential','credentialCategory','recognizedBy','validIn','alumniOf','award','hasOccupation','memberOf','knowsAbout','knowsLanguage','identifier']::text[],ARRAY['recognizedBy','memberOf']::text[],'License numbers as identifier+PropertyValue(propertyID). recognizedBy -> licensing body.'),
(4,'reputation','Reputation','media_voice','Experience signal and social proof',ARRAY['AggregateRating','Review','Rating']::text[],ARRAY['aggregateRating','review','ratingValue','reviewCount','ratingCount','bestRating','reviewRating','reviewBody','datePublished']::text[],ARRAY['author','publisher','itemReviewed']::text[],'Many sources, one ring: publisher @id distinguishes GMB vs Healthgrades vs Yelp reviews.'),
(5,'content','Content','published_content','Freshness, topical relevance, demonstrated expertise (absorbs media/voice)',ARRAY['CreativeWork','Article','BlogPosting','NewsArticle','FAQPage','Question','Answer','HowTo','Service','Product','OfferCatalog','Offer','VideoObject','ImageObject','AudioObject']::text[],ARRAY['about','mentions','keywords','datePublished','dateModified','headline','articleBody','inLanguage','hasOfferCatalog','makesOffer','acceptedAnswer']::text[],ARRAY['author','creator','publisher','isPartOf','mainEntityOfPage']::text[],'author @id = the authored-by E-E-A-T edge back to the Person. Media formats are content.'),
(6,'engagement','Engagement','social_engagement','Liveness and popularity signals',ARRAY['InteractionCounter']::text[],ARRAY['interactionStatistic','agentInteractionStatistic','interactionType','userInteractionCount','interactionService']::text[],ARRAY[]::text[],'interactionStatistic=received vs agentInteractionStatistic=performed. interactionType takes Action subtypes (LikeAction, ShareAction, FollowAction, CommentAction, WatchAction, ListenAction, WriteAction).'),
(7,'transactions','Transactions','transactions_outcomes','Outcome/conversion proof — hardest signal to fake; ties to logic-layer conversion_actions',ARRAY['Order','Reservation','FoodEstablishmentReservation','LodgingReservation','Offer','Demand','OrderAction','ReserveAction','ScheduleAction','BuyAction','PayAction']::text[],ARRAY['potentialAction','seeks','availability','price','priceCurrency','acceptsReservations']::text[],ARRAY['potentialAction']::text[],'potentialAction wires the conversion_actions layer into the graph. Mostly platform-observed -> trust-tier matters.'),
(8,'context','Context','upstream_context','Entity-graph connectivity — how AI situates the entity (the AI Entity Graph layer)',ARRAY['Brand']::text[],ARRAY['parentOrganization','subOrganization','department','brand','owns','funder','sponsor','memberOf','areaServed','serviceArea','isPartOf','knowsAbout','sameAs']::text[],ARRAY['parentOrganization','memberOf','brand','sameAs']::text[],'parentOrganization = OWNERSHIP ONLY (corporate-owned chain). Franchisee is independent: use brand -> corporate Brand + memberOf network, NEVER parentOrganization. sameAs here targets knowledge bases (Wikidata/Crunchbase). ''Franchise'' type does not exist.')
ON CONFLICT (position) DO UPDATE SET ring_key=EXCLUDED.ring_key, ring_name=EXCLUDED.ring_name,
  legacy_key=EXCLUDED.legacy_key, seo_function=EXCLUDED.seo_function, schema_types=EXCLUDED.schema_types,
  schema_properties=EXCLUDED.schema_properties, edge_properties=EXCLUDED.edge_properties, notes=EXCLUDED.notes;