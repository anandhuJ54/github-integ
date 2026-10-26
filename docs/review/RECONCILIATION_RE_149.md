# RECONCILIATION — RE 149-field schema pilot vs 10-ring node model

Master = node registry; Schema tab becomes its projection. Verdict per field:
KEEP = clean, becomes an RE registry node instance in the mapped ring.
FIX = linted defect; correction per docs/Schema_Projection_Correction_Spec.md.

| # | Field | property | ring | verdict |
|---|---|---|---|---|
| 1 | Full Legal Name | name | identity | KEEP |
| 2 | Preferred Display Name | alternateName | identity | KEEP |
| 3 | Agent Headline / Tagline | description | identity | KEEP |
| 4 | Profile Photo | image | identity | KEEP |
| 5 | Job Title | jobTitle | identity | KEEP |
| 6 | Agent Role / Designation Label | hasOccupation | authority | KEEP |
| 7 | Primary Email Address | email | identity | KEEP |
| 8 | Primary Phone Number | telephone | identity | KEEP |
| 9 | Mobile Phone Number | contactPoint.telephone | identity | KEEP |
| 10 | Office Phone Number | contactPoint.contactType | identity | KEEP |
| 11 | Fax Number | faxNumber | identity | KEEP |
| 12 | Office / Brokerage Address | address | location | KEEP |
| 13 | Geographic Coordinates | geo | location | FIX — B-domain: 'geo' INVALID on Person |
| 14 | Primary Service Area | areaServed | location | FIX — B-domain: 'areaServed' INVALID on Person |
| 15 | Languages Spoken | knowsLanguage | authority | KEEP |
| 16 | Gender | gender | identity | KEEP |
| 17 | Nationality | nationality | identity | KEEP |
| 18 | Birth Date | birthDate | identity | KEEP |
| 19 | Agent Vanity URL | url | presence | KEEP |
| 20 | Real Estate License Number | hasCredential.credentialId | authority | KEEP |
| 21 | License State / Jurisdiction | hasCredential.recognizedBy | authority | KEEP |
| 22 | License Type | hasCredential.credentialCategory | authority | KEEP |
| 23 | License Status | hasCredential.validFrom | authority | KEEP |
| 24 | License Expiration Date | hasCredential.validUntil | authority | KEEP |
| 25 | NAR Membership Status | memberOf.name | entity_graph | KEEP |
| 26 | REALTOR Designation | hasCredential.name | authority | KEEP |
| 27 | ABR Designation | hasCredential.name | authority | KEEP |
| 28 | CRS Designation | hasCredential.name | authority | KEEP |
| 29 | GRI Designation | hasCredential.name | authority | KEEP |
| 30 | SRS Designation | hasCredential.name | authority | KEEP |
| 31 | e-PRO Certification | hasCredential.name | authority | KEEP |
| 32 | MRP Certification | hasCredential.name | authority | KEEP |
| 33 | SRES Designation | hasCredential.name | authority | KEEP |
| 34 | Fiduciary Duty Acknowledgement | hasCredential.description | authority | KEEP |
| 35 | Dual Agency Disclosure | hasCredential.description | authority | KEEP |
| 36 | E&O Insurance Carrier | hasCredential.recognizedBy | authority | KEEP |
| 37 | Continuing Ed Hours | hasCredential.competencyRequired | authority | KEEP |
| 38 | Years Licensed | hasOccupation.experienceRequirements | authority | FIX — B-domain: 'hasOccupation' INVALID on RealEstateAgent |
| 39 | Year First Licensed | hasCredential.validFrom | authority | KEEP |
| 40 | Total Career Transactions | performTime | authority | FIX — B-domain: 'performTime' INVALID on RealEstateAgent |
| 41 | Total Career Sales Volume | priceRange | authority | FIX — C-rule#4: career/T12 metrics never use 'priceRange' — additionalProperty(PropertyValue) on business facet |
| 42 | T12 Units Sold | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 43 | T12 Sales Volume | offers.price | authority | FIX — C-rule#4: career/T12 metrics never use 'price' — additionalProperty(PropertyValue) on business facet |
| 44 | Avg Days on Market | additionalProperty.value | authority | KEEP |
| 45 | Avg List-to-Sale Ratio | additionalProperty.value | authority | KEEP |
| 46 | Buyer-Side Transactions | additionalProperty.value | authority | KEEP |
| 47 | Seller-Side Transactions | additionalProperty.value | authority | KEEP |
| 48 | Avg Sale Price | additionalProperty.value | authority | KEEP |
| 49 | Median Sale Price | additionalProperty.value | authority | KEEP |
| 50 | Relocation Cases | additionalProperty.value | authority | KEEP |
| 51 | Investment Transactions | additionalProperty.value | authority | KEEP |
| 52 | CMAs Delivered | additionalProperty.value | authority | KEEP |
| 53 | Open Houses Hosted | additionalProperty.value | authority | KEEP |
| 54 | Earnest Money Negotiations | additionalProperty.value | authority | KEEP |
| 55 | Geographic Farm ZIPs | areaServed | location | KEEP |
| 56 | Blog / Article Bylines | author | content | FIX — B-domain: 'author' INVALID on Person |
| 57 | Market Report Publications | subjectOf | content | KEEP |
| 58 | Neighborhood Guide Articles | subjectOf | content | KEEP |
| 59 | CMA Reports Published | subjectOf | content | KEEP |
| 60 | Listing Agreement Explainer | subjectOf | content | KEEP |
| 61 | Buyers Guide Publications | subjectOf | content | KEEP |
| 62 | Closing Disclosure Content | subjectOf | content | KEEP |
| 63 | Commission Transparency Post | subjectOf | content | KEEP |
| 64 | MLS Commentary Posts | subjectOf | content | KEEP |
| 65 | Investment Whitepaper | subjectOf | content | KEEP |
| 66 | Press Mentions | subjectOf | content | KEEP |
| 67 | Total Published Pieces | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 68 | Podcast Guest Appearances | subjectOf | content | KEEP |
| 69 | Podcast Host Show | creator | content | FIX — B-domain: 'creator' INVALID on Person |
| 70 | YouTube Channel URL | sameAs | presence | KEEP |
| 71 | Video Library Count | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 72 | Video Tour Productions | subjectOf | content | KEEP |
| 73 | TV Segment Appearances | subjectOf | content | KEEP |
| 74 | Radio Interviews | subjectOf | content | KEEP |
| 75 | Webinar Presentations | subjectOf | content | KEEP |
| 76 | Speaking Topics | knowsAbout | authority | KEEP |
| 77 | Conference Engagements | performerIn | content | KEEP |
| 78 | Headshot Library | image | content | KEEP |
| 79 | Virtual Tour Credits | subjectOf | content | KEEP |
| 80 | LinkedIn URL | sameAs | presence | KEEP |
| 81 | LinkedIn Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 82 | Facebook URL | sameAs | presence | KEEP |
| 83 | Facebook Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 84 | Instagram URL | sameAs | presence | KEEP |
| 85 | Instagram Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 86 | Twitter URL | sameAs | presence | KEEP |
| 87 | Twitter Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 88 | TikTok URL | sameAs | presence | KEEP |
| 89 | TikTok Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 90 | Pinterest URL | sameAs | presence | KEEP |
| 91 | Avg Engagement Rate | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 92 | Total Social Followers | interactionStatistic.userInteractionCount | engagement | FIX — C-rule#5: InteractionCounter without interactionType — ambiguous engagement |
| 93 | Aggregate Star Rating | aggregateRating.ratingValue | reputation | KEEP |
| 94 | Total Review Count | aggregateRating.reviewCount | reputation | KEEP |
| 95 | Rating Scale | aggregateRating.bestRating | reputation | KEEP |
| 96 | Verified Transaction Reviews | aggregateRating.reviewCount | reputation | KEEP |
| 97 | Review Text Buyer | review.reviewBody | reputation | KEEP |
| 98 | Review Text Seller | review.reviewBody | reputation | KEEP |
| 99 | Reviewer Name | review.author | reputation | KEEP |
| 100 | Review Date | review.datePublished | reputation | KEEP |
| 101 | Review Star Rating | review.reviewRating.ratingValue | reputation | KEEP |
| 102 | Review Source Platform | review.publisher | reputation | KEEP |
| 103 | Google Business Rating | aggregateRating.ratingValue | reputation | KEEP |
| 104 | Zillow Rating | aggregateRating.ratingValue | reputation | KEEP |
| 105 | Realtor.com Rating | aggregateRating.ratingValue | reputation | KEEP |
| 106 | Peer Referral Count | additionalProperty.value | authority | KEEP |
| 107 | NPS | additionalProperty.value | authority | KEEP |
| 108 | Review Response Rate | additionalProperty.value | authority | KEEP |
| 109 | Awards in Reviews | award | authority | KEEP |
| 110 | Parent Brokerage | worksFor | entity_graph | FIX — B-domain: 'worksFor' INVALID on RealEstateAgent |
| 111 | Brokerage Brand | parentOrganization | entity_graph | KEEP |
| 112 | Brokerage License Number | worksFor.hasCredential.credentialId | entity_graph | FIX — B-domain: 'worksFor' INVALID on RealEstateAgent |
| 113 | MLS Membership | memberOf | entity_graph | KEEP |
| 114 | Local REALTOR Assoc | memberOf | entity_graph | KEEP |
| 115 | State REALTOR Assoc | memberOf | entity_graph | KEEP |
| 116 | NAR Membership | memberOf | entity_graph | KEEP |
| 117 | Team Name | memberOf | entity_graph | KEEP |
| 118 | Team Leader | colleague | entity_graph | FIX — B-domain: 'colleague' INVALID on RealEstateAgent |
| 119 | Referral Networks | memberOf | entity_graph | KEEP |
| 120 | Relocation Network | memberOf | entity_graph | KEEP |
| 121 | CCIM Affiliation | memberOf | entity_graph | KEEP |
| 122 | Chamber of Commerce | memberOf | entity_graph | KEEP |
| 123 | Civic Memberships | memberOf | entity_graph | KEEP |
| 124 | Commission Split Structure | additionalProperty.value | authority | KEEP |
| 125 | Primary Website URL | url | presence | KEEP |
| 126 | Experience.com Profile | sameAs | presence | KEEP |
| 127 | Zillow Profile | sameAs | presence | KEEP |
| 128 | Realtor.com Profile | sameAs | presence | KEEP |
| 129 | GBP URL | sameAs | presence | KEEP |
| 130 | Homes.com Profile | sameAs | presence | KEEP |
| 131 | Trulia Profile | sameAs | presence | KEEP |
| 132 | Wikidata Entity ID | sameAs | presence | KEEP |
| 133 | Knowledge Panel Claimed | additionalProperty.value | authority | KEEP |
| 134 | SvcCat Listing/Selling | hasOfferCatalog | services | KEEP |
| 135 | SvcCat Buyer Rep | hasOfferCatalog | services | KEEP |
| 136 | SvcCat CMA | hasOfferCatalog | services | KEEP |
| 137 | SvcCat Negotiation | hasOfferCatalog | services | KEEP |
| 138 | SvcCat Open House | hasOfferCatalog | services | KEEP |
| 139 | SvcCat Transaction Mgmt | hasOfferCatalog | services | KEEP |
| 140 | SvcCat Relocation | hasOfferCatalog | services | KEEP |
| 141 | SvcCat Investment | hasOfferCatalog | services | KEEP |
| 142 | Office Hours | openingHoursSpecification | identity | KEEP |
| 143 | Active Listing URLs | makesOffer | services | KEEP |
| 144 | KnowsAbout MLS | knowsAbout | authority | KEEP |
| 145 | KnowsAbout Contracts | knowsAbout | authority | KEEP |
| 146 | KnowsAbout Escrow | knowsAbout | authority | KEEP |
| 147 | KnowsAbout RESPA | knowsAbout | authority | KEEP |
| 148 | KnowsAbout Investment | knowsAbout | authority | KEEP |
| 149 | Schema Published Flag | additionalProperty.value | authority | KEEP |

## Summary: 128 KEEP / 21 FIX of 149

## What the pilot has that the rings lacked (SALVAGE — this is the value)
- Field-level node instances w/ named sources (MLS, state_db, NAR, brokerage) — the RE registry seed
- Designation-level credential granularity (ABR/CRS/GRI/SRS/MRP/SRES as separate nodes)
- Per-platform sameAs targets and per-source ratings

## What the rings have that the pilot lacked
- Location + Services as first-class rings; DefinedTerm expertise clustering; Conversion actions
- Vocabulary/domain-range/usage gating (7 defect classes shipped ungated in the pilot)