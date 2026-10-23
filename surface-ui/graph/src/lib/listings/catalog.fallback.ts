/** @deprecated FALLBACK ONLY — the publisher catalogs now live in the database
 *  (exp_listings_publishers + exp_listings_field_map, seeded by
 *  drizzle/migrations/0026_listings_catalog_db.sql, generated from THIS file by
 *  tools/listings/emit_catalog_sql.ts). listings-tab.tsx reads the DB and uses these
 *  constants only while the migration is unapplied. Edit the DB, not this file;
 *  delete this file once 0026 is applied everywhere.
 *
 *  Column order (Scott, 2026-07-09): Their Field | Our Mapped Field | Rules.
 *  Data Axle documented from local-listings-premium.data-axle.com/docs + /docs/api.
 *  This is an OUTPUT mapping — it does not change the model; "missing_ours" rows
 *  are enrichment candidates only. */

export type RowStatus = "mapped" | "missing_ours" | "na" | "pipeline";
export interface MapRow {
  their: string;
  ours: string;
  rules: string;
  status: RowStatus;
  family?: string;
}
export interface Section {
  title: string;
  note?: string;
  rows: MapRow[];
  applicability?: string;
}

export const DATA_AXLE_SECTIONS: Section[] = [
  {
    title: "Core Required",
    note: "Their publishing minimum — failures here fail the whole submission.",
    rows: [
      {
        their: "Submission Type",
        ours: "Pipeline state (A/U/R/D)",
        rules:
          "A=Add (billable) · U=Update (free <12mo) · R=Renew (billable, 12mo+) · D=Delete (out of business only). They auto-detect type from history.",
        status: "pipeline",
      },
      {
        their: "Company Name",
        ours: "Registry: DBA Name [identity]",
        rules:
          "DBA, not legal name. No location suffixes (“Best Buy - Omaha” fails). Pipes or characters around ampersands fail up-front validation.",
        status: "mapped",
      },
      {
        their: "Location Address",
        ours: "Registry: Street Address [location]",
        rules:
          "Address only, no cross-street text. USPS-standardized suffixes (St, Ave, NW). Canadian suites: “99-894 Road”, suite attribute left blank.",
        status: "mapped",
      },
      {
        their: "Location City",
        ours: "Profile: address.addressLocality",
        rules: "City of physical location.",
        status: "mapped",
      },
      {
        their: "Location State/Province",
        ours: "Profile: address.addressRegion",
        rules: "Abbreviated, not spelled out. US + DC + GU/PR/VI only.",
        status: "mapped",
      },
      {
        their: "Location Zip/Postal Code",
        ours: "Profile: address.postalCode",
        rules: "5 digits, leading zero preserved.",
        status: "mapped",
      },
      {
        their: "Location Phone",
        ours: "Registry: Phone Number [presence]",
        rules:
          "LOCAL number required, 10-digit; toll-free alone is rejected. Their primary match key — wrong phone creates duplicates.",
        status: "mapped",
      },
      {
        their: "Primary SIC",
        ours: "gcid → SIC crosswalk (to build)",
        rules:
          "Their category taxonomy. Mexican Restaurant ≈ 581208. Professional credentials must correspond to SIC (ATTY ↔ 811103).",
        status: "missing_ours",
      },
    ],
  },
  {
    title: "Enhanced Content",
    note: "Their “highly used by publishers” list — richer listings rank and retain better.",
    rows: [
      {
        their: "Operating Hours",
        ours: "Registry: Operating Hours [services]",
        rules:
          "Multi-range per day supported; format per template tab 3. “By appointment” NOT accepted.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "Cuisine",
        ours: "Registry: Cuisine Type [identity]",
        rules: "Fixed enum (their published cuisine list). Value must match exactly.",
        status: "mapped",
      },
      {
        their: "Payment Type",
        ours: "Registry: payment methods node",
        rules: "Enum of accepted payment methods.",
        status: "missing_ours",
        family: "payment",
      },
      {
        their: "Short Web Address",
        ours: "Registry: Website URL [presence]",
        rules: "Main site domain.",
        status: "mapped",
      },
      {
        their: "Web Address",
        ours: "Profile: location page URL",
        rules: "Longer, location-specific page.",
        status: "mapped",
      },
      {
        their: "Social Links",
        ours: "Registry: Facebook / Instagram profiles [presence]",
        rules: "Facebook, Twitter, etc.",
        status: "mapped",
      },
      {
        their: "Brands / Products / Services",
        ours: "Registry: brands + services nodes",
        rules: "e.g. brands carried; ATM special rule — bank name goes in Brands.",
        status: "mapped",
        family: "brand",
      },
      {
        their: "Business Description",
        ours: "Registry: Description [identity]",
        rules: "Verified by their research team.",
        status: "mapped",
      },
      {
        their: "Alternative Name",
        ours: "Registry: alternate-name node",
        rules: "e.g. “Starbucks Pike Street”.",
        status: "missing_ours",
        family: "alt_name",
      },
      {
        their: "Anchor/Host Business",
        ours: "Registry: anchor/host node",
        rules: "“Starbucks inside Target” — Target is anchor/host.",
        status: "missing_ours",
        family: "anchor_host",
      },
      {
        their: "Toll Free / Fax",
        ours: "Registry: Toll-Free Number + Fax Number [presence]",
        rules: "Fax + attorney SIC 811103 triggers a warning (category-conditional rule).",
        status: "mapped",
      },
      {
        their: "Extended attributes (accessibility, parking, amenities — 400+ read-side)",
        ours: "Registry: operational layer nodes",
        rules:
          "Writable subset lives in the login-gated template (attributes change through the year) — reconcile on template pull; operational nodes stand ready.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Restaurant Attributes",
    applicability: "restaurant_attributes",
    note: "Category-variant pack (their newest additions).",
    rows: [
      {
        their: "Takeout / Dining Options",
        ours: "Registry: Dine-In Offer, Online Ordering URL, Takeout nodes [services]",
        rules: "New attributes per their docs banner; submit via updated template.",
        status: "mapped",
      },
      {
        their: "Reservations",
        ours: "Registry: OpenTable Reservation Profile [presence]",
        rules: "—",
        status: "mapped",
      },
      {
        their: "Service Area Cities",
        ours: "Registry: Service Area Coverage [location]",
        rules: "New attribute; for service-area businesses.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Images (×5)",
    rows: [
      {
        their: "Primary Image + Image 2–5",
        ours: "Registry: Logo [identity], Photo Gallery nodes [content]",
        rules:
          "URL of the image itself (not the page). jpg/png/non-animated gif. ≥1600px wide recommended. Primary = storefront with visible sign. Human-reviewed; duplicates rejected. Images accumulate across submissions.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Professional Records",
    applicability: "professional_records",
    note: "Their schema splits professional vs location exactly where our entity model does. This category is a location — block not applicable here; required for professional categories.",
    rows: [
      {
        their: "Is Professional Record?",
        ours: "entity_type (professional lane)",
        rules: "Y/N; defaults N.",
        status: "na",
      },
      {
        their: "Professional First/Last Name",
        ours: "Profile: person givenName/familyName",
        rules: "Alpha + apostrophes only.",
        status: "na",
      },
      {
        their: "Professional Firm Name",
        ours: "Profile: worksFor organization",
        rules: "Hospital, company, or office.",
        status: "na",
      },
      {
        their: "Professional Credentials",
        ours: "Registry: authority-ring credential nodes",
        rules:
          "Fixed enum; MUST correspond to Primary SIC (ATTY ↔ 811103). Insurance agents: carrier-specific name formats (“John Smith State Farm Insurance Agent”).",
        status: "na",
      },
      {
        their: "Professional Standardized Title",
        ours: "Profile: jobTitle",
        rules: "Enum: CEO, Owner, President, EVP, SVP, VP, Plant Manager, Office Manager.",
        status: "na",
      },
      {
        their: "Professional Email",
        ours: "Profile: email",
        rules: "Not available for Canadian records.",
        status: "na",
      },
    ],
  },
];

export const DA_PUBLISHES_TO =
  "Major search engines · Internet Yellow Pages · In-car navigation systems · Smart speakers / virtual assistants · Mobile apps · Directory assistance (411) · AI-driven search surfaces";

export const DA_OPS_NOTES = [
  "Verification is human: automated match → teleresearch (3 calls / 3 business days) → manual research. Unverifiable = failed.",
  "Monthly resubmission recommended — recency is passed to publishers as a quality signal.",
  "3 failed submissions = 90-day limbo. Duplicates removed via Account Executive.",
  "Renewal emails at 30–60 days out; A and R are the billable events.",
];

export const FOURSQUARE_SECTIONS: Section[] = [
  {
    title: "Identity & Match",
    note: "Onboarding rail: harmonize our profile to their POI before any write.",
    rows: [
      {
        their: "fsq_place_id",
        ours: "Presence node instance: Foursquare listing (stores their ID)",
        rules:
          "Obtained via Place Match: name + address (or lat/lng) → fsq_place_id + match_rate 0.45–1.00; 404 below threshold. Abbreviate directionals (N, S) and suffixes (St, Rd) for match quality.",
        status: "pipeline",
      },
      {
        their: "categories (up to 3)",
        ours: "gcid → FSQ category crosswalk (to build)",
        rules:
          "New integer taxonomy (~1,100 categories; legacy hex IDs deprecated with V3, May 2026). Mexican Restaurant = 13303 under Dining & Drinking › Restaurant. Up to 3 IDs per place — supports our multi-category composition.",
        status: "missing_ours",
      },
      {
        their: "chains",
        ours: "Profile: brand/franchise affiliation",
        rules: "FSQ Chain IDs for franchise locations.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Core Place Data",
    note: "Writable today via the Feedback API (Propose Place Edit) — lands as a reviewed proposal.",
    rows: [
      {
        their: "name",
        ours: "Registry: DBA Name [identity]",
        rules: "Propose-editable.",
        status: "mapped",
      },
      {
        their: "location (address, locality, region, postcode)",
        ours: "Profile: address components",
        rules: "Propose-editable. USPS-style abbreviations improve matching.",
        status: "mapped",
      },
      {
        their: "latitude / longitude",
        ours: "Profile: geo coordinates",
        rules: "Propose-editable (mislocated flag also available).",
        status: "mapped",
      },
      {
        their: "tel",
        ours: "Registry: Phone Number [presence]",
        rules: "Propose-editable.",
        status: "mapped",
      },
      {
        their: "website",
        ours: "Registry: Website URL [presence]",
        rules: "Propose-editable.",
        status: "mapped",
      },
      {
        their: "email",
        ours: "Profile: business email",
        rules: "Rich attribute.",
        status: "mapped",
      },
      {
        their: "hours (structured + display)",
        ours: "Registry: Operating Hours [services]",
        rules: "Structured periods; open_now derived by FSQ.",
        status: "mapped",
      },
      {
        their: "date_closed / closed_bucket",
        ours: "Profile: operating status",
        rules: "Flag Problematic Place endpoint: closed, mislocated, etc.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Rich Content & Features",
    rows: [
      {
        their: "menu (URL)",
        ours: "Registry: Menu URL [services]",
        rules: "Menu link — not item-level content.",
        status: "mapped",
      },
      {
        their: "features.food_and_drink / services (delivery, dine-in, takeout, reservations)",
        ours: "Registry: 19 dining/ordering nodes [services/presence]",
        rules: "Attribute block; partner-path write.",
        status: "mapped",
      },
      {
        their: "features.payment (credit cards, digital wallet)",
        ours: "Registry: payment methods node",
        rules: "Same gap as Data Axle Payment Type — one enrichment fixes both publishers.",
        status: "missing_ours",
        family: "payment",
      },
      {
        their: "features.amenities (wifi, outdoor seating, restrooms)",
        ours: "Registry: Guest WiFi + amenity nodes [location]",
        rules: "Attribute block.",
        status: "mapped",
      },
      {
        their: "features: wheelchair accessible",
        ours: "Registry: Accessibility Features [location]",
        rules: "Accessibility attribute.",
        status: "mapped",
      },
      {
        their: "features: parking",
        ours: "Registry: Parking Availability [location]",
        rules: "Parking attribute.",
        status: "mapped",
      },
      {
        their: "price (1–4 tier)",
        ours: "Registry: Price Range [identity]",
        rules: "Venue price tier.",
        status: "mapped",
      },
      {
        their: "photos",
        ours: "Registry: Photo Gallery nodes [content]",
        rules: "UGC + owner photos; write via partner path.",
        status: "mapped",
      },
      {
        their: "social_media",
        ours: "Registry: Facebook / Instagram profiles [presence]",
        rules: "Rich attribute.",
        status: "mapped",
      },
      {
        their: "description",
        ours: "Registry: Restaurant Description [identity]",
        rules: "Rich attribute.",
        status: "mapped",
      },
      {
        their: "rating / popularity / stats",
        ours: "READ-ONLY — derived by FSQ from user behavior",
        rules: "Never writable; ingestible as reputation signals for our side.",
        status: "na",
      },
    ],
  },
];

export const FSQ_PUBLISHES_TO =
  "Apple Maps · OpenAI · Uber · Nextdoor · Yahoo! Japan · navigation & AI-search surfaces via FSQ OS Places";
export const FSQ_OPS_NOTES = [
  "Three write paths: Place Match (read/harmonize, self-serve key) · Feedback API propose-edits (Service Account key, reviewed proposals, status endpoint) · Business Listings bulk authoritative publishing (partner agreement — in motion).",
  "Legacy V3 endpoints deprecated May 15, 2026 — integrate against the new FSQ OS Places-powered endpoints only.",
  "Feedback proposals are reviewed by Foursquare before applying; Get Feedback Status closes the loop.",
  "FSQ Places powers Apple Maps and OpenAI — the most AI-citation-relevant aggregator on the list.",
];

export const GOOGLE_SECTIONS: Section[] = [
  {
    title: "Identity & Categories",
    note: "Business Information API v1 · locations resource. Our crosswalk is IDENTITY: platform gcids are GBP category IDs.",
    rows: [
      {
        their: "title",
        ours: "Registry: DBA Name [identity]",
        rules:
          "Real-world name only. FORBIDDEN in name: taglines, store codes, special chars, hours/open status, phone, URLs, service info, address, containment (“Chase ATM in Duane Reade”). Violations risk suspension.",
        status: "mapped",
      },
      {
        their: "categories.primaryCategory",
        ours: "Profile: primary gcid — native",
        rules:
          "Must be a valid GBP category ID. Ours ARE GBP category IDs — identity mapping, verified by construction.",
        status: "mapped",
      },
      {
        their: "categories.additionalCategories (≤9)",
        ours: "Profile: composed categories 2–10",
        rules:
          "Up to 9 additional — exactly our composition contract (primary + 9). Primary + additional must be updated together (no partial mask).",
        status: "mapped",
      },
      {
        their: "storeCode",
        ours: "Profile: external location code",
        rules: "Multi-location dedupe key for bulk management.",
        status: "mapped",
      },
      {
        their: "languageCode",
        ours: "Profile: locale",
        rules: "IMMUTABLE after creation.",
        status: "mapped",
      },
      {
        their: "labels",
        ours: "Platform-internal tags",
        rules: "1–255 chars each; never user-facing.",
        status: "pipeline",
      },
      {
        their: "relationshipData / chains",
        ours: "Profile: brand/franchise affiliation",
        rules: "Chain association.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Location, Contact & Service Area",
    rows: [
      {
        their: "storefrontAddress",
        ours: "Profile: address components",
        rules: "Geocoded on create; PO boxes rejected.",
        status: "mapped",
      },
      {
        their: "latlng",
        ours: "Profile: geo coordinates",
        rules: "APPROVED CLIENTS ONLY may update; otherwise derived from geocoding.",
        status: "mapped",
      },
      {
        their: "serviceArea (places + regionCode)",
        ours: "Registry: Service Area Coverage [location]",
        rules:
          "CUSTOMER_LOCATION_ONLY businesses need NO address but MUST set regionCode; areas as place IDs.",
        status: "mapped",
      },
      {
        their: "phoneNumbers.primaryPhone / additionalPhones",
        ours: "Registry: Phone Number [presence]",
        rules:
          "International format preferred (+1 415 555 0132). Primary + additional must update together.",
        status: "mapped",
        family: "phone",
      },
      {
        their: "websiteUri",
        ours: "Registry: Website URL [presence]",
        rules: "Location-specific URL preferred over brand-generic.",
        status: "mapped",
        family: "website",
      },
    ],
  },
  {
    title: "Hours (four layers)",
    rows: [
      {
        their: "regularHours",
        ours: "Registry: Operating Hours [services]",
        rules: "TimePeriod collection.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "specialHours",
        ours: "Profile: holiday/exception hours",
        rules: "Each period <24h; close can extend to 11:59am next day; overrides regular hours.",
        status: "mapped",
      },
      {
        their: "moreHours[]",
        ours: "Registry: department/service-specific hours nodes",
        rules:
          "Category-defined hoursTypes (drive-through, delivery, senior hours…) — discovered per category via categories.list.",
        status: "mapped",
      },
      {
        their: "openInfo (status, openingDate, canReopen)",
        ours: "Profile: operating status + founding",
        rules: "OPEN / CLOSED_PERMANENTLY / CLOSED_TEMPORARILY; openingDate can be future.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Profile, Services & Menus",
    rows: [
      {
        their: "profile.description",
        ours: "Registry: Description [identity]",
        rules:
          "750 chars, own voice. REQUIRED for all categories EXCEPT lodging (forbidden there — Lodging API owns hotel content).",
        status: "mapped",
        family: "description",
      },
      {
        their: "serviceItems (structured + freeForm)",
        ours: "Taxonomy: product_service level + pricing",
        rules:
          "structuredServiceItem: Google serviceTypeId (per category) + price; freeFormServiceItem for custom. Google may auto-add services — monitor and prune (drift detection).",
        status: "mapped",
      },
      {
        their: "Food Menus API (menus > sections > items)",
        ours: "Taxonomy: product_service + KM signature items + pricing",
        rules:
          "Item-level: name, description, price, dietary attributes, item photos, cuisines. THE deep-menu surface. Requires FOOD_MENUS enabled category.",
        status: "mapped",
      },
      {
        their: "Health insurance networks",
        ours: "Registry: Insurance Accepted [services]",
        rules: "US medical categories: accepted insurance networks (v4.9+).",
        status: "mapped",
      },
    ],
  },
  {
    title: "Attributes (dynamic per category)",
    rows: [
      {
        their: "attributes (BOOL / ENUM / REPEATED_ENUM / URL)",
        ours: "Registry: amenity/service/payment nodes per category",
        rules:
          "attributes.list?show_all exposes ALL attributes valid for a category+region — Google-defined, changes without API versioning. THE per-category enrichment oracle: their attribute list audits our registry per category.",
        status: "mapped",
      },
      {
        their: "attributes: accessibility (wheelchair entrance/restroom/seating/parking)",
        ours: "Registry: Accessibility Features [location]",
        rules: "Accessibility attribute group.",
        status: "mapped",
      },
      {
        their: "attributes: parking",
        ours: "Registry: Parking Availability [location]",
        rules: "Lot / street / valet / garage options.",
        status: "mapped",
      },
      {
        their: "attributes: amenities (Wi-Fi, restrooms)",
        ours: "Registry: Guest WiFi + amenity nodes [location]",
        rules: "Amenity attribute group (venue-weighted).",
        status: "mapped",
      },
      {
        their: "attributes: identity (women-owned, veteran-owned, LGBTQ+ friendly, Black-owned)",
        ours: "Registry: Ownership Identity Badges [identity]",
        rules: "Identity attribute group — campaign/dashboard filters; merchant-declared.",
        status: "mapped",
      },
      {
        their: "attributes: service options (delivery, curbside, in-store pickup, dine-in)",
        ours: "Registry: Delivery, Pickup and Curbside Options [services]",
        rules: "Service-options attribute group; restaurant variants via dining options.",
        status: "mapped",
      },
      {
        their: "attributes: planning (appointment required, reservations)",
        ours: "Registry: Appointment and Walk-In Policy [services]",
        rules: "Planning attribute group.",
        status: "mapped",
      },
      {
        their: "attributes: languages spoken",
        ours: "Registry: Languages Spoken [services]",
        rules: "Staff language coverage where offered.",
        status: "mapped",
      },
      {
        their: "attributes: payment types",
        ours: "Registry: payment methods node",
        rules: "Part of the attribute set for most categories.",
        status: "missing_ours",
        family: "payment",
      },
      {
        their: "getGoogleUpdated (diff view)",
        ours: "Curator: drift detection",
        rules:
          "Returns Google/user-edited version with masks showing which fields differ from ours — the single-voice-of-truth watchdog.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Place Action Links",
    note: "Their action links ARE our conversion ring — lane CTAs publish here.",
    rows: [
      {
        their:
          "APPOINTMENT / DINING_RESERVATION / FOOD_ORDERING / FOOD_DELIVERY / FOOD_TAKEOUT / ONLINE_ORDER / SHOP_ONLINE",
        ours: "Registry: conversion-ring CTAs (lane-aware)",
        rules:
          "Place Actions API; one preferred link per type; provider links may compete with merchant links.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Media",
    rows: [
      {
        their:
          "media (photo categories: LOGO, COVER, EXTERIOR, INTERIOR, PRODUCT, FOOD_AND_DRINK, MENU, TEAM, AT_WORK)",
        ours: "Registry: Logo [identity] + Photo Gallery [content]",
        rules: "v4 Media API; format/size minimums; category-tagged uploads.",
        status: "mapped",
        family: "images",
      },
      {
        their: "video",
        ours: "Registry: video nodes [content]",
        rules: "≤30s, ≤100MB, 720p+.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Engagement Surfaces (v4)",
    rows: [
      {
        their: "Local Posts (STANDARD / EVENT / OFFER / ALERT + recurring)",
        ours: "Posts product → publish pipe",
        rules:
          "CTA button types incl. BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL. Recurring posts supported.",
        status: "mapped",
      },
      {
        their: "Questions & Answers",
        ours: "Taxonomy: question level → owned Q&A",
        rules: "Merchants can seed and answer — our question taxonomy publishes here.",
        status: "mapped",
      },
      {
        their: "Reviews (reply)",
        ours: "Review Management → reply pipe",
        rules: "Read + reply; review media and reply status trackable.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Lodging (hotel categories)",
    applicability: "lodging",
    rows: [
      {
        their: "Lodging API (mybusinesslodging)",
        ours: "Registry: hotel amenity/policy nodes",
        rules:
          "Deep hotel schema: amenities, policies, sustainability, health & safety. Replaces profile.description for lodging.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Verification & Ops",
    rows: [
      {
        their: "Verifications API / voiceOfMerchantState",
        ours: "Onboarding pipeline",
        rules:
          "Verification options (postcard, phone, email, instant); voice-of-merchant gates all publishing.",
        status: "pipeline",
      },
      {
        their: "Performance API (impressions, calls, direction requests)",
        ours: "READ-ONLY → analytics + score signals",
        rules: "Ingestible metrics; never writable.",
        status: "na",
      },
    ],
  },
];
export const GOOGLE_PUBLISHES_TO =
  "Google Search · Google Maps · AI Overviews / Gemini surfaces · the primary local discovery surface";
export const GOOGLE_OPS_NOTES = [
  "Access: enable in GCP Console + request GBP API access (quota starts at 0 until approved) — self-serve application, not a partner agreement.",
  "updateMask required on every patch; categories and phone numbers update as whole objects, never partially.",
  "attributes.list?show_all per category+region = the per-category field oracle; attributes change without API versioning — Curator watch-item.",
  "getGoogleUpdated diffs = drift detection: Google and users can edit listings; masks show exactly which fields moved.",
  "Google may auto-add services to service lists — monitor and prune incorrect ones (permanent fix per Google).",
];

export const META_SECTIONS: Section[] = [
  {
    title: "Facebook Page — Business Metadata",
    note: "Graph API v25 (quarterly versions, ~2yr support). Page category is UI-managed, not API-writable — no crosswalk needed.",
    rows: [
      {
        their: "name",
        ours: "DRIFT-AUDIT only",
        rules:
          "Page name is NOT API-writable — changes go through Meta's UI review; we verify it matches DBA and flag divergence.",
        status: "pipeline",
      },
      {
        their: "about (255 chars)",
        ours: "Registry: short description [identity]",
        rules: "Writable; 255-char ceiling.",
        status: "mapped",
      },
      {
        their: "description / general_info",
        ours: "Registry: Description [identity]",
        rules: "Writable long-form.",
        status: "mapped",
      },
      {
        their: "phone / emails / website",
        ours: "Registry: Phone + Website [presence]",
        rules: "Contact fields.",
        status: "mapped",
      },
      {
        their: "location (address, lat/lng)",
        ours: "Profile: address components",
        rules:
          "Historically RESTRICTED for existing pages — many page types cannot update address via API; verify at integration (Graph Explorer metadata=1 on a sandbox page). Multi-location brands use the locations edge.",
        status: "pipeline",
      },
      {
        their: "hours",
        ours: "Registry: Operating Hours [services]",
        rules: "Writable; key format mon_1_open/mon_1_close, two ranges per day max.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "price_range",
        ours: "Registry: Price Range [identity]",
        rules: "$ – $$$$.",
        status: "mapped",
      },
      {
        their: "category_list",
        ours: "READ + audit only",
        rules:
          "Not API-writable — set in Page settings; we verify it matches the gcid and flag drift.",
        status: "pipeline",
      },
      {
        their: "cover / profile photos, CTA button",
        ours: "Registry: Logo + photos [content]; conversion CTA",
        rules: "Page CTA maps to conversion-ring primary action.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Facebook — Publishing",
    rows: [
      {
        their: "page feed posts (message, link, media, scheduled_publish_time)",
        ours: "content_publications channel: facebook",
        rules:
          "NATIVE SCHEDULING via scheduled_publish_time — the multi-post feature publishes and schedules directly.",
        status: "mapped",
      },
      {
        their: "events (page events)",
        ours: "content_items kind: event",
        rules: "Page events surface — the event content kind publishes here.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Instagram — Publishing (professional accounts)",
    note: "IG business/creator only; business path requires linked FB Page; PPA where applicable.",
    rows: [
      {
        their: "media containers → publish (image/carousel/Reels/Stories, alt_text)",
        ours: "content_publications channel: instagram",
        rules:
          "Two-step: POST /media → /media_publish; poll status IN_PROGRESS→FINISHED→PUBLISHED; containers expire in 24h; images JPEG only; 200 calls/hr/account; content_publishing_limit endpoint for quota.",
        status: "mapped",
      },
      {
        their: "profile fields (bio, website)",
        ours: "READ + audit only",
        rules: "IG profile editing not API-supported — verify-and-flag drift.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "WhatsApp Business (Scott ruling #4)",
    rows: [
      {
        their: "business profile (about, address, description, email, websites, vertical, photo)",
        ours: "Registry: WhatsApp Business Profile [presence] + identity nodes",
        rules:
          "WhatsApp Business Platform profile endpoints; Cloud API via the same Meta app. International contact channel.",
        status: "mapped",
      },
      {
        their: "messaging (conversations)",
        ours: "Engagement surface (future)",
        rules: "Conversation-based pricing; outside listings scope.",
        status: "na",
      },
    ],
  },
  {
    title: "Ops & Access",
    rows: [
      {
        their: "App Review (per-permission screencasts)",
        ours: "Onboarding pipeline",
        rules:
          "2–4 weeks per permission; Advanced Access for publishing on accounts we don't own. pages_manage_posts, pages_manage_metadata, instagram_business_content_publish.",
        status: "pipeline",
      },
      {
        their: "tokens (60-day long-lived, refresh after 24h)",
        ours: "oauth_connections refresh jobs",
        rules: "Refresh every ~50 days or publishing silently dies.",
        status: "pipeline",
      },
    ],
  },
];
export const META_PUBLISHES_TO =
  "Facebook Pages · Instagram · Meta search surfaces · WhatsApp Business linkage";
export const META_OPS_NOTES = [
  "Identity + content channel, not a listings feed: page/profile fields sync where writable, drift-audit where not (category, IG bio).",
  "Graph API v25.0 current; versions sunset ~2 years — pin and bump ahead of expiry.",
  "IG prerequisites compound onboarding: professional account + linked FB Page (business path) + PPA where required.",
  "FIELD-WRITABILITY VERIFICATION PENDING: Meta's Page reference is JS-walled to automated readers — final per-field write truth comes from Graph Explorer (metadata=1) + sandbox POSTs on a test page during App Review setup. Rows marked pipeline are the known-restricted set.",
];

export const LINKEDIN_SECTIONS: Section[] = [
  {
    title: "Organization Page",
    note: "Community Management API — access via LinkedIn Developer Program review. Org profile fields are largely UI-managed.",
    rows: [
      {
        their: "organization name / tagline / description / website / logo",
        ours: "Registry: identity + presence nodes",
        rules: "Read + limited write; most org identity edits are UI-side — verify-and-flag drift.",
        status: "pipeline",
      },
      {
        their: "industries (LinkedIn industry codes) / specialties",
        ours: "gcid → industry family (coarse; ~420 codes)",
        rules: "UI-managed; we recommend the correct code per category and audit.",
        status: "pipeline",
      },
      {
        their: "locations",
        ours: "Profile: address components",
        rules: "Org locations list.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Publishing",
    rows: [
      {
        their: "organization posts (Posts API: text, article link, media, documents)",
        ours: "content_publications channel: linkedin",
        rules: "w_organization_social; no native scheduling — our scheduler holds and fires.",
        status: "mapped",
      },
      {
        their: "member posts (professional's own voice)",
        ours: "content_publications channel: linkedin (member token)",
        rules:
          "w_member_social — THE professional lane: library subscriptions publish to the person's feed, not just the org page.",
        status: "mapped",
      },
      {
        their: "articles (long-form)",
        ours: "content_items kind: article",
        rules: "Link-share of VOCE articles; native LinkedIn Articles not API-writable.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Ops & Access",
    rows: [
      {
        their: "Developer Program access review",
        ours: "Onboarding pipeline",
        rules: "Community Management API requires application approval; scopes per product.",
        status: "pipeline",
      },
      {
        their: "member profile fields (headline, experience, skills)",
        ours: "NOT WRITABLE — by design",
        rules:
          "No public API edits member profiles; the graph holds the truth, LinkedIn holds their copy.",
        status: "na",
      },
    ],
  },
];
export const LINKEDIN_PUBLISHES_TO =
  "LinkedIn feed · organization pages · member networks · LinkedIn search";
export const LINKEDIN_OPS_NOTES = [
  "Primarily a professional-lane CONTENT channel: member-voice posting is the value; org listing fields are thin and mostly UI-managed.",
  "No native post scheduling — platform scheduler owns timing.",
];

export const APPLE_SECTIONS: Section[] = [
  {
    title: "Identity & Category",
    note: "Apple Business (rebranded April 14, 2026 — merged Business Connect + Business Manager + Essentials). Free platform; place cards surface across Apple Maps, Siri, Spotlight, Safari, and Wallet.",
    rows: [
      {
        their: "business name",
        ours: "Registry: DBA Name [identity]",
        rules: "Real-world name; consistency with signage.",
        status: "mapped",
      },
      {
        their: "category",
        ours: "gcid → Apple category (verify at integration)",
        rules:
          "Apple's own taxonomy, selected in dashboard; no public dump — confirm mapping on first claimed listing.",
        status: "pipeline",
      },
      {
        their: "Partner ID",
        ours: "Platform partner identifier",
        rules:
          "Optional for small businesses; REQUIRED for enterprise orgs and third-party partners using the Location APIs.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Place Card Content",
    rows: [
      {
        their: "About / text fields",
        ours: "Registry: Description [identity]",
        rules: "Business-voice description.",
        status: "mapped",
        family: "description",
      },
      {
        their: "Good to Know (wheelchair access, Wi-Fi, amenities)",
        ours: "Registry: Accessibility Features + Guest WiFi + amenity nodes [location]",
        rules: "Operational attribute set — maps straight onto the operational layer.",
        status: "mapped",
      },
      {
        their: "logo + images",
        ours: "Registry: Logo [identity] + Photo Gallery [content]",
        rules: "Brand assets on the place card.",
        status: "mapped",
        family: "images",
      },
      {
        their: "hours",
        ours: "Registry: Operating Hours [services]",
        rules: "Update for holidays/special events per Apple guidance.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "phone / website",
        ours: "Registry: Phone + Website [presence]",
        rules: "Contact block.",
        status: "mapped",
        family: "phone",
      },
    ],
  },
  {
    title: "Showcases & Actions",
    rows: [
      {
        their: "Showcases (offers, promotions)",
        ours: "content_items kind: offer → publications channel",
        rules:
          "Approval takes up to 3 days; expire after 30 days unless earlier — scheduler must model the approval lag and expiry.",
        status: "mapped",
      },
      {
        their: "Action links / CTAs (Call Now, Get Directions, Order, Reserve)",
        ours: "Registry: conversion-ring CTAs",
        rules:
          "Provider actions via Instacart, Booking.com, OpenTable — provider links may compete with merchant links, same dynamic as Google Place Actions.",
        status: "mapped",
      },
    ],
  },
  {
    title: "Ops & Access",
    rows: [
      {
        their: "verification (phone code / document review)",
        ours: "Onboarding pipeline",
        rules:
          "Phone code is fastest; document review (lease, insurance, utility bill) up to 5 business days; 10-day window to verify after signup.",
        status: "pipeline",
      },
      {
        their: "Location API (bulk, at scale)",
        ours: "Listings runtime — PARTNER-GATED",
        rules:
          "Delivered through listing-management-agency partners (Yext, Uberall, Reputation, SOCi, Rio SEO); Partner ID required. NOTE: the self-serve 'Apple Business API' in Apple's developer docs is DEVICE management — not locations. Partner track is a BD conversation, same class as DA/FSQ agreements.",
        status: "pipeline",
      },
      {
        their: "Apple Maps Ads (summer 2026)",
        ours: "Campaign surface (future)",
        rules:
          "US + Canada at launch; requires a claimed location — claiming is the prerequisite we control.",
        status: "na",
      },
    ],
  },
];
export const APPLE_PUBLISHES_TO =
  "Apple Maps · Siri · Spotlight · Safari · Wallet — the default iPhone discovery surface";
export const APPLE_OPS_NOTES = [
  "Two write paths: self-serve dashboard (available today, per-location) and Location API at scale (partner agreement — joins the DA/FSQ agreement track).",
  "Apple ALSO ingests Foursquare data — our FSQ rail reaches Apple Maps passively; a claimed Apple Business listing is the authoritative override.",
  "Showcase mechanics (3-day approval, 30-day expiry) are scheduler constraints for the offers pipeline.",
];

export const BING_SECTIONS: Section[] = [
  {
    title: "Identity & Category",
    note: "Bing Places overhauled Oct 2025 → bing.com/forbusiness (unified Microsoft account with Ads + Webmaster Tools).",
    rows: [
      {
        their: "business name",
        ours: "Registry: DBA Name [identity]",
        rules:
          "Must match physical signage — keyword additions create data conflicts and duplicate listings.",
        status: "mapped",
      },
      {
        their: "categories (primary + secondaries)",
        ours: "gcid → Bing category (verify at integration)",
        rules:
          "Bing's own list, NOT identical to Google's; categories are the field that most often fails to transfer in Google sync — post-sync drift-audit required.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Listing Content",
    rows: [
      {
        their: "address / phone / precise map pin",
        ours: "Profile: address + Registry: Phone [presence]",
        rules: "Service-area businesses must still provide an address (can be hidden).",
        status: "mapped",
        family: "phone",
      },
      {
        their: "hours (+ holiday hours)",
        ours: "Registry: Operating Hours [services]",
        rules: "Holiday hours supported.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "description",
        ours: "Registry: Description [identity]",
        rules: "Plain language; no keyword stuffing — same rules as Google.",
        status: "mapped",
        family: "description",
      },
      {
        their: "photos (8–10 recommended)",
        ours: "Registry: Photo Gallery [content]",
        rules: "Displayed prominently.",
        status: "mapped",
        family: "images",
      },
      {
        their: "social links",
        ours: "Registry: social profiles [presence]",
        rules: "—",
        status: "mapped",
        family: "social",
      },
    ],
  },
  {
    title: "Deals & Ads Extensions",
    rows: [
      {
        their: "Bing Deals",
        ours: "content_items kind: offer → publications channel",
        rules:
          "Semi-permanent (up to 90 days) with green map-pin tag — outlasts ephemeral GBP posts; distinct offer surface.",
        status: "mapped",
      },
      {
        their: "Microsoft Ads location extensions",
        ours: "Campaign surface",
        rules: "Claimed listing unlocks address/phone on paid ads + map ad placements.",
        status: "na",
      },
    ],
  },
  {
    title: "Sync Rails & Access",
    rows: [
      {
        their: "Import from Google Business Profile + periodic auto-sync",
        ours: "OUR GOOGLE PUBLISHING → cascades to Bing",
        rules:
          "One-way Google→Bing, weekly/biweekly/monthly intervals; changes propagate 24–48h. Verified GBP usually verifies Bing INSTANTLY. Sync can overwrite Bing-specific edits — choose master-source policy per field.",
        status: "pipeline",
      },
      {
        their: "bulk upload (Excel templates)",
        ours: "Listings runtime — multi-location",
        rules: "Template-driven bulk for dozens–hundreds of locations.",
        status: "pipeline",
      },
      {
        their: "API access",
        ours: "Listings runtime — partner/agency track",
        rules:
          "Enterprise API integrations exist via partners (agency support expanding per Microsoft); no public self-serve listings API today.",
        status: "pipeline",
      },
      {
        their: "verification (GBP-trust / Domain Connect / phone / email / postcard)",
        ours: "Onboarding pipeline",
        rules:
          "Instant via verified GBP import or Webmaster Tools Domain Connect; postcard 7–14 days as last resort.",
        status: "pipeline",
      },
    ],
  },
];
export const BING_PUBLISHES_TO =
  "Bing Search + Maps · Copilot · ChatGPT web search · Yahoo · AOL · DuckDuckGo · Windows/Edge · voice (Cortana, Alexa)";
export const BING_OPS_NOTES = [
  "The second AI-citation pipe: Bing's index feeds Microsoft Copilot and ChatGPT's local answers — a claimed, complete listing is how AI assistants describe the business correctly.",
  "Strategic rail: Google→Bing auto-sync means our Google publishing propagates here nearly free; the runtime's job is post-sync auditing (especially categories) rather than duplicate submission.",
  "One-way sync only (Google→Bing); Bing-specific fields (Deals) are managed directly.",
];

export const TOMTOM_SECTIONS: Section[] = [
  {
    title: "Identity & Category",
    note: "Global POI database (~100 categories / 600+ subcategories) powering in-car navigation, Azure/Bing Maps, and apps built on TomTom APIs.",
    rows: [
      {
        their: "business name",
        ours: "Registry: DBA Name [identity]",
        rules: "POIs displayed neutrally — no paid boosting; fake-POI validation on ingest.",
        status: "mapped",
      },
      {
        their: "category (their taxonomy)",
        ours: "gcid → TomTom category (via rails / verify at integration)",
        rules: "Their own 100/600 taxonomy; aggregator rails handle the mapping — no public dump.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Listing Content",
    note: "Direct schema is thin; RICH data (ratings, photos, price range) arrives via the Foursquare partnership.",
    rows: [
      {
        their: "address / map pin / phone",
        ours: "Profile: address + Registry: Phone [presence]",
        rules: "Core POI record.",
        status: "mapped",
        family: "phone",
      },
      {
        their: "website / email",
        ours: "Registry: Website URL [presence]",
        rules: "—",
        status: "mapped",
        family: "website",
      },
      {
        their: "description / keywords",
        ours: "Registry: Description [identity] + taxonomy keywords",
        rules:
          "Via syndication rails (Yext-class publishers carry description + payment methods + holiday hours to TomTom).",
        status: "mapped",
        family: "description",
      },
      {
        their: "hours",
        ours: "Registry: Operating Hours [services]",
        rules:
          "MapShare direct-add puts hours in a comments box (!); structured hours flow via rails.",
        status: "mapped",
        family: "hours",
      },
      {
        their: "payment methods",
        ours: "Registry: Payment Methods Accepted [services]",
        rules: "Carried via syndication rails.",
        status: "mapped",
        family: "payment",
      },
      {
        their: "ratings / reviews / photos / price range",
        ours: "Foursquare rail (fsq_place_id)",
        rules:
          "TomTom ingests rich POI content from Foursquare — our FSQ publishing IS the rich-content path here.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Write Paths & Sync Rails",
    rows: [
      {
        their: "MapShare Reporter (community edits)",
        ours: "Corrections pipeline",
        rules:
          "Free, moderated by TomTom review team; add-POI form is thin (name, category, address, URL, comments); propagation to devices/apps is SLOW (map release cycles).",
        status: "pipeline",
      },
      {
        their: "partner POI suppliers (Foursquare + listings aggregators)",
        ours: "OUR DA + FSQ RAILS — already publishing here",
        rules:
          "TomTom's database is partner-fed; the aggregator strategy reaches TomTom without a direct integration.",
        status: "pipeline",
      },
      {
        their: "listings API",
        ours: "— none public",
        rules: "No self-serve listings write API; agency/aggregator syndication is the scale path.",
        status: "na",
      },
    ],
  },
];
export const TOMTOM_PUBLISHES_TO =
  "In-car navigation (OEM embeds) · TomTom GO/AmiGO apps · Azure Maps + Bing Maps (Microsoft partnership) · Yellow Pages Canada · apps built on TomTom APIs · ~800M users claimed";
export const TOMTOM_OPS_NOTES = [
  "Rail-fed publisher: this card documents a DESTINATION our DA + FSQ rails already reach, not a new integration to build.",
  "MapShare edits are review-team moderated with slow device propagation — corrections channel, not a publishing channel.",
  "Runtime job here is verification: confirm the profile appears correctly via TomTom Search API (self-serve developer key, read-only) and file MapShare corrections on drift.",
];

export const YELP_SECTIONS: Section[] = [
  {
    title: "Identity & Listing",
    note: "Phase-2 trust anchor. No public listings write API — claim + dashboard self-serve; scale write access via Yelp Knowledge / data-licensing partnership.",
    rows: [
      {
        their: "name / address / phone / categories",
        ours: "Registry: DBA + Profile NAP; gcid → Yelp category (verify at integration)",
        rules: "Claim at biz.yelp.com; Yelp's own category taxonomy (public JSON list exists).",
        status: "pipeline",
      },
      {
        their: "hours / website / attributes (amenities)",
        ours: "Registry: Operating Hours + Website + operational nodes",
        rules: "Dashboard-managed post-claim.",
        status: "pipeline",
      },
      {
        their: "photos / menu link",
        ours: "Registry: Photo Gallery + Menu URL",
        rules: "Dashboard-managed.",
        status: "pipeline",
      },
    ],
  },
  {
    title: "Reviews & Trust",
    rows: [
      {
        their: "reviews (read via Fusion API)",
        ours: "Reputation ingestion (read-only: rating, count, 3 review excerpts per business)",
        rules: "Fusion API is self-serve read — verification + reputation signals, never write.",
        status: "mapped",
      },
      {
        their: "review solicitation",
        ours: "COMPLIANCE RULE for our review campaigns",
        rules:
          "Yelp PROHIBITS asking customers for reviews — review-campaign engine must exclude Yelp from solicitation flows or risk penalty. Encoded as a platform compliance rule.",
        status: "pipeline",
      },
      {
        their: "review responses",
        ours: "Review Management reply pipe",
        rules: "Dashboard post-claim; API reply via partner track.",
        status: "pipeline",
      },
    ],
  },
];
export const YELP_PUBLISHES_TO =
  "Yelp Search + app · Apple Maps (reviews/photos historically) · Amazon Alexa local answers · voice assistants";
export const YELP_OPS_NOTES = [
  "Write access at scale is a partnership (Yelp Knowledge / licensing) — joins the DA/FSQ/Apple agreement track.",
  "Fusion API (self-serve key) is the verification rail: confirm listing state, ingest rating/count as reputation signals.",
  "The review-solicitation prohibition is a hard compliance boundary for the campaigns product.",
];

export const HERE_SECTIONS: Section[] = [
  {
    title: "Identity & Listing",
    note: "Rail-fed sibling of TomTom: global map platform owned by the German auto consortium; database is partner- and community-fed.",
    rows: [
      {
        their: "core POI record (name, address, phone, category, hours)",
        ours: "OUR AGGREGATOR RAILS (Localeze network explicitly includes HERE-class nav; Yext-parity publishers syndicate here)",
        rules:
          "No public self-serve listings write API; POI data arrives via licensed suppliers and aggregators.",
        status: "pipeline",
      },
      {
        their: "Map Creator (community edits)",
        ours: "Corrections pipeline",
        rules:
          "HERE's MapShare-equivalent: moderated community editing for POI fixes; slow propagation via map releases.",
        status: "pipeline",
      },
    ],
  },
];
export const HERE_PUBLISHES_TO =
  "Amazon Alexa · embedded auto navigation (BMW, Mercedes, Audi consortium + many OEMs) · Garmin · enterprise/logistics platforms built on HERE APIs";
export const HERE_OPS_NOTES = [
  "Rail-fed destination: reached through the aggregator layer, not direct integration; runtime job = verify via HERE Geocoding & Search API (self-serve read key) + Map Creator corrections on drift.",
  "Strategic weight: HERE feeds Alexa and most European in-car navigation — the voice + automotive surface.",
];

export const LOCALEZE_SECTIONS: Section[] = [
  {
    title: "Aggregation Network",
    note: "TransUnion Digital Business Profile (Neustar Localeze) — the third classic aggregator alongside Data Axle and Foursquare.",
    rows: [
      {
        their: "business profile (NAP, hours, attributes, description)",
        ours: "Registry: identity/presence/services nodes — same base map as Data Axle",
        rules:
          "Self-serve SMB (<$10/mo, unlimited updates); enterprise bulk add/edit/release/close via contract with dedicated account manager.",
        status: "pipeline",
      },
      {
        their: "completeness + confidence scoring",
        ours: "Mirrors our completeness lane",
        rules:
          "They score minimum recommended attributes for partner confidence — their score validates our completeness doctrine.",
        status: "pipeline",
      },
      {
        their: "ongoing re-verification",
        ours: "Recency pipeline (like DA monthly resubmission)",
        rules: "Stagnant data loses partner confidence — recency is a first-class signal here too.",
        status: "pipeline",
      },
      {
        their: "GBP direct sync",
        ours: "Google rail interaction — dedupe with our direct GBP publishing",
        rules:
          "Their Google sync must not fight our direct GBP writes; master-source policy required per field.",
        status: "pipeline",
      },
    ],
  },
];
export const LOCALEZE_PUBLISHES_TO =
  "80–90+ authorized platforms: Google · Apple Maps · Bing · Yahoo · TomTom · YP.com · navigation systems · voice assistants (Alexa rail) · mobile apps";
export const LOCALEZE_OPS_NOTES = [
  "Contract-gated at scale (enterprise bulk) — joins the agreement track; SMB self-serve exists for early testing.",
  "Overlap management is the real work: DA + FSQ + Localeze + our direct writes all touch Google/Apple/Bing/TomTom — the runtime needs a source-priority matrix so rails reinforce rather than fight.",
];

export const STUB_PUBLISHERS: string[] = [];

export const NEXTDOOR_SECTIONS: Section[] = [
  {
    title: "Business Page & Trust",
    note: "Neighborhood trust surface (Scott ruling #5: dedicated integration).",
    rows: [
      {
        their: "business page (NAP, hours, website, description, photos)",
        ours: "Registry: identity/presence/services nodes",
        rules:
          "Free claim at business.nextdoor.com; self-serve dashboard. POI baseline arrives via the Foursquare rail.",
        status: "pipeline",
      },
      {
        their: "recommendations (neighbor endorsements)",
        ours: "Reputation ingestion (read)",
        rules:
          "Nextdoor's trust currency — ingest as reputation signals; no solicitation mechanics to violate.",
        status: "pipeline",
      },
      {
        their: "posts / Local Deals",
        ours: "content_publications channel + offer kind",
        rules: "Neighborhood-targeted posting and deals from the business page.",
        status: "pipeline",
      },
      {
        their: "API",
        ours: "Listings runtime — verify at integration",
        rules:
          "Public APIs are ads-focused; page management is dashboard-first; scale path via partner/aggregator syndication.",
        status: "pipeline",
      },
    ],
  },
];
export const NEXTDOOR_PUBLISHES_TO =
  "Nextdoor neighborhoods · local recommendation threads · the highest-trust local surface per household";
export const NEXTDOOR_OPS_NOTES = [
  "Claim is self-serve and free; FSQ rail supplies the POI baseline — claiming converts it to an owned trust surface.",
  "Recommendations are organic-only: reputation here is earned, which is exactly why it signals.",
];

export type PublisherId =
  | "data_axle"
  | "google"
  | "foursquare"
  | "meta"
  | "linkedin"
  | "apple"
  | "bing"
  | "tomtom"
  | "yelp"
  | "here"
  | "localeze"
  | "nextdoor";

export interface PublisherCatalog {
  id: string;
  name: string;
  subtitle: string;
  kind: string;
  sections: Section[];
  publishesTo: string;
  opsNotes: string[];
  defaultOpen?: boolean;
}

/** @deprecated Display order and card copy exactly as listings-tab.tsx rendered them pre-DB. */
export const PUBLISHER_CATALOGS: PublisherCatalog[] = [
  {
    id: "data_axle",
    name: "Data Axle",
    subtitle: "Local Listings Premium · aggregator · API v1",
    kind: "aggregator",
    sections: DATA_AXLE_SECTIONS,
    publishesTo: DA_PUBLISHES_TO,
    opsNotes: DA_OPS_NOTES,
    defaultOpen: true,
  },
  {
    id: "google",
    name: "Google Business Profile",
    subtitle: "direct · Business Info v1 + v4 + Food Menus + Lodging + Place Actions",
    kind: "direct",
    sections: GOOGLE_SECTIONS,
    publishesTo: GOOGLE_PUBLISHES_TO,
    opsNotes: GOOGLE_OPS_NOTES,
    defaultOpen: true,
  },
  {
    id: "foursquare",
    name: "Foursquare",
    subtitle: "FSQ OS Places · aggregator · Places + Feedback APIs",
    kind: "aggregator",
    sections: FOURSQUARE_SECTIONS,
    publishesTo: FSQ_PUBLISHES_TO,
    opsNotes: FSQ_OPS_NOTES,
  },
  {
    id: "meta",
    name: "Facebook / Instagram (Meta)",
    subtitle: "identity + content channel · Graph API v25",
    kind: "channel",
    sections: META_SECTIONS,
    publishesTo: META_PUBLISHES_TO,
    opsNotes: META_OPS_NOTES,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    subtitle: "professional content channel · Community Management API",
    kind: "channel",
    sections: LINKEDIN_SECTIONS,
    publishesTo: LINKEDIN_PUBLISHES_TO,
    opsNotes: LINKEDIN_OPS_NOTES,
  },
  {
    id: "apple",
    name: "Apple Business",
    subtitle: "direct · place cards · dashboard now, Location API partner-gated",
    kind: "direct",
    sections: APPLE_SECTIONS,
    publishesTo: APPLE_PUBLISHES_TO,
    opsNotes: APPLE_OPS_NOTES,
  },
  {
    id: "bing",
    name: "Bing Places (Microsoft)",
    subtitle: "direct · bing.com/forbusiness · Google auto-sync rail",
    kind: "direct",
    sections: BING_SECTIONS,
    publishesTo: BING_PUBLISHES_TO,
    opsNotes: BING_OPS_NOTES,
  },
  {
    id: "tomtom",
    name: "TomTom",
    subtitle: "rail-fed · global POI database · reached via DA + FSQ",
    kind: "rail_fed",
    sections: TOMTOM_SECTIONS,
    publishesTo: TOMTOM_PUBLISHES_TO,
    opsNotes: TOMTOM_OPS_NOTES,
  },
  {
    id: "yelp",
    name: "Yelp",
    subtitle: "trust anchor · claim + dashboard · partner track for scale",
    kind: "trust_anchor",
    sections: YELP_SECTIONS,
    publishesTo: YELP_PUBLISHES_TO,
    opsNotes: YELP_OPS_NOTES,
  },
  {
    id: "here",
    name: "HERE",
    subtitle: "rail-fed · voice + automotive surface",
    kind: "rail_fed",
    sections: HERE_SECTIONS,
    publishesTo: HERE_PUBLISHES_TO,
    opsNotes: HERE_OPS_NOTES,
  },
  {
    id: "localeze",
    name: "Localeze (TransUnion)",
    subtitle: "aggregator · 80–90+ platform network · contract-gated at scale",
    kind: "aggregator",
    sections: LOCALEZE_SECTIONS,
    publishesTo: LOCALEZE_PUBLISHES_TO,
    opsNotes: LOCALEZE_OPS_NOTES,
  },
  {
    id: "nextdoor",
    name: "Nextdoor",
    subtitle: "neighborhood trust surface · claim self-serve · FSQ-seeded",
    kind: "channel",
    sections: NEXTDOOR_SECTIONS,
    publishesTo: NEXTDOOR_PUBLISHES_TO,
    opsNotes: NEXTDOOR_OPS_NOTES,
  },
];
