import sys,json,re,collections,math
sys.path.insert(0,'.')
from feat import *   # rows with nf, na, rc
sec=json.load(open('sec.json'))['rows']
GROUPS={1:'Professional services',2:'Finance and insurance',3:'Home and trade services',4:'Health and medical',5:'Restaurants, food and drink',6:'Retail and regulated retail',7:'Personal services and fitness',8:'Lodging, venues and events',9:'Auto',10:'B2B and niche',11:'Civic, religious, education and nonprofit'}
W3={'sport_school','restaurant_head','b2b_head','retail_head','school_head','prof_head','religious','food_bank','fuel_station','shop_auto','shop_auto2','personal_exc','venue_exc','tree','med_lab_exc','civic_exc','food_shop'}
W26={'finance','health','civic_gov','trade_head','sport_facility','sport_club','social_help','shop_repair'}
W16={'b2b_niche','edu_nonprofit','edu_class','social_club','residential_prop','adult_adjacent'}
W6={'b2b_head','personal_exc','venue_exc','tree','med_lab_exc','civic_exc','sport_school','shop_industrial','shop_auto','shop_auto2','shop_repair'}
def nw(tag): return 6.0 if tag in W6 else 4.5 if tag in W3 else 2.6 if tag in W26 else 1.6 if tag in W16 else 2.2
SCH={ # schema_type -> {group:weight}  (specific types 1.5, generic 0.6-1.0)
}
def addmap(types,g,w):
    for t in types.split(','): SCH[t]={g:w}
addmap('Restaurant,BarOrPub,CafeOrCoffeeShop,Bakery,FastFoodRestaurant,FoodEstablishment,FoodService,Brewery,IceCreamShop,Winery,Distillery',5,1.5)
addmap('Physician,Dentist,Hospital,MedicalClinic,MedicalBusiness,MedicalOrganization,VeterinaryCare,Optician',4,1.5)
addmap('Attorney,LegalService,Notary,AccountingService,RealEstateAgent,EmploymentAgency',1,1.5)
SCH['ProfessionalService']={1:1.0}
addmap('InsuranceAgency,BankOrCreditUnion,FinancialService,AutomatedTeller',2,1.5)
addmap('HomeAndConstructionBusiness,Plumber,Electrician,RoofingContractor,GeneralContractor,Locksmith,MovingCompany,HousePainter',3,1.5)
addmap('AutoDealer,AutoRepair,AutoRental,AutoWash,AutoBodyShop,AutoPartsStore,MotorcycleDealer,MotorcycleRepair,TireShop,GasStation',9,1.5)
addmap('LodgingBusiness,Hotel,Motel,Hostel,BedAndBreakfast,Resort,Campground,RVPark,EventVenue,PerformingArtsTheater,MovieTheater,TouristAttraction,Museum,Zoo,Aquarium,AmusementPark,Casino,NightClub,ComedyClub,StadiumOrArena,SkiResort,GolfCourse,BowlingAlley,ArtGallery,TravelAgency,Park,LandmarksOrHistoricalBuildings,EntertainmentBusiness,Festival,PublicSwimmingPool,Playground,Sculpture,Painting,MusicGroup,PerformingGroup,DanceGroup',8,1.3)
addmap('DaySpa,BeautySalon,HairSalon,NailSalon,TattooParlor,ExerciseGym,HealthClub,SportsClub,DryCleaningOrLaundry',7,1.5)
SCH['HealthAndBeautyBusiness']={7:0.7,4:0.3}
SCH['SportsActivityLocation']={7:0.5,8:0.5}
addmap('School,Preschool,ElementarySchool,MiddleSchool,HighSchool,CollegeOrUniversity,Church,PlaceOfWorship,Synagogue,Mosque,HinduTemple,BuddhistTemple,CatholicChurch,GovernmentOffice,GovernmentBuilding,CityHall,Courthouse,PoliceStation,FireStation,Embassy,PostOffice,Library,NGO,PoliticalParty,Cemetery,Airport,TrainStation,ArchiveOrganization,RecyclingCenter,PublicToilet,ParkingFacility,AnimalShelter,ChildCare,LegislativeBuilding,EmergencyService,TaxiStand,BoatTerminal,Bridge',11,1.5)
SCH['CivicStructure']={11:0.6}
addmap('TelevisionStation,RadioStation,Airline,TaxiService,ShippingService',10,1.0)
addmap('FurnitureStore,ClothingStore,GroceryStore,BookStore,Pharmacy,LiquorStore,PawnShop,Florist,PetStore,GardenStore,HardwareStore,ComputerStore,ElectronicsStore,ShoeStore,JewelryStore,MusicStore,BikeStore,ToyStore,MovieRentalStore,OutletStore,ShoppingCenter,DepartmentStore,HomeGoodsStore,MensClothingStore,SportingGoodsStore,ConvenienceStore',6,1.5)
SCH['Store']={6:0.8,10:0.3}
ARCH={ # (cta,credential_label) -> votes
 ('Reserve a table','Awards'):{5:2.0},
 ('Book an appointment','Credentials & licenses'):{4:2.0,7:0.3},
 ('Contact dealer','Certifications'):{9:2.0},
 ('Get a quote','Licenses & certifications'):{3:2.0},
 ('Request a consultation','Bar admissions'):{1:2.0},
 ('Request a quote','Licenses'):{2:1.5,1:0.5},
 ('Check availability','Credentials'):{8:2.0},
 ('Contact agent','Licenses'):{1:2.0},
 ('Get pre-qualified','Licenses'):{2:2.0},
 ('Learn more','Accreditation'):{11:1.5,7:0.3},
 ('Get directions','Credentials'):{11:0.8,8:0.8},
 ('Visit store','Credentials'):{6:0.8,10:0.7,9:0.3},
}
def comp_votes(r):
    v=collections.Counter()
    if r['hipaa']: v[4]+=1.0; v[11]+=0.2
    if r['age']: v[5]+=0.5; v[6]+=0.4; v[8]+=0.3
    if r['glba']: v[2]+=0.3; v[1]+=0.2
    rc=set(r['rc'])
    if 'BAR' in rc: v[1]+=0.8
    if 'NPO' in rc: v[11]+=0.8
    if 'EDU' in rc: v[11]+=0.6
    if 'CON' in rc: v[3]+=0.6
    if 'ABC' in rc: v[5]+=0.5
    if 'CAN' in rc: v[6]+=0.5
    lic=r.get('lic')
    if lic:
        for k,g in (('NMLS',2),('CRD',2),('Insurance',2),('Medical',4),('Dental',4),('Bar',1),('RE ',1),('Cannabis',6)):
            if lic.startswith(k): v[g]+=1.5
    return v
for r in rows:
    v=collections.Counter(); sig=[]
    if r['nf']:
        g,t=r['nf']; v[g]+=nw(t); sig.append(f"N:{t}")
    if r['na']:
        g,t=r['na']; v[g]+=0.8; sig.append(f"N2:{t}")
    for g,w in SCH.get(r['st'],{}).items(): v[g]+=w
    if r['st'] and SCH.get(r['st']): sig.append(f"S:{r['st']}")
    a=ARCH.get((r['cta'],r['cl']))
    if a:
        for g,w in a.items(): v[g]+=w
        sig.append(f"A:{r['cta']}")
    cv=comp_votes(r)
    for g,w in cv.items(): v[g]+=w
    if cv: sig.append('C:'+'+'.join([k for k in ('hipaa','age','glba') if r[k]]+[c for c in r['rc'] if c in ('BAR','NPO','EDU','CON','ABC','CAN')]))
    if (r['n_med'] or 0)>0: v[4]+=1.0; sig.append('Nd:med')
    if (r['n_lodge'] or 0)>0: v[8]+=0.8; sig.append('Nd:lodge')
    r['v0']=v; r['sig']=sig
# graph propagation
nbr=collections.defaultdict(list)
idx={r['gcid']:r for r in rows}
for e in sec:
    rel=float(e['r'])
    nbr[e['p']].append((e['s'],rel)); nbr[e['s']].append((e['p'],rel))
def share(v):
    t=sum(v.values()); return {g:x/t for g,x in v.items()} if t>0 else {}
for r in rows: r['sh0']=share(r['v0']); r['top0']=max(r['v0'].values()) if r['v0'] else 0
for r in rows:
    v=collections.Counter(r['v0']); tw=0; gv=collections.Counter()
    for n,rel in nbr[r['gcid']]:
        nr=idx.get(n)
        if not nr or not nr['sh0']: continue
        wt=rel*min(1,nr['top0']/3.0)
        for g,s in nr['sh0'].items(): gv[g]+=wt*s
        tw+=wt
    if tw>0:
        for g,x in gv.items(): v[g]+=1.2*x/tw*min(1,tw/1.5)
        r['sig'].append(f"G:{len(nbr[r['gcid']])}nb")
    r['gv']=gv; r['v']=v
def finalize(r):
    v=r['v']
    if not v: r['grp']=None; r['conf']=0.1; return
    ranked=sorted(v.items(),key=lambda x:-x[1])
    g,top=ranked[0]; tot=sum(v.values())
    second=ranked[1][1] if len(ranked)>1 else 0
    sh=top/(top+second) if top+second>0 else 0
    ev=min(1,top/6.0)
    conf=sh*(0.5+0.5*ev)
    if len(ranked)>1: r['alt']=ranked[1][0]; r['margin']=(top-ranked[1][1])/tot
    else: r['alt']=None; r['margin']=1
    r['grp']=g; r['conf']=round(min(conf,0.99),3)
for r in rows: finalize(r)
