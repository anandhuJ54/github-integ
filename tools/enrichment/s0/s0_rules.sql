-- =====================================================================================
-- S0 category GROUP classification (taxonomy-enrichment program).  READ-ONLY (SELECT only).
-- Generated 2026-10-15.  Produces one row per active gbp_categories gcid:
--   gcid, grp (1..11), conf (0..1), alt_grp, name_rule, signals-count columns.
-- 11 groups: 1 Professional services | 2 Finance and insurance | 3 Home and trade services |
--   4 Health and medical | 5 Restaurants, food and drink | 6 Retail and regulated retail |
--   7 Personal services and fitness | 8 Lodging, venues and events | 9 Auto |
--   10 B2B and niche | 11 Civic, religious, education and nonprofit
-- Evidence (all existing data; weights are additive votes):
--   N  name rules over the gcid slug (ordered, first match = vote w, first DIFFERENT-group match = 0.8)
--   S  exp_category_schema_type.schema_type  (1.5 specific type / 0.3-1.0 generic)
--   A  exp_category_profile_config (cta_label, credential_label) archetype  (0.8-2.0)
--   C  exp_category_compliance (hipaa/age_gate/glba, regulator text, license_label)  (0.2-1.5)
--   D  exp_vertical_node_registry (medicalSpecialty-type nodes -> 4; lodging nodes -> 8)
--   G  exp_category_secondaries neighbour propagation (<=1.2, relevance-weighted)
-- conf = top/(top+second) * (0.5 + 0.5*min(1,top/6)); x0.8 if the schema type is the 'longtail_default' (9 untyped).
-- VERIFICATION STATUS: the Python pipeline (rules_v3.py/s0.py in this folder) produced s0_classification.csv/json.
--   This SQL was executed against the live DB on a 686-category hash sample (abs(hashtext(gcid)) % 6 = 0) up to the
--   pre-graph vote stage: name-rule first/alt tags, argmax group and weights matched Python 686/686 (0 mismatches).
--   The FULL query (incl. step G neighbour propagation, all 4,041 rows) returned HTTP 504 (gateway timeout) in one shot,
--   so step G in SQL is UNVERIFIED against Python. Run it in chunks or as a materialised view if needed.
-- NOT in SQL: sibling clusters (graph clustering) and demand tiers are produced by final.py/clus.py (see bottom comments).
-- =====================================================================================
with c as (
  select g.gcid,
         lower(replace(replace(g.gcid,'gcid:',''),'_',' ')) as nm,
         st.schema_type as st, st.rule as sr,
         pc.cta_label as cta, pc.credential_label as cl,
         coalesce(cc.hipaa_applies,false) as hipaa, coalesce(cc.age_gate_required,false) as age,
         coalesce(cc.glba_applies,false) as glba, cc.license_label as lic,
         coalesce(array_to_string(cc.regulated_by,'; '),'') as reg,
         coalesce(nd.n_med,0) as n_med, coalesce(nd.n_lodge,0) as n_lodge
  from gbp_categories g
  left join exp_category_schema_type st on st.gcid=g.gcid
  left join exp_category_profile_config pc on pc.gcid=g.gcid
  left join exp_category_compliance cc on cc.gcid=g.gcid
  left join (select gcid,
               count(*) filter (where schema_property in ('medicalSpecialty','availableService','healthPlanNetworkId')) n_med,
               count(*) filter (where schema_property in ('checkinTime','checkoutTime','numberOfRooms','petsAllowed')) n_lodge
             from exp_vertical_node_registry group by gcid) nd on nd.gcid=g.gcid
  where g.status='active'
),
rules(ord,grp,tag,rx,w) as (values
  (1,7,'personal_exc','\m(sports equipment rental service|ski rental service|snowboard rental service|water sports equipment rental service|boot camp|sauna club|public sauna|gay sauna|cat boarding service|cat breeder|dog breeder|horse breeder|horse boarding stable|horsestable studfarm|eyebrow bar|bar pmu|barber shop|tattoo shop|tattoo and piercing shop|body piercing shop|beauty salon|nail salon|hair salon|eyelash salon|fencing salon)\M',6.0),
  (2,8,'venue_exc','\m(party equipment rental service|karaoke equipment rental service|bicycle rental service|boat rental service|canoe and kayak rental service|horse rental service|snowmobile rental service|pony ride service|carriage ride service|dogsled ride service|parasailing ride service|raft trip outfitter|fishing charter|helicopter charter|hang gliding center|skydiving center|bungee jumping center|aquatic center|recreation center|leisurecentre|indoor snowcenter|summer toboggan run|hunting preserve|fishing pond|off roading area|prawn fishing|hiking guide|outdoor activity organizer|tent rental service|aeroclub|marriage celebrant|entertainment agency|rv park|mobile home park|race track|racetrack|race course|car race track|model car play area|mountain cable car|off road race track|go kart track|speedway|high ropes course|childrens farm|pick your own farm produce|christmas tree farm|camping farm|cruise line|cruise terminal|beer garden|beer hall)\M',6.0),
  (3,3,'tree','\m(tree surgeon|arborist\w*|tree service)\M',6.0),
  (4,4,'med_lab_exc','\m(paternity testing|drug testing|government hospital|military hospital|veterans hospital|dental lab|medical lab|x ray lab|blood (bank|donation|testing)|organ donation and tissue bank|sperm bank)\M',6.0),
  (5,11,'civic_exc','\m(district attorney|public prosecutors?|social security attorney|sanitary inspection|chamber of agriculture|park and ride|political party|refugee camp|scout hall|community garden|gambling instructor|pet cemetery|pet adoption service|handicapped transportation service|police supply store)\M',6.0),
  (6,10,'b2b_head','\m(equipment|machinery|machines?|(crane|forklift|scaffolding|tool|plant and machinery|construction machine|building equipment|office equipment|audio visual equipment|catering equipment|lawn equipment|equipment) (rental|hire)( service| agency)?|equipment and solutions|suppliers?|supplies|supply|manufacturers?|manufacturing|wholesalers?|wholesale|distributors?|exporters?|importers?|producers?|factory|fabricators?|processors?|refinery|foundry|packers?|packagers?|mills?|plants?|bottling company|growers?|farmer|farms?)$',6.0),
  (7,10,'b2b_word','\m(wholesalers?|wholesale|manufacturers?|manufacturing|suppliers?|distributors?|importers?|exporters?|import export)\M',2.2),
  (8,5,'restaurant_head','\m(gastropub|restaurants?|restaurtant|restaurants|cafes?|cafeteria|bar|pub|bistro|brasserie|bakery|brewery|brewpub|winery|distillery|diner|eatery|takeaway|taqueria|steak ?house|grill|pizzeria|vineyard|buffet|deli|lounge|catering service|caterer|food court|food truck|hawker stall|hawker centre|izakaya|tavern|pancake house|tea house|teahouse|tea room)$',4.5),
  (9,5,'food_shop','\m(coffee shop|coffee stand|coffee roasters|ice cream shop|donut shop|doughnut shop|bagel shop|juice shop|juice bar|sandwich shop|bubble tea|dessert shop|cake shop|candy shop|pretzel|popcorn|gelato|hot dog stand|sweet shop|chocolate shop|noodle shop|pastelaria|churreria|frituur|kebab shop|soup shop|salad shop|smoothie shop|tamale shop|panipuri shop|pie shop|cookie shop|cupcake shop|pastry shop|frozen yogurt shop|acai shop|steamed bun shop|indian sweets shop|japanese \w+ sweets shop|japanese confectionery shop|rice cracker shop|chicken shop|pasta shop|tortilla shop|tofu shop|rice cake shop|soft drinks shop|paan shop|confectionery|patisserie|takoyaki stand|sugar shack|shared use commercial kitchen|meal delivery|pizza delivery service|personal chef service|mobile catering)\M',4.5),
  (10,10,'shop_industrial','\m(machine shop|metal working shop|millwork shop|tool and die shop|driveshaft shop|radiator shop|propeller shop|generator shop|print shop|screen printing shop|neon sign shop|sign shop|vinyl sign shop|safe and vault shop|copy shop|auto machine shop)\M',6.0),
  (11,9,'shop_auto','\m(auto|car|cars|truck|motorcycle|motor scooter|rv|trailer|tire|tires|racing car|marine|atv|tractor|brake|muffler|transmission|vehicle|wheel|scooter)\M.*\m(stores?|shops?|market|supplies|supply)$',6.0),
  (12,9,'shop_auto2','\m(auto parts|auto supply|car parts|used auto parts|used tire shop|tire repair shop)\M',6.0),
  (13,3,'shop_repair','\m(repair shops?|repair|repairs)$',6.0),
  (14,6,'retail_head','\m(stores?|shops?|boutique|markets?|supermarket|hypermarket|mall|malls|outlet|megastore|showroom|pharmacy|drugstore|dispensary|florist|bazaar|bazar|emporium|trading post|vending machine|kiosk|garden center|garden centre|plant nursery|nursery|cannabis|marijuana|liquor|firearm|gun shop|tobacco|vape|cigar|hemp|cbd|grocery|groceries|convenience|thrift|antique|bookshop|haberdashery|saddlery|jeweler|jewellers?|green grocers|parapharmacy|newsstand|lottery retailer|botanica|shopping center|market place|handicraft|furniture accessories|retail monopoly|alcohol retail monopoly|merchant|fruit and vegetable|staple food package|meat products|wine cellar|cannabis club|wine club|warehouse club|health and beauty shop|diamond buyer|jewelry buyer|garden building retail|garden machinery|flower delivery|grocery delivery service|milk delivery service|wedding dress rental service)$',4.5),
  (15,11,'food_bank','\m(food bank|soup kitchen|pantry)\M',4.5),
  (16,11,'religious','\m(church|churches|temple|mosque|synagogue|cathedral|chapel|monastery|abbey|shrine|parish|pagoda|ashram|basilica|gurdwara|convent|nunnery|seminary|clergyman|priest|mohel|rabbi|imam|pastor|religious|worship|ministry of education|diocese|congregation|spiritist|buddhist|hindu|catholic|baptist|lutheran|methodist|presbyterian|orthodox|evangelical|pentecostal|anglican|adventist|mormon|jehovah|sikh|islamic|jewish|christian|bible|rectory|marae|musalla|yeshiva|pilgrimages?|mission)\M',4.5),
  (17,9,'fuel_station','\m((gas|cng|lpg|fuel|petrol|hydrogen|filling|service|alternative fuel) station|ev charging|ebike charging|electric vehicle charging station|lpg conversion|cng fittment center|truck stop)\M',4.5),
  (18,7,'adult_adjacent','\m(soapland|nudist|erotic|brothel|strip club|host club|love hotel)\M',1.6),
  (19,7,'sport_school','\m((dance|ballet|yoga|martial arts|karate|judo|aikido|taekwondo|kung fu|kickboxing|baby swimming|swimming|gymnastics|ski|surf|sailing|horse riding|fencing|boxing|diving|golf|tennis|wrestling|pilates|fitness|sports|pool) (school|academy))\M',6.0),
  (20,11,'school_head','\m(schools?|colleges?|universit(y|ies)|academy|institute|faculty|kindergarten|preschool|conservatory|seminary|campus|montessori preschool|faculty of \w+( \w+)?|school of \w+( \w+)?|education center|educational institution|learning center|training center|training institute|distance learning center)$',4.5),
  (21,11,'school_word','\m(faculty|school|university|college|kindergarten|preschool|academy|lyceum|realschule|hauptschule|berufsfachschule|iut)\M',2.2),
  (22,11,'civic_gov','\m(law enforcement|military|army|navy|air force|marine corps|coast guard|police|fire station|fire department|prison|jail|detention|courthouse|embassy|consulate|government|municipal|city hall|city clerks|city council|city district|city tax|county|parliament|ministry|department of|public safety|public defenders|registry|registration office|passport office|visa and passport|customs office|main customs office|immigration and naturalization|voter|tax collectors|social security|social services|social welfare|post office|town hall|legislat\w*|probation|veterans|unemployment|pension office|lost property|drivers license|birth certificate|civic|community center|prefecture|district office|school district|environment office|agenzia|carabinieri|gendarmerie|sheriffs|highway patrol|traffic officer|civil defence|border guard|border crossing|guardia civil|self defense force|armed forces|naval base|district justice|justice department|tax assessor|tax department|urban planning|planning authority|public works|water works|housing authority|tribal|employment department|license bureau|marriage license|citizen information|consumer advice|economic development|federal agency|protected area|nature preserve|wildlife refuge|public housing|public bathroom|public female bathroom|public male bathroom|public wheelchair accessible bathroom|public parking space|parking lot|parking lot for bicycles|parking lot for motorcycle|parking garage|toll road|toll station|weigh station|rest stop|stock exchange|tax office|sacem|press advisory|bureau|embassies|train depot|bus depot|transit depot|train yard|suburban train line|seaplane base|heliport|rideshare pickup|carpool|drinking water fountain|wi fi spot|emergency call station|bicycle rack|boat ramp|promenade|memorial|space of remembrance|land allotment|public water well|emergency training|port authority|airport|public health department|occupational safety and health|road safety town)\M',2.6),
  (23,1,'prof_head','\m(lawyers?|attorneys?|law firm|law office|law practice|legal|notary|notaries|paralegal|accountants?|accounting|bookkeeping|tax (preparation|consultant|advisor|attorney|service)|auditor|barrister|solicitor|conveyancer|commissioner for oaths|judicial scrivener|customs broker|customs consultant|medical billing service)\M',4.5),
  (24,2,'finance','\m(insurance|mortgage|loans?|lenders?|credit union|credit counseling|credit reporting|financial|bank|banking|investment|securities|stock broker|wealth|check cashing|currency exchange|money order|money transfer|mobile money|atm|debt|escrow|bail bonds|payday|pawn|savings|brokerage|annuity|forex|cryptocurrency|tax refund|trust company|building society|finance broker|private equity|venture capital|loss adjuster|insolvency|foreclosure|holding company|business broker)\M',2.6),
  (25,1,'professional','\m(consultants?|consulting|real estate|realtor|estate agent|property (management|manager|developer|administrator|investment)|appraiser|surveyor|engineers?|engineering|architects?|architecture|architectural designer|building designer|interior (designer|architect|decorator)|marketing|market researcher|advertising|branding|public relations|translator|translation|interpreter|recruit(er|ment)?|staffing|employment agency|temp agency|executive search|human resources?|patent|copywriting|mediation|divorce|bankruptcy|business (management|administration|development|services)|design agency|web design|graphic design|website designer|graphic designer|seo|e commerce agency|talent agency|headhunter|payroll|data entry|transcription|secretarial|typing service|resume service|title company|private investigator|process server|court reporter|court executive officer|executor|liquidator|estate liquidator|genealogist|professional organizer|polygraph|fingerprinting|meeting planning|small claims|bpo|call center|telemarketing|photo agency|publisher|publishing|land surveying office|interior architect office|vastu|feng shui consultant)\M',2.2),
  (26,1,'residential_prop','\m(apartment (building|complex)|condominium (complex|rental agency)|townhouse complex|housing (complex|development)|furnished apartment building|gated community|retirement community|student dormitory|student housing center|teachers housing|police officers housing|militar residence|boarding house|roommate referral service|timeshare agency|display home center|mobile home rental agency|retail space rental agency|executive suite rental agency|office space rental agency|apartment rental agency)\M',1.6),
  (27,3,'trade_head','\m(contractors?|builders?|installers?|installation services?|remodelers?|restoration services?|cleaning services?|cleaners?|repair services?|maintenance|movers?|moving services?|removal services?|inspectors?|sweep|fitting|erector|scaffolder|plumbers?|electricians?|roofers?|carpenters?|painters?|locksmiths?|glaziers?|gardeners?|landscapers?|handyman|joiners?|bricklayers?|pile drivers?|gasfitters?|shopfitters?|upholsterers?|waterproofing company|construction company|building firm)$',2.6),
  (28,4,'health','\m(dentist|dental|doctors?|physicians?|surgeons?|surgery|surgical|clinic|policlinic|hospital|medical|health|healthcare|therapy|therapist|therapists|psychotherapist|psychoanalyst|psychologist|psychiatrist|neuropsychologist|chiropractor|optometrist|ophthalmologist|orthodontist|periodontist|endodontist|prosthodontist|dermatologist|cardiologist|neurologist|oncologist|urologist|gynecologist|obstetrician|pediatrician|radiologist|pathologist|radiotherapist|geriatrician|internist|physiatrist|general practitioner|neurosurgeon|neurophysiologist|orthoptist|pedorthist|venereologist|diabetologist|kinesiologist|kinesiotherapist|reflexologist|seitai|laboratory|nursing|nurse|midwife|doula|assisted living|hospice|rehabilitation|rehab|dialysis|mri|mammography|diagnostic|ambulance|paramedic|first aid|veterinarian|veterinary|vet|animal hospital|animal clinic|urgent care|emergency room|emergency care|acupuncturist|homeopath|naturopath|naturopathic practitioner|osteopath|podiatrist|audiologist|physiotherapist|physiotherapy|addiction|treatment|detox|fertility|ivf|birth|perinatal|pregnancy|family planning|std|hiv|diabetes|cancer|allergist|anesthesiologist|hematologist|rheumatologist|gastroenterologist|nephrologist|pulmonologist|endocrinologist|immunologist|proctologist|hepatologist|otolaryngologist|intensivist|endoscopist|sexologist|counselor|counseling|mental|behavioral|dietitian|nutritionist|lactation|eye care|optician|hearing|denture|orthotics|prosthetics|iv therapy|sleep|speech|occupational|pain management|plastic surgeon|cosmetic dentist|medicine|pharmacist|herbalist|bonesetting|foot care|childbirth|retirement home|sheltered housing|emdr|teeth whitening|home care|home health|home help|nursing home|deaf service|wheelchair|lymph drainage|abortion)\M',2.6),
  (29,11,'social_help','\m(support group|social worker|special educator|student career counseling|adoption agency|foster care|group home|halfway house|homeless|shelter|orphanage|childrens home|crime victim|womens protection|family service|anganwadi|aadhar|aadhaar|favela|domestic abuse|youth care)\M',2.6),
  (30,9,'auto','\m(auto|automobile|automotive|tire service|tires?|engine rebuilding|car|cars|vehicle|motorcycle|motor|truck|trucks|wheel alignment|oil change|towing|tow|rv|recreational vehicle|trailer|scooter|moped|atv|dealer|dealership|dealers|car wash|smog|boat dealer|boat repair|boat storage|boat detailing|marine supply|brake|muffler|transmission|windshield|mechanic|garage|taxi|limousine|car sharing|van rental|bus charter|air taxi)\M',2.2),
  (31,8,'club_venue','\m(night ?club|disco|cabaret|comedy club|jazz club|blues club|rock music club|dance club|carnival club|beach club|country club|host club)\M',2.2),
  (32,7,'sport_club','\m((basketball|badminton|tennis|squash|volleyball|beach volleyball|handball|padel|pickleball|bocce ball|athletic|baseball|softball|football|soccer|rugby|hockey|futsal|cricket|little league|natural rock climbing|swimming|water polo|acrobatic diving|indoor swimming|outdoor swimming|public swimming|ice skating|roller skating|horse riding|archery|skeet shooting|shooting|rowing|weightlifting|sailing event|bmx|tae kwon do comp|boxing|bike|cycling|golf|polo|equestrian|sailing|rowing|ski|surf lifesaving|swim|water skiing|dive|bicycle|hiking|hunting|fishing|gun|motoring|pony|skittle|lawn bowls|curling|kabaddi|go|canoe and kayak|ice hockey|rugby league|little league|boat|yacht|leagues|rsl|sports|athletic|boxing|martial arts|karate|judo|aikido|gymnastics|bmx) club)\M',2.6),
  (33,8,'venue_club','\m(night ?club|disco|cabaret|comedy club|jazz club|blues club|rock music club|dance club|carnival club|beach club|country club|karaoke|casino|gambling|betting|lottery|bingo|escape room|bowling|billiard|pool hall|pachinko|arcade|amusement|laser tag|paintball|theat(er|re)|cinema|movie|opera|concert|music venue|stadium|arena|racetrack|velodrome|bullring|rodeo|fairground|sambodrome|ski resort|resort|hotel|motel|hostel|inn|lodge|lodging|bed and breakfast|guest house|guesthouse|cabin|log cabins|cottage|campground|camping|camp|vacation|holiday|short term|houseboat|villa|chalet|castle|palace|manor|fortress|museum|gallery|exhibit|exhibition|zoo|aquarium|attraction|landmark|monument|historic|heritage\w*|ghost town|park|beach|tour|sightseeing|cruise|travel|visitor|tourist|event|wedding|banquet|reception|conference|convention|function room|party|festival|fair|carnival|circus|performing|auditorium|hall|pavilion|pavillion|amphitheatre|amphitheater|observatory|planetarium|ticket|photo booth|dj|balloon|bouncy|marquee|haunted|trampoline|water park|theme park|golf course|mini golf|driving range|disc golf|botanical|arboretum|garden|statuary|sculpture|art center|cultural center|bridge|pier|lookout|scenic spot|observation deck|ferris wheel|roller coaster|serviced accommodation|serviced apartment|farmstay|dude ranch|mountain hut|lido|stage|orchestra|choir|band|magician|entertainer|musician|reenactment|yakatabune|pumpkin patch|picnic ground|playground|playgroup|hiking area|hunting area|canoeing area|bird watching area|animal watering hole|marina|ranch|orchard|greenhouse|business park|technology park|movie studio|monument maker|sport tour|scuba tour|whale watching|golf driving range|indoor golf|rock climbing area)\M',2.2),
  (34,8,'sport_facility','\m(basketball|badminton|tennis|squash|volleyball|beach volleyball|handball|padel|pickleball|bocce ball|athletic|baseball|softball|football|soccer|rugby|hockey|futsal|cricket|little league|natural rock climbing|swimming|water polo|acrobatic diving|indoor swimming|outdoor swimming|public swimming|ice skating|roller skating|horse riding|archery|skeet shooting|shooting|rowing|weightlifting|sailing event|bmx|tae kwon do comp|boxing|bike|cycling)\M.*\m(courts?|fields?|rinks?|tracks?|ranges?|pools?|grounds?|areas?|facility|complex|competition|lake|ring|pool academy)$',2.6),
  (35,11,'social_club','\m(club|clubs|clubhouse|workers club|childrens club|youth club|social club|conservative club|stamp collectors club|scale model club|traditional costume club|musical club|bridge club|chess|computer club|anime club|board game club)\M',1.6),
  (36,7,'personal_fitness','\m(gym|fitness|yoga|pilates|martial arts|karate|judo|aikido|taekwondo|tae kwon do|kung fu|kickboxing|jiu jitsu|dance|ballet|zumba|aerobics|gymnastics|crossfit|boot camp|personal trainer|trainer|weight loss|sauna|swimming|golf|scuba|boating|water skiing|ice skating|skating|salsa|tennis|squash|badminton|racquetball|pickleball|volleyball|soccer|football|baseball|basketball|softball|hockey|rugby|cricket|curling|rowing|sailing|ski|snowboard|skate|surf|diving|dive|climbing|archery|fencing|polo|equestrian|riding|horseback|sports|athletic|pet groomer|pet grooming|pet sitter|pet boarding|dog walker|dog training|dog day care|kennel|cattery|groomer|tailor|dressmaker|alteration|dry clean\w*|laundry|laundromat|shoe shining|psychic|astrologer|numerologist|fortune telling|photograph\w*|portrait|concierge|babysitter|nanny|house sitter|dating|meditation|retreat|wellness|makeup|beautician|cosmetolog\w*|esthetic|esthetics|aesthetic|waxing|threading|eyebrow|eyelash|tanning|laser hair|electrolysis|barber|body shaping|hypnotherapy|reiki|aromatherapy|indoor cycling|road cycling|wrestling|futsal|parkour|rafting|batting cage|bocce|handball|padel|bike wash|kinesi\w*|mehndi designer|mehandi|life coach|stylist|funeral|mortuary|cremation|casket|pet funeral|hair|nail|salon|spa|massage|health club|fitness club|hairdresser|hammam|foot bath|bath|onsen|bathhouse|thermal baths|tattoo|piercing|beauty|pet trainer|horse trainer|dog trainer|cat trainer|water sports equipment rental service|sports equipment rental service|ski rental service|snowboard rental service|ski repair service|skate sharpening service|art studio|portrait studio|stained glass studio|model portfolio studio|rehearsa studio|recording studio|health resort|permanent make up clinic|skin care clinic|water skiing service|film and photograph library)\M',2.2),
  (37,11,'edu_class','\m(classes|class|lessons?|lesson|courses?|instructors?|tutors?|tutoring|teacher|coaching center|test preparation|driving test|studying center|literacy|apprenticeship|training|education|educational|learning|assistante maternelle|student|donations|conservatory)\M',1.6),
  (38,5,'food','\m(restaurants?|cafe|cafes|coffee|bakery|pizza|pizzeria|grill|brewery|winery|distillery|catering|caterer|diner|bistro|brasserie|eatery|take out|ice cream|donut|doughnut|bagel|juice|smoothie|hot dog|sandwich|noodle|burger|sushi|ramen|taco|kebab|bbq|barbecue|buffet|deli|snack|dessert|pancake|crepe|creperie|dumpling|bar|pub|tavern|lounge|cocktail|hookah|cantina|chocolate|cake|confectionery|pastry|patisserie|candy|cookie|churro|seafood|chicken|rotisserie|salad|tiffin|hawker|takoyaki|vineyard|cider|oxygen cocktail|bartending|soy sauce|sugar|travel lounge|internet cafe|cured ham|obanzai|offal pot|skewer deep frying|donburi|dim sum|fruit parlor|japanese delicatessen|charcuterie|asador|meyhane|dhaba|asador)\M',2.2),
  (39,3,'home_trade','\m(plumb\w*|electric\w*|roof\w*|hvac|heating|air conditioning|furnace|contractors?|builders?|building (firm|inspector)|construction|carpent\w*|cabinet\w*|joiner|bricklayer|painters?|painting|flooring|floor|tile|mason\w*|concrete|fence|garage door|locksmith|pest control|exterminat\w*|clean(er|ers|ing)|janitorial|carpet|window (installation|cleaning|tinting)|gutter\w*|chimney|lawn|landscap\w*|gardener|pool (cleaning|service|contractor)|septic|sewage|drainage?|water (heater|damage|softener|tank|well|purification)|movers?|moving|junk|junkyard|salvage|house clearance|debris|handyman|appliances?|home (inspector|inspection|improvement|staging|builder|automation)|solar|insulation|siding|glazier|drywall|remodel\w*|renovat\w*|restoration|waterproof\w*|impermeabilization|plaster\w*|stucco|demolition|excavat\w*|earth works|paving|asphalt|sandblast\w*|pressure washing|snow removal|scaffold\w*|elevator|fire protection|home security|alarm|antenna|aerial installation|satellite dish|repair|installation|maintenance|upholster\w*|weatherproofing|fireplace|stove|sprinkler|irrigation|blinds|curtain|awning|shutter|wallpaper installer|garbage|sanitation|dumpster|shredding|graffiti|key duplication|sharpening|bee relocation|bird control|crane service|valet|window|piano tuning|computer (repair|security)|beach cleaning|home cinema installation|golf course builder)\M',2.2),
  (40,10,'b2b_niche','\m(equipment|machinery|machine|machinist|tool|tools|welding|welder|metal|steel|iron|aluminum|copper|plating|anodizer|coating|casting|molding|forging|stamping|fabricat\w*|engraver|printer|printing|laser cutting|water jet|3d printing|three d printing|hydraulic|compressor|boiler|pump|valve|chemical|plastic|rubber|paper|textile|fabric|leather|farm|farming|agricultur\w*|livestock|cattle|dairy|poultry|grain|feed|seed|forestry|logging|sawmill|lumber|timber|mining|mine|quarry|oil and gas|petroleum|energy|power|utility|telecommunication\w*|telephone|satellite|data center|web hosting|software|computer|internet|logistics|freight|cargo|shipping|courier|transport\w*|trucking|storage|warehouse|container|packaging|scrap|waste|testing|inspection|geological|mapping|environmental|certification|trading|commercial|corporate|office|uniform|bulk|distribution|delivery|mail\w*|business|company|industry|industrial|research|production|studio|film|video|animation|shipyard|railroad|railway|cable|gravel|coalfield|oilfield|tannery|slaughterhouse|cannery|dyeworks|weaving|sewing|stone|glass|wood\w*|knife|saw|turnery|toolroom|silversmith|goldsmith|coppersmith|blacksmith|lapidary|gemologist|taxidermist|sailmaker|piano|instrument|embroidery|embossing|lamination|monogramming|fur|horseshoe smith|farrier|sheep shearer|livery|aircraft|aerospace|automation|biotechnology|pharmaceutical|metallurgy|topography|scenography|desktop publishing|drone|aerial|photo lab|weather|water|record company|airline|ferry|river port|media|news|television|radio|newspaper|broadcaster|recycling|airport shuttle|school bus|aquaculture|orchid|honey|pig|shrimp|bus company|customs warehouse|closed circuit|mercantile|chamber of handicrafts|energy advisory|e commerce service|data recovery service|fax service|blueprint service|drafting service|information services|coworking space|makerspace|payment terminal|package locker|cell phone charging station|coin operated locker|mobile network operator|tower communication service|music management and promotion|security guard service|security service|furniture rental service)\M',1.6),
  (41,11,'edu_nonprofit','\m(library|archive|charity|foundation|association|associations|society|union|nonprofit|ngo|organization|organisation|council|committee|federation|cooperative|community|youth|senior|volunteer|scout|scouting|chamber of commerce|cemetery|child care|daycare|day care|head start|asylum|welfare|recycling|donations|animal (shelter|protection|control|rescue)|wildlife rescue|national forest|national reserve)\M',1.6)
),
schema_map(st,grp,w) as (values
  ('AccountingService',1,1.5),
  ('Airline',10,1.0),
  ('Airport',11,1.5),
  ('AmusementPark',8,1.3),
  ('AnimalShelter',11,1.5),
  ('Aquarium',8,1.3),
  ('ArchiveOrganization',11,1.5),
  ('ArtGallery',8,1.3),
  ('Attorney',1,1.5),
  ('AutoBodyShop',9,1.5),
  ('AutoDealer',9,1.5),
  ('AutoPartsStore',9,1.5),
  ('AutoRental',9,1.5),
  ('AutoRepair',9,1.5),
  ('AutoWash',9,1.5),
  ('AutomatedTeller',2,1.5),
  ('Bakery',5,1.5),
  ('BankOrCreditUnion',2,1.5),
  ('BarOrPub',5,1.5),
  ('BeautySalon',7,1.5),
  ('BedAndBreakfast',8,1.3),
  ('BikeStore',6,1.5),
  ('BoatTerminal',11,1.5),
  ('BookStore',6,1.5),
  ('BowlingAlley',8,1.3),
  ('Brewery',5,1.5),
  ('Bridge',11,1.5),
  ('BuddhistTemple',11,1.5),
  ('CafeOrCoffeeShop',5,1.5),
  ('Campground',8,1.3),
  ('Casino',8,1.3),
  ('CatholicChurch',11,1.5),
  ('Cemetery',11,1.5),
  ('ChildCare',11,1.5),
  ('Church',11,1.5),
  ('CityHall',11,1.5),
  ('CivicStructure',11,0.6),
  ('ClothingStore',6,1.5),
  ('CollegeOrUniversity',11,1.5),
  ('ComedyClub',8,1.3),
  ('ComputerStore',6,1.5),
  ('ConvenienceStore',6,1.5),
  ('Courthouse',11,1.5),
  ('DanceGroup',8,1.3),
  ('DaySpa',7,1.5),
  ('Dentist',4,1.5),
  ('DepartmentStore',6,1.5),
  ('Distillery',5,1.5),
  ('DryCleaningOrLaundry',7,1.5),
  ('Electrician',3,1.5),
  ('ElectronicsStore',6,1.5),
  ('ElementarySchool',11,1.5),
  ('Embassy',11,1.5),
  ('EmergencyService',11,1.5),
  ('EmploymentAgency',1,1.5),
  ('EntertainmentBusiness',8,1.3),
  ('EventVenue',8,1.3),
  ('ExerciseGym',7,1.5),
  ('FastFoodRestaurant',5,1.5),
  ('Festival',8,1.3),
  ('FinancialService',2,1.5),
  ('FireStation',11,1.5),
  ('Florist',6,1.5),
  ('FoodEstablishment',5,1.5),
  ('FoodService',5,1.5),
  ('FurnitureStore',6,1.5),
  ('GardenStore',6,1.5),
  ('GasStation',9,1.5),
  ('GeneralContractor',3,1.5),
  ('GolfCourse',8,1.3),
  ('GovernmentBuilding',11,1.5),
  ('GovernmentOffice',11,1.5),
  ('GroceryStore',6,1.5),
  ('HairSalon',7,1.5),
  ('HardwareStore',6,1.5),
  ('HealthAndBeautyBusiness',7,0.7),
  ('HealthAndBeautyBusiness',4,0.3),
  ('HealthClub',7,1.5),
  ('HighSchool',11,1.5),
  ('HinduTemple',11,1.5),
  ('HomeAndConstructionBusiness',3,1.5),
  ('HomeGoodsStore',6,1.5),
  ('Hospital',4,1.5),
  ('Hostel',8,1.3),
  ('Hotel',8,1.3),
  ('HousePainter',3,1.5),
  ('IceCreamShop',5,1.5),
  ('InsuranceAgency',2,1.5),
  ('JewelryStore',6,1.5),
  ('LandmarksOrHistoricalBuildings',8,1.3),
  ('LegalService',1,1.5),
  ('LegislativeBuilding',11,1.5),
  ('Library',11,1.5),
  ('LiquorStore',6,1.5),
  ('Locksmith',3,1.5),
  ('LodgingBusiness',8,1.3),
  ('MedicalBusiness',4,1.5),
  ('MedicalClinic',4,1.5),
  ('MedicalOrganization',4,1.5),
  ('MensClothingStore',6,1.5),
  ('MiddleSchool',11,1.5),
  ('Mosque',11,1.5),
  ('Motel',8,1.3),
  ('MotorcycleDealer',9,1.5),
  ('MotorcycleRepair',9,1.5),
  ('MovieRentalStore',6,1.5),
  ('MovieTheater',8,1.3),
  ('MovingCompany',3,1.5),
  ('Museum',8,1.3),
  ('MusicGroup',8,1.3),
  ('MusicStore',6,1.5),
  ('NGO',11,1.5),
  ('NailSalon',7,1.5),
  ('NightClub',8,1.3),
  ('Notary',1,1.5),
  ('Optician',4,1.5),
  ('OutletStore',6,1.5),
  ('Painting',8,1.3),
  ('Park',8,1.3),
  ('ParkingFacility',11,1.5),
  ('PawnShop',6,1.5),
  ('PerformingArtsTheater',8,1.3),
  ('PerformingGroup',8,1.3),
  ('PetStore',6,1.5),
  ('Pharmacy',6,1.5),
  ('Physician',4,1.5),
  ('PlaceOfWorship',11,1.5),
  ('Playground',8,1.3),
  ('Plumber',3,1.5),
  ('PoliceStation',11,1.5),
  ('PoliticalParty',11,1.5),
  ('PostOffice',11,1.5),
  ('Preschool',11,1.5),
  ('ProfessionalService',1,1.0),
  ('PublicSwimmingPool',8,1.3),
  ('PublicToilet',11,1.5),
  ('RVPark',8,1.3),
  ('RadioStation',10,1.0),
  ('RealEstateAgent',1,1.5),
  ('RecyclingCenter',11,1.5),
  ('Resort',8,1.3),
  ('Restaurant',5,1.5),
  ('RoofingContractor',3,1.5),
  ('School',11,1.5),
  ('Sculpture',8,1.3),
  ('ShippingService',10,1.0),
  ('ShoeStore',6,1.5),
  ('ShoppingCenter',6,1.5),
  ('SkiResort',8,1.3),
  ('SportingGoodsStore',6,1.5),
  ('SportsActivityLocation',7,0.5),
  ('SportsActivityLocation',8,0.5),
  ('SportsClub',7,1.5),
  ('StadiumOrArena',8,1.3),
  ('Store',6,0.8),
  ('Store',10,0.3),
  ('Synagogue',11,1.5),
  ('TattooParlor',7,1.5),
  ('TaxiService',10,1.0),
  ('TaxiStand',11,1.5),
  ('TelevisionStation',10,1.0),
  ('TireShop',9,1.5),
  ('TouristAttraction',8,1.3),
  ('ToyStore',6,1.5),
  ('TrainStation',11,1.5),
  ('TravelAgency',8,1.3),
  ('VeterinaryCare',4,1.5),
  ('Winery',5,1.5),
  ('Zoo',8,1.3)
),
arch_map(cta,cl,grp,w) as (values
  ('Reserve a table','Awards',5,2.0),
  ('Book an appointment','Credentials & licenses',4,2.0),
  ('Book an appointment','Credentials & licenses',7,0.3),
  ('Contact dealer','Certifications',9,2.0),
  ('Get a quote','Licenses & certifications',3,2.0),
  ('Request a consultation','Bar admissions',1,2.0),
  ('Request a quote','Licenses',2,1.5),
  ('Request a quote','Licenses',1,0.5),
  ('Check availability','Credentials',8,2.0),
  ('Contact agent','Licenses',1,2.0),
  ('Get pre-qualified','Licenses',2,2.0),
  ('Learn more','Accreditation',11,1.5),
  ('Learn more','Accreditation',7,0.3),
  ('Get directions','Credentials',11,0.8),
  ('Get directions','Credentials',8,0.8),
  ('Visit store','Credentials',6,0.8),
  ('Visit store','Credentials',10,0.7),
  ('Visit store','Credentials',9,0.3)
),
hit as (select c.gcid, r.ord, r.grp, r.tag, r.w from c join rules r on c.nm ~ r.rx),
first as (select distinct on (gcid) gcid, ord, grp, tag, w from hit order by gcid, ord),
alt as (select distinct on (h.gcid) h.gcid, h.grp, h.tag from hit h join first f on f.gcid=h.gcid and h.grp<>f.grp order by h.gcid, h.ord),
comp as (
  select gcid, 4 grp, 1.0 w from c where hipaa
  union all select gcid, 11, 0.2 from c where hipaa
  union all select gcid, 5, 0.5 from c where age  union all select gcid, 6, 0.4 from c where age  union all select gcid, 8, 0.3 from c where age
  union all select gcid, 2, 0.3 from c where glba union all select gcid, 1, 0.2 from c where glba
  union all select gcid, 1, 0.8 from c where reg ~* 'State Bar|Bar Association|Rules of Professional Conduct|Legal Services|Supreme Court'
  union all select gcid, 11, 0.8 from c where reg ~* '501\(c\)|Charit|Nonprofit|Non-profit|Attorney General.*Charit'
  union all select gcid, 11, 0.6 from c where reg ~* 'Department of Education|Accredit|Ministry of Education|FERPA|School Board|Higher Education'
  union all select gcid, 3, 0.6 from c where reg ~* 'Contractor|Building (Code|Department|Authority)|Plumbing|Electrical (Board|Safety)|Home Improvement|Building Standards|Construction'
  union all select gcid, 5, 0.5 from c where reg ~* 'Alcohol|ABC|TTB|Liquor|Tobacco'
  union all select gcid, 6, 0.5 from c where reg ~* 'Cannabis|Marijuana|Firearms|Gaming|Lottery' or reg ~ 'ATF'
  union all select gcid, case when lic like 'NMLS%' or lic like 'CRD%' or lic like 'Insurance%' then 2
                              when lic like 'Medical%' or lic like 'Dental%' then 4
                              when lic like 'Bar%' or lic like 'RE %' then 1
                              when lic like 'Cannabis%' then 6 end, 1.5 from c where lic is not null
),
votes as (
  select gcid, grp, w from first
  union all select gcid, grp, 0.8 from alt
  union all select c.gcid, s.grp, s.w from c join schema_map s on s.st=c.st
  union all select c.gcid, a.grp, a.w from c join arch_map a on a.cta=c.cta and a.cl=c.cl
  union all select gcid, grp, w from comp where grp is not null
  union all select gcid, 4, 1.0 from c where n_med>0
  union all select gcid, 8, 0.8 from c where n_lodge>0
),
v0 as (select gcid, grp, sum(w) w from votes group by 1,2),
tot0 as (select gcid, sum(w) t, max(w) top from v0 group by 1),
sh0 as (select v0.gcid, v0.grp, v0.w/t.t sh from v0 join tot0 t using(gcid)),
edges as (select primary_gcid a, secondary_gcid b, relevance::numeric rel from exp_category_secondaries
          union all select secondary_gcid, primary_gcid, relevance::numeric from exp_category_secondaries),
gnum as (select e.a gcid, s.grp, sum(e.rel*least(1,t.top/3.0)*s.sh) num
         from edges e join tot0 t on t.gcid=e.b join sh0 s on s.gcid=e.b group by 1,2),
gw as (select e.a gcid, sum(e.rel*least(1,t.top/3.0)) tw from edges e join tot0 t on t.gcid=e.b group by 1),
v as (select gcid, grp, sum(w) w from (
        select gcid, grp, w from v0
        union all select gn.gcid, gn.grp, 1.2*gn.num/gw.tw*least(1,gw.tw/1.5) from gnum gn join gw using(gcid) where gw.tw>0
      ) x group by 1,2),
ranked as (select gcid, grp, w, row_number() over (partition by gcid order by w desc, grp) rn from v),
res as (
  select r1.gcid, r1.grp, r2.grp alt_grp, r1.w as top_w, coalesce(r2.w,0) as sec_w
  from ranked r1 left join ranked r2 on r2.gcid=r1.gcid and r2.rn=2 where r1.rn=1
)
select c.gcid, res.grp, res.alt_grp,
       round((res.top_w/(res.top_w+res.sec_w) * (0.5+0.5*least(1,res.top_w/6.0))
              * case when c.sr like 'longtail%' then 0.8 else 1 end)::numeric, 3) as conf,
       f.tag as name_rule, a.tag as name_rule_alt
from c join res using(gcid) left join first f using(gcid) left join alt a using(gcid)
order by c.gcid;

-- =====================================================================================
-- SIBLING CLUSTERS (script: clus.py / final.py, not SQL).  Edge score between two categories of the SAME final group:
--   +1.0 (+0.2 if reciprocal) exp_category_secondaries relevance >= 0.9 ; +0.5 (+0.2) relevance 0.7-0.8
--   +0.5 per shared normalised alias (exp_taxonomy level='alias', alias held by 2..8 categories), capped at 3 aliases
--   +0.7 alias of A == display_name of B (900 such aliases exist)
--   +0.4 per shared rare informative name token (token held by <=15 categories, generic head nouns excluded)
--   +2.0 authored exp_category_boundary pairs (mortgage_lender/broker, real_estate_agents/agency, insurance_agent/agency)
--   clusters = connected components over edges with score >= 1.2; any component > 12 members is re-split recursively at
--   +0.25 thresholds.  'family' = same method at threshold 1.0 and max 25 (looser parent grouping).
-- DEMAND TIER (script): supply = max(gbp_categories.estimated_locations, estimated_profiles); T1 >= 75,000; T2 15,000-74,999;
--   T3 2,000-14,999; T4 < 2,000 or 0; us_relevance 'none' -> T4, 'low' -> one tier down; priority_tier=1 -> T1;
--   public-infrastructure nouns (bridge, parking, fountain, wi fi spot, ...) -> T4.
