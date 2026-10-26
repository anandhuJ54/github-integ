// AUTO-GENERATED reference (claude-sonnet-4-6), validated against CategorySchema.
// Curated location-lane example proving the renderer scales beyond real estate.
// The AI Generate button reproduces this exact shape for the long tail.

export const RESTAURANT_SCHEMA = {
  "gcid": "restaurant",
  "displayName": "Restaurant",
  "entityType": "location",
  "lanes": [
    {
      "key": "location",
      "label": "Restaurant Profile",
      "schemaType": "Restaurant",
      "elements": [
        {
          "n": 1,
          "name": "Core identity",
          "group": "Place",
          "fields": [
            {
              "label": "Restaurant Name",
              "prop": "name",
              "type": "string",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Street Address",
              "prop": "address.streetAddress",
              "type": "string",
              "source": "GBP"
            },
            {
              "label": "City",
              "prop": "address.addressLocality",
              "type": "string",
              "source": "GBP"
            },
            {
              "label": "State / Province",
              "prop": "address.addressRegion",
              "type": "string",
              "source": "GBP"
            },
            {
              "label": "Postal Code",
              "prop": "address.postalCode",
              "type": "string",
              "source": "GBP"
            },
            {
              "label": "Country",
              "prop": "address.addressCountry",
              "type": "string",
              "source": "GBP"
            },
            {
              "label": "Latitude",
              "prop": "geo.latitude",
              "type": "number",
              "source": "GBP"
            },
            {
              "label": "Longitude",
              "prop": "geo.longitude",
              "type": "number",
              "source": "GBP"
            },
            {
              "label": "Phone",
              "prop": "telephone",
              "type": "string",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Website URL",
              "prop": "url",
              "type": "url",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Primary Cuisine",
              "prop": "servesCuisine",
              "type": "string",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Secondary Cuisines",
              "prop": "servesCuisine",
              "type": "array",
              "source": "Operator"
            },
            {
              "label": "Price Range",
              "prop": "priceRange",
              "type": "string",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Logo URL",
              "prop": "logo",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Cover Photo URL",
              "prop": "photo",
              "type": "url",
              "source": "GBP"
            },
            {
              "label": "Short Description",
              "prop": "description",
              "type": "text",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Year Established",
              "prop": "foundingDate",
              "type": "year",
              "source": "Operator"
            },
            {
              "label": "GBP Place ID",
              "prop": "identifier",
              "type": "string",
              "source": "GBP"
            }
          ]
        },
        {
          "n": 2,
          "name": "Credentials & authority",
          "group": "Licensing & Compliance",
          "fields": [
            {
              "label": "Food Service Permit Number",
              "prop": "hasCredential.permitNumber",
              "type": "string",
              "source": "Local Health Dept",
              "scored": true
            },
            {
              "label": "Health Inspection Grade",
              "prop": "hasCredential.grade",
              "type": "string",
              "source": "Local Health Dept",
              "scored": true
            },
            {
              "label": "Health Inspection Date",
              "prop": "hasCredential.dateIssued",
              "type": "date",
              "source": "Local Health Dept"
            },
            {
              "label": "Liquor License Number",
              "prop": "hasCredential.liquorLicense",
              "type": "string",
              "source": "State ABC Board"
            },
            {
              "label": "Liquor License Expiry",
              "prop": "hasCredential.liquorLicenseExpiry",
              "type": "date",
              "source": "State ABC Board"
            },
            {
              "label": "Food Manager Certification",
              "prop": "hasCredential.foodManagerCert",
              "type": "string",
              "source": "ServSafe / NRFSP"
            },
            {
              "label": "ADA Accessibility Compliance",
              "prop": "amenityFeature.accessibility",
              "type": "boolean",
              "source": "Operator"
            },
            {
              "label": "Fire Safety Certificate",
              "prop": "hasCredential.fireSafety",
              "type": "string",
              "source": "Local Fire Dept"
            },
            {
              "label": "Kosher / Halal Certification",
              "prop": "hasCredential.religiousCert",
              "type": "string",
              "source": "Certifying Body"
            },
            {
              "label": "Organic Certification",
              "prop": "hasCredential.organicCert",
              "type": "string",
              "source": "USDA / Certifier"
            }
          ]
        },
        {
          "n": 3,
          "name": "Experience & track record",
          "group": "Operations",
          "fields": [
            {
              "label": "Years in Operation",
              "prop": "yearsInOperation",
              "type": "number",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Hours of Operation",
              "prop": "openingHoursSpecification",
              "type": "array",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Holiday Hours",
              "prop": "specialOpeningHoursSpecification",
              "type": "array",
              "source": "GBP"
            },
            {
              "label": "Seating Capacity",
              "prop": "seatingCapacity",
              "type": "number",
              "source": "Operator"
            },
            {
              "label": "Outdoor Seating Available",
              "prop": "amenityFeature.outdoorSeating",
              "type": "boolean",
              "source": "GBP"
            },
            {
              "label": "Private Dining / Event Space",
              "prop": "amenityFeature.privateRoom",
              "type": "boolean",
              "source": "Operator"
            },
            {
              "label": "Catering Services Offered",
              "prop": "makesOffer.catering",
              "type": "boolean",
              "source": "Operator"
            },
            {
              "label": "Delivery Available",
              "prop": "amenityFeature.delivery",
              "type": "boolean",
              "source": "GBP"
            },
            {
              "label": "Takeout Available",
              "prop": "amenityFeature.takeout",
              "type": "boolean",
              "source": "GBP"
            },
            {
              "label": "Dine-In Available",
              "prop": "amenityFeature.dineIn",
              "type": "boolean",
              "source": "GBP"
            },
            {
              "label": "Reservations Required",
              "prop": "acceptsReservations",
              "type": "boolean",
              "source": "GBP",
              "scored": true
            },
            {
              "label": "Reservation URL",
              "prop": "reservationUrl",
              "type": "url",
              "source": "OpenTable / Resy"
            },
            {
              "label": "Awards & Accolades",
              "prop": "award",
              "type": "array",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Michelin Stars",
              "prop": "award.michelin",
              "type": "number",
              "source": "Michelin Guide"
            },
            {
              "label": "James Beard Nominations / Wins",
              "prop": "award.jamesBeard",
              "type": "string",
              "source": "James Beard Foundation"
            }
          ]
        },
        {
          "n": 4,
          "name": "Published content",
          "group": "Menu & Offerings",
          "fields": [
            {
              "label": "Menu URL",
              "prop": "hasMenu",
              "type": "url",
              "source": "Operator / GBP",
              "scored": true
            },
            {
              "label": "Breakfast Menu",
              "prop": "hasMenu.breakfast",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Lunch Menu",
              "prop": "hasMenu.lunch",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Dinner Menu",
              "prop": "hasMenu.dinner",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Drinks / Cocktail Menu",
              "prop": "hasMenu.drinks",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Happy Hour Menu",
              "prop": "hasMenu.happyHour",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Seasonal / Specials Menu",
              "prop": "hasMenu.seasonal",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Menu Item Name",
              "prop": "menu.MenuItem.name",
              "type": "string",
              "source": "Operator"
            },
            {
              "label": "Menu Item Description",
              "prop": "menu.MenuItem.description",
              "type": "text",
              "source": "Operator"
            },
            {
              "label": "Menu Item Price",
              "prop": "menu.MenuItem.offers.price",
              "type": "currency",
              "source": "Operator"
            },
            {
              "label": "Dietary Tags (Vegan/GF/etc.)",
              "prop": "menu.MenuItem.suitableForDiet",
              "type": "array",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Blog / Story Posts",
              "prop": "subjectOf.BlogPosting",
              "type": "url",
              "source": "Operator CMS"
            },
            {
              "label": "Press Mentions",
              "prop": "subjectOf.NewsArticle",
              "type": "url",
              "source": "Media"
            }
          ]
        },
        {
          "n": 5,
          "name": "Media & voice",
          "group": "Visual & Brand",
          "fields": [
            {
              "label": "Photo Gallery URLs",
              "prop": "photo",
              "type": "array",
              "source": "GBP / Operator",
              "scored": true
            },
            {
              "label": "Virtual Tour URL",
              "prop": "virtualTourUrl",
              "type": "url",
              "source": "Google Street View / Operator"
            },
            {
              "label": "Video Tour URL",
              "prop": "video",
              "type": "url",
              "source": "YouTube / Operator"
            },
            {
              "label": "Chef Profile Photo",
              "prop": "employee.image",
              "type": "url",
              "source": "Operator"
            },
            {
              "label": "Brand Voice / Tagline",
              "prop": "slogan",
              "type": "string",
              "source": "Operator"
            },
            {
              "label": "Interior Photos",
              "prop": "photo.interior",
              "type": "array",
              "source": "GBP"
            },
            {
              "label": "Food / Dish Photos",
              "prop": "photo.food",
              "type": "array",
              "source": "GBP / Yelp"
            },
            {
              "label": "Menu Board Photos",
              "prop": "photo.menu",
              "type": "array",
              "source": "GBP"
            },
            {
              "label": "Event / Catering Photos",
              "prop": "photo.events",
              "type": "array",
              "source": "Operator"
            }
          ]
        },
        {
          "n": 6,
          "name": "Social presence & engagement",
          "group": "Social",
          "fields": [
            {
              "label": "Facebook Page URL",
              "prop": "sameAs.facebook",
              "type": "url",
              "source": "Facebook",
              "scored": true
            },
            {
              "label": "Instagram Profile URL",
              "prop": "sameAs.instagram",
              "type": "url",
              "source": "Instagram",
              "scored": true
            },
            {
              "label": "Twitter / X Profile URL",
              "prop": "sameAs.twitter",
              "type": "url",
              "source": "Twitter/X"
            },
            {
              "label": "TikTok Profile URL",
              "prop": "sameAs.tiktok",
              "type": "url",
              "source": "TikTok"
            },
            {
              "label": "YouTube Channel URL",
              "prop": "sameAs.youtube",
              "type": "url",
              "source": "YouTube"
            },
            {
              "label": "Instagram Follower Count",
              "prop": "interactionStatistic.instagram.followers",
              "type": "number",
              "source": "Instagram"
            },
            {
              "label": "Facebook Likes / Follows",
              "prop": "interactionStatistic.facebook.follows",
              "type": "number",
              "source": "Facebook"
            },
            {
              "label": "Most Recent Post Date",
              "prop": "dateModified",
              "type": "date",
              "source": "Social Aggregator"
            },
            {
              "label": "UGC Hashtag",
              "prop": "keywords.ugcHashtag",
              "type": "string",
              "source": "Operator"
            }
          ]
        },
        {
          "n": 7,
          "name": "Reviews & reputation",
          "group": "Reputation",
          "fields": [
            {
              "label": "Google Rating",
              "prop": "aggregateRating.google.ratingValue",
              "type": "number",
              "source": "Google",
              "scored": true
            },
            {
              "label": "Google Review Count",
              "prop": "aggregateRating.google.reviewCount",
              "type": "number",
              "source": "Google",
              "scored": true
            },
            {
              "label": "Yelp Rating",
              "prop": "aggregateRating.yelp.ratingValue",
              "type": "number",
              "source": "Yelp",
              "scored": true
            },
            {
              "label": "Yelp Review Count",
              "prop": "aggregateRating.yelp.reviewCount",
              "type": "number",
              "source": "Yelp"
            },
            {
              "label": "TripAdvisor Rating",
              "prop": "aggregateRating.tripadvisor.ratingValue",
              "type": "number",
              "source": "TripAdvisor",
              "scored": true
            },
            {
              "label": "TripAdvisor Review Count",
              "prop": "aggregateRating.tripadvisor.reviewCount",
              "type": "number",
              "source": "TripAdvisor"
            },
            {
              "label": "OpenTable Rating",
              "prop": "aggregateRating.opentable.ratingValue",
              "type": "number",
              "source": "OpenTable"
            },
            {
              "label": "OpenTable Review Count",
              "prop": "aggregateRating.opentable.reviewCount",
              "type": "number",
              "source": "OpenTable"
            },
            {
              "label": "Owner Response Rate (%)",
              "prop": "reviewResponseRate",
              "type": "number",
              "source": "Platform Analytics",
              "scored": true
            },
            {
              "label": "Average Sentiment Score",
              "prop": "aggregateRating.sentiment",
              "type": "number",
              "source": "NLP Engine"
            },
            {
              "label": "Featured Review Snippet",
              "prop": "review.reviewBody",
              "type": "text",
              "source": "Google / Yelp"
            }
          ]
        },
        {
          "n": 8,
          "name": "Affiliations & upstream",
          "group": "Network & Partnerships",
          "fields": [
            {
              "label": "Restaurant Group / Parent Company",
              "prop": "parentOrganization",
              "type": "string",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Franchise Brand",
              "prop": "brand",
              "type": "string",
              "source": "Operator"
            },
            {
              "label": "James Beard Foundation Member",
              "prop": "memberOf.jamesBeard",
              "type": "boolean",
              "source": "James Beard Foundation"
            },
            {
              "label": "National Restaurant Association Member",
              "prop": "memberOf.nra",
              "type": "boolean",
              "source": "NRA"
            },
            {
              "label": "Local Chamber of Commerce Member",
              "prop": "memberOf.chamber",
              "type": "boolean",
              "source": "Chamber"
            },
            {
              "label": "OpenTable Partner",
              "prop": "memberOf.opentable",
              "type": "boolean",
              "source": "OpenTable"
            },
            {
              "label": "Resy / Tock Partner",
              "prop": "memberOf.reservationPlatform",
              "type": "string",
              "source": "Resy / Tock"
            },
            {
              "label": "Third-Party Delivery Partners",
              "prop": "memberOf.delivery",
              "type": "array",
              "source": "DoorDash / Uber Eats / Grubhub"
            },
            {
              "label": "Charity / Community Partnerships",
              "prop": "knowsAbout.community",
              "type": "array",
              "source": "Operator"
            },
            {
              "label": "Local Farm / Supplier Sourcing",
              "prop": "knowsAbout.suppliers",
              "type": "array",
              "source": "Operator"
            }
          ]
        },
        {
          "n": 9,
          "name": "Web presence & entity graph",
          "group": "Entity & SEO",
          "fields": [
            {
              "label": "Primary Website Domain",
              "prop": "url",
              "type": "url",
              "source": "Operator",
              "scored": true
            },
            {
              "label": "Yelp Business Page URL",
              "prop": "sameAs.yelp",
              "type": "url",
              "source": "Yelp",
              "scored": true
            },
            {
              "label": "TripAdvisor Listing URL",
              "prop": "sameAs.tripadvisor",
              "type": "url",
              "source": "TripAdvisor"
            },
            {
              "label": "Google Maps Place URL",
              "prop": "sameAs.googleMaps",
              "type": "url",
              "source": "Google"
            },
            {
              "label": "OpenTable Listing URL",
              "prop": "sameAs.opentable",
              "type": "url",
              "source": "OpenTable"
            },
            {
              "label": "Facebook Listing URL",
              "prop": "sameAs.facebook",
              "type": "url",
              "source": "Facebook"
            },
            {
              "label": "Wikidata QID",
              "prop": "sameAs.wikidata",
              "type": "url",
              "source": "Wikidata"
            },
            {
              "label": "Schema.org JSON-LD Present",
              "prop": "subjectOf.jsonld",
              "type": "boolean",
              "source": "Technical Audit",
              "scored": true
            },
            {
              "label": "NAP Consistency Score",
              "prop": "identifier.napConsistency",
              "type": "number",
              "source": "Moz / BrightLocal",
              "scored": true
            },
            {
              "label": "Canonical URL",
              "prop": "url.canonical",
              "type": "url",
              "source": "Technical Audit"
            },
            {
              "label": "Sitemap URL",
              "prop": "url.sitemap",
              "type": "url",
              "source": "Technical Audit"
            },
            {
              "label": "Zagat / Infatuation Listing",
              "prop": "sameAs.zagat",
              "type": "url",
              "source": "Zagat / Infatuation"
            }
          ]
        }
      ],
      "seo": [
        [
          "title",
          "{{name}} — {{servesCuisine}} Restaurant in {{address.addressLocality}}, {{address.addressRegion}}"
        ],
        [
          "description",
          "{{name}} is a {{priceRange}} {{servesCuisine}} restaurant in {{address.addressLocality}}. Rated {{aggregateRating.google.ratingValue}}/5 on Google with {{aggregateRating.google.reviewCount}} reviews. {{amenityFeature.outdoorSeating ? 'Outdoor seating available.' : ''}} {{acceptsReservations ? 'Reservations accepted.' : 'Walk-ins welcome.'}}"
        ],
        [
          "og:title",
          "{{name}} | {{servesCuisine}} | {{address.addressLocality}}"
        ],
        [
          "og:description",
          "{{description}}"
        ],
        [
          "og:image",
          "{{photo[0]}}"
        ],
        [
          "og:type",
          "restaurant.restaurant"
        ],
        [
          "canonical",
          "{{url}}"
        ],
        [
          "robots",
          "index, follow"
        ],
        [
          "schema:servesCuisine",
          "{{servesCuisine}}"
        ],
        [
          "schema:priceRange",
          "{{priceRange}}"
        ]
      ],
      "jsonld": "{\"@context\":\"https://schema.org\",\"@type\":[\"Restaurant\",\"LocalBusiness\"],\"name\":\"{{name}}\",\"description\":\"{{description}}\",\"url\":\"{{url}}\",\"telephone\":\"{{telephone}}\",\"servesCuisine\":\"{{servesCuisine}}\",\"priceRange\":\"{{priceRange}}\",\"slogan\":\"{{slogan}}\",\"hasMenu\":\"{{hasMenu}}\",\"acceptsReservations\":\"{{acceptsReservations}}\",\"address\":{\"@type\":\"PostalAddress\",\"streetAddress\":\"{{address.streetAddress}}\",\"addressLocality\":\"{{address.addressLocality}}\",\"addressRegion\":\"{{address.addressRegion}}\",\"postalCode\":\"{{address.postalCode}}\",\"addressCountry\":\"{{address.addressCountry}}\"},\"geo\":{\"@type\":\"GeoCoordinates\",\"latitude\":\"{{geo.latitude}}\",\"longitude\":\"{{geo.longitude}}\"},\"openingHoursSpecification\":\"{{openingHoursSpecification}}\",\"aggregateRating\":{\"@type\":\"AggregateRating\",\"ratingValue\":\"{{aggregateRating.google.ratingValue}}\",\"reviewCount\":\"{{aggregateRating.google.reviewCount}}\",\"bestRating\":\"5\"},\"review\":\"{{review}}\",\"photo\":\"{{photo}}\",\"sameAs\":[\"{{sameAs.yelp}}\",\"{{sameAs.facebook}}\",\"{{sameAs.instagram}}\",\"{{sameAs.tripadvisor}}\",\"{{sameAs.opentable}}\"],\"logo\":{\"@type\":\"ImageObject\",\"url\":\"{{logo}}\"},\"parentOrganization\":{\"@type\":\"Organization\",\"name\":\"{{parentOrganization}}\"},\"award\":\"{{award}}\"}",
      "html": "<section itemscope itemtype=\"https://schema.org/Restaurant https://schema.org/LocalBusiness\"><meta itemprop=\"name\" content=\"{{name}}\"/><meta itemprop=\"description\" content=\"{{description}}\"/><meta itemprop=\"telephone\" content=\"{{telephone}}\"/><meta itemprop=\"url\" content=\"{{url}}\"/><meta itemprop=\"servesCuisine\" content=\"{{servesCuisine}}\"/><meta itemprop=\"priceRange\" content=\"{{priceRange}}\"/><meta itemprop=\"hasMenu\" content=\"{{hasMenu}}\"/><div itemprop=\"address\" itemscope itemtype=\"https://schema.org/PostalAddress\"><meta itemprop=\"streetAddress\" content=\"{{address.streetAddress}}\"/><meta itemprop=\"addressLocality\" content=\"{{address.addressLocality}}\"/><meta itemprop=\"addressRegion\" content=\"{{address.addressRegion}}\"/><meta itemprop=\"postalCode\" content=\"{{address.postalCode}}\"/><meta itemprop=\"addressCountry\" content=\"{{address.addressCountry}}\"/></div><div itemprop=\"geo\" itemscope itemtype=\"https://schema.org/GeoCoordinates\"><meta itemprop=\"latitude\" content=\"{{geo.latitude}}\"/><meta itemprop=\"longitude\" content=\"{{geo.longitude}}\"/></div><div itemprop=\"aggregateRating\" itemscope itemtype=\"https://schema.org/AggregateRating\"><meta itemprop=\"ratingValue\" content=\"{{aggregateRating.google.ratingValue}}\"/><meta itemprop=\"reviewCount\" content=\"{{aggregateRating.google.reviewCount}}\"/><meta itemprop=\"bestRating\" content=\"5\"/></div></section>",
      "profile": [
        {
          "kind": "header",
          "name": "Osteria Della Volta",
          "subtitle": "Contemporary Italian · River North, Chicago",
          "initials": "OV",
          "square": true,
          "badges": [
            "Health Grade: A",
            "Michelin Bib Gourmand",
            "OpenTable Diner's Choice 2024"
          ],
          "rating": "4.7",
          "ratingCount": "1,284",
          "chips": [
            "Italian",
            "$$$",
            "Dine-In",
            "Outdoor Seating",
            "Reservations",
            "Full Bar"
          ],
          "lines": [
            "736 W. Grand Ave, Chicago, IL 60654",
            "(312) 555-0192",
            "osteriadellavolta.com"
          ],
          "bio": "Osteria Della Volta has been bringing handmade pasta and wood-fired regional Italian cooking to Chicago's River North neighborhood since 2011. Chef Marco Rinaldi sources ingredients from local Midwest farms and imports select specialty items directly from Emilia-Romagna.",
          "ctas": [
            "Reserve a Table",
            "View Menu",
            "Order Delivery",
            "Get Directions"
          ]
        },
        {
          "kind": "infoCards",
          "cards": [
            {
              "title": "Hours",
              "lines": [
                "Mon – Thu: 5:00 PM – 10:00 PM",
                "Fri – Sat: 5:00 PM – 11:00 PM",
                "Sun: 4:30 PM – 9:30 PM",
                "Brunch Sat – Sun: 10:00 AM – 2:30 PM"
              ]
            },
            {
              "title": "Cuisine & Price",
              "lines": [
                "Contemporary Italian",
                "Price Range: $$$",
                "Avg. entrée: $28–$46"
              ]
            },
            {
              "title": "Features",
              "chips": [
                "Outdoor Patio",
                "Private Dining Room",
                "Full Bar",
                "Vegan Options",
                "Gluten-Free Menu",
                "Catering Available",
                "Wheelchair Accessible"
              ]
            }
          ]
        },
        {
          "kind": "services",
          "title": "Dining Options",
          "items": [
            "Dine-In",
            "Outdoor Patio Seating",
            "Takeout",
            "Delivery (DoorDash, Uber Eats)",
            "Private Events & Catering",
            "Chef's Tasting Menu (Fri–Sat)",
            "Weekend Brunch",
            "Happy Hour (Mon–Fri 5–7 PM)"
          ]
        },
        {
          "kind": "properties",
          "title": "Menu Highlights",
          "items": [
            {
              "price": "$18",
              "meta": "Tagliatelle al Ragù Bolognese — handmade pasta, 6-hour braised beef & pork",
              "status": "Signature"
            },
            {
              "price": "$24",
              "meta": "Branzino al Forno — whole-roasted sea bass, capers, olives, lemon",
              "status": "Chef's Choice"
            },
            {
              "price": "$14",
              "meta": "Burrata della Casa — Pugliese burrata, heirloom tomatoes, basil oil",
              "status": "Popular"
            },
            {
              "price": "$32",
              "meta": "Bistecca Florentina (for 2) — 28-day dry-aged Porterhouse, rosemary, EVOO",
              "status": "Weekend Only"
            },
            {
              "price": "$11",
              "meta": "Tiramisù al Cucchiaio — classic espresso mascarpone, house ladyfingers",
              "status": "Signature"
            }
          ]
        },
        {
          "kind": "stats",
          "title": "Reputation at a Glance",
          "stats": [
            {
              "value": "4.7",
              "label": "Google Rating"
            },
            {
              "value": "1,284",
              "label": "Google Reviews"
            },
            {
              "value": "4.5",
              "label": "Yelp Rating"
            },
            {
              "value": "412",
              "label": "Yelp Reviews"
            },
            {
              "value": "4.8",
              "label": "OpenTable Rating"
            },
            {
              "value": "639",
              "label": "OpenTable Reviews"
            },
            {
              "value": "4.5",
              "label": "TripAdvisor Rating"
            },
            {
              "value": "94%",
              "label": "Owner Response Rate"
            },
            {
              "value": "13",
              "label": "Years in Operation"
            },
            {
              "value": "120",
              "label": "Seating Capacity"
            }
          ]
        },
        {
          "kind": "score",
          "title": "Expertise Score",
          "value": 724,
          "max": 850
        },
        {
          "kind": "lines",
          "title": "Credentials & Certifications",
          "lines": [
            "Chicago Dept. of Public Health Food Service Permit #FSP-2024-008812",
            "Health Inspection Grade: A (Inspected March 2024)",
            "Illinois Liquor License #RB-1128940 (expires 12/2025)",
            "ServSafe Certified Food Manager on premises",
            "ADA Accessible — ramp entry, accessible restrooms",
            "Certified Sustainable Seafood Partner (Monterey Bay Aquarium)"
          ]
        },
        {
          "kind": "roster",
          "title": "Team",
          "members": [
            {
              "initials": "MR",
              "name": "Marco Rinaldi",
              "meta": "Executive Chef & Co-Owner — 20 yrs experience, trained in Bologna"
            },
            {
              "initials": "SP",
              "name": "Sofia Pauletti",
              "meta": "Pastry Chef — James Beard Semi-Finalist 2023"
            },
            {
              "initials": "DC",
              "name": "David Chen",
              "meta": "General Manager — 10 yrs front-of-house leadership"
            },
            {
              "initials": "AL",
              "name": "Alessia Lombardi",
              "meta": "Sommelier — WSET Level 3, 400-label Italian wine program"
            }
          ],
          "note": "Full team of 38 including front-of-house and kitchen staff."
        },
        {
          "kind": "chips",
          "title": "Dietary Accommodations",
          "chips": [
            "Vegetarian",
            "Vegan",
            "Gluten-Free",
            "Nut-Free on Request",
            "Halal on Request",
            "Dairy-Free Options"
          ]
        },
        {
          "kind": "reviews",
          "title": "Guest Reviews",
          "sources": [
            "Google",
            "Yelp",
            "OpenTable",
            "TripAdvisor"
          ],
          "reviews": [
            {
              "author": "Jennifer M.",
              "loc": "Lincoln Park, Chicago",
              "rating": "5/5",
              "date": "2024-10-14",
              "body": "The tagliatelle Bolognese is the best pasta I've had outside of Italy. Service was warm and attentive without being overbearing. Came for my anniversary and they surprised us with a complimentary dessert. Will absolutely be back.",
              "reply": "Thank you so much Jennifer! Anniversaries are our favorite occasions to celebrate — we hope to see you again soon. — The OV Team"
            },
            {
              "author": "TasteChicago_R",
              "loc": "Chicago, IL",
              "rating": "4/5",
              "date": "2024-09-28",
              "body": "Solid Italian spot. The burrata starter was exceptional and the patio is lovely in fall. Parking is a pain on weekends. Slightly noisy inside but the food more than makes up for it.",
              "reply": "Thanks for the honest feedback! We're working on a noise-reduction solution for the main dining room — really appreciate the input."
            },
            {
              "author": "FoodieOT User",
              "loc": "OpenTable Verified Diner",
              "rating": "5/5",
              "date": "2024-08-03",
              "body": "Booked through OpenTable for a group of 8 — everything was seamless. The tasting menu on Friday was outstanding. Chef Rinaldi even came out to speak with the table.",
              "reply": null
            },
            {
              "author": "UK_Traveler_2024",
              "loc": "London, UK",
              "rating": "4.5/5",
              "date": "2024-07-19",
              "body": "In Chicago for a conference and stumbled on this gem via TripAdvisor. The Branzino was perfectly cooked, the wine list is genuinely impressive, and the sommelier's recommendation was spot-on.",
              "reply": "Welcome to Chicago! We love hosting guests from around the world. Safe travels and come back anytime!"
            }
          ]
        },
        {
          "kind": "posts",
          "title": "Recent Social & Updates",
          "posts": [
            {
              "platform": "Instagram",
              "ago": "2 days ago",
              "text": "🍂 Fall is here and so is our new seasonal menu! Featuring truffle tagliolini, roasted chestnut risotto, and a new spiced pear tart by Pastry Chef Sofia. Reserve your table now via the link in bio. #OsteriaDellaVolta #ChicagoEats #ItalianFood"
            },
            {
              "platform": "Facebook",
              "ago": "5 days ago",
              "text": "Big news! We've been selected as an OpenTable Diner's Choice Award winner for 2024. Thank you to every guest who dined with us and left a review — this one's for you. 🏆"
            },
            {
              "platform": "Instagram",
              "ago": "1 week ago",
              "text": "Sunday Brunch is BACK for the season. Bottomless Aperol spritzes, fresh focaccia, eggs in purgatory, and Chef Marco's famous ricotta pancakes. Seatings at 10am & 12:30pm. Link in bio to reserve. 🥂☀️"
            },
            {
              "platform": "Google Posts",
              "ago": "2 weeks ago",
              "text": "Join us for Happy Hour Mon–Fri 5–7 PM. Half-price negronis, spritzes, and select small plates including our crowd-favorite arancini. Walk-ins welcome during happy hour."
            }
          ]
        },
        {
          "kind": "infoCards",
          "cards": [
            {
              "title": "Reservation Partners",
              "chips": [
                "OpenTable",
                "Resy"
              ]
            },
            {
              "title": "Delivery Partners",
              "chips": [
                "DoorDash",
                "Uber Eats",
                "Grubhub"
              ]
            },
            {
              "title": "Industry Memberships",
              "lines": [
                "Illinois Restaurant Association",
                "National Restaurant Association",
                "Choose Chicago Tourism Partner",
                "Certified Sustainable Seafood — Monterey Bay Aquarium"
              ]
            }
          ]
        },
        {
          "kind": "disclaimer",
          "text": "Menu items, prices, hours, and availability are subject to change without notice. Health inspection grades and permit information are sourced from the Chicago Department of Public Health and may not reflect the most current status. Dietary accommodation requests should be communicated directly to staff at time of reservation or visit — cross-contamination is possible in our kitchen. Third-party review ratings are aggregated at time of last data sync and may differ from live platform scores. Reservation availability is managed via OpenTable and Resy; this profile does not guarantee table availability."
        }
      ]
    }
  ]
} as const;
