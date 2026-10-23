-- RE SCHEMA PROJECTION (regenerated): derived from the 149-row node registry + Correction
-- Spec (9 rules) + conversion actions. Replaces the stale free-form pilot. Every schema.org
-- type/property pair linted (Layers A/B/C incl. per-hop dotted paths). Gates: 183 fields
-- (min 100), 20/20 SEO pairs (min 18). Multi-typed roots per lane.
INSERT INTO exp_category_schema (gcid, entity_type, schema_json, model, knowledge_updated_at)
VALUES ('gcid:real_estate_agents','both',$reproj${
 "gcid": "gcid:real_estate_agents",
 "displayName": "Real estate agent",
 "entityType": "both",
 "lanes": [
  {
   "key": "location",
   "label": "Office (location)",
   "schemaType": "RealEstateAgent + LocalBusiness",
   "elements": [
    {
     "n": 1,
     "name": "Identity",
     "group": "RealEstateAgent + LocalBusiness",
     "fields": [
      {
       "label": "Office Name",
       "prop": "name",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Legal Name",
       "prop": "legalName",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Logo",
       "prop": "logo",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Office Photo",
       "prop": "image",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Office Phone",
       "prop": "telephone",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Office Email",
       "prop": "email",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Office Hours",
       "prop": "openingHoursSpecification",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Price Range",
       "prop": "priceRange",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Founding Date",
       "prop": "foundingDate",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Team Size",
       "prop": "numberOfEmployees",
       "type": "Text",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 2,
     "name": "Presence",
     "group": "sameAs / hasMap",
     "fields": [
      {
       "label": "Website",
       "prop": "url",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Google Business Profile",
       "prop": "sameAs",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Zillow Office Page",
       "prop": "sameAs",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Facebook Page",
       "prop": "sameAs",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Map Link",
       "prop": "hasMap",
       "type": "Text",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 3,
     "name": "Location",
     "group": "PostalAddress / GeoCoordinates",
     "fields": [
      {
       "label": "Street Address",
       "prop": "address",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Coordinates",
       "prop": "geo",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Service Areas",
       "prop": "areaServed",
       "type": "Text",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 4,
     "name": "Services",
     "group": "OfferCatalog / Offer",
     "fields": [
      {
       "label": "Service Catalog",
       "prop": "hasOfferCatalog",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Active Listings",
       "prop": "makesOffer",
       "type": "Text",
       "source": "Platform"
      }
     ]
    },
    {
     "n": 5,
     "name": "Reputation",
     "group": "AggregateRating / Review",
     "fields": [
      {
       "label": "Office Rating",
       "prop": "aggregateRating",
       "type": "Text",
       "source": "Platform"
      },
      {
       "label": "Office Reviews",
       "prop": "review",
       "type": "Text",
       "source": "Platform"
      }
     ]
    },
    {
     "n": 6,
     "name": "Engagement",
     "group": "InteractionCounter",
     "fields": [
      {
       "label": "Page Followers",
       "prop": "interactionStatistic",
       "type": "Text",
       "source": "Platform"
      }
     ]
    },
    {
     "n": 7,
     "name": "Conversion",
     "group": "potentialAction",
     "fields": [
      {
       "label": "Schedule with an agent",
       "prop": "potentialAction",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Contact office",
       "prop": "potentialAction",
       "type": "Text",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 8,
     "name": "Entity Graph",
     "group": "parentOrganization / employee / brand",
     "fields": [
      {
       "label": "Parent Brokerage",
       "prop": "parentOrganization",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Brand",
       "prop": "brand",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Agents (roster)",
       "prop": "employee",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "MLS Membership",
       "prop": "memberOf",
       "type": "Text",
       "source": "Profile"
      }
     ]
    }
   ],
   "seo": [
    [
     "title",
     "{office_name} — Real Estate Office in {city}, {state} | Experience.com"
    ],
    [
     "description",
     "{office_name} serves {city} with {agent_count} licensed agents. {review_count} verified reviews. Browse active listings or schedule with an agent."
    ],
    [
     "keywords",
     "real estate office, {city} realtors, real estate agency, {office_name}, homes for sale {city}"
    ],
    [
     "canonical",
     "{office_url}"
    ],
    [
     "robots",
     "index, follow, max-image-preview:large"
    ],
    [
     "geo.region",
     "US-{state}"
    ],
    [
     "geo.placename",
     "{city}"
    ],
    [
     "geo.position",
     "{lat};{lng}"
    ],
    [
     "ICBM",
     "{lat}, {lng}"
    ],
    [
     "og:type",
     "business.business"
    ],
    [
     "og:title",
     "{office_name} — {city} Real Estate Office"
    ],
    [
     "og:description",
     "{agent_count} agents · {rating}★ ({review_count} reviews) · {city}, {state}"
    ],
    [
     "og:image",
     "{photo_url}"
    ],
    [
     "og:url",
     "{office_url}"
    ],
    [
     "og:site_name",
     "Experience.com"
    ],
    [
     "business:contact_data:street_address",
     "{street}"
    ],
    [
     "business:contact_data:locality",
     "{city}"
    ],
    [
     "business:contact_data:region",
     "{state}"
    ],
    [
     "twitter:card",
     "summary_large_image"
    ],
    [
     "twitter:title",
     "{office_name} — Real Estate Office in {city}"
    ]
   ],
   "jsonld": "{\n  \"@context\": \"https://schema.org\",\n  \"@id\": \"{office_url}#office\",\n  \"@type\": [\"RealEstateAgent\", \"LocalBusiness\"],\n  \"name\": \"{office_name}\", \"legalName\": \"{legal_name}\", \"url\": \"{office_url}\",\n  \"logo\": \"{logo_url}\", \"image\": \"{photo_url}\", \"telephone\": \"{phone}\", \"email\": \"{email}\",\n  \"priceRange\": \"{price_range}\", \"foundingDate\": \"{founded}\", \"numberOfEmployees\": \"{team_size}\",\n  \"address\": { \"@type\": \"PostalAddress\", \"streetAddress\": \"{street}\", \"addressLocality\": \"{city}\", \"addressRegion\": \"{state}\", \"postalCode\": \"{zip}\" },\n  \"geo\": { \"@type\": \"GeoCoordinates\", \"latitude\": \"{lat}\", \"longitude\": \"{lng}\" },\n  \"hasMap\": \"{map_url}\", \"areaServed\": [{ \"@type\": \"City\", \"name\": \"{city}\" }],\n  \"openingHoursSpecification\": [{ \"@type\": \"OpeningHoursSpecification\", \"dayOfWeek\": [\"Monday\",\"Tuesday\",\"Wednesday\",\"Thursday\",\"Friday\"], \"opens\": \"09:00\", \"closes\": \"18:00\" }],\n  \"aggregateRating\": { \"@type\": \"AggregateRating\", \"ratingValue\": \"{rating}\", \"reviewCount\": \"{review_count}\", \"bestRating\": \"5\" },\n  \"hasOfferCatalog\": { \"@type\": \"OfferCatalog\", \"name\": \"Real Estate Services\", \"itemListElement\": {service_offers} },\n  \"makesOffer\": {active_listings},\n  \"potentialAction\": [\n    { \"@type\": \"ScheduleAction\", \"name\": \"Schedule with an agent\", \"target\": \"{schedule_url}\" },\n    { \"@type\": \"CommunicateAction\", \"name\": \"Contact office\", \"target\": \"{contact_url}\" }\n  ],\n  \"parentOrganization\": { \"@type\": \"Organization\", \"name\": \"{brokerage_name}\" },\n  \"brand\": { \"@type\": \"Brand\", \"name\": \"{brand_name}\" },\n  \"employee\": {agent_roster},\n  \"sameAs\": {sameas_urls},\n  \"interactionStatistic\": [{ \"@type\": \"InteractionCounter\", \"interactionType\": { \"@type\": \"FollowAction\" }, \"interactionService\": { \"@type\": \"WebSite\", \"name\": \"Facebook\" }, \"userInteractionCount\": \"{follower_count}\" }]\n}",
   "html": "<main itemscope itemtype=\"https://schema.org/RealEstateAgent\">\n  <link itemprop=\"additionalType\" href=\"https://schema.org/LocalBusiness\" />\n  <h1 itemprop=\"name\">{office_name}</h1>\n  <div itemprop=\"address\" itemscope itemtype=\"https://schema.org/PostalAddress\">\n    <span itemprop=\"streetAddress\">{street}</span>, <span itemprop=\"addressLocality\">{city}</span>\n  </div>\n  <span itemprop=\"telephone\">{phone}</span> · <a itemprop=\"url\" href=\"{office_url}\">{office_url}</a>\n  <div itemprop=\"aggregateRating\" itemscope itemtype=\"https://schema.org/AggregateRating\">\n    <span itemprop=\"ratingValue\">{rating}</span>★ (<span itemprop=\"reviewCount\">{review_count}</span>)\n  </div>\n</main>",
   "profile": [
    {
     "kind": "header",
     "name": "Lakeline Realty — Downtown Austin",
     "subtitle": "Real estate office · 500 W 2nd St, Austin, TX",
     "initials": "LR",
     "square": true,
     "badges": [
      "Verified"
     ],
     "rating": "4.8",
     "ratingCount": "640",
     "chips": [
      "Mon–Fri 9–6 · Sat 10–4"
     ],
     "bio": "Full-service Austin office: 24 licensed agents covering central and south Austin.",
     "ctas": [
      "Schedule with an agent",
      "Browse listings",
      "Contact office"
     ]
    },
    {
     "kind": "infoCards",
     "cards": [
      {
       "title": "Location & hours",
       "lines": [
        "500 W 2nd St, Austin, TX 78701",
        "Mon–Fri 9:00–18:00 · Sat 10:00–16:00 · CST"
       ],
       "chips": [
        "Accessible",
        "Parking"
       ]
      },
      {
       "title": "Contact",
       "lines": [
        "(512) 555-0100",
        "downtown@lakelinerealty.com",
        "lakelinerealty.com"
       ],
       "chips": [
        "FB",
        "IG",
        "LI"
       ]
      }
     ]
    },
    {
     "kind": "roster",
     "title": "Agents · 24",
     "members": [
      {
       "initials": "SM",
       "name": "Sarah Mitchell",
       "meta": "4.9★ · 212 reviews · Luxury, first-time buyers"
      },
      {
       "initials": "DK",
       "name": "David Kim",
       "meta": "4.8★ · 154 reviews · Investment, condos"
      },
      {
       "initials": "AP",
       "name": "Ana Perez",
       "meta": "4.9★ · 98 reviews · Relocation, new construction"
      }
     ],
     "note": "Roster ranked by search rank score."
    },
    {
     "kind": "services",
     "title": "Services",
     "items": [
      "Buyer representation",
      "Listing & marketing",
      "Home valuation",
      "Relocation support",
      "Investment advisory"
     ]
    },
    {
     "kind": "properties",
     "title": "Office listings · 46",
     "items": [
      {
       "price": "$745,000",
       "meta": "1208 Kinney Ave · 3bd 2ba",
       "status": "Active"
      },
      {
       "price": "$389,000",
       "meta": "801 Rutland Dr · 2bd 2ba",
       "status": "Active"
      }
     ]
    },
    {
     "kind": "reviews",
     "title": "Reviews",
     "sources": [
      "Google",
      "Experience.com"
     ],
     "reviews": [
      {
       "author": "R. Osei",
       "loc": "Austin",
       "rating": "5.0",
       "date": "Jun 2026",
       "body": "Professional office — paired us with the right agent in a day."
      }
     ]
    },
    {
     "kind": "disclaimer",
     "text": "Lakeline Realty Group is a licensed Texas real estate brokerage. Office and agent licenses verified against TREC records. Equal Housing Opportunity."
    }
   ]
  },
  {
   "key": "professional",
   "label": "Agent (professional)",
   "schemaType": "Person + RealEstateAgent",
   "elements": [
    {
     "n": 1,
     "name": "Identity",
     "group": "Person + RealEstateAgent",
     "fields": [
      {
       "label": "Full Legal Name",
       "prop": "name",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Preferred Display Name",
       "prop": "alternateName",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Agent Headline / Tagline",
       "prop": "description",
       "type": "TextObject",
       "source": "Profile"
      },
      {
       "label": "Profile Photo",
       "prop": "image",
       "type": "ImageObject",
       "source": "Profile"
      },
      {
       "label": "Job Title",
       "prop": "jobTitle",
       "type": "DefinedTerm",
       "source": "Profile"
      },
      {
       "label": "Primary Email Address",
       "prop": "email",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Primary Phone Number",
       "prop": "telephone",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Mobile Phone Number",
       "prop": "contactPoint.telephone",
       "type": "ContactPoint",
       "source": "Profile"
      },
      {
       "label": "Office Phone Number",
       "prop": "contactPoint.contactType",
       "type": "ContactPoint",
       "source": "Profile"
      },
      {
       "label": "Fax Number",
       "prop": "faxNumber",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Gender",
       "prop": "gender",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Nationality",
       "prop": "nationality",
       "type": "Country",
       "source": "Profile"
      },
      {
       "label": "Birth Date",
       "prop": "birthDate",
       "type": "Date",
       "source": "Profile"
      },
      {
       "label": "Office Hours",
       "prop": "openingHoursSpecification",
       "type": "OpeningHoursSpecification",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 2,
     "name": "Presence",
     "group": "sameAs / ProfilePage",
     "fields": [
      {
       "label": "Agent Vanity URL",
       "prop": "url",
       "type": "URL",
       "source": "Platform"
      },
      {
       "label": "YouTube Channel URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "LinkedIn URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "Facebook URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "Instagram URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "Twitter URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "TikTok URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "Pinterest URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Social"
      },
      {
       "label": "Primary Website URL",
       "prop": "url",
       "type": "URL",
       "source": "Profile"
      },
      {
       "label": "Experience.com Profile",
       "prop": "sameAs",
       "type": "URL",
       "source": "Platform"
      },
      {
       "label": "Zillow Profile",
       "prop": "sameAs",
       "type": "URL",
       "source": "Zillow"
      },
      {
       "label": "Realtor.com Profile",
       "prop": "sameAs",
       "type": "URL",
       "source": "Realtor.com"
      },
      {
       "label": "GBP URL",
       "prop": "sameAs",
       "type": "URL",
       "source": "Google"
      },
      {
       "label": "Homes.com Profile",
       "prop": "sameAs",
       "type": "URL",
       "source": "Homes.com"
      },
      {
       "label": "Trulia Profile",
       "prop": "sameAs",
       "type": "URL",
       "source": "Trulia"
      },
      {
       "label": "Wikidata Entity ID",
       "prop": "sameAs",
       "type": "URL",
       "source": "Wikidata"
      }
     ]
    },
    {
     "n": 3,
     "name": "Location",
     "group": "PostalAddress / GeoCoordinates / areaServed",
     "fields": [
      {
       "label": "Office / Brokerage Address",
       "prop": "address",
       "type": "Text",
       "source": "Profile"
      },
      {
       "label": "Geographic Coordinates",
       "prop": "geo",
       "type": "GeoCoordinates",
       "source": "Profile"
      },
      {
       "label": "Primary Service Area",
       "prop": "areaServed",
       "type": "GeoShape",
       "source": "Profile"
      },
      {
       "label": "Geographic Farm ZIPs",
       "prop": "areaServed",
       "type": "GeoShape",
       "source": "Profile"
      }
     ]
    },
    {
     "n": 4,
     "name": "Authority",
     "group": "EducationalOccupationalCredential / Occupation / PropertyValue",
     "fields": [
      {
       "label": "Agent Role / Designation Label",
       "prop": "hasOccupation",
       "type": "Occupation",
       "source": "Profile"
      },
      {
       "label": "Languages Spoken",
       "prop": "knowsLanguage",
       "type": "Language",
       "source": "Profile"
      },
      {
       "label": "Real Estate License Number",
       "prop": "hasCredential.credentialId",
       "type": "EducationalOccupationalCredential",
       "source": "State DB"
      },
      {
       "label": "License State / Jurisdiction",
       "prop": "hasCredential.recognizedBy",
       "type": "EducationalOccupationalCredential",
       "source": "State DB"
      },
      {
       "label": "License Type",
       "prop": "hasCredential.credentialCategory",
       "type": "EducationalOccupationalCredential",
       "source": "State DB"
      },
      {
       "label": "License Status",
       "prop": "— (platform only)",
       "type": "Platform",
       "source": "State DB"
      },
      {
       "label": "License Expiration Date",
       "prop": "hasCredential.expires",
       "type": "Date",
       "source": "State DB"
      },
      {
       "label": "REALTOR Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "ABR Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "CRS Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "CRS"
      },
      {
       "label": "GRI Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "SRS Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "e-PRO Certification",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "MRP Certification",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "SRES Designation",
       "prop": "hasCredential.name",
       "type": "EducationalOccupationalCredential",
       "source": "NAR"
      },
      {
       "label": "Fiduciary Duty Acknowledgement",
       "prop": "hasCredential.description",
       "type": "EducationalOccupationalCredential",
       "source": "State DB"
      },
      {
       "label": "Dual Agency Disclosure",
       "prop": "hasCredential.description",
       "type": "EducationalOccupationalCredential",
       "source": "Brokerage"
      },
      {
       "label": "E&O Insurance Carrier",
       "prop": "hasCredential.recognizedBy",
       "type": "EducationalOccupationalCredential",
       "source": "Brokerage"
      },
      {
       "label": "Continuing Ed Hours",
       "prop": "hasCredential.competencyRequired",
       "type": "EducationalOccupationalCredential",
       "source": "State DB"
      },
      {
       "label": "Years Licensed",
       "prop": "hasOccupation.experienceRequirements",
       "type": "Occupation",
       "source": "Profile"
      },
      {
       "label": "Year First Licensed",
       "prop": "hasCredential.dateCreated",
       "type": "Date",
       "source": "State DB"
      },
      {
       "label": "Total Career Transactions",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Total Career Sales Volume",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "T12 Sales Volume",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Avg Days on Market",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Avg List-to-Sale Ratio",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Buyer-Side Transactions",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Seller-Side Transactions",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Avg Sale Price",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Median Sale Price",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Relocation Cases",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Profile"
      },
      {
       "label": "Investment Transactions",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "CMAs Delivered",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Profile"
      },
      {
       "label": "Open Houses Hosted",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "MLS"
      },
      {
       "label": "Earnest Money Negotiations",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Profile"
      },
      {
       "label": "Speaking Topics",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "Peer Referral Count",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Platform"
      },
      {
       "label": "NPS",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Platform"
      },
      {
       "label": "Review Response Rate",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Platform"
      },
      {
       "label": "Awards in Reviews",
       "prop": "award",
       "type": "Text",
       "source": "Platform"
      },
      {
       "label": "Commission Split Structure",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Brokerage"
      },
      {
       "label": "Knowledge Panel Claimed",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Google"
      },
      {
       "label": "KnowsAbout MLS",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "KnowsAbout Contracts",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "KnowsAbout Escrow",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "KnowsAbout RESPA",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "KnowsAbout Investment",
       "prop": "knowsAbout",
       "type": "Thing",
       "source": "Profile"
      },
      {
       "label": "Schema Published Flag",
       "prop": "additionalProperty.value",
       "type": "PropertyValue",
       "source": "Platform"
      }
     ]
    },
    {
     "n": 5,
     "name": "Services",
     "group": "Service / OfferCatalog / Offer",
     "fields": [
      {
       "label": "SvcCat Listing/Selling",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Buyer Rep",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat CMA",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Negotiation",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Open House",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Transaction Mgmt",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Relocation",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "SvcCat Investment",
       "prop": "hasOfferCatalog",
       "type": "OfferCatalog",
       "source": "Profile"
      },
      {
       "label": "Active Listing URLs",
       "prop": "makesOffer",
       "type": "Offer",
       "source": "MLS"
      }
     ]
    },
    {
     "n": 6,
     "name": "Content",
     "group": "Article / CreativeWork (author @id -> Person)",
     "fields": [
      {
       "label": "Blog / Article Bylines",
       "prop": "author",
       "type": "Organization",
       "source": "CMS"
      },
      {
       "label": "Market Report Publications",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Neighborhood Guide Articles",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "CMA Reports Published",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Listing Agreement Explainer",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Buyers Guide Publications",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Closing Disclosure Content",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Commission Transparency Post",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "MLS Commentary Posts",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Investment Whitepaper",
       "prop": "subjectOf",
       "type": "Event",
       "source": "CMS"
      },
      {
       "label": "Press Mentions",
       "prop": "subjectOf",
       "type": "Event",
       "source": "Press"
      },
      {
       "label": "Podcast Guest Appearances",
       "prop": "subjectOf",
       "type": "Event",
       "source": "Media"
      },
      {
       "label": "Podcast Host Show",
       "prop": "creator",
       "type": "Organization",
       "source": "Media"
      },
      {
       "label": "Video Tour Productions",
       "prop": "subjectOf",
       "type": "Event",
       "source": "MLS"
      },
      {
       "label": "TV Segment Appearances",
       "prop": "subjectOf",
       "type": "Event",
       "source": "Media"
      },
      {
       "label": "Radio Interviews",
       "prop": "subjectOf",
       "type": "Event",
       "source": "Media"
      },
      {
       "label": "Webinar Presentations",
       "prop": "subjectOf",
       "type": "Event",
       "source": "Platform"
      },
      {
       "label": "Conference Engagements",
       "prop": "performerIn",
       "type": "Event",
       "source": "Profile"
      },
      {
       "label": "Headshot Library",
       "prop": "image",
       "type": "ImageObject",
       "source": "Profile"
      },
      {
       "label": "Virtual Tour Credits",
       "prop": "subjectOf",
       "type": "Event",
       "source": "MLS"
      }
     ]
    },
    {
     "n": 7,
     "name": "Reputation",
     "group": "AggregateRating / Review (per-source publisher @id)",
     "fields": [
      {
       "label": "Aggregate Star Rating",
       "prop": "aggregateRating.ratingValue",
       "type": "AggregateRating",
       "source": "Platform"
      },
      {
       "label": "Total Review Count",
       "prop": "aggregateRating.reviewCount",
       "type": "AggregateRating",
       "source": "Platform"
      },
      {
       "label": "Rating Scale",
       "prop": "aggregateRating.bestRating",
       "type": "AggregateRating",
       "source": "Platform"
      },
      {
       "label": "Verified Transaction Reviews",
       "prop": "aggregateRating.reviewCount",
       "type": "AggregateRating",
       "source": "Platform"
      },
      {
       "label": "Review Text Buyer",
       "prop": "review.reviewBody",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Review Text Seller",
       "prop": "review.reviewBody",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Reviewer Name",
       "prop": "review.author",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Review Date",
       "prop": "review.datePublished",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Review Star Rating",
       "prop": "review.reviewRating.ratingValue",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Review Source Platform",
       "prop": "review.publisher",
       "type": "Review",
       "source": "Platform"
      },
      {
       "label": "Google Business Rating",
       "prop": "aggregateRating.ratingValue",
       "type": "AggregateRating",
       "source": "Google"
      },
      {
       "label": "Zillow Rating",
       "prop": "aggregateRating.ratingValue",
       "type": "AggregateRating",
       "source": "Zillow"
      },
      {
       "label": "Realtor.com Rating",
       "prop": "aggregateRating.ratingValue",
       "type": "AggregateRating",
       "source": "Realtor.com"
      }
     ]
    },
    {
     "n": 8,
     "name": "Engagement",
     "group": "InteractionCounter + interactionType",
     "fields": [
      {
       "label": "T12 Units Sold",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "MLS"
      },
      {
       "label": "Total Published Pieces",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "CMS"
      },
      {
       "label": "Video Library Count",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Platform"
      },
      {
       "label": "LinkedIn Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "Facebook Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "Instagram Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "Twitter Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "TikTok Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "Avg Engagement Rate",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      },
      {
       "label": "Total Social Followers",
       "prop": "interactionStatistic.userInteractionCount",
       "type": "InteractionCounter",
       "source": "Social"
      }
     ]
    },
    {
     "n": 9,
     "name": "Conversion",
     "group": "potentialAction -> Action subtypes",
     "fields": [
      {
       "label": "Schedule a showing",
       "prop": "potentialAction (ScheduleAction)",
       "type": "ScheduleAction",
       "source": "Logic layer"
      },
      {
       "label": "Book a consultation",
       "prop": "potentialAction (ScheduleAction)",
       "type": "ScheduleAction",
       "source": "Logic layer"
      },
      {
       "label": "Request home valuation",
       "prop": "potentialAction (ScheduleAction)",
       "type": "ScheduleAction",
       "source": "Logic layer"
      },
      {
       "label": "Contact the agent",
       "prop": "potentialAction (CommunicateAction)",
       "type": "CommunicateAction",
       "source": "Logic layer"
      },
      {
       "label": "Subscribe to market updates",
       "prop": "potentialAction (SubscribeAction)",
       "type": "SubscribeAction",
       "source": "Logic layer"
      }
     ]
    },
    {
     "n": 10,
     "name": "Entity Graph",
     "group": "worksFor / memberOf / parentOrganization",
     "fields": [
      {
       "label": "NAR Membership Status",
       "prop": "memberOf.name",
       "type": "MemberProgramTier",
       "source": "NAR"
      },
      {
       "label": "Parent Brokerage",
       "prop": "worksFor",
       "type": "Organization",
       "source": "Brokerage"
      },
      {
       "label": "Brokerage Brand",
       "prop": "parentOrganization",
       "type": "Organization",
       "source": "Brokerage"
      },
      {
       "label": "Brokerage License Number",
       "prop": "worksFor.hasCredential.credentialId",
       "type": "Organization",
       "source": "State DB"
      },
      {
       "label": "MLS Membership",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "MLS"
      },
      {
       "label": "Local REALTOR Assoc",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "NAR"
      },
      {
       "label": "State REALTOR Assoc",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "NAR"
      },
      {
       "label": "NAR Membership",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "NAR"
      },
      {
       "label": "Team Name",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Brokerage"
      },
      {
       "label": "Team Leader",
       "prop": "colleague",
       "type": "URL",
       "source": "Brokerage"
      },
      {
       "label": "Referral Networks",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Profile"
      },
      {
       "label": "Relocation Network",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Profile"
      },
      {
       "label": "CCIM Affiliation",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Profile"
      },
      {
       "label": "Chamber of Commerce",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Profile"
      },
      {
       "label": "Civic Memberships",
       "prop": "memberOf",
       "type": "MemberProgramTier",
       "source": "Profile"
      }
     ]
    }
   ],
   "seo": [
    [
     "title",
     "{name} — Real Estate Agent in {city}, {state} | Experience.com"
    ],
    [
     "description",
     "{name} is a licensed real estate agent serving {city} and surrounding areas. {review_count} verified reviews, {years_licensed} years of experience. Schedule a showing or request a free home valuation."
    ],
    [
     "keywords",
     "real estate agent, realtor, {city} real estate agent, buyers agent, listing agent, home valuation, {name}"
    ],
    [
     "canonical",
     "{profile_url}"
    ],
    [
     "robots",
     "index, follow, max-image-preview:large"
    ],
    [
     "author",
     "{name}"
    ],
    [
     "geo.region",
     "US-{state}"
    ],
    [
     "geo.placename",
     "{city}"
    ],
    [
     "og:type",
     "profile"
    ],
    [
     "og:title",
     "{name} — Real Estate Agent in {city}"
    ],
    [
     "og:description",
     "Licensed real estate agent · {rating}★ ({review_count} reviews) · {specialty_list}"
    ],
    [
     "og:image",
     "{photo_url}"
    ],
    [
     "og:url",
     "{profile_url}"
    ],
    [
     "og:site_name",
     "Experience.com"
    ],
    [
     "profile:first_name",
     "{first_name}"
    ],
    [
     "profile:last_name",
     "{last_name}"
    ],
    [
     "twitter:card",
     "summary_large_image"
    ],
    [
     "twitter:title",
     "{name} — {city} Real Estate Agent"
    ],
    [
     "twitter:description",
     "{rating}★ · {review_count} verified reviews · {years_licensed} yrs experience"
    ],
    [
     "twitter:image",
     "{photo_url}"
    ]
   ],
   "jsonld": "{\n  \"@context\": \"https://schema.org\",\n  \"@graph\": [\n    {\n      \"@id\": \"{profile_url}#agent\",\n      \"@type\": [\"Person\", \"RealEstateAgent\"],\n      \"name\": \"{name}\", \"alternateName\": \"{display_name}\", \"description\": \"{headline}\",\n      \"image\": \"{photo_url}\", \"jobTitle\": \"{job_title}\", \"url\": \"{profile_url}\",\n      \"telephone\": \"{phone}\", \"email\": \"{email}\", \"knowsLanguage\": {languages},\n      \"address\": { \"@type\": \"PostalAddress\", \"streetAddress\": \"{street}\", \"addressLocality\": \"{city}\", \"addressRegion\": \"{state}\", \"postalCode\": \"{zip}\" },\n      \"geo\": { \"@type\": \"GeoCoordinates\", \"latitude\": \"{lat}\", \"longitude\": \"{lng}\" },\n      \"areaServed\": [{ \"@type\": \"City\", \"name\": \"{city}\" }],\n      \"hasOccupation\": { \"@type\": \"Occupation\", \"name\": \"Real Estate Agent\", \"experienceRequirements\": \"{years_licensed} years\" },\n      \"hasCredential\": [{\n        \"@type\": \"EducationalOccupationalCredential\", \"credentialCategory\": \"license\",\n        \"identifier\": \"{license_number}\", \"name\": \"{license_label}\",\n        \"recognizedBy\": { \"@type\": \"GovernmentOrganization\", \"name\": \"{licensing_body}\" },\n        \"expires\": \"{license_expiration}\"\n      }],\n      \"knowsAbout\": {specialties}, \"award\": {awards},\n      \"worksFor\": { \"@type\": \"Organization\", \"@id\": \"{profile_url}#brokerage\", \"name\": \"{brokerage_name}\" },\n      \"memberOf\": [{ \"@type\": \"Organization\", \"name\": \"{mls_name}\" }, { \"@type\": \"Organization\", \"name\": \"National Association of REALTORS\" }],\n      \"colleague\": {team_members},\n      \"interactionStatistic\": [{\n        \"@type\": \"InteractionCounter\",\n        \"interactionType\": { \"@type\": \"FollowAction\" },\n        \"interactionService\": { \"@type\": \"WebSite\", \"name\": \"{social_platform}\" },\n        \"userInteractionCount\": \"{follower_count}\"\n      }],\n      \"subjectOf\": [{ \"@type\": \"Article\", \"headline\": \"{article_title}\", \"datePublished\": \"{article_date}\", \"author\": { \"@id\": \"{profile_url}#agent\" } }],\n      \"sameAs\": {sameas_urls}\n    },\n    {\n      \"@id\": \"{profile_url}#business\",\n      \"@type\": \"RealEstateAgent\",\n      \"name\": \"{name} — Real Estate Services\", \"url\": \"{profile_url}\",\n      \"additionalProperty\": [\n        { \"@type\": \"PropertyValue\", \"name\": \"Total Career Sales Volume\", \"value\": \"{career_volume}\" },\n        { \"@type\": \"PropertyValue\", \"name\": \"Total Career Transactions\", \"value\": \"{career_transactions}\" },\n        { \"@type\": \"PropertyValue\", \"name\": \"Average Days on Market\", \"value\": \"{avg_dom}\" }\n      ],\n      \"aggregateRating\": [\n        { \"@type\": \"AggregateRating\", \"ratingValue\": \"{platform_rating}\", \"reviewCount\": \"{platform_review_count}\", \"bestRating\": \"5\" }\n      ],\n      \"review\": [{ \"@type\": \"Review\", \"reviewBody\": \"{review_text}\", \"reviewRating\": { \"@type\": \"Rating\", \"ratingValue\": \"{review_rating}\" }, \"author\": { \"@type\": \"Person\", \"name\": \"{reviewer}\" }, \"datePublished\": \"{review_date}\", \"publisher\": { \"@type\": \"Organization\", \"@id\": \"{review_source_id}\" } }],\n      \"hasOfferCatalog\": { \"@type\": \"OfferCatalog\", \"name\": \"Real Estate Services\", \"itemListElement\": {service_offers} },\n      \"makesOffer\": {active_listings},\n      \"openingHoursSpecification\": {hours},\n      \"potentialAction\": [\n        { \"@type\": \"ScheduleAction\", \"name\": \"Schedule a showing\", \"target\": \"{schedule_url}\" },\n        { \"@type\": \"CommunicateAction\", \"name\": \"Contact the agent\", \"target\": \"{contact_url}\" }\n      ],\n      \"employee\": { \"@id\": \"{profile_url}#agent\" }\n    }\n  ]\n}",
   "html": "<main itemscope itemtype=\"https://schema.org/RealEstateAgent\">\n  <link itemprop=\"additionalType\" href=\"https://schema.org/Person\" />\n  <h1 itemprop=\"name\">{name}</h1>\n  <p itemprop=\"description\">{headline}</p>\n  <img itemprop=\"image\" src=\"{photo_url}\" alt=\"{name}\" />\n  <span itemprop=\"jobTitle\">{job_title}</span> · <a itemprop=\"telephone\" href=\"tel:{phone}\">{phone}</a>\n  <div itemprop=\"address\" itemscope itemtype=\"https://schema.org/PostalAddress\">\n    <span itemprop=\"addressLocality\">{city}</span>, <span itemprop=\"addressRegion\">{state}</span>\n  </div>\n  <div itemprop=\"hasCredential\" itemscope itemtype=\"https://schema.org/EducationalOccupationalCredential\">\n    <span itemprop=\"name\">{license_label}</span> <span itemprop=\"identifier\">{license_number}</span>\n    <meta itemprop=\"expires\" content=\"{license_expiration}\" />\n  </div>\n  <div itemprop=\"aggregateRating\" itemscope itemtype=\"https://schema.org/AggregateRating\">\n    <span itemprop=\"ratingValue\">{rating}</span>★ (<span itemprop=\"reviewCount\">{review_count}</span> reviews)\n  </div>\n</main>",
   "profile": [
    {
     "kind": "header",
     "name": "Sarah Mitchell",
     "subtitle": "Real estate agent · TX license #0654321 · TREC",
     "initials": "SM",
     "badges": [
      "PRO",
      "Verified"
     ],
     "rating": "4.9",
     "ratingCount": "212",
     "chips": [
      "Downtown Austin office"
     ],
     "bio": "12+ years helping Austin buyers and sellers. Data-driven pricing, 12-day average time-to-offer across Downtown, Travis Heights, and South Congress.",
     "ctas": [
      "Schedule a showing",
      "Get a home valuation",
      "Contact Sarah"
     ]
    },
    {
     "kind": "infoCards",
     "cards": [
      {
       "title": "Contact",
       "lines": [
        "(512) 555-0188",
        "Austin, TX",
        "sarahmitchell.realty"
       ],
       "chips": [
        "FB",
        "IG",
        "LI",
        "X",
        "YT",
        "TikTok"
       ]
      },
      {
       "title": "License & credentials",
       "lines": [
        "TX #0654321 · Active · exp 2027-08-31",
        "TREC · Austin Board of REALTORS · NAR"
       ],
       "chips": [
        "ABR",
        "CRS",
        "GRI",
        "SRS"
       ]
      }
     ]
    },
    {
     "kind": "lines",
     "title": "About",
     "lines": [
      "With 12+ years in Austin real estate, I help first-time buyers and move-up sellers across central and south Austin.",
      "Licensed 2013 · English, Spanish"
     ]
    },
    {
     "kind": "stats",
     "title": "Track record (MLS-verified)",
     "stats": [
      {
       "value": "$128M",
       "label": "Lifetime volume"
      },
      {
       "value": "340",
       "label": "Homes sold"
      },
      {
       "value": "12",
       "label": "Avg days on market"
      },
      {
       "value": "99.2%",
       "label": "List-to-sale"
      }
     ]
    },
    {
     "kind": "properties",
     "title": "Active listings · 18",
     "items": [
      {
       "price": "$745,000",
       "meta": "1208 Kinney Ave · 3bd 2ba 1,840 sqft",
       "status": "Active"
      },
      {
       "price": "$1,240,000",
       "meta": "4412 Oak Knoll · 4bd 3ba 2,910 sqft",
       "status": "Active"
      },
      {
       "price": "$525,000",
       "meta": "2207 Bluff Springs · 3bd 2ba 1,520 sqft",
       "status": "Pending"
      }
     ]
    },
    {
     "kind": "services",
     "title": "Products & services",
     "items": [
      "Buyer representation",
      "Listing / seller representation",
      "Comparative market analysis",
      "Home valuation",
      "Open house coordination"
     ]
    },
    {
     "kind": "chips",
     "title": "Specialties",
     "chips": [
      "First-time buyers",
      "Luxury",
      "Relocation",
      "Investment",
      "New construction",
      "Condos"
     ]
    },
    {
     "kind": "score",
     "title": "Search rank score",
     "value": 782,
     "max": 850
    },
    {
     "kind": "lines",
     "title": "Works at",
     "lines": [
      "Lakeline Realty Group",
      "↳ Downtown Austin office",
      "↳ Sarah Mitchell"
     ]
    },
    {
     "kind": "chips",
     "title": "Serving areas",
     "chips": [
      "Downtown",
      "Travis Heights",
      "South Congress",
      "78701",
      "78704",
      "78745"
     ]
    },
    {
     "kind": "reviews",
     "title": "Reviews",
     "sources": [
      "Experience.com",
      "Google",
      "Zillow",
      "Realtor.com"
     ],
     "reviews": [
      {
       "author": "J. Alvarez",
       "loc": "Travis Heights",
       "rating": "5.0",
       "date": "May 2026",
       "body": "Sarah priced our home perfectly — under contract in 9 days, above asking.",
       "reply": "Thank you, Jenna! Enjoy the new place."
      },
      {
       "author": "M. Chen",
       "loc": "78704",
       "rating": "4.8",
       "date": "Apr 2026",
       "body": "Patient with first-time buyers. Negotiated $18K in credits."
      }
     ]
    },
    {
     "kind": "posts",
     "title": "Latest content",
     "posts": [
      {
       "platform": "Blog",
       "ago": "3d",
       "text": "Austin spring market report: inventory up 12%, days-on-market steady."
      },
      {
       "platform": "YouTube",
       "ago": "1w",
       "text": "Walkthrough: what $750K buys in South Congress right now."
      }
     ]
    },
    {
     "kind": "disclaimer",
     "text": "Sarah Mitchell is a licensed Texas real estate agent (TREC #0654321) affiliated with Lakeline Realty Group. Market data is informational only and not a guarantee of outcome. Equal Housing Opportunity."
    }
   ]
  }
 ]
}$reproj$::jsonb,'registry-projection-linted-v1',now())
ON CONFLICT (gcid) DO UPDATE SET
  schema_json=EXCLUDED.schema_json, entity_type=EXCLUDED.entity_type,
  model=EXCLUDED.model, knowledge_updated_at=now(), updated_at=now();
