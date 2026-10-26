// ─────────────────────────────────────────────────────────────────────────────
// EXPERTISE SCHEMA — the category-driven contract behind every profile.
//
// SCALING PRINCIPLE: the expertise-graph FRAME is constant for all 4,041
// categories — the same 9 expertise elements, the same lane model
// (location always; professional when entity_type = both). Everything that
// VARIES per category is data in EXPERTISE_SCHEMAS: the schema.org @type per
// lane, the fields inside each element, the SEO patterns, the profile sections,
// and the emitted markup. A restaurant is a new entry here (location-only,
// "Restaurant" type, menu sections instead of listings) — the renderer in
// schema-tab.tsx never changes. Real estate is fully defined; the rest follow
// the same shape and can be AI-generated into this structure.
// ─────────────────────────────────────────────────────────────────────────────

import { RESTAURANT_SCHEMA } from "./expertise-schema.restaurant";

export const EXPERTISE_ELEMENTS = [
  "Core identity",
  "Credentials & authority",
  "Experience & track record",
  "Published content",
  "Media & voice",
  "Social presence & engagement",
  "Reviews & reputation",
  "Affiliations & upstream",
  "Web presence & entity graph",
] as const;

export type FieldDef = {
  label: string;
  prop: string;
  type: string;
  source: string;
  scored?: boolean;
};

export type ElementDef = {
  n: number;
  name: string;
  group: string; // schema.org grouping for this element
  fields: FieldDef[];
};

export type ProfileSection =
  | {
      kind: "header";
      name: string;
      subtitle: string;
      initials: string;
      square?: boolean;
      badges?: string[];
      rating?: string;
      ratingCount?: string;
      chips?: string[];
      lines?: string[];
      bio?: string;
      ctas?: string[];
    }
  | { kind: "infoCards"; cards: { title: string; lines?: string[]; chips?: string[] }[] }
  | { kind: "lines"; title: string; lines: string[] }
  | { kind: "stats"; title: string; stats: { value: string; label: string }[] }
  | { kind: "properties"; title: string; items: { price: string; meta: string; status: string }[] }
  | { kind: "services"; title: string; items: string[] }
  | { kind: "chips"; title: string; chips: string[] }
  | { kind: "score"; title: string; value: number; max: number }
  | { kind: "roster"; title: string; members: { initials: string; name: string; meta: string }[]; note?: string }
  | {
      kind: "reviews";
      title: string;
      sources: string[];
      reviews: { author: string; loc: string; rating: string; date: string; body: string; reply?: string }[];
    }
  | { kind: "posts"; title: string; posts: { platform: string; ago: string; text: string }[] }
  | { kind: "disclaimer"; text: string };

export type LaneDef = {
  key: "professional" | "location";
  label: string;
  schemaType: string;
  elements: ElementDef[];
  seo: [string, string][];
  jsonld: string;
  html: string;
  profile: ProfileSection[];
};

export type CategorySchema = {
  gcid: string;
  displayName: string;
  entityType: "both" | "location" | "professional";
  lanes: LaneDef[];
};

// ── Real estate agent — AGENT (professional) lane elements ───────────────────
const RE_AGENT_ELEMENTS: ElementDef[] = [
  { n: 1, name: "Core identity", group: "Person + RealEstateAgent", fields: [
    { label: "Given name", prop: "givenName", type: "Text", source: "Profile" },
    { label: "Family name", prop: "familyName", type: "Text", source: "Profile" },
    { label: "Full name", prop: "name", type: "Text", source: "Profile", scored: true },
    { label: "Preferred / nickname", prop: "alternateName", type: "Text", source: "Profile" },
    { label: "Job title", prop: "jobTitle", type: "Text", source: "Profile", scored: true },
    { label: "Headline", prop: "disambiguatingDescription", type: "Text", source: "Profile" },
    { label: "Bio (long)", prop: "description", type: "Text", source: "Profile", scored: true },
    { label: "Headshot", prop: "image", type: "URL", source: "Profile", scored: true },
    { label: "Languages", prop: "knowsLanguage", type: "Text[]", source: "Profile" },
    { label: "Phone", prop: "telephone", type: "Text", source: "Profile" },
    { label: "Email", prop: "email", type: "Text", source: "Profile" },
    { label: "Personal site", prop: "url", type: "URL", source: "Profile" },
    { label: "Canonical entity id", prop: "@id", type: "URI", source: "System", scored: true },
    { label: "Category", prop: "additionalType / gcid", type: "URI", source: "System", scored: true },
    { label: "Year started", prop: "foundingDate", type: "Date", source: "Profile" },
    { label: "Home market", prop: "homeLocation", type: "Place", source: "Profile" },
  ]},
  { n: 2, name: "Credentials & authority", group: "hasCredential → EducationalOccupationalCredential", fields: [
    { label: "License number", prop: "identifier", type: "Text", source: "State board", scored: true },
    { label: "License state", prop: "—", type: "Text", source: "State board", scored: true },
    { label: "License type", prop: "credentialCategory", type: "Text", source: "State board" },
    { label: "Issuing authority", prop: "recognizedBy", type: "Organization", source: "State board", scored: true },
    { label: "License status", prop: "—", type: "Text", source: "State board", scored: true },
    { label: "Valid from", prop: "validFrom", type: "Date", source: "State board" },
    { label: "Valid through", prop: "validThrough", type: "Date", source: "State board" },
    { label: "Verified", prop: "—", type: "Boolean", source: "System", scored: true },
    { label: "Verified at", prop: "—", type: "DateTime", source: "System" },
    { label: "Additional state licenses", prop: "hasCredential[]", type: "Credential[]", source: "State board" },
    { label: "Designations (ABR/CRS/GRI/SRS)", prop: "hasCredential[]", type: "Credential[]", source: "NAR", scored: true },
    { label: "Certifications", prop: "hasCredential[]", type: "Credential[]", source: "Issuer" },
    { label: "Education / alma mater", prop: "alumniOf", type: "Organization", source: "Profile" },
    { label: "Degree", prop: "hasCredential", type: "Credential", source: "Profile" },
    { label: "Awards", prop: "award", type: "Text[]", source: "Profile" },
    { label: "Years licensed", prop: "—", type: "Number", source: "State board" },
    { label: "CE compliance", prop: "—", type: "Boolean", source: "State board" },
  ]},
  { n: 3, name: "Experience & track record", group: "additionalProperty / makesOffer", fields: [
    { label: "Lifetime volume", prop: "additionalProperty", type: "MonetaryAmount", source: "MLS", scored: true },
    { label: "Homes sold (lifetime)", prop: "additionalProperty", type: "Number", source: "MLS", scored: true },
    { label: "Transactions (12 mo)", prop: "additionalProperty", type: "Number", source: "MLS", scored: true },
    { label: "Avg days on market", prop: "additionalProperty", type: "Number", source: "MLS" },
    { label: "List-to-sale ratio", prop: "additionalProperty", type: "Number %", source: "MLS" },
    { label: "Avg sale price", prop: "additionalProperty", type: "MonetaryAmount", source: "MLS" },
    { label: "Price range served", prop: "priceRange", type: "Text", source: "MLS" },
    { label: "Active listings (count)", prop: "makesOffer", type: "Number", source: "MLS", scored: true },
    { label: "Active listings", prop: "makesOffer[] → RealEstateListing", type: "Offer[]", source: "MLS" },
    { label: "Recent sales", prop: "additionalProperty[]", type: "Place[]", source: "MLS" },
    { label: "Buyer / seller split", prop: "additionalProperty", type: "Text", source: "MLS" },
    { label: "Property types", prop: "additionalProperty", type: "Text[]", source: "MLS" },
    { label: "Neighborhoods transacted", prop: "additionalProperty", type: "Text[]", source: "MLS" },
  ]},
  { n: 4, name: "Published content", group: "author / subjectOf → Article", fields: [
    { label: "Articles authored", prop: "subjectOf[] → Article", type: "Article[]", source: "VOCE", scored: true },
    { label: "Article headline", prop: "headline", type: "Text", source: "VOCE" },
    { label: "Article URL", prop: "url", type: "URL", source: "VOCE" },
    { label: "Published date", prop: "datePublished", type: "Date", source: "VOCE" },
    { label: "Publisher", prop: "publisher", type: "Organization", source: "VOCE" },
    { label: "Market reports", prop: "subjectOf[]", type: "Article[]", source: "VOCE" },
    { label: "Guides", prop: "subjectOf[]", type: "Article[]", source: "VOCE" },
    { label: "Total reads", prop: "interactionStatistic", type: "Number", source: "VOCE" },
    { label: "Article count", prop: "—", type: "Number", source: "VOCE", scored: true },
  ]},
  { n: 5, name: "Media & voice", group: "subjectOf → VideoObject / AudioObject", fields: [
    { label: "Videos / listing tours", prop: "subjectOf[] → VideoObject", type: "Video[]", source: "YouTube", scored: true },
    { label: "Video title", prop: "name", type: "Text", source: "YouTube" },
    { label: "Video URL", prop: "contentUrl", type: "URL", source: "YouTube" },
    { label: "Thumbnail", prop: "thumbnailUrl", type: "URL", source: "YouTube" },
    { label: "Upload date", prop: "uploadDate", type: "Date", source: "YouTube" },
    { label: "Duration", prop: "duration", type: "Duration", source: "YouTube" },
    { label: "Podcast appearances", prop: "subjectOf[] → AudioObject", type: "Audio[]", source: "Podcast" },
    { label: "Press mentions", prop: "subjectOf[] / citation", type: "Article[]", source: "Press", scored: true },
    { label: "Webinars / talks", prop: "subjectOf[] → Event", type: "Event[]", source: "Profile" },
    { label: "Media count", prop: "—", type: "Number", source: "System" },
  ]},
  { n: 6, name: "Social presence & engagement", group: "sameAs + interactionStatistic + SocialMediaPosting", fields: [
    { label: "Facebook", prop: "sameAs", type: "URL", source: "Social", scored: true },
    { label: "Instagram", prop: "sameAs", type: "URL", source: "Social" },
    { label: "LinkedIn", prop: "sameAs", type: "URL", source: "Social" },
    { label: "X (Twitter)", prop: "sameAs", type: "URL", source: "Social" },
    { label: "YouTube", prop: "sameAs", type: "URL", source: "Social" },
    { label: "TikTok", prop: "sameAs", type: "URL", source: "Social" },
    { label: "Follower counts", prop: "interactionStatistic", type: "Number", source: "Social" },
    { label: "Posts feed (last 10)", prop: "subjectOf[] → SocialMediaPosting", type: "Post[]", source: "Social", scored: true },
    { label: "Post text", prop: "articleBody", type: "Text", source: "Social" },
    { label: "Post date", prop: "datePublished", type: "Date", source: "Social" },
    { label: "Posting cadence", prop: "—", type: "Text", source: "System" },
  ]},
  { n: 7, name: "Reviews & reputation", group: "aggregateRating + review[]", fields: [
    { label: "Overall rating", prop: "aggregateRating.ratingValue", type: "Number", source: "All sources", scored: true },
    { label: "Review count", prop: "aggregateRating.reviewCount", type: "Number", source: "All sources", scored: true },
    { label: "Best rating", prop: "bestRating", type: "Number", source: "System" },
    { label: "Experience.com rating + count", prop: "aggregateRating", type: "Number", source: "Experience.com", scored: true },
    { label: "Zillow rating + count", prop: "aggregateRating", type: "Number", source: "Zillow" },
    { label: "Google rating + count", prop: "aggregateRating", type: "Number", source: "Google", scored: true },
    { label: "Facebook rating + count", prop: "aggregateRating", type: "Number", source: "Facebook" },
    { label: "Rating distribution", prop: "—", type: "Number[]", source: "All sources" },
    { label: "Reviews", prop: "review[] → Review", type: "Review[]", source: "All sources", scored: true },
    { label: "Review author", prop: "author", type: "Person", source: "All sources" },
    { label: "Review location", prop: "author.address", type: "Text", source: "All sources" },
    { label: "Review rating", prop: "reviewRating", type: "Number", source: "All sources" },
    { label: "Review date", prop: "datePublished", type: "Date", source: "All sources" },
    { label: "Review body", prop: "reviewBody", type: "Text", source: "All sources" },
    { label: "Verified flag", prop: "—", type: "Boolean", source: "System" },
    { label: "Reply / response", prop: "review.comment → Comment", type: "Comment[]", source: "Profile" },
    { label: "Response rate", prop: "—", type: "Number %", source: "System" },
    { label: "Avg response time", prop: "—", type: "Duration", source: "System" },
  ]},
  { n: 8, name: "Affiliations & upstream", group: "worksFor / memberOf", fields: [
    { label: "Works at office ↑", prop: "worksFor → @id", type: "URI", source: "Brokerage", scored: true },
    { label: "Brokerage", prop: "worksFor.parentOrganization", type: "Organization", source: "Brokerage", scored: true },
    { label: "Branch / office", prop: "worksFor", type: "Organization", source: "Brokerage" },
    { label: "Hierarchy path", prop: "—", type: "Text", source: "System" },
    { label: "Team", prop: "memberOf → Organization", type: "Organization", source: "Brokerage" },
    { label: "Team role", prop: "—", type: "Text", source: "Brokerage" },
    { label: "MLS membership", prop: "memberOf", type: "Organization", source: "MLS" },
    { label: "NAR membership", prop: "memberOf", type: "Organization", source: "NAR", scored: true },
    { label: "State association", prop: "memberOf", type: "Organization", source: "State" },
    { label: "Local board", prop: "memberOf", type: "Organization", source: "Local" },
    { label: "Franchise / brand", prop: "brand", type: "Brand", source: "Brokerage" },
  ]},
  { n: 9, name: "Web presence & entity graph", group: "sameAs[] + @id + identifier", fields: [
    { label: "Google Business Profile", prop: "sameAs", type: "URL", source: "GBP", scored: true },
    { label: "Zillow profile", prop: "sameAs", type: "URL", source: "Zillow" },
    { label: "Realtor.com", prop: "sameAs", type: "URL", source: "Realtor.com" },
    { label: "Homes.com", prop: "sameAs", type: "URL", source: "Homes.com" },
    { label: "Brokerage profile", prop: "sameAs", type: "URL", source: "Brokerage" },
    { label: "Wikidata entity", prop: "@id / sameAs", type: "URI", source: "Wikidata", scored: true },
    { label: "Knowledge panel linked", prop: "—", type: "Boolean", source: "Google" },
    { label: "Directory listings (count)", prop: "—", type: "Number", source: "System" },
    { label: "Canonical URL", prop: "url", type: "URL", source: "System", scored: true },
    { label: "NAP consistency", prop: "—", type: "Boolean", source: "System", scored: true },
  ]},
];

// ── Real estate — OFFICE (location) lane elements ────────────────────────────
const RE_OFFICE_ELEMENTS: ElementDef[] = [
  { n: 1, name: "Core identity (a place)", group: "RealEstateAgent + LocalBusiness", fields: [
    { label: "Office name", prop: "name", type: "Text", source: "Profile", scored: true },
    { label: "Legal name", prop: "legalName", type: "Text", source: "Profile" },
    { label: "Logo", prop: "logo / image", type: "URL", source: "Profile", scored: true },
    { label: "Description", prop: "description", type: "Text", source: "Profile" },
    { label: "Founding date", prop: "foundingDate", type: "Date", source: "Profile" },
    { label: "Phone", prop: "telephone", type: "Text", source: "GBP" },
    { label: "Email", prop: "email", type: "Text", source: "Profile" },
    { label: "Website", prop: "url", type: "URL", source: "Profile" },
    { label: "Canonical entity id", prop: "@id", type: "URI", source: "System", scored: true },
    { label: "Category", prop: "additionalType / gcid", type: "URI", source: "System", scored: true },
    { label: "Street address", prop: "address.streetAddress", type: "Text", source: "GBP", scored: true },
    { label: "City / region / postal", prop: "address", type: "PostalAddress", source: "GBP", scored: true },
    { label: "Geo coordinates", prop: "geo", type: "GeoCoordinates", source: "GBP", scored: true },
    { label: "Business hours", prop: "openingHoursSpecification", type: "Hours[]", source: "GBP", scored: true },
    { label: "Time zone", prop: "—", type: "Text", source: "GBP" },
    { label: "Amenities (wheelchair, parking)", prop: "amenityFeature", type: "Feature[]", source: "GBP" },
    { label: "Price range", prop: "priceRange", type: "Text", source: "GBP" },
    { label: "Payment accepted", prop: "paymentAccepted", type: "Text[]", source: "GBP" },
    { label: "Map", prop: "hasMap", type: "URL", source: "GBP" },
  ]},
  { n: 2, name: "Credentials & authority", group: "hasCredential → EducationalOccupationalCredential", fields: [
    { label: "Brokerage license", prop: "hasCredential", type: "Credential", source: "DRE / state", scored: true },
    { label: "License / DRE number", prop: "identifier", type: "Text", source: "DRE / state", scored: true },
    { label: "License state(s)", prop: "—", type: "Text[]", source: "DRE / state" },
    { label: "Verified", prop: "—", type: "Boolean", source: "System", scored: true },
    { label: "Designated broker", prop: "employee → Person", type: "Person", source: "Brokerage" },
  ]},
  { n: 3, name: "Experience & track record", group: "additionalProperty / numberOfEmployees", fields: [
    { label: "Office lifetime volume", prop: "additionalProperty", type: "MonetaryAmount", source: "MLS", scored: true },
    { label: "Office homes sold", prop: "additionalProperty", type: "Number", source: "MLS", scored: true },
    { label: "Agents (count)", prop: "numberOfEmployees", type: "Number", source: "System", scored: true },
    { label: "Transactions (12 mo)", prop: "additionalProperty", type: "Number", source: "MLS" },
    { label: "Avg days on market", prop: "additionalProperty", type: "Number", source: "MLS" },
    { label: "Combined active listings", prop: "makesOffer", type: "Number", source: "MLS" },
  ]},
  { n: 4, name: "Published content", group: "author / subjectOf → Article", fields: [
    { label: "Office articles", prop: "subjectOf[] → Article", type: "Article[]", source: "VOCE", scored: true },
    { label: "Market reports", prop: "subjectOf[]", type: "Article[]", source: "VOCE" },
    { label: "Article count", prop: "—", type: "Number", source: "VOCE" },
  ]},
  { n: 5, name: "Media & voice", group: "subjectOf → VideoObject", fields: [
    { label: "Office videos", prop: "subjectOf[] → VideoObject", type: "Video[]", source: "YouTube" },
    { label: "Press mentions", prop: "subjectOf[] / citation", type: "Article[]", source: "Press" },
  ]},
  { n: 6, name: "Social presence & engagement", group: "sameAs + SocialMediaPosting", fields: [
    { label: "Office Facebook", prop: "sameAs", type: "URL", source: "Social" },
    { label: "Office Instagram", prop: "sameAs", type: "URL", source: "Social" },
    { label: "Office LinkedIn", prop: "sameAs", type: "URL", source: "Social" },
    { label: "Posts feed", prop: "subjectOf[] → SocialMediaPosting", type: "Post[]", source: "Social" },
  ]},
  { n: 7, name: "Reviews & reputation", group: "aggregateRating + review[]", fields: [
    { label: "Office overall rating", prop: "aggregateRating.ratingValue", type: "Number", source: "All sources", scored: true },
    { label: "Office review count", prop: "aggregateRating.reviewCount", type: "Number", source: "All sources", scored: true },
    { label: "Per-source ratings", prop: "aggregateRating", type: "Number", source: "4 sources", scored: true },
    { label: "Reviews", prop: "review[] → Review", type: "Review[]", source: "All sources", scored: true },
    { label: "Replies", prop: "review.comment → Comment", type: "Comment[]", source: "Profile" },
  ]},
  { n: 8, name: "Affiliations & upstream", group: "parentOrganization / employee[]", fields: [
    { label: "Parent brokerage ↑", prop: "parentOrganization", type: "Organization", source: "Brokerage", scored: true },
    { label: "Agents (roster) ↓", prop: "employee[] → Person", type: "Person[]", source: "System", scored: true },
    { label: "Members", prop: "member[] → Person", type: "Person[]", source: "System" },
    { label: "Franchise / brand", prop: "brand", type: "Brand", source: "Brokerage" },
    { label: "MLS / board memberships", prop: "memberOf", type: "Organization[]", source: "MLS / board" },
    { label: "Service / serving areas", prop: "areaServed", type: "Place[]", source: "GBP", scored: true },
  ]},
  { n: 9, name: "Web presence & entity graph", group: "sameAs[] + @id + identifier", fields: [
    { label: "Google Business Profile", prop: "sameAs", type: "URL", source: "GBP", scored: true },
    { label: "Zillow office page", prop: "sameAs", type: "URL", source: "Zillow" },
    { label: "Brokerage site", prop: "sameAs", type: "URL", source: "Brokerage" },
    { label: "Wikidata entity", prop: "@id / sameAs", type: "URI", source: "Wikidata" },
    { label: "Canonical URL", prop: "url", type: "URL", source: "System", scored: true },
    { label: "NAP consistency", prop: "—", type: "Boolean", source: "System", scored: true },
  ]},
];

const RE_AGENT_SEO: [string, string][] = [
  ["Title tag", "{name} — {jobTitle} in {city}, {state} | {brokerage}"],
  ["Meta description", "{name}, {jobTitle} in {city}. {rating}★ from {reviewCount} reviews. {topSpecialties}."],
  ["Canonical URL", "/real-estate-agent/{state}/{city}/{slug}"],
  ["Robots", "index, follow, max-image-preview:large"],
  ["H1", "{name}"],
  ["H2 structure", "About · Track record · Listings · Reviews · Articles · Contact"],
  ["og:type", "profile"],
  ["og:title", "{name} — {jobTitle} in {city}"],
  ["og:description", "{rating}★ · {reviewCount} reviews · {brokerage}"],
  ["og:image", "{headshot} (1200×630 card)"],
  ["twitter:card", "summary_large_image"],
  ["Breadcrumb", "Home › Real estate agents › {state} › {city} › {name}"],
  ["Breadcrumb schema", "BreadcrumbList → ListItem[]"],
  ["Image alt pattern", "{name}, {jobTitle} in {city}, {state}"],
  ["Internal links", "→ office · → brokerage · → each article · → nearby agents"],
  ["hreflang", "en-US"],
  ["Sitemap priority", "0.7 · changefreq weekly"],
  ["JSON-LD types emitted", "Person, RealEstateAgent, AggregateRating, Review, Article, VideoObject, BreadcrumbList"],
  ["Core Web Vitals targets", "LCP < 2.5s · CLS < 0.1 · INP < 200ms"],
];

const RE_OFFICE_SEO: [string, string][] = [
  ["Title tag", "{officeName} — Real estate office in {city}, {state} | {brokerage}"],
  ["Meta description", "{officeName} in {city}. {agentCount} agents, {rating}★ from {reviewCount} reviews. {hours}."],
  ["Canonical URL", "/real-estate-office/{state}/{city}/{slug}"],
  ["Robots", "index, follow, max-image-preview:large"],
  ["H1", "{officeName}"],
  ["H2 structure", "About · Our agents · Listings · Reviews · Hours · Contact"],
  ["og:type", "business.business"],
  ["og:title", "{officeName} — Real estate office in {city}"],
  ["og:image", "{logo} (1200×630 card)"],
  ["twitter:card", "summary_large_image"],
  ["Breadcrumb", "Home › Real estate offices › {state} › {city} › {officeName}"],
  ["Breadcrumb schema", "BreadcrumbList → ListItem[]"],
  ["Image alt pattern", "{officeName} office in {city}, {state}"],
  ["Internal links", "→ parent brokerage · → each agent · → listings"],
  ["hreflang", "en-US"],
  ["Sitemap priority", "0.8 · changefreq weekly"],
  ["JSON-LD types emitted", "RealEstateAgent, LocalBusiness, PostalAddress, GeoCoordinates, OpeningHoursSpecification, AggregateRating, BreadcrumbList"],
  ["Core Web Vitals targets", "LCP < 2.5s · CLS < 0.1 · INP < 200ms"],
];

const RE_AGENT_JSONLD = `{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Person", "RealEstateAgent"],
      "@id": "https://experience.com/a/sarah-mitchell#person",
      "name": "Sarah Mitchell",
      "jobTitle": "Real estate agent",
      "description": "12+ years helping Austin buyers and sellers...",
      "image": "https://.../sarah-mitchell.jpg",
      "telephone": "+1-512-555-0188",
      "knowsLanguage": ["en", "es"],
      "hasCredential": [
        { "@type": "EducationalOccupationalCredential",
          "credentialCategory": "license",
          "recognizedBy": { "@type": "Organization", "name": "TREC" },
          "identifier": "0654321" },
        { "@type": "EducationalOccupationalCredential",
          "credentialCategory": "designation", "name": "CRS" }
      ],
      "worksFor": { "@id": "https://experience.com/o/lakeline-downtown#office" },
      "memberOf": { "@type": "Organization", "name": "National Association of Realtors" },
      "areaServed": [ { "@type": "City", "name": "Austin" } ],
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.9, "reviewCount": 212, "bestRating": 5 },
      "subjectOf": [
        { "@type": "Article", "headline": "Austin Q2 market report", "publisher": { "@type": "Organization", "name": "VOCE" } },
        { "@type": "VideoObject", "name": "Travis Heights listing tour" }
      ],
      "sameAs": [ "https://g.page/...", "https://zillow.com/profile/...", "https://wikidata.org/wiki/Q..." ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Real estate agents" },
        { "@type": "ListItem", "position": 2, "name": "Austin, TX" },
        { "@type": "ListItem", "position": 3, "name": "Sarah Mitchell" }
      ]
    }
  ]
}`;

const RE_AGENT_HTML = `<main itemscope itemtype="https://schema.org/RealEstateAgent">
  <h1 itemprop="name">Sarah Mitchell</h1>
  <span itemprop="jobTitle">Real estate agent</span>
  <img itemprop="image" src="/sarah-mitchell.jpg" alt="Sarah Mitchell, real estate agent in Austin, TX">

  <div itemprop="hasCredential" itemscope itemtype="https://schema.org/EducationalOccupationalCredential">
    <meta itemprop="credentialCategory" content="license">
    <span itemprop="identifier">TX #0654321</span> · TREC
  </div>

  <a itemprop="worksFor" href="/o/lakeline-downtown">Lakeline Realty Group — Downtown</a>

  <div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
    <span itemprop="ratingValue">4.9</span> / <span itemprop="bestRating">5</span>
    (<span itemprop="reviewCount">212</span> reviews)
  </div>

  <link itemprop="sameAs" href="https://g.page/...">
  <link itemprop="sameAs" href="https://wikidata.org/wiki/Q...">
</main>`;

const RE_OFFICE_JSONLD = `{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["RealEstateAgent", "LocalBusiness"],
      "@id": "https://experience.com/o/lakeline-downtown#office",
      "name": "Lakeline Realty Group — Downtown Austin",
      "image": "https://.../lakeline-logo.png",
      "telephone": "+1-512-555-0100",
      "priceRange": "$$",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "500 W 2nd St",
        "addressLocality": "Austin", "addressRegion": "TX",
        "postalCode": "78701", "addressCountry": "US"
      },
      "geo": { "@type": "GeoCoordinates", "latitude": 30.26, "longitude": -97.75 },
      "openingHoursSpecification": [
        { "@type": "OpeningHoursSpecification",
          "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
          "opens": "09:00", "closes": "18:00" }
      ],
      "amenityFeature": [
        { "@type": "LocationFeatureSpecification", "name": "Wheelchair accessible", "value": true },
        { "@type": "LocationFeatureSpecification", "name": "Parking", "value": true }
      ],
      "parentOrganization": { "@type": "Organization", "name": "Lakeline Realty Group" },
      "numberOfEmployees": 24,
      "employee": [
        { "@id": "https://experience.com/a/sarah-mitchell#person" },
        { "@id": "https://experience.com/a/marcus-lee#person" }
      ],
      "areaServed": [ { "@type": "City", "name": "Austin" } ],
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": 4.8, "reviewCount": 640 },
      "sameAs": [ "https://g.page/...", "https://wikidata.org/wiki/Q..." ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Real estate offices" },
        { "@type": "ListItem", "position": 2, "name": "Austin, TX" },
        { "@type": "ListItem", "position": 3, "name": "Lakeline Realty Group — Downtown" }
      ]
    }
  ]
}`;

const RE_OFFICE_HTML = `<main itemscope itemtype="https://schema.org/RealEstateAgent">
  <h1 itemprop="name">Lakeline Realty Group — Downtown</h1>
  <img itemprop="logo" src="/lakeline-logo.png" alt="Lakeline Realty Group office in Austin, TX">

  <address itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
    <span itemprop="streetAddress">500 W 2nd St</span>,
    <span itemprop="addressLocality">Austin</span>,
    <span itemprop="addressRegion">TX</span> <span itemprop="postalCode">78701</span>
  </address>

  <div itemprop="openingHoursSpecification" itemscope itemtype="https://schema.org/OpeningHoursSpecification">
    <time itemprop="opens">09:00</time>–<time itemprop="closes">18:00</time>
  </div>

  <ul>
    <li itemprop="employee" itemscope itemtype="https://schema.org/Person">
      <a href="/a/sarah-mitchell"><span itemprop="name">Sarah Mitchell</span></a></li>
    <li itemprop="employee" itemscope itemtype="https://schema.org/Person">
      <a href="/a/marcus-lee"><span itemprop="name">Marcus Lee</span></a></li>
  </ul>

  <link itemprop="parentOrganization" href="/brokerage/lakeline">
</main>`;

const RE_AGENT_PROFILE: ProfileSection[] = [
  { kind: "header", name: "Sarah Mitchell", subtitle: "Real estate agent · TX license #0654321",
    initials: "SM", badges: ["PRO", "Verified"], rating: "4.9", ratingCount: "212",
    chips: ["Downtown Austin office"],
    bio: "12+ years helping Austin buyers and sellers. Data-driven pricing, 12-day average time-to-offer across Downtown, Travis Heights, and South Congress.",
    ctas: ["Contact Sarah", "Refer Sarah", "Get a home valuation"] },
  { kind: "infoCards", cards: [
    { title: "Contact", lines: ["(512) 555-0188", "Austin, TX", "sarahmitchell.realty"], chips: ["FB", "IG", "LI", "X", "YT", "TikTok"] },
    { title: "Location & hours", lines: ["500 W 2nd St, Austin, TX 78701", "Mon–Fri 9:00–18:00 · Sat 10:00–16:00 · CST"], chips: ["Accessible", "Parking"] },
  ]},
  { kind: "lines", title: "About", lines: [
    "With 12+ years in Austin real estate, I help first-time buyers and move-up sellers across central and south Austin.",
    "Year started 2013 · 12 years · English, Spanish",
  ]},
  { kind: "stats", title: "Track record", stats: [
    { value: "$128M", label: "Lifetime volume" }, { value: "340", label: "Homes sold" },
    { value: "12", label: "Avg days on market" }, { value: "99.2%", label: "List-to-sale" },
  ]},
  { kind: "properties", title: "Active listings · 18", items: [
    { price: "$745,000", meta: "1208 Kinney Ave · 3bd 2ba 1,840 sqft", status: "Active" },
    { price: "$1,240,000", meta: "4412 Oak Knoll · 4bd 3ba 2,910 sqft", status: "Active" },
    { price: "$525,000", meta: "2207 Bluff Springs · 3bd 2ba 1,520 sqft", status: "Pending" },
  ]},
  { kind: "services", title: "Products & services", items: [
    "Buyer representation", "Listing / seller representation", "Comparative market analysis",
    "Home valuation", "Staging consultation",
  ]},
  { kind: "chips", title: "Specialties", chips: ["First-time buyers", "Luxury", "Relocation", "Investment", "New construction", "Condos"] },
  { kind: "chips", title: "Credentials & licenses", chips: ["TX #0654321 ✓ TREC", "ABR", "CRS", "GRI", "SRS", "BBA, UT Austin", "Austin Board of Realtors · NAR"] },
  { kind: "score", title: "Search rank score", value: 782, max: 850 },
  { kind: "lines", title: "Works at", lines: ["Lakeline Realty Group", "↳ Downtown Austin office", "↳ Sarah Mitchell"] },
  { kind: "chips", title: "Serving areas", chips: ["Downtown", "Travis Heights", "South Congress", "78701", "78704", "78745"] },
  { kind: "lines", title: "Published articles", lines: [
    "Austin Q2 market report: inventory turns a corner — VOCE",
    "A first-time buyer's guide to Travis County — VOCE",
    "How to read a comparative market analysis — VOCE",
  ]},
  { kind: "chips", title: "Media & press", chips: ["2 listing tours", "Austin Real Estate Podcast", "Quoted · Austin Monthly"] },
  { kind: "chips", title: "Social", chips: ["Instagram 18.4K", "YouTube 6.1K", "LinkedIn 4.2K", "TikTok 9.8K"] },
  { kind: "chips", title: "Across the web", chips: ["Google", "Zillow", "Realtor.com", "Brokerage profile", "Wikidata"] },
  { kind: "reviews", title: "Reviews · 4.9 (212)",
    sources: ["Experience.com 4.9 (168)", "Zillow 5.0 (22)", "Google 4.8 (18)", "Facebook 5.0 (4)"],
    reviews: [
      { author: "Daniel R.", loc: "Austin, TX", rating: "★★★★★", date: "Feb 10, 2026",
        body: "Sarah priced our home perfectly and we had three offers in a week. Clear communication the whole way.",
        reply: "Reply from Sarah · Feb 17 — Thank you so much, Daniel! Congratulations on the sale." },
      { author: "Priya M.", loc: "Round Rock, TX", rating: "★★★★★", date: "Nov 17, 2025",
        body: "As first-time buyers we felt guided, never rushed. She knew every neighborhood cold.",
        reply: "Reply from Sarah · Nov 18 — So happy for you both. Enjoy the new home!" },
    ]},
  { kind: "posts", title: "Posts · last 10", posts: [
    { platform: "Instagram", ago: "16h", text: "Just closed on this Travis Heights bungalow — third offer accepted in 6 days." },
    { platform: "Facebook", ago: "2d", text: "New 5-star review on Experience.com — \"Sarah made our first purchase painless.\"" },
    { platform: "LinkedIn", ago: "4d", text: "Austin Q2 market report is live: inventory is finally loosening." },
    { platform: "X", ago: "6d", text: "Rates dipped this week. Good window for buyers who paused this spring." },
  ]},
  { kind: "disclaimer", text: "Sarah Mitchell is a licensed real estate agent (TX #0654321) with Lakeline Realty Group. Equal Housing Opportunity. All information deemed reliable but not guaranteed. © 2026 Lakeline Realty Group." },
];

const RE_OFFICE_PROFILE: ProfileSection[] = [
  { kind: "header", name: "Lakeline Realty Group — Downtown", subtitle: "Real estate office · DRE #01999999",
    initials: "⌂", square: true, badges: ["Verified"], rating: "4.8", ratingCount: "640",
    lines: ["500 W 2nd St, Austin, TX 78701", "Mon–Fri 9:00–18:00 · Sat 10:00–16:00 · CST"],
    chips: ["Wheelchair accessible", "Parking"],
    ctas: ["Contact office", "Claim office"] },
  { kind: "stats", title: "Office track record", stats: [
    { value: "$1.2B", label: "Office volume" }, { value: "24", label: "Agents" },
    { value: "2,840", label: "Homes sold" }, { value: "11", label: "Avg days on market" },
  ]},
  { kind: "roster", title: "Our agents ↓", members: [
    { initials: "SM", name: "Sarah Mitchell", meta: "★ 4.9 · 212" },
    { initials: "ML", name: "Marcus Lee", meta: "★ 4.7 · 96" },
    { initials: "DC", name: "Dana Cruz", meta: "★ 4.9 · 154" },
  ], note: "+ 21 more agents" },
  { kind: "infoCards", cards: [
    { title: "Upstream ↑", lines: ["Parent brokerage: Lakeline Realty Group", "Franchise / brand affiliation"] },
    { title: "Serving areas", chips: ["Downtown", "Travis Heights", "78701", "78704"] },
  ]},
  { kind: "reviews", title: "Office reviews · 4.8 (640)",
    sources: ["Experience.com 4.8 (512)", "Zillow 4.9 (74)", "Google 4.7 (54)"],
    reviews: [
      { author: "Office aggregate", loc: "all agents", rating: "★★★★★", date: "rolling",
        body: "Office rating rolls up every agent's verified reviews across all four sources." },
    ]},
  { kind: "chips", title: "Across the web", chips: ["Google Business Profile", "Zillow office", "Brokerage site", "Wikidata"] },
  { kind: "disclaimer", text: "Lakeline Realty Group is a licensed real estate brokerage (DRE #01999999). Equal Housing Opportunity." },
];

export const EXPERTISE_SCHEMAS: Record<string, CategorySchema> = {
  real_estate_agents: {
    gcid: "real_estate_agents",
    displayName: "Real estate agent",
    entityType: "both",
    lanes: [
      { key: "location", label: "Office (location)", schemaType: "RealEstateAgent + LocalBusiness",
        elements: RE_OFFICE_ELEMENTS, seo: RE_OFFICE_SEO, jsonld: RE_OFFICE_JSONLD, html: RE_OFFICE_HTML, profile: RE_OFFICE_PROFILE },
      { key: "professional", label: "Agent (professional)", schemaType: "Person + RealEstateAgent",
        elements: RE_AGENT_ELEMENTS, seo: RE_AGENT_SEO, jsonld: RE_AGENT_JSONLD, html: RE_AGENT_HTML, profile: RE_AGENT_PROFILE },
    ],
  },
  restaurant: RESTAURANT_SCHEMA as unknown as CategorySchema,
};

export function getCategorySchema(gcid: string): CategorySchema | null {
  const key = gcid.replace(/^gcid:/, "");
  return EXPERTISE_SCHEMAS[key] ?? null;
}

export function countFields(lane: LaneDef): number {
  return lane.elements.reduce((n, e) => n + e.fields.length, 0);
}
export function countScored(lane: LaneDef): number {
  return lane.elements.reduce((n, e) => n + e.fields.filter((f) => f.scored).length, 0);
}
