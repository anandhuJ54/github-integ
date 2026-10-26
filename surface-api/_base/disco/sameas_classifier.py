"""sameAs domain classifier (port of `sameas-domain-classifier.ts`, Batch 1 + Batch 2, 2026-09-24).

Given the text of a registry node_slug/node_name (schema_property = 'sameAs') and the real URLs
found in a page's JSON-LD `sameAs` array, decide deterministically -- without an LLM -- whether
one of those URLs belongs to that node. The first matching rule wins, so more specific rules for
the same platform come first. A recognised slug with no matching URL is a confident "not found";
an unrecognised slug falls through to the LLM fallback. No network calls, no database.

The patterns are the TS regex literals verbatim (no flags: case-sensitive), compiled with
re.ASCII so `\\b` keeps JavaScript's ASCII word-boundary semantics.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PlatformRule:
    """label: human label; slug_test: matched against the slug text; url_test: against a URL."""

    label: str
    slug_test: re.Pattern[str]
    url_test: re.Pattern[str]


def _rule(label: str, slug: str, url: str) -> PlatformRule:
    return PlatformRule(label, re.compile(slug, re.ASCII), re.compile(url, re.ASCII))


# Ordered: more specific rules for the same platform must come first.
SAMEAS_PLATFORM_RULES: list[PlatformRule] = [
    # --- LinkedIn (disambiguate company vs personal from the slug text) ---
    _rule('LinkedIn Company Page', r"linkedin.*(company|business|organi[sz]ation|school)", r"linkedin\.com/(company|school)/"),
    _rule('LinkedIn Personal Profile', r"linkedin", r"linkedin\.com/in/"),

    # --- Global consumer social platforms ---
    _rule('Facebook', r"facebook", r"facebook\.com"),
    _rule('Instagram', r"instagram", r"instagram\.com"),
    _rule('X / Twitter', r"twitter|(^|[^a-z])x[-_]?(profile|handle|page)", r"(twitter|x)\.com"),
    _rule('YouTube', r"youtube", r"youtube\.com|youtu\.be"),
    _rule('TikTok', r"tiktok", r"tiktok\.com"),
    _rule('Pinterest', r"pinterest", r"pinterest\.com"),
    _rule('Snapchat', r"snapchat", r"snapchat\.com"),
    _rule('Threads', r"threads", r"threads\.net"),
    _rule('Reddit', r"reddit", r"reddit\.com"),
    _rule('Discord', r"discord", r"discord\.(gg|com)"),
    _rule('WeChat', r"wechat", r"wechat\.com"),
    _rule('Xiaohongshu / RED', r"xiaohongshu", r"xiaohongshu\.com|xhslink\.com"),
    _rule('WhatsApp Business', r"whatsapp", r"wa\.me|whatsapp\.com"),
    _rule('Nextdoor', r"nextdoor", r"nextdoor\.com"),
    _rule('Meetup', r"meetup", r"meetup\.com"),
    _rule('GitHub', r"github", r"github\.com"),
    _rule('Vimeo', r"vimeo", r"vimeo\.com"),
    _rule('SoundCloud', r"soundcloud", r"soundcloud\.com"),
    _rule('Spotify', r"spotify", r"spotify\.com"),
    _rule('Bandcamp', r"bandcamp", r"bandcamp\.com"),

    # --- Google / mapping ---
    _rule('Google Business Profile', r"google.*(business|maps|profile)|gbp", r"g\.page|business\.google\.com|goo\.gl/maps|google\.com/maps"),
    _rule('Bing', r"\bbing\b", r"bing\.com"),
    _rule('OpenStreetMap', r"openstreetmap", r"openstreetmap\.org"),
    _rule('Waze', r"\bwaze\b", r"waze\.com"),
    _rule('MapQuest', r"mapquest", r"mapquest\.com"),

    # --- Reference / knowledge ---
    _rule('Wikidata', r"wikidata", r"wikidata\.org"),
    _rule('Wikipedia', r"wikipedia", r"wikipedia\.org"),
    _rule('Crunchbase', r"crunchbase", r"crunchbase\.com"),
    _rule('OpenCorporates', r"opencorporates", r"opencorporates\.com"),
    _rule('GuideStar / Candid', r"guidestar|\bcandid\b", r"guidestar\.org|candid\.org"),
    _rule('Dun & Bradstreet', r"bradstreet|d(-|&)?b\b|dnb\b", r"dnb\.com"),
    _rule("Hoover's", r"\bhoovers\b", r"hoovers\.com"),
    _rule('Manta', r"\bmanta\b", r"manta\.com"),
    _rule('ResearchGate', r"researchgate", r"researchgate\.net"),
    _rule('ORCID', r"\borcid\b", r"orcid\.org"),
    _rule('VIAF', r"\bviaf\b", r"viaf\.org"),
    _rule('ISNI', r"\bisni\b", r"isni\.org"),
    _rule('WorldCat', r"worldcat", r"worldcat\.org"),

    # --- Business directories / B2B marketplaces ---
    _rule('ThomasNet', r"thomasnet|\bthomas\b", r"thomasnet\.com"),
    _rule('Kompass', r"\bkompass\b", r"kompass\.com"),
    _rule('GlobalSpec', r"globalspec", r"globalspec\.com"),
    _rule('IndiaMART', r"indiamart", r"indiamart\.com"),
    _rule('TradeIndia', r"tradeindia", r"tradeindia\.com"),
    _rule('Alibaba', r"alibaba", r"alibaba\.com"),
    _rule('Grainger', r"grainger", r"grainger\.com"),
    _rule('Panjiva', r"panjiva", r"panjiva\.com"),
    _rule('Better Business Bureau', r"\bbbb\b|better business bureau", r"bbb\.org"),

    # --- Legal directories ---
    _rule('Avvo', r"\bavvo\b", r"avvo\.com"),
    _rule('Martindale-Hubbell', r"martindale", r"martindale\.com"),
    _rule('Justia', r"\bjustia\b", r"justia\.com"),
    _rule('FindLaw', r"findlaw", r"findlaw\.com"),
    _rule('Lawyers.com', r"lawyerscom|lawyers\.com", r"lawyers\.com"),

    # --- Real estate / property ---
    _rule('Zillow', r"zillow", r"zillow\.com"),
    _rule('Realtor.com', r"realtorcom|realtor\.com", r"realtor\.com"),
    _rule('LoopNet', r"loopnet", r"loopnet\.com"),
    _rule('CoStar', r"\bcostar\b", r"costar\.com"),
    _rule('Crexi', r"\bcrexi\b", r"crexi\.com"),
    _rule('Apartments.com', r"apartmentscom|apartments\.com", r"apartments\.com"),

    # --- Automotive ---
    _rule('CarGurus', r"cargurus", r"cargurus\.com"),
    _rule('Carfax', r"carfax", r"carfax\.com"),
    _rule('Cars.com', r"carscom|cars\.com", r"cars\.com"),
    _rule('Autotrader', r"autotrader", r"autotrader\.com"),
    _rule('DealerRater', r"dealerrater", r"dealerrater\.com"),
    _rule('NADA / J.D. Power', r"\bnada\b", r"nada\.org|jdpower\.com"),
    _rule('RepairPal', r"repairpal", r"repairpal\.com"),
    _rule('AutoMD', r"automd", r"automd\.com"),
    _rule('DealerSocket', r"dealersocket", r"dealersocket\.com"),
    _rule('Dealer.com', r"dealercom", r"dealer\.com"),

    # --- Healthcare ---
    _rule('Healthgrades', r"healthgrades", r"healthgrades\.com"),
    _rule('Vitals', r"\bvitals(com)?\b", r"vitals\.com"),
    _rule('Zocdoc', r"zocdoc", r"zocdoc\.com"),
    _rule('WebMD', r"webmd", r"webmd\.com"),
    _rule('RateMDs', r"ratemds", r"ratemds\.com"),
    _rule('Doximity', r"doximity", r"doximity\.com"),
    _rule('NPI / NPPES Registry', r"\bnpi\b|nppes", r"npiregistry\.cms\.hhs\.gov|nppes\.cms\.hhs\.gov"),
    _rule('Medicare.gov', r"medicare", r"medicare\.gov"),
    _rule('Medicaid.gov', r"medicaid", r"medicaid\.gov"),

    # --- Pet ---
    _rule('Petfinder', r"petfinder", r"petfinder\.com"),
    _rule('American Kennel Club', r"\bakc\b", r"akc\.org"),
    _rule('Rover', r"\brover\b", r"rover\.com"),
    _rule('Wag!', r"\bwag\b", r"wagwalking\.com"),

    # --- Food / restaurant ---
    _rule('OpenTable', r"opentable", r"opentable\.com"),
    _rule('DoorDash', r"doordash", r"doordash\.com"),
    _rule('Uber Eats', r"ubereats|uber.*eats", r"ubereats\.com"),
    _rule('Grubhub', r"grubhub", r"grubhub\.com"),
    _rule('Resy', r"\bresy\b", r"resy\.com"),
    _rule('TheFork', r"thefork", r"thefork\.com"),
    _rule('Tock', r"\btock\b", r"exploretock\.com"),
    _rule('Zomato', r"zomato", r"zomato\.com"),
    _rule('Michelin Guide', r"michelin", r"guide\.michelin\.com"),
    _rule('Zagat', r"\bzagat\b", r"zagat\.com"),
    _rule('The Infatuation', r"infatuation", r"theinfatuation\.com"),
    _rule('Eater', r"\beater\b", r"eater\.com"),
    _rule('Deliveroo', r"deliveroo", r"deliveroo\.(com|co\.uk)"),
    _rule('ezCater', r"ezcater", r"ezcater\.com"),
    _rule('GoFood', r"gofood", r"gofood\.co\.id"),
    _rule('Swiggy', r"swiggy", r"swiggy\.com"),
    _rule('foodpanda', r"foodpanda", r"foodpanda\."),
    _rule('HappyCow', r"happycow", r"happycow\.net"),

    # --- Travel / hospitality ---
    _rule('TripAdvisor', r"tripadvisor", r"tripadvisor\.com"),
    _rule('Booking.com', r"bookingcom|booking\.com", r"booking\.com"),
    _rule('Expedia', r"expedia", r"expedia\.com"),
    _rule('Airbnb', r"airbnb", r"airbnb\.com"),
    _rule('Vrbo', r"\bvrbo\b", r"vrbo\.com"),
    _rule('Viator', r"\bviator\b", r"viator\.com"),
    _rule('GetYourGuide', r"getyourguide", r"getyourguide\.com"),
    _rule('Hipcamp', r"hipcamp", r"hipcamp\.com"),
    _rule('HomeAway', r"homeaway", r"homeaway\.com"),
    _rule('Recreation.gov', r"recreationgov", r"recreation\.gov"),

    # --- Home services / contractors ---
    _rule('Angi', r"\bangi(es)?\b", r"angi\.com|angieslist\.com"),
    _rule('HomeAdvisor', r"homeadvisor", r"homeadvisor\.com"),
    _rule('Houzz', r"houzz", r"houzz\.com"),
    _rule('Thumbtack', r"thumbtack", r"thumbtack\.com"),
    _rule('Checkatrade', r"checkatrade", r"checkatrade\.com"),
    _rule('BuildZoom', r"buildzoom", r"buildzoom\.com"),

    # --- Reviews (general) ---
    _rule('Yelp', r"\byelp\b", r"yelp\.com"),
    _rule('Trustpilot', r"trustpilot", r"trustpilot\.com"),
    _rule('Capterra', r"capterra", r"capterra\.com"),
    _rule('UpCity', r"upcity", r"upcity\.com"),
    _rule('Clutch', r"\bclutchco\b|\bclutch\b", r"clutch\.co"),
    _rule('Foursquare', r"foursquare", r"foursquare\.com"),

    # --- Media / entertainment / events ---
    _rule('IMDb', r"\bimdb\b", r"imdb\.com"),
    _rule('Discogs', r"discogs", r"discogs\.com"),
    _rule('AllMusic', r"allmusic", r"allmusic\.com"),
    _rule('Songkick', r"songkick", r"songkick\.com"),
    _rule('Bandsintown', r"bandsintown", r"bandsintown\.com"),
    _rule('Eventbrite', r"eventbrite", r"eventbrite\.com"),
    _rule('Ticketmaster', r"ticketmaster", r"ticketmaster\.com"),
    _rule('StubHub', r"stubhub", r"stubhub\.com"),

    # --- Sports / fitness / classes ---
    _rule('Strava', r"strava", r"strava\.com"),
    _rule('ClassPass', r"classpass", r"classpass\.com"),
    _rule('MINDBODY', r"mindbody", r"mindbodyonline\.com"),
    _rule('TeamSnap', r"teamsnap", r"teamsnap\.com"),
    _rule('SportsEngine', r"sportsengine", r"sportsengine\.com"),
    _rule('ACTIVE Network', r"activenetwork|activecom|\bactive\b.*network", r"active\.com"),

    # --- E-commerce / marketplaces ---
    _rule('Etsy', r"\betsy\b", r"etsy\.com"),
    _rule('eBay', r"\bebay\b", r"ebay\.com"),
    _rule('Amazon', r"amazon", r"amazon\.com"),
    _rule('Shopify', r"shopify", r"myshopify\.com|shopify\.com"),
    _rule('Poshmark', r"poshmark", r"poshmark\.com"),
    _rule('Mercari', r"mercari", r"mercari\.com"),
    _rule('Wayfair', r"wayfair", r"wayfair\.com"),
    _rule('Alibaba (com)', r"alibabacom", r"alibaba\.com"),
    _rule('Instacart', r"instacart", r"instacart\.com"),
    _rule('Groupon', r"groupon", r"groupon\.com"),

    # --- Financial-advisor-specific directories (financial_advisor pilot) ---
    _rule('FINRA BrokerCheck', r"brokercheck|finra", r"brokercheck\.finra\.org"),
    _rule('SEC IAPD / Adviser Info', r"\biapd\b|adviserinfo", r"adviserinfo\.sec\.gov"),
    _rule('SEC EDGAR', r"\bedgar\b|sec.*edgar", r"sec\.gov/cgi-bin/browse-edgar|sec\.gov/edgar"),
    _rule('NAPFA', r"\bnapfa\b", r"napfa\.org"),
    _rule('CFP Board', r"cfp.*board", r"cfp\.net"),
    _rule('SmartAsset', r"smartasset", r"smartasset\.com"),
    _rule('WiserAdvisor', r"wiseradvisor", r"wiseradvisor\.com"),
    _rule('XY Planning Network', r"\bxypn\b|xyplanningnetwork", r"xyplanningnetwork\.com"),
    _rule('Garrett Planning Network', r"garrett.*planning", r"garrettplanningnetwork\.com"),
    _rule('Wealthtender', r"wealthtender", r"wealthtender\.com"),
    _rule('AICPA', r"\baicpa\b", r"aicpa(-cima)?\.org"),
    _rule('NMLS Consumer Access', r"\bnmls\b", r"nmlsconsumeraccess\.org"),

    # --- Government / regulatory registries (used as sameAs / verification links) ---
    _rule('IRS', r"\birs\b", r"irs\.gov"),
    _rule('SEC', r"\bsec\b(?!.*edgar)(?!.*iapd)", r"sec\.gov"),
    _rule('EPA', r"\bepa\b", r"epa\.gov"),
    _rule('FDA', r"\bfda\b", r"fda\.gov"),
    _rule('USDA', r"\busda\b", r"usda\.gov"),
    _rule('DMV (state)', r"\bdmv\b", r"dmv\.[a-z]{2}\.gov|dmv\.gov"),
    _rule('FMCSA SAFER', r"fmcsa|\bsafer\b", r"safer\.fmcsa\.dot\.gov"),
    _rule('FAA', r"\bfaa\b", r"faa\.gov"),
    _rule('CMS.gov', r"\bcms\b", r"cms\.gov"),
    _rule('HUD', r"\bhud\b", r"hud\.gov"),
    _rule('FCC', r"\bfcc\b", r"fcc\.gov"),
    _rule('SAM.gov', r"samgov|\bsam\b.*gov", r"sam\.gov"),
    _rule('Data.gov', r"datagov", r"data\.gov"),
    _rule('CBP', r"\bcbp\b", r"cbp\.gov"),
    _rule('FSIS (USDA)', r"\bfsis\b", r"fsis\.usda\.gov"),
    _rule('USPS', r"\busps\b", r"usps\.com"),
    _rule('ATF', r"\batf\b", r"atf\.gov"),
    _rule('US DOT', r"\bdot\b", r"transportation\.gov|dot\.gov"),
    _rule('APHIS (USDA)', r"\baphis\b", r"aphis\.usda\.gov"),
    _rule('CDC', r"\bcdc\b", r"cdc\.gov"),
    _rule('FEMA', r"\bfema\b", r"fema\.gov"),
    _rule('FinCEN', r"fincen", r"fincen\.gov"),
    _rule('TTB', r"\bttb\b", r"ttb\.gov"),
    _rule('NHTSA', r"nhtsa", r"nhtsa\.gov"),
    _rule('MSHA', r"\bmsha\b", r"msha\.gov"),
    _rule('HRSA', r"\bhrsa\b", r"hrsa\.gov"),
    _rule('ITAR / DDTC', r"\bitar\b|\bddtc\b", r"pmddtc\.state\.gov"),
    _rule('DOI (Dept of Interior)', r"\bdoi\b", r"doi\.gov"),
    _rule('GSA', r"\bgsa\b", r"gsa\.gov"),
    _rule('BIS (Bureau of Industry & Security)', r"\bbis\b", r"bis\.doc\.gov"),
    _rule('DEA', r"\bdea\b", r"dea\.gov"),
    _rule('NRC (Nuclear Regulatory)', r"\bnrc\b", r"nrc\.gov"),
    _rule('NOAA', r"\bnoaa\b", r"noaa\.gov"),
    _rule('DOL (Dept of Labor)', r"\bdol\b", r"dol\.gov"),
    _rule('CFPB', r"\bcfpb\b", r"consumerfinance\.gov"),

    # --- Education ---
    _rule('NCES', r"\bnces\b", r"nces\.ed\.gov"),
    _rule('IPEDS', r"ipeds", r"nces\.ed\.gov/ipeds"),
    _rule('Niche.com', r"nichecom", r"niche\.com"),
    _rule("Peterson's", r"petersons", r"petersons\.com"),

    # --- Misc recognizable platforms seen in the freq>=8 list ---
    _rule('Alltrails', r"alltrails", r"alltrails\.com"),
    _rule('Craigslist', r"craigslist", r"craigslist\.org"),
    _rule('Glassdoor', r"glassdoor", r"glassdoor\.com"),
    _rule('Indeed', r"\bindeed\b", r"indeed\.com"),

    # ============================================================
    # Batch 2 (freq 3-7 tier) additions below
    # ============================================================

    # --- More government / regulatory agencies ---
    _rule('FTC', r"\bftc\b", r"ftc\.gov"),
    _rule('SSA (Social Security Administration)', r"\bssa\b", r"ssa\.gov"),
    _rule('OSHA', r"\bosha\b", r"osha\.gov"),
    _rule('DHS', r"\bdhs\b", r"dhs\.gov"),
    _rule('USCIS', r"uscis", r"uscis\.gov"),
    _rule('FDIC', r"\bfdic\b", r"fdic\.gov"),
    _rule('NCUA', r"\bncua\b", r"ncua\.gov"),
    _rule('USPTO', r"uspto", r"uspto\.gov"),
    _rule('FHWA', r"\bfhwa\b", r"fhwa\.dot\.gov"),
    _rule('NRCS (USDA)', r"\bnrcs\b", r"nrcs\.usda\.gov"),
    _rule('HHS', r"\bhhs\b", r"hhs\.gov"),
    _rule('National Park Service', r"\bnps\b", r"nps\.gov"),
    _rule('CITES', r"\bcites\b", r"cites\.org"),
    _rule('GBIF', r"\bgbif\b", r"gbif\.org"),
    _rule('USAJobs', r"usajobs", r"usajobs\.gov"),
    _rule('VA.gov', r"vagov", r"va\.gov"),
    _rule('USAspending.gov', r"usaspendinggov", r"usaspending\.gov"),
    _rule('Govinfo.gov', r"govinfogov", r"govinfo\.gov"),
    _rule('GOV.UK', r"govuk", r"gov\.uk"),

    # --- Consumer finance ---
    _rule('NerdWallet', r"nerdwallet", r"nerdwallet\.com"),
    _rule('LendingTree', r"lendingtree", r"lendingtree\.com"),

    # --- Professional / credentialing bodies ---
    _rule('ABMS', r"\babms\b", r"abms\.org"),
    _rule('ASCE', r"\basce\b", r"asce\.org"),
    _rule('ASME', r"\basme\b", r"asme\.org"),
    _rule('ASTM International', r"\bastm\b", r"astm\.org"),
    _rule('ANSI', r"\bansi\b", r"ansi\.org"),
    _rule('ABET', r"\babet\b", r"abet\.org"),
    _rule('NASBA', r"\bnasba\b", r"nasba\.org"),
    _rule('ICAEW', r"icaew", r"icaew\.com"),
    _rule('National Association of Realtors', r"\bnar\b", r"nar\.realtor"),
    _rule('NAHB', r"\bnahb\b", r"nahb\.org"),
    _rule('NAIC', r"\bnaic\b", r"naic\.org"),
    _rule('NCQA', r"\bncqa\b", r"ncqa\.org"),
    _rule('NREMT', r"nremt", r"nremt\.org"),
    _rule('ASHA', r"\basha\b", r"asha\.org"),
    _rule('AOTA', r"\baota\b", r"aota\.org"),
    _rule('APTA', r"\bapta\b", r"apta\.org"),
    _rule('ASCO', r"\basco\b", r"asco\.org"),
    _rule('AAOS', r"\baaos\b", r"aaos\.org"),
    _rule('ABOG', r"\babog\b", r"abog\.org"),
    _rule('ABPN', r"\babpn\b", r"abpn\.com"),
    _rule('American College of Physicians', r"\bacp\b", r"acponline\.org"),
    _rule('AUA (Urological Association)', r"\baua\b", r"auanet\.org"),
    _rule('ASPS (Plastic Surgeons)', r"\basps\b", r"plasticsurgery\.org"),
    _rule('AANP', r"\baanp\b", r"aanp\.org"),
    _rule('APMA (Podiatric)', r"\bapma\b", r"apma\.org"),
    _rule('AQHA', r"\baqha\b", r"aqha\.com"),
    _rule('USGA', r"\busga\b", r"usga\.org"),
    _rule('ACEC', r"\bacec\b", r"acec\.org"),
    _rule('AGC (Associated General Contractors)', r"\bagc\b", r"agc\.org"),
    _rule('BOMA', r"\bboma\b", r"boma\.org"),
    _rule('NARI', r"\bnari\b", r"nari\.org"),
    _rule('AZA', r"\baza\b", r"aza\.org"),
    _rule('ICMA', r"\bicma\b", r"icma\.org"),
    _rule('NALP', r"\bnalp\b", r"nalp\.org"),
    _rule('AILA', r"\baila\b", r"aila\.org"),
    _rule('NAIFA', r"naifa", r"naifa\.org"),
    _rule('NBCC (Counselors)', r"\bnbcc\b", r"nbcc\.org"),
    _rule('SHRM', r"\bshrm\b", r"shrm\.org"),
    _rule('CFA Institute', r"\bcfa\b", r"cfainstitute\.org"),
    _rule('ASID', r"\basid\b", r"asid\.org"),
    _rule('ASHRAE', r"ashrae", r"ashrae\.org"),
    _rule('ALOA (Locksmiths)', r"\baloa\b", r"aloa\.org"),
    _rule('NSCA', r"\bnsca\b", r"nsca\.com"),
    _rule('NKBA', r"\bnkba\b", r"nkba\.org"),
    _rule('PPA (Professional Photographers)', r"\bppa\b", r"ppa\.com"),
    _rule('NFDA (Funeral Directors)', r"\bnfda\b", r"nfda\.org"),
    _rule('NBAA (Business Aviation)', r"\bnbaa\b", r"nbaa\.org"),
    _rule('NCBTMB (Massage Therapy)', r"ncbtmb", r"ncbtmb\.org"),
    _rule('ABMP (Massage & Bodywork)', r"\babmp\b", r"abmp\.com"),
    _rule('RESNA', r"\bresna\b", r"resna\.org"),
    _rule('NIADA', r"niada", r"niada\.com"),

    # --- Real estate / property (more) ---
    _rule('ApartmentList', r"apartmentlist", r"apartmentlist\.com"),
    _rule('NewHomeSource', r"newhomesource", r"newhomesource\.com"),
    _rule('BizBuySell', r"bizbuysell", r"bizbuysell\.com"),

    # --- Automotive (more) ---
    _rule('Edmunds', r"edmunds", r"edmunds\.com"),
    _rule('CarWise', r"carwise", r"carwise\.com"),
    _rule('RockAuto', r"rockauto", r"rockauto\.com"),
    _rule('Car Talk', r"cartalk", r"cartalk\.com"),
    _rule('CycleTrader', r"cycletrader", r"cycletrader\.com"),
    _rule('TractorHouse', r"tractorhouse", r"tractorhouse\.com"),
    _rule('TruckPaper', r"truckpaper", r"truckpaper\.com"),
    _rule('Trade-A-Plane', r"trade-a-plane", r"trade-a-plane\.com"),
    _rule('Hemmings', r"hemmings", r"hemmings\.com"),
    _rule('MHVillage', r"mhvillage", r"mhvillage\.com"),
    _rule('Motors.co.uk', r"motorscouk", r"motors\.co\.uk"),
    _rule('Car-Part.com', r"car-partcom", r"car-part\.com"),
    _rule('Controller.com', r"controllercom", r"controller\.com"),
    _rule('GovPlanet', r"govplanet", r"govplanet\.com"),
    _rule('Ritchie Bros', r"\britchie\b", r"ritchiebros\.com"),
    _rule('iBoats', r"iboats", r"iboats\.com"),
    _rule('AirNav', r"airnav", r"airnav\.com"),
    _rule('SkyVector', r"skyvector", r"skyvector\.com"),
    _rule('ForeFlight', r"foreflight", r"foreflight\.com"),
    _rule('ActiveCaptain', r"activecaptain", r"activecaptain\.garmin\.com"),
    _rule('Dockwa', r"dockwa", r"dockwa\.com"),
    _rule('EquineNow', r"equinenow", r"equinenow\.com"),
    _rule('Equine.com', r"equinecom", r"equine\.com"),

    # --- Marketplaces / e-commerce / services (more) ---
    _rule('1stDibs', r"1stdibs", r"1stdibs\.com"),
    _rule('AbeBooks', r"abebooks", r"abebooks\.com"),
    _rule('Bookshop.org', r"bookshoporg", r"bookshop\.org"),
    _rule('Rakuten', r"rakuten", r"rakuten\.com"),
    _rule('Tokopedia', r"tokopedia", r"tokopedia\.com"),
    _rule('JustDial', r"justdial", r"justdial\.com"),
    _rule('Sulekha', r"sulekha", r"sulekha\.com"),
    _rule('Made-in-China.com', r"made-in-china", r"made-in-china\.com"),
    _rule('Global Sources', r"globalsources", r"globalsources\.com"),
    _rule('IndustryNet', r"industrynet", r"industrynet\.com"),
    _rule('Octopart', r"octopart", r"octopart\.com"),
    _rule('Alignable', r"alignable", r"alignable\.com"),
    _rule('Bark.com', r"barkcom", r"bark\.com"),
    _rule('Upwork', r"upwork", r"upwork\.com"),
    _rule('Skillshare', r"skillshare", r"skillshare\.com"),
    _rule('Udemy', r"udemy", r"udemy\.com"),
    _rule('Coursera', r"coursera", r"coursera\.org"),
    _rule('Handshake', r"handshake", r"joinhandshake\.com"),
    _rule('Idealist', r"idealistorg|\bidealist\b", r"idealist\.org"),
    _rule('GreatNonprofits', r"greatnonprofits", r"greatnonprofits\.org"),
    _rule('FindHelp.org', r"findhelporg", r"findhelp\.org"),
    _rule('GoodFirms', r"goodfirms", r"goodfirms\.co"),
    _rule('Dribbble', r"dribbble", r"dribbble\.com"),
    _rule('Saatchi Art', r"\bsaatchi\b", r"saatchiart\.com"),
    _rule('ArchDaily', r"archdaily", r"archdaily\.com"),
    _rule('Dezeen', r"dezeen", r"dezeen\.com"),
    _rule('Time Out', r"timeout", r"timeout\.com"),
    _rule('Forbes', r"forbes", r"forbes\.com"),
    _rule('Bloomberg', r"bloomberg", r"bloomberg\.com"),
    _rule('ProPublica', r"propublica", r"propublica\.org"),
    _rule('Wikimedia', r"wikimedia", r"wikimedia\.org"),
    _rule('DBpedia', r"dbpedia", r"dbpedia\.org"),
    _rule('Europeana', r"europeana", r"europeana\.eu"),
    _rule('eBird', r"ebird", r"ebird\.org"),
    _rule('RateBeer', r"ratebeer", r"ratebeer\.com"),
    _rule('BeerAdvocate', r"beeradvocate", r"beeradvocate\.com"),
    _rule('BoardGameGeek', r"boardgamegeek", r"boardgamegeek\.com"),
    _rule('Letterboxd', r"letterboxd", r"letterboxd\.com"),
    _rule('Chess.com', r"chesscom", r"chess\.com"),
    _rule('AudiogoN', r"audiogon", r"audiogon\.com"),
    _rule('SeatGeek', r"seatgeek", r"seatgeek\.com"),
    _rule('Recreation Reservations (ReserveAmerica)', r"reserveamerica", r"reserveamerica\.com"),
    _rule('KOA', r"\bkoa\b", r"koa\.com"),
    _rule('RVshare', r"rvshare", r"rvshare\.com"),
    _rule('LocalHarvest', r"localharvest", r"localharvest\.org"),
    _rule('EnergySage', r"energysage", r"energysage\.com"),
    _rule('Goldbelly', r"goldbelly", r"goldbelly\.com"),
    _rule('HalalTrip', r"halaltrip", r"halaltrip\.com"),
    _rule('Hitched', r"hitched", r"hitched\.co\.uk"),
    _rule('Bridebook', r"bridebook", r"bridebook\.co\.uk"),
    _rule('Treatwell', r"treatwell", r"treatwell\.com"),
    _rule('Fresha', r"fresha", r"fresha\.com"),
    _rule('MassageBook', r"massagebook", r"massagebook\.com"),
    _rule('CourtReserve', r"courtreserve", r"courtreserve\.com"),
    _rule('CourseHorse', r"coursehorse", r"coursehorse\.com"),
    _rule('Adopt-a-Pet.com', r"adopt-a-pet", r"adoptapet\.com"),
    _rule('RealSelf', r"realself", r"realself\.com"),
    _rule('Caring.com', r"caringcom", r"caring\.com"),
    _rule('GreatSchools', r"greatschools", r"greatschools\.org"),
    _rule('SchoolDigger', r"schooldigger", r"schooldigger\.com"),
    _rule('Insurify', r"insurify", r"insurify\.com"),
    _rule('Insurance.com', r"insurancecom", r"insurance\.com"),
    _rule('Yellowpages.com', r"yellowpages|yellcom", r"yellowpages\.com|yell\.com"),
    _rule('500px', r"500px", r"500px\.com"),
    _rule('Fandango', r"fandango", r"fandango\.com"),
    _rule('FashionGo', r"fashiongo", r"fashiongo\.net"),
    _rule('Dutchie', r"dutchie", r"dutchie\.com"),
    _rule('KakaoTalk', r"kakaotalk", r"kakao\.com|pf\.kakao\.com"),
    _rule('Naver', r"\bnaver\b", r"naver\.com"),
    _rule('italki', r"italki", r"italki\.com"),
    _rule('IslamicFinder', r"islamicfinder", r"islamicfinder\.org"),
    _rule('Zabihah', r"zabihah", r"zabihah\.com"),
    _rule('YMCA', r"\bymca\b", r"ymca\.net"),
    _rule('Superpages', r"superpages", r"superpages\.com"),
    _rule('Teleflora', r"teleflora", r"teleflora\.com"),
    _rule('Sittercity', r"sittercity", r"sittercity\.com"),
    _rule('uShip', r"uship", r"uship\.com"),

]


def classify_same_as(node_slug_or_name: str, candidate_urls: list[str]) -> dict:
    """Classify one sameAs field against the page's sameAs URLs.

    Returns ``{"recognized": False}`` (unknown platform: use the LLM fallback),
    ``{"recognized": True, "url": None, "platform": label}`` (known platform, confidently absent)
    or ``{"recognized": True, "url": url, "platform": label}`` (found).
    """
    haystack = re.sub(r"[_-]+", " ", node_slug_or_name.lower())
    for rule in SAMEAS_PLATFORM_RULES:
        if rule.slug_test.search(haystack):
            match = next((u for u in candidate_urls if rule.url_test.search(u)), None)
            return {"recognized": True, "url": match, "platform": rule.label}
    return {"recognized": False}
