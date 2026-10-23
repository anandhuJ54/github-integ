/**
 * sameAs domain classifier — Batch 1 + Batch 2 (built 2026-09-24)
 *
 * Purpose: given the literal text of a exp_vertical_node_registry node_slug/
 * node_name (schema_property = 'sameAs'), and given a real URL found in a
 * page's JSON-LD `sameAs` array, decide deterministically whether that URL
 * belongs to that node — WITHOUT calling an LLM.
 *
 * Why this exists: `sameAs` is a multi-value JSON-LD property. A single page
 * can list dozens of external links (LinkedIn, Facebook, BrokerCheck,
 * NAPFA, Wikidata, ...). The registry has ~23,000 distinct node_slugs across
 * all gcids that map to schema_property='sameAs', because each gcid's field
 * list was generated independently and never shares a common vocabulary
 * (e.g. "linkedin_profile_url", "linkedin_company_page", "url_linkedin",
 * "partner_linkedin_profile" all mean "LinkedIn", but are 4 different slugs).
 *
 * This file does NOT try to merge/dedupe those slugs. Each slug is still its
 * own key everywhere else in the system. This file only answers: "does this
 * slug's text reference a platform I can recognize, and if so, does this
 * specific URL belong to that platform?"
 *
 * Scope of Batch 1: built from every token that appeared >= 8 times across
 * the ~23,334 distinct active sameAs node_slugs in the live registry
 * (2026-09-24 snapshot) — this covers roughly 73% of all sameAs field
 * *usages* in the registry (43,069 of ~58,889 token occurrences), because
 * frequency directly reflects how many actual fields this will help
 * classify. Purely generic/descriptive tokens with no single fixed platform
 * behind them (e.g. "state", "entity", "locator", "dealer", "authorized",
 * "local", "board") were reviewed and deliberately left out — those slugs
 * fall through to the existing LLM fallback, which is correct: there is no
 * one fixed domain that answers "the state's licensing board" or "the local
 * food delivery marketplace" across 50 states and thousands of businesses.
 *
 * Scope of Batch 2: reviewed every token that appeared 3-7 times (~1,951
 * distinct tokens, another ~14% of usage, bringing cumulative coverage to
 * roughly 87%). Of those, added the ones that are real, identifiable
 * platforms/registries: more government agencies (SSA, OSHA, DHS, USCIS,
 * FDIC, NCUA, USPTO, FHWA, NRCS, HHS, NPS, and more), professional and
 * credentialing bodies (ASCE, ASME, ASTM, ANSI, ABET, NASBA, NAR, NAHB,
 * NAIC, NCQA, CFA Institute, and many single-vertical ones), more
 * marketplaces and directories (Rakuten, Tokopedia, JustDial, Sulekha,
 * Upwork, Coursera, Handshake, Idealist, Forbes, Bloomberg, ProPublica,
 * Wikimedia, and dozens more spanning automotive, travel, pets, food,
 * events, and hobby verticals). Skipped anything short/ambiguous enough to
 * risk a false match on an unrelated word (e.g. dropped a plain "guru" or
 * "nar" style acronym where the collision risk looked real, even though a
 * genuine platform sits behind some of those letters).
 *
 * Not done yet: the long tail below Batch 2 — tokens appearing only 1-2
 * times each (~5,966 distinct tokens, ~13% of usage) — is mostly
 * one-off/ultra-niche fragments; whether to review that tier exhaustively
 * is still an open call, not blocking on it now.
 *
 * This file makes NO network calls, reads no database, and is not wired
 * into mapSite() yet — it is a standalone, reviewable unit. Wiring it in is
 * a separate step.
 */

export interface PlatformRule {
  /** Human label, for logging/debugging only. */
  label: string;
  /**
   * Matches against the node_slug / node_name text (lowercased, underscores
   * turned to spaces) to decide "this field is asking for platform X".
   * More specific rules (e.g. linkedin company vs personal) must be listed
   * BEFORE the generic fallback rule for the same platform, since the first
   * match wins.
   */
  slugTest: RegExp;
  /**
   * Matches against an actual observed URL (from the page's real sameAs
   * array) to confirm it really is platform X before assigning it. This is
   * the guard that keeps this deterministic rather than a guess: a slug
   * mentioning "linkedin" only gets a value if some URL on the page's own
   * sameAs array actually resolves to linkedin.com.
   */
  urlTest: RegExp;
}

// Ordered: more specific rules for the same platform must come first.
export const SAMEAS_PLATFORM_RULES: PlatformRule[] = [
  // --- LinkedIn (disambiguate company vs personal from the slug text) ---
  { label: 'LinkedIn Company Page', slugTest: /linkedin.*(company|business|organi[sz]ation|school)/, urlTest: /linkedin\.com\/(company|school)\// },
  { label: 'LinkedIn Personal Profile', slugTest: /linkedin/, urlTest: /linkedin\.com\/in\// },

  // --- Global consumer social platforms ---
  { label: 'Facebook', slugTest: /facebook/, urlTest: /facebook\.com/ },
  { label: 'Instagram', slugTest: /instagram/, urlTest: /instagram\.com/ },
  { label: 'X / Twitter', slugTest: /twitter|(^|[^a-z])x[-_]?(profile|handle|page)/, urlTest: /(twitter|x)\.com/ },
  { label: 'YouTube', slugTest: /youtube/, urlTest: /youtube\.com|youtu\.be/ },
  { label: 'TikTok', slugTest: /tiktok/, urlTest: /tiktok\.com/ },
  { label: 'Pinterest', slugTest: /pinterest/, urlTest: /pinterest\.com/ },
  { label: 'Snapchat', slugTest: /snapchat/, urlTest: /snapchat\.com/ },
  { label: 'Threads', slugTest: /threads/, urlTest: /threads\.net/ },
  { label: 'Reddit', slugTest: /reddit/, urlTest: /reddit\.com/ },
  { label: 'Discord', slugTest: /discord/, urlTest: /discord\.(gg|com)/ },
  { label: 'WeChat', slugTest: /wechat/, urlTest: /wechat\.com/ },
  { label: 'Xiaohongshu / RED', slugTest: /xiaohongshu/, urlTest: /xiaohongshu\.com|xhslink\.com/ },
  { label: 'WhatsApp Business', slugTest: /whatsapp/, urlTest: /wa\.me|whatsapp\.com/ },
  { label: 'Nextdoor', slugTest: /nextdoor/, urlTest: /nextdoor\.com/ },
  { label: 'Meetup', slugTest: /meetup/, urlTest: /meetup\.com/ },
  { label: 'GitHub', slugTest: /github/, urlTest: /github\.com/ },
  { label: 'Vimeo', slugTest: /vimeo/, urlTest: /vimeo\.com/ },
  { label: 'SoundCloud', slugTest: /soundcloud/, urlTest: /soundcloud\.com/ },
  { label: 'Spotify', slugTest: /spotify/, urlTest: /spotify\.com/ },
  { label: 'Bandcamp', slugTest: /bandcamp/, urlTest: /bandcamp\.com/ },

  // --- Google / mapping ---
  { label: 'Google Business Profile', slugTest: /google.*(business|maps|profile)|gbp/, urlTest: /g\.page|business\.google\.com|goo\.gl\/maps|google\.com\/maps/ },
  { label: 'Bing', slugTest: /\bbing\b/, urlTest: /bing\.com/ },
  { label: 'OpenStreetMap', slugTest: /openstreetmap/, urlTest: /openstreetmap\.org/ },
  { label: 'Waze', slugTest: /\bwaze\b/, urlTest: /waze\.com/ },
  { label: 'MapQuest', slugTest: /mapquest/, urlTest: /mapquest\.com/ },

  // --- Reference / knowledge ---
  { label: 'Wikidata', slugTest: /wikidata/, urlTest: /wikidata\.org/ },
  { label: 'Wikipedia', slugTest: /wikipedia/, urlTest: /wikipedia\.org/ },
  { label: 'Crunchbase', slugTest: /crunchbase/, urlTest: /crunchbase\.com/ },
  { label: 'OpenCorporates', slugTest: /opencorporates/, urlTest: /opencorporates\.com/ },
  { label: 'GuideStar / Candid', slugTest: /guidestar|\bcandid\b/, urlTest: /guidestar\.org|candid\.org/ },
  { label: 'Dun & Bradstreet', slugTest: /bradstreet|d(-|&)?b\b|dnb\b/, urlTest: /dnb\.com/ },
  { label: "Hoover's", slugTest: /\bhoovers\b/, urlTest: /hoovers\.com/ },
  { label: 'Manta', slugTest: /\bmanta\b/, urlTest: /manta\.com/ },
  { label: 'ResearchGate', slugTest: /researchgate/, urlTest: /researchgate\.net/ },
  { label: 'ORCID', slugTest: /\borcid\b/, urlTest: /orcid\.org/ },
  { label: 'VIAF', slugTest: /\bviaf\b/, urlTest: /viaf\.org/ },
  { label: 'ISNI', slugTest: /\bisni\b/, urlTest: /isni\.org/ },
  { label: 'WorldCat', slugTest: /worldcat/, urlTest: /worldcat\.org/ },

  // --- Business directories / B2B marketplaces ---
  { label: 'ThomasNet', slugTest: /thomasnet|\bthomas\b/, urlTest: /thomasnet\.com/ },
  { label: 'Kompass', slugTest: /\bkompass\b/, urlTest: /kompass\.com/ },
  { label: 'GlobalSpec', slugTest: /globalspec/, urlTest: /globalspec\.com/ },
  { label: 'IndiaMART', slugTest: /indiamart/, urlTest: /indiamart\.com/ },
  { label: 'TradeIndia', slugTest: /tradeindia/, urlTest: /tradeindia\.com/ },
  { label: 'Alibaba', slugTest: /alibaba/, urlTest: /alibaba\.com/ },
  { label: 'Grainger', slugTest: /grainger/, urlTest: /grainger\.com/ },
  { label: 'Panjiva', slugTest: /panjiva/, urlTest: /panjiva\.com/ },
  { label: 'Better Business Bureau', slugTest: /\bbbb\b|better business bureau/, urlTest: /bbb\.org/ },

  // --- Legal directories ---
  { label: 'Avvo', slugTest: /\bavvo\b/, urlTest: /avvo\.com/ },
  { label: 'Martindale-Hubbell', slugTest: /martindale/, urlTest: /martindale\.com/ },
  { label: 'Justia', slugTest: /\bjustia\b/, urlTest: /justia\.com/ },
  { label: 'FindLaw', slugTest: /findlaw/, urlTest: /findlaw\.com/ },
  { label: 'Lawyers.com', slugTest: /lawyerscom|lawyers\.com/, urlTest: /lawyers\.com/ },

  // --- Real estate / property ---
  { label: 'Zillow', slugTest: /zillow/, urlTest: /zillow\.com/ },
  { label: 'Realtor.com', slugTest: /realtorcom|realtor\.com/, urlTest: /realtor\.com/ },
  { label: 'LoopNet', slugTest: /loopnet/, urlTest: /loopnet\.com/ },
  { label: 'CoStar', slugTest: /\bcostar\b/, urlTest: /costar\.com/ },
  { label: 'Crexi', slugTest: /\bcrexi\b/, urlTest: /crexi\.com/ },
  { label: 'Apartments.com', slugTest: /apartmentscom|apartments\.com/, urlTest: /apartments\.com/ },

  // --- Automotive ---
  { label: 'CarGurus', slugTest: /cargurus/, urlTest: /cargurus\.com/ },
  { label: 'Carfax', slugTest: /carfax/, urlTest: /carfax\.com/ },
  { label: 'Cars.com', slugTest: /carscom|cars\.com/, urlTest: /cars\.com/ },
  { label: 'Autotrader', slugTest: /autotrader/, urlTest: /autotrader\.com/ },
  { label: 'DealerRater', slugTest: /dealerrater/, urlTest: /dealerrater\.com/ },
  { label: 'NADA / J.D. Power', slugTest: /\bnada\b/, urlTest: /nada\.org|jdpower\.com/ },
  { label: 'RepairPal', slugTest: /repairpal/, urlTest: /repairpal\.com/ },
  { label: 'AutoMD', slugTest: /automd/, urlTest: /automd\.com/ },
  { label: 'DealerSocket', slugTest: /dealersocket/, urlTest: /dealersocket\.com/ },
  { label: 'Dealer.com', slugTest: /dealercom/, urlTest: /dealer\.com/ },

  // --- Healthcare ---
  { label: 'Healthgrades', slugTest: /healthgrades/, urlTest: /healthgrades\.com/ },
  { label: 'Vitals', slugTest: /\bvitals(com)?\b/, urlTest: /vitals\.com/ },
  { label: 'Zocdoc', slugTest: /zocdoc/, urlTest: /zocdoc\.com/ },
  { label: 'WebMD', slugTest: /webmd/, urlTest: /webmd\.com/ },
  { label: 'RateMDs', slugTest: /ratemds/, urlTest: /ratemds\.com/ },
  { label: 'Doximity', slugTest: /doximity/, urlTest: /doximity\.com/ },
  { label: 'NPI / NPPES Registry', slugTest: /\bnpi\b|nppes/, urlTest: /npiregistry\.cms\.hhs\.gov|nppes\.cms\.hhs\.gov/ },
  { label: 'Medicare.gov', slugTest: /medicare/, urlTest: /medicare\.gov/ },
  { label: 'Medicaid.gov', slugTest: /medicaid/, urlTest: /medicaid\.gov/ },

  // --- Pet ---
  { label: 'Petfinder', slugTest: /petfinder/, urlTest: /petfinder\.com/ },
  { label: 'American Kennel Club', slugTest: /\bakc\b/, urlTest: /akc\.org/ },
  { label: 'Rover', slugTest: /\brover\b/, urlTest: /rover\.com/ },
  { label: 'Wag!', slugTest: /\bwag\b/, urlTest: /wagwalking\.com/ },

  // --- Food / restaurant ---
  { label: 'OpenTable', slugTest: /opentable/, urlTest: /opentable\.com/ },
  { label: 'DoorDash', slugTest: /doordash/, urlTest: /doordash\.com/ },
  { label: 'Uber Eats', slugTest: /ubereats|uber.*eats/, urlTest: /ubereats\.com/ },
  { label: 'Grubhub', slugTest: /grubhub/, urlTest: /grubhub\.com/ },
  { label: 'Resy', slugTest: /\bresy\b/, urlTest: /resy\.com/ },
  { label: 'TheFork', slugTest: /thefork/, urlTest: /thefork\.com/ },
  { label: 'Tock', slugTest: /\btock\b/, urlTest: /exploretock\.com/ },
  { label: 'Zomato', slugTest: /zomato/, urlTest: /zomato\.com/ },
  { label: 'Michelin Guide', slugTest: /michelin/, urlTest: /guide\.michelin\.com/ },
  { label: 'Zagat', slugTest: /\bzagat\b/, urlTest: /zagat\.com/ },
  { label: 'The Infatuation', slugTest: /infatuation/, urlTest: /theinfatuation\.com/ },
  { label: 'Eater', slugTest: /\beater\b/, urlTest: /eater\.com/ },
  { label: 'Deliveroo', slugTest: /deliveroo/, urlTest: /deliveroo\.(com|co\.uk)/ },
  { label: 'ezCater', slugTest: /ezcater/, urlTest: /ezcater\.com/ },
  { label: 'GoFood', slugTest: /gofood/, urlTest: /gofood\.co\.id/ },
  { label: 'Swiggy', slugTest: /swiggy/, urlTest: /swiggy\.com/ },
  { label: 'foodpanda', slugTest: /foodpanda/, urlTest: /foodpanda\./ },
  { label: 'HappyCow', slugTest: /happycow/, urlTest: /happycow\.net/ },

  // --- Travel / hospitality ---
  { label: 'TripAdvisor', slugTest: /tripadvisor/, urlTest: /tripadvisor\.com/ },
  { label: 'Booking.com', slugTest: /bookingcom|booking\.com/, urlTest: /booking\.com/ },
  { label: 'Expedia', slugTest: /expedia/, urlTest: /expedia\.com/ },
  { label: 'Airbnb', slugTest: /airbnb/, urlTest: /airbnb\.com/ },
  { label: 'Vrbo', slugTest: /\bvrbo\b/, urlTest: /vrbo\.com/ },
  { label: 'Viator', slugTest: /\bviator\b/, urlTest: /viator\.com/ },
  { label: 'GetYourGuide', slugTest: /getyourguide/, urlTest: /getyourguide\.com/ },
  { label: 'Hipcamp', slugTest: /hipcamp/, urlTest: /hipcamp\.com/ },
  { label: 'HomeAway', slugTest: /homeaway/, urlTest: /homeaway\.com/ },
  { label: 'Recreation.gov', slugTest: /recreationgov/, urlTest: /recreation\.gov/ },

  // --- Home services / contractors ---
  { label: 'Angi', slugTest: /\bangi(es)?\b/, urlTest: /angi\.com|angieslist\.com/ },
  { label: 'HomeAdvisor', slugTest: /homeadvisor/, urlTest: /homeadvisor\.com/ },
  { label: 'Houzz', slugTest: /houzz/, urlTest: /houzz\.com/ },
  { label: 'Thumbtack', slugTest: /thumbtack/, urlTest: /thumbtack\.com/ },
  { label: 'Checkatrade', slugTest: /checkatrade/, urlTest: /checkatrade\.com/ },
  { label: 'BuildZoom', slugTest: /buildzoom/, urlTest: /buildzoom\.com/ },

  // --- Reviews (general) ---
  { label: 'Yelp', slugTest: /\byelp\b/, urlTest: /yelp\.com/ },
  { label: 'Trustpilot', slugTest: /trustpilot/, urlTest: /trustpilot\.com/ },
  { label: 'Capterra', slugTest: /capterra/, urlTest: /capterra\.com/ },
  { label: 'UpCity', slugTest: /upcity/, urlTest: /upcity\.com/ },
  { label: 'Clutch', slugTest: /\bclutchco\b|\bclutch\b/, urlTest: /clutch\.co/ },
  { label: 'Foursquare', slugTest: /foursquare/, urlTest: /foursquare\.com/ },

  // --- Media / entertainment / events ---
  { label: 'IMDb', slugTest: /\bimdb\b/, urlTest: /imdb\.com/ },
  { label: 'Discogs', slugTest: /discogs/, urlTest: /discogs\.com/ },
  { label: 'AllMusic', slugTest: /allmusic/, urlTest: /allmusic\.com/ },
  { label: 'Songkick', slugTest: /songkick/, urlTest: /songkick\.com/ },
  { label: 'Bandsintown', slugTest: /bandsintown/, urlTest: /bandsintown\.com/ },
  { label: 'Eventbrite', slugTest: /eventbrite/, urlTest: /eventbrite\.com/ },
  { label: 'Ticketmaster', slugTest: /ticketmaster/, urlTest: /ticketmaster\.com/ },
  { label: 'StubHub', slugTest: /stubhub/, urlTest: /stubhub\.com/ },

  // --- Sports / fitness / classes ---
  { label: 'Strava', slugTest: /strava/, urlTest: /strava\.com/ },
  { label: 'ClassPass', slugTest: /classpass/, urlTest: /classpass\.com/ },
  { label: 'MINDBODY', slugTest: /mindbody/, urlTest: /mindbodyonline\.com/ },
  { label: 'TeamSnap', slugTest: /teamsnap/, urlTest: /teamsnap\.com/ },
  { label: 'SportsEngine', slugTest: /sportsengine/, urlTest: /sportsengine\.com/ },
  { label: 'ACTIVE Network', slugTest: /activenetwork|activecom|\bactive\b.*network/, urlTest: /active\.com/ },

  // --- E-commerce / marketplaces ---
  { label: 'Etsy', slugTest: /\betsy\b/, urlTest: /etsy\.com/ },
  { label: 'eBay', slugTest: /\bebay\b/, urlTest: /ebay\.com/ },
  { label: 'Amazon', slugTest: /amazon/, urlTest: /amazon\.com/ },
  { label: 'Shopify', slugTest: /shopify/, urlTest: /myshopify\.com|shopify\.com/ },
  { label: 'Poshmark', slugTest: /poshmark/, urlTest: /poshmark\.com/ },
  { label: 'Mercari', slugTest: /mercari/, urlTest: /mercari\.com/ },
  { label: 'Wayfair', slugTest: /wayfair/, urlTest: /wayfair\.com/ },
  { label: 'Alibaba (com)', slugTest: /alibabacom/, urlTest: /alibaba\.com/ },
  { label: 'Instacart', slugTest: /instacart/, urlTest: /instacart\.com/ },
  { label: 'Groupon', slugTest: /groupon/, urlTest: /groupon\.com/ },

  // --- Financial-advisor-specific directories (financial_advisor pilot) ---
  { label: 'FINRA BrokerCheck', slugTest: /brokercheck|finra/, urlTest: /brokercheck\.finra\.org/ },
  { label: 'SEC IAPD / Adviser Info', slugTest: /\biapd\b|adviserinfo/, urlTest: /adviserinfo\.sec\.gov/ },
  { label: 'SEC EDGAR', slugTest: /\bedgar\b|sec.*edgar/, urlTest: /sec\.gov\/cgi-bin\/browse-edgar|sec\.gov\/edgar/ },
  { label: 'NAPFA', slugTest: /\bnapfa\b/, urlTest: /napfa\.org/ },
  { label: 'CFP Board', slugTest: /cfp.*board/, urlTest: /cfp\.net/ },
  { label: 'SmartAsset', slugTest: /smartasset/, urlTest: /smartasset\.com/ },
  { label: 'WiserAdvisor', slugTest: /wiseradvisor/, urlTest: /wiseradvisor\.com/ },
  { label: 'XY Planning Network', slugTest: /\bxypn\b|xyplanningnetwork/, urlTest: /xyplanningnetwork\.com/ },
  { label: 'Garrett Planning Network', slugTest: /garrett.*planning/, urlTest: /garrettplanningnetwork\.com/ },
  { label: 'Wealthtender', slugTest: /wealthtender/, urlTest: /wealthtender\.com/ },
  { label: 'AICPA', slugTest: /\baicpa\b/, urlTest: /aicpa(-cima)?\.org/ },
  { label: 'NMLS Consumer Access', slugTest: /\bnmls\b/, urlTest: /nmlsconsumeraccess\.org/ },

  // --- Government / regulatory registries (used as sameAs / verification links) ---
  { label: 'IRS', slugTest: /\birs\b/, urlTest: /irs\.gov/ },
  { label: 'SEC', slugTest: /\bsec\b(?!.*edgar)(?!.*iapd)/, urlTest: /sec\.gov/ },
  { label: 'EPA', slugTest: /\bepa\b/, urlTest: /epa\.gov/ },
  { label: 'FDA', slugTest: /\bfda\b/, urlTest: /fda\.gov/ },
  { label: 'USDA', slugTest: /\busda\b/, urlTest: /usda\.gov/ },
  { label: 'DMV (state)', slugTest: /\bdmv\b/, urlTest: /dmv\.[a-z]{2}\.gov|dmv\.gov/ },
  { label: 'FMCSA SAFER', slugTest: /fmcsa|\bsafer\b/, urlTest: /safer\.fmcsa\.dot\.gov/ },
  { label: 'FAA', slugTest: /\bfaa\b/, urlTest: /faa\.gov/ },
  { label: 'CMS.gov', slugTest: /\bcms\b/, urlTest: /cms\.gov/ },
  { label: 'HUD', slugTest: /\bhud\b/, urlTest: /hud\.gov/ },
  { label: 'FCC', slugTest: /\bfcc\b/, urlTest: /fcc\.gov/ },
  { label: 'SAM.gov', slugTest: /samgov|\bsam\b.*gov/, urlTest: /sam\.gov/ },
  { label: 'Data.gov', slugTest: /datagov/, urlTest: /data\.gov/ },
  { label: 'CBP', slugTest: /\bcbp\b/, urlTest: /cbp\.gov/ },
  { label: 'FSIS (USDA)', slugTest: /\bfsis\b/, urlTest: /fsis\.usda\.gov/ },
  { label: 'USPS', slugTest: /\busps\b/, urlTest: /usps\.com/ },
  { label: 'ATF', slugTest: /\batf\b/, urlTest: /atf\.gov/ },
  { label: 'US DOT', slugTest: /\bdot\b/, urlTest: /transportation\.gov|dot\.gov/ },
  { label: 'APHIS (USDA)', slugTest: /\baphis\b/, urlTest: /aphis\.usda\.gov/ },
  { label: 'CDC', slugTest: /\bcdc\b/, urlTest: /cdc\.gov/ },
  { label: 'FEMA', slugTest: /\bfema\b/, urlTest: /fema\.gov/ },
  { label: 'FinCEN', slugTest: /fincen/, urlTest: /fincen\.gov/ },
  { label: 'TTB', slugTest: /\bttb\b/, urlTest: /ttb\.gov/ },
  { label: 'NHTSA', slugTest: /nhtsa/, urlTest: /nhtsa\.gov/ },
  { label: 'MSHA', slugTest: /\bmsha\b/, urlTest: /msha\.gov/ },
  { label: 'HRSA', slugTest: /\bhrsa\b/, urlTest: /hrsa\.gov/ },
  { label: 'ITAR / DDTC', slugTest: /\bitar\b|\bddtc\b/, urlTest: /pmddtc\.state\.gov/ },
  { label: 'DOI (Dept of Interior)', slugTest: /\bdoi\b/, urlTest: /doi\.gov/ },
  { label: 'GSA', slugTest: /\bgsa\b/, urlTest: /gsa\.gov/ },
  { label: 'BIS (Bureau of Industry & Security)', slugTest: /\bbis\b/, urlTest: /bis\.doc\.gov/ },
  { label: 'DEA', slugTest: /\bdea\b/, urlTest: /dea\.gov/ },
  { label: 'NRC (Nuclear Regulatory)', slugTest: /\bnrc\b/, urlTest: /nrc\.gov/ },
  { label: 'NOAA', slugTest: /\bnoaa\b/, urlTest: /noaa\.gov/ },
  { label: 'DOL (Dept of Labor)', slugTest: /\bdol\b/, urlTest: /dol\.gov/ },
  { label: 'CFPB', slugTest: /\bcfpb\b/, urlTest: /consumerfinance\.gov/ },

  // --- Education ---
  { label: 'NCES', slugTest: /\bnces\b/, urlTest: /nces\.ed\.gov/ },
  { label: 'IPEDS', slugTest: /ipeds/, urlTest: /nces\.ed\.gov\/ipeds/ },
  { label: "Niche.com", slugTest: /nichecom/, urlTest: /niche\.com/ },
  { label: "Peterson's", slugTest: /petersons/, urlTest: /petersons\.com/ },

  // --- Misc recognizable platforms seen in the freq>=8 list ---
  { label: 'Alltrails', slugTest: /alltrails/, urlTest: /alltrails\.com/ },
  { label: 'Craigslist', slugTest: /craigslist/, urlTest: /craigslist\.org/ },
  { label: 'Glassdoor', slugTest: /glassdoor/, urlTest: /glassdoor\.com/ },
  { label: 'Indeed', slugTest: /\bindeed\b/, urlTest: /indeed\.com/ },

  // ============================================================
  // Batch 2 (freq 3-7 tier) additions below
  // ============================================================

  // --- More government / regulatory agencies ---
  { label: 'FTC', slugTest: /\bftc\b/, urlTest: /ftc\.gov/ },
  { label: 'SSA (Social Security Administration)', slugTest: /\bssa\b/, urlTest: /ssa\.gov/ },
  { label: 'OSHA', slugTest: /\bosha\b/, urlTest: /osha\.gov/ },
  { label: 'DHS', slugTest: /\bdhs\b/, urlTest: /dhs\.gov/ },
  { label: 'USCIS', slugTest: /uscis/, urlTest: /uscis\.gov/ },
  { label: 'FDIC', slugTest: /\bfdic\b/, urlTest: /fdic\.gov/ },
  { label: 'NCUA', slugTest: /\bncua\b/, urlTest: /ncua\.gov/ },
  { label: 'USPTO', slugTest: /uspto/, urlTest: /uspto\.gov/ },
  { label: 'FHWA', slugTest: /\bfhwa\b/, urlTest: /fhwa\.dot\.gov/ },
  { label: 'NRCS (USDA)', slugTest: /\bnrcs\b/, urlTest: /nrcs\.usda\.gov/ },
  { label: 'HHS', slugTest: /\bhhs\b/, urlTest: /hhs\.gov/ },
  { label: 'National Park Service', slugTest: /\bnps\b/, urlTest: /nps\.gov/ },
  { label: 'CITES', slugTest: /\bcites\b/, urlTest: /cites\.org/ },
  { label: 'GBIF', slugTest: /\bgbif\b/, urlTest: /gbif\.org/ },
  { label: 'USAJobs', slugTest: /usajobs/, urlTest: /usajobs\.gov/ },
  { label: 'VA.gov', slugTest: /vagov/, urlTest: /va\.gov/ },
  { label: 'USAspending.gov', slugTest: /usaspendinggov/, urlTest: /usaspending\.gov/ },
  { label: 'Govinfo.gov', slugTest: /govinfogov/, urlTest: /govinfo\.gov/ },
  { label: 'GOV.UK', slugTest: /govuk/, urlTest: /gov\.uk/ },

  // --- Consumer finance ---
  { label: 'NerdWallet', slugTest: /nerdwallet/, urlTest: /nerdwallet\.com/ },
  { label: 'LendingTree', slugTest: /lendingtree/, urlTest: /lendingtree\.com/ },

  // --- Professional / credentialing bodies ---
  { label: 'ABMS', slugTest: /\babms\b/, urlTest: /abms\.org/ },
  { label: 'ASCE', slugTest: /\basce\b/, urlTest: /asce\.org/ },
  { label: 'ASME', slugTest: /\basme\b/, urlTest: /asme\.org/ },
  { label: 'ASTM International', slugTest: /\bastm\b/, urlTest: /astm\.org/ },
  { label: 'ANSI', slugTest: /\bansi\b/, urlTest: /ansi\.org/ },
  { label: 'ABET', slugTest: /\babet\b/, urlTest: /abet\.org/ },
  { label: 'NASBA', slugTest: /\bnasba\b/, urlTest: /nasba\.org/ },
  { label: 'ICAEW', slugTest: /icaew/, urlTest: /icaew\.com/ },
  { label: 'National Association of Realtors', slugTest: /\bnar\b/, urlTest: /nar\.realtor/ },
  { label: 'NAHB', slugTest: /\bnahb\b/, urlTest: /nahb\.org/ },
  { label: 'NAIC', slugTest: /\bnaic\b/, urlTest: /naic\.org/ },
  { label: 'NCQA', slugTest: /\bncqa\b/, urlTest: /ncqa\.org/ },
  { label: 'NREMT', slugTest: /nremt/, urlTest: /nremt\.org/ },
  { label: 'ASHA', slugTest: /\basha\b/, urlTest: /asha\.org/ },
  { label: 'AOTA', slugTest: /\baota\b/, urlTest: /aota\.org/ },
  { label: 'APTA', slugTest: /\bapta\b/, urlTest: /apta\.org/ },
  { label: 'ASCO', slugTest: /\basco\b/, urlTest: /asco\.org/ },
  { label: 'AAOS', slugTest: /\baaos\b/, urlTest: /aaos\.org/ },
  { label: 'ABOG', slugTest: /\babog\b/, urlTest: /abog\.org/ },
  { label: 'ABPN', slugTest: /\babpn\b/, urlTest: /abpn\.com/ },
  { label: 'American College of Physicians', slugTest: /\bacp\b/, urlTest: /acponline\.org/ },
  { label: 'AUA (Urological Association)', slugTest: /\baua\b/, urlTest: /auanet\.org/ },
  { label: 'ASPS (Plastic Surgeons)', slugTest: /\basps\b/, urlTest: /plasticsurgery\.org/ },
  { label: 'AANP', slugTest: /\baanp\b/, urlTest: /aanp\.org/ },
  { label: 'APMA (Podiatric)', slugTest: /\bapma\b/, urlTest: /apma\.org/ },
  { label: 'AQHA', slugTest: /\baqha\b/, urlTest: /aqha\.com/ },
  { label: 'USGA', slugTest: /\busga\b/, urlTest: /usga\.org/ },
  { label: 'ACEC', slugTest: /\bacec\b/, urlTest: /acec\.org/ },
  { label: 'AGC (Associated General Contractors)', slugTest: /\bagc\b/, urlTest: /agc\.org/ },
  { label: 'BOMA', slugTest: /\bboma\b/, urlTest: /boma\.org/ },
  { label: 'NARI', slugTest: /\bnari\b/, urlTest: /nari\.org/ },
  { label: 'AZA', slugTest: /\baza\b/, urlTest: /aza\.org/ },
  { label: 'ICMA', slugTest: /\bicma\b/, urlTest: /icma\.org/ },
  { label: 'NALP', slugTest: /\bnalp\b/, urlTest: /nalp\.org/ },
  { label: 'AILA', slugTest: /\baila\b/, urlTest: /aila\.org/ },
  { label: 'NAIFA', slugTest: /naifa/, urlTest: /naifa\.org/ },
  { label: 'NBCC (Counselors)', slugTest: /\bnbcc\b/, urlTest: /nbcc\.org/ },
  { label: 'SHRM', slugTest: /\bshrm\b/, urlTest: /shrm\.org/ },
  { label: 'CFA Institute', slugTest: /\bcfa\b/, urlTest: /cfainstitute\.org/ },
  { label: 'ASID', slugTest: /\basid\b/, urlTest: /asid\.org/ },
  { label: 'ASHRAE', slugTest: /ashrae/, urlTest: /ashrae\.org/ },
  { label: 'ALOA (Locksmiths)', slugTest: /\baloa\b/, urlTest: /aloa\.org/ },
  { label: 'NSCA', slugTest: /\bnsca\b/, urlTest: /nsca\.com/ },
  { label: 'NKBA', slugTest: /\bnkba\b/, urlTest: /nkba\.org/ },
  { label: 'PPA (Professional Photographers)', slugTest: /\bppa\b/, urlTest: /ppa\.com/ },
  { label: 'NFDA (Funeral Directors)', slugTest: /\bnfda\b/, urlTest: /nfda\.org/ },
  { label: 'NBAA (Business Aviation)', slugTest: /\bnbaa\b/, urlTest: /nbaa\.org/ },
  { label: 'NCBTMB (Massage Therapy)', slugTest: /ncbtmb/, urlTest: /ncbtmb\.org/ },
  { label: 'ABMP (Massage & Bodywork)', slugTest: /\babmp\b/, urlTest: /abmp\.com/ },
  { label: 'RESNA', slugTest: /\bresna\b/, urlTest: /resna\.org/ },
  { label: 'NIADA', slugTest: /niada/, urlTest: /niada\.com/ },

  // --- Real estate / property (more) ---
  { label: 'ApartmentList', slugTest: /apartmentlist/, urlTest: /apartmentlist\.com/ },
  { label: 'NewHomeSource', slugTest: /newhomesource/, urlTest: /newhomesource\.com/ },
  { label: 'BizBuySell', slugTest: /bizbuysell/, urlTest: /bizbuysell\.com/ },

  // --- Automotive (more) ---
  { label: 'Edmunds', slugTest: /edmunds/, urlTest: /edmunds\.com/ },
  { label: 'CarWise', slugTest: /carwise/, urlTest: /carwise\.com/ },
  { label: 'RockAuto', slugTest: /rockauto/, urlTest: /rockauto\.com/ },
  { label: 'Car Talk', slugTest: /cartalk/, urlTest: /cartalk\.com/ },
  { label: 'CycleTrader', slugTest: /cycletrader/, urlTest: /cycletrader\.com/ },
  { label: 'TractorHouse', slugTest: /tractorhouse/, urlTest: /tractorhouse\.com/ },
  { label: 'TruckPaper', slugTest: /truckpaper/, urlTest: /truckpaper\.com/ },
  { label: 'Trade-A-Plane', slugTest: /trade-a-plane/, urlTest: /trade-a-plane\.com/ },
  { label: 'Hemmings', slugTest: /hemmings/, urlTest: /hemmings\.com/ },
  { label: 'MHVillage', slugTest: /mhvillage/, urlTest: /mhvillage\.com/ },
  { label: 'Motors.co.uk', slugTest: /motorscouk/, urlTest: /motors\.co\.uk/ },
  { label: 'Car-Part.com', slugTest: /car-partcom/, urlTest: /car-part\.com/ },
  { label: 'Controller.com', slugTest: /controllercom/, urlTest: /controller\.com/ },
  { label: 'GovPlanet', slugTest: /govplanet/, urlTest: /govplanet\.com/ },
  { label: 'Ritchie Bros', slugTest: /\britchie\b/, urlTest: /ritchiebros\.com/ },
  { label: 'iBoats', slugTest: /iboats/, urlTest: /iboats\.com/ },
  { label: 'AirNav', slugTest: /airnav/, urlTest: /airnav\.com/ },
  { label: 'SkyVector', slugTest: /skyvector/, urlTest: /skyvector\.com/ },
  { label: 'ForeFlight', slugTest: /foreflight/, urlTest: /foreflight\.com/ },
  { label: 'ActiveCaptain', slugTest: /activecaptain/, urlTest: /activecaptain\.garmin\.com/ },
  { label: 'Dockwa', slugTest: /dockwa/, urlTest: /dockwa\.com/ },
  { label: 'EquineNow', slugTest: /equinenow/, urlTest: /equinenow\.com/ },
  { label: 'Equine.com', slugTest: /equinecom/, urlTest: /equine\.com/ },

  // --- Marketplaces / e-commerce / services (more) ---
  { label: '1stDibs', slugTest: /1stdibs/, urlTest: /1stdibs\.com/ },
  { label: 'AbeBooks', slugTest: /abebooks/, urlTest: /abebooks\.com/ },
  { label: 'Bookshop.org', slugTest: /bookshoporg/, urlTest: /bookshop\.org/ },
  { label: 'Rakuten', slugTest: /rakuten/, urlTest: /rakuten\.com/ },
  { label: 'Tokopedia', slugTest: /tokopedia/, urlTest: /tokopedia\.com/ },
  { label: 'JustDial', slugTest: /justdial/, urlTest: /justdial\.com/ },
  { label: 'Sulekha', slugTest: /sulekha/, urlTest: /sulekha\.com/ },
  { label: 'Made-in-China.com', slugTest: /made-in-china/, urlTest: /made-in-china\.com/ },
  { label: 'Global Sources', slugTest: /globalsources/, urlTest: /globalsources\.com/ },
  { label: 'IndustryNet', slugTest: /industrynet/, urlTest: /industrynet\.com/ },
  { label: 'Octopart', slugTest: /octopart/, urlTest: /octopart\.com/ },
  { label: 'Alignable', slugTest: /alignable/, urlTest: /alignable\.com/ },
  { label: 'Bark.com', slugTest: /barkcom/, urlTest: /bark\.com/ },
  { label: 'Upwork', slugTest: /upwork/, urlTest: /upwork\.com/ },
  { label: 'Skillshare', slugTest: /skillshare/, urlTest: /skillshare\.com/ },
  { label: 'Udemy', slugTest: /udemy/, urlTest: /udemy\.com/ },
  { label: 'Coursera', slugTest: /coursera/, urlTest: /coursera\.org/ },
  { label: 'Handshake', slugTest: /handshake/, urlTest: /joinhandshake\.com/ },
  { label: 'Idealist', slugTest: /idealistorg|\bidealist\b/, urlTest: /idealist\.org/ },
  { label: 'GreatNonprofits', slugTest: /greatnonprofits/, urlTest: /greatnonprofits\.org/ },
  { label: 'FindHelp.org', slugTest: /findhelporg/, urlTest: /findhelp\.org/ },
  { label: 'GoodFirms', slugTest: /goodfirms/, urlTest: /goodfirms\.co/ },
  { label: 'Dribbble', slugTest: /dribbble/, urlTest: /dribbble\.com/ },
  { label: 'Saatchi Art', slugTest: /\bsaatchi\b/, urlTest: /saatchiart\.com/ },
  { label: 'ArchDaily', slugTest: /archdaily/, urlTest: /archdaily\.com/ },
  { label: 'Dezeen', slugTest: /dezeen/, urlTest: /dezeen\.com/ },
  { label: 'Time Out', slugTest: /timeout/, urlTest: /timeout\.com/ },
  { label: 'Forbes', slugTest: /forbes/, urlTest: /forbes\.com/ },
  { label: 'Bloomberg', slugTest: /bloomberg/, urlTest: /bloomberg\.com/ },
  { label: 'ProPublica', slugTest: /propublica/, urlTest: /propublica\.org/ },
  { label: 'Wikimedia', slugTest: /wikimedia/, urlTest: /wikimedia\.org/ },
  { label: 'DBpedia', slugTest: /dbpedia/, urlTest: /dbpedia\.org/ },
  { label: 'Europeana', slugTest: /europeana/, urlTest: /europeana\.eu/ },
  { label: 'eBird', slugTest: /ebird/, urlTest: /ebird\.org/ },
  { label: 'RateBeer', slugTest: /ratebeer/, urlTest: /ratebeer\.com/ },
  { label: 'BeerAdvocate', slugTest: /beeradvocate/, urlTest: /beeradvocate\.com/ },
  { label: 'BoardGameGeek', slugTest: /boardgamegeek/, urlTest: /boardgamegeek\.com/ },
  { label: 'Letterboxd', slugTest: /letterboxd/, urlTest: /letterboxd\.com/ },
  { label: 'Chess.com', slugTest: /chesscom/, urlTest: /chess\.com/ },
  { label: 'AudiogoN', slugTest: /audiogon/, urlTest: /audiogon\.com/ },
  { label: 'SeatGeek', slugTest: /seatgeek/, urlTest: /seatgeek\.com/ },
  { label: 'Recreation Reservations (ReserveAmerica)', slugTest: /reserveamerica/, urlTest: /reserveamerica\.com/ },
  { label: 'KOA', slugTest: /\bkoa\b/, urlTest: /koa\.com/ },
  { label: 'RVshare', slugTest: /rvshare/, urlTest: /rvshare\.com/ },
  { label: 'LocalHarvest', slugTest: /localharvest/, urlTest: /localharvest\.org/ },
  { label: 'EnergySage', slugTest: /energysage/, urlTest: /energysage\.com/ },
  { label: 'Goldbelly', slugTest: /goldbelly/, urlTest: /goldbelly\.com/ },
  { label: 'HalalTrip', slugTest: /halaltrip/, urlTest: /halaltrip\.com/ },
  { label: 'Hitched', slugTest: /hitched/, urlTest: /hitched\.co\.uk/ },
  { label: 'Bridebook', slugTest: /bridebook/, urlTest: /bridebook\.co\.uk/ },
  { label: 'Treatwell', slugTest: /treatwell/, urlTest: /treatwell\.com/ },
  { label: 'Fresha', slugTest: /fresha/, urlTest: /fresha\.com/ },
  { label: 'MassageBook', slugTest: /massagebook/, urlTest: /massagebook\.com/ },
  { label: 'CourtReserve', slugTest: /courtreserve/, urlTest: /courtreserve\.com/ },
  { label: 'CourseHorse', slugTest: /coursehorse/, urlTest: /coursehorse\.com/ },
  { label: 'Adopt-a-Pet.com', slugTest: /adopt-a-pet/, urlTest: /adoptapet\.com/ },
  { label: 'RealSelf', slugTest: /realself/, urlTest: /realself\.com/ },
  { label: 'Caring.com', slugTest: /caringcom/, urlTest: /caring\.com/ },
  { label: 'GreatSchools', slugTest: /greatschools/, urlTest: /greatschools\.org/ },
  { label: 'SchoolDigger', slugTest: /schooldigger/, urlTest: /schooldigger\.com/ },
  { label: 'Insurify', slugTest: /insurify/, urlTest: /insurify\.com/ },
  { label: 'Insurance.com', slugTest: /insurancecom/, urlTest: /insurance\.com/ },
  { label: 'Yellowpages.com', slugTest: /yellowpages|yellcom/, urlTest: /yellowpages\.com|yell\.com/ },
  { label: '500px', slugTest: /500px/, urlTest: /500px\.com/ },
  { label: 'Fandango', slugTest: /fandango/, urlTest: /fandango\.com/ },
  { label: 'FashionGo', slugTest: /fashiongo/, urlTest: /fashiongo\.net/ },
  { label: 'Dutchie', slugTest: /dutchie/, urlTest: /dutchie\.com/ },
  { label: 'KakaoTalk', slugTest: /kakaotalk/, urlTest: /kakao\.com|pf\.kakao\.com/ },
  { label: 'Naver', slugTest: /\bnaver\b/, urlTest: /naver\.com/ },
  { label: 'italki', slugTest: /italki/, urlTest: /italki\.com/ },
  { label: 'IslamicFinder', slugTest: /islamicfinder/, urlTest: /islamicfinder\.org/ },
  { label: 'Zabihah', slugTest: /zabihah/, urlTest: /zabihah\.com/ },
  { label: 'YMCA', slugTest: /\bymca\b/, urlTest: /ymca\.net/ },
  { label: 'Superpages', slugTest: /superpages/, urlTest: /superpages\.com/ },
  { label: 'Teleflora', slugTest: /teleflora/, urlTest: /teleflora\.com/ },
  { label: 'Sittercity', slugTest: /sittercity/, urlTest: /sittercity\.com/ },
  { label: 'uShip', slugTest: /uship/, urlTest: /uship\.com/ },
];

/**
 * Given a node_slug (and optionally node_name) from the registry, and the
 * list of sameAs URLs actually found on a page, decide deterministically
 * whether this field is one we recognize, and if so, whether this specific
 * page carries it.
 *
 * Three distinct outcomes, all meaningfully different:
 * - { recognized: false } — this slug's text doesn't match any known
 *   platform. Caller should fall through to the LLM fallback, same as any
 *   other unresolved field.
 * - { recognized: true, url: null, platform } — we know exactly which
 *   platform this field wants, and we positively confirmed this page's own
 *   sameAs values do NOT include it. This is a real, confident "not found",
 *   not a gap — the caller should NOT ask the LLM about it.
 * - { recognized: true, url, platform } — found it.
 */
export type SameAsClassification =
  | { recognized: false }
  | { recognized: true; url: string | null; platform: string };

export function classifySameAs(
  nodeSlugOrName: string,
  candidateUrls: string[],
): SameAsClassification {
  const haystack = nodeSlugOrName.toLowerCase().replace(/[_-]+/g, ' ');
  for (const rule of SAMEAS_PLATFORM_RULES) {
    if (rule.slugTest.test(haystack)) {
      const match = candidateUrls.find((u) => rule.urlTest.test(u));
      return match
        ? { recognized: true, url: match, platform: rule.label }
        : { recognized: true, url: null, platform: rule.label };
    }
  }
  return { recognized: false };
}
