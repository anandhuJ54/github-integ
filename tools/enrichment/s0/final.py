import sys,csv,json,collections,re,statistics
sys.path.insert(0,'.')
import clus
from clus import *      # rows (with grp, conf, sig, alt, margin), E, comps, nodes, cl (loose), multi
# ---------- clusters: tight (siblings) and family (loose)
clus.MAX=12; tight=[c for c in clus.split(nodes,1.2) if len(c)>=2]
tight.sort(key=lambda c:(-len(c),min(c)))
tid={}
for i,c in enumerate(tight):
    for n in c: tid[n]=f"S{i+1:04d}"
fam=multi   # MAX 25 family-level from clus.py (already sorted)
fid={}
for i,c in enumerate(fam):
    for n in c: fid[n]=f"F{i+1:04d}"
def hub(c):
    cs=set(c); d=collections.Counter()
    for (a,b),w in E.items():
        if a in cs and b in cs: d[a]+=w; d[b]+=w
    return d.most_common(1)[0][0]
# ---------- tiers (supply-based; LLM-estimated counts)
INFRA=re.compile(r'\b(bridge|parking|fountain|wi fi spot|bathroom|bicycle rack|boat ramp|promenade|rest stop|toll|weigh station|pedestrian zone|weir|memorial|emergency call station|carpool|rideshare)\b')
def tier(r):
    sup=max(r['el'] or 0,r['ep'] or 0)
    if INFRA.search(r['nm']): return 4
    t=1 if sup>=75000 else 2 if sup>=15000 else 3 if sup>=2000 else 4
    if sup==0: t=4
    if r['ur']=='none': t=4
    elif r['ur']=='low': t=min(4,t+1)
    if r['pt']==1: t=1
    return t
PERSON=re.compile(r'(ist|ian|ologist|practitioner|therapist|instructor|trainer|tutor|agent|broker|consultant|advisor|adviser|surgeon|physician|doctor|nurse|midwife|doula|attorney|lawyer|barrister|solicitor|accountant|architect|engineer|notary|counselor|planner|designer|photographer|artist|stylist|barber|tailor|dressmaker|mechanic|electrician|plumber|carpenter|painter|locksmith|welder|farrier|appraiser|surveyor|inspector|auditor|translator|interpreter|recruiter|executor|liquidator|celebrant|priest|clergyman|rabbi|imam|pastor|mohel|magician|musician|entertainer|dj|performer|coach|guide|babysitter|nanny|sitter|walker|groomer|breeder|bricklayer|joiner|glazier|gardener|landscaper|handyman|sweep|remodeler|sculptor|goldsmith|silversmith|blacksmith|taxidermist|gemologist|herbalist|homeopath|osteopath|acupuncturist|chiropractor|optician|psychic|astrologer|numerologist|genealogist|beautician|loctician|technician|conveyancer|organizer|decorator|dietitian|nutritionist|kinesiologist|audiologist|pathologist)$')
EST=re.compile(r'\b(clinic|hospital|center|centre|shop|salon|spa|studio|agency|firm|office|school|service|services|company|store|institute|association|group|practice|club|facility|house|home|parlor|gym)$')
FPNOUN=re.compile(r'(producer|florist|church|breeder|farmer)$')
low_ct=0
for r in rows:
    r['sup']=max(r['el'] or 0,r['ep'] or 0)
    r['tier']=tier(r)
    flags=[]
    if r['sr'] and r['sr'].startswith('longtail'): flags.append('untyped_schema'); r['conf']=round(r['conf']*0.8,3)
    if r['nf'] and r['nf'][1]=='adult_adjacent': flags.append('adult_adjacent')
    if r['nf'] and r['grp']!=r['nf'][0]: flags.append('name_vs_final_conflict'); 
    if not r['nf']: flags.append('no_name_rule')
    if r['shape']=='location_first' and PERSON.search(r['nm']) and not FPNOUN.search(r['nm']): flags.append('loc_but_person_noun')
    if r['shape']=='professional_first' and EST.search(r['nm']) and not PERSON.search(r['nm']): flags.append('pro_but_place_noun')
    if r['shape']=='professional_first' and r['grp'] in (5,6,8,9,10): flags.append('pro_first_in_nonpro_group')
    if r['el'] in (0,None) and not r['ep']: flags.append('no_supply_estimate')
    if INFRA.search(r['nm']): flags.append('non_searchable_infrastructure')
    if r['ec']=='low': flags.append('low_conf_estimate')
    r['flags']=flags
    r['cluster_id']=tid.get(r['gcid']); r['family_id']=fid.get(r['gcid'])
    r['signals']=';'.join(r['sig'])
    r['conf_band']='high' if r['conf']>=0.8 else 'medium' if r['conf']>=0.55 else 'low'
def title(slug): return slug.replace('_',' ').capitalize()
for r in rows:
    dn=r['display_name'] or title(r['slug'])
    r['dn']=dn
if __name__=='__main__':
    out='/private/tmp/claude-505/-Users-scott-experiencesrp/36311a22-7894-4d1e-80e1-ee935dfa9add/scratchpad/'
    with open(out+'s0_classification.csv','w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['gcid','display_name','group','group_name','confidence','conf_band','alt_group','signals','cluster_id','family_id','entity_type','demand_tier','est_supply','flags'])
        for r in rows:
            w.writerow([r['gcid'],r['dn'],r['grp'],GROUPS[r['grp']],r['conf'],r['conf_band'],r['alt'] or '',r['signals'],r['cluster_id'] or '',r['family_id'] or '',r['entity_type'],f"T{r['tier']}",r['sup'],'|'.join(r['flags'])])
    clusters=[]
    for i,c in enumerate(tight):
        h=hub(c); clusters.append({'cluster_id':f"S{i+1:04d}",'size':len(c),'group':collections.Counter(grp[x] for x in c).most_common(1)[0][0],'hub':h,'members':sorted(c)})
    fams=[{'family_id':f"F{i+1:04d}",'size':len(c),'hub':hub(c),'members':sorted(c)} for i,c in enumerate(fam)]
    data={'meta':{'stage':'S0','generated':'2026-10-15','n_categories':len(rows),'groups':GROUPS,'method':'rules over existing data: name-rule (rules_v3 / s0_rules.sql) + schema_type + profile_config archetype + compliance + node-registry + secondaries-graph propagation; see s0_rules.sql','confidence_bands':'high>=0.80 medium 0.55-0.80 low<0.55'},
          'categories':[{'gcid':r['gcid'],'display_name':r['dn'],'group':r['grp'],'group_name':GROUPS[r['grp']],'confidence':r['conf'],'alt_group':r['alt'],'signals':r['sig'],'cluster_id':r['cluster_id'],'family_id':r['family_id'],'entity_type':r['entity_type'],'demand_tier':f"T{r['tier']}",'est_supply':r['sup'],'flags':r['flags']} for r in rows],
          'sibling_clusters':clusters,'families':fams}
    json.dump(data,open(out+'s0_classification.json','w'),indent=1)
    print('written',len(rows))
