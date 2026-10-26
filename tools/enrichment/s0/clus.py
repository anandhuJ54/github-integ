import sys,collections,re,json
sys.path.insert(0,'.')
from s0 import *
tax=json.load(open('tax.json'))['rows']
def norm(t):
    t=t.lower(); t=re.sub(r'[^a-z0-9 ]+',' ',t); t=re.sub(r'\b(near me|nearby|local|the|a|an|and|of|in|for)\b',' ',t); return ' '.join(t.split())
al=collections.defaultdict(set)
for t in tax:
    if t['level']=='alias':
        n=norm(t['t'])
        if n: al[n].add(t['gcid'])
dn=collections.defaultdict(set)
for r in rows: dn[norm(r['display_name'])].add(r['gcid'])
GEN={'restaurant','restaurants','store','shop','service','services','center','centre','school','church','supplier','suppliers','club','company','agency','office','dealer','repair','market','wholesaler','manufacturer','facility','association','organization','institute','academy','college','university','and','the','for','shops','stores','clinic','specialist','provider','group','studio','contractor','retailer','house','hall','park','area','station','point','place','spot','stand'}
toks={r['gcid']:[t for t in r['nm'].split() if t not in GEN and len(t)>=4] for r in rows}
tokfreq=collections.Counter(t for v in toks.values() for t in set(v))
E=collections.defaultdict(float); why=collections.defaultdict(set)
def add(a,b,w,tag):
    if a==b: return
    k=(a,b) if a<b else (b,a); E[k]+=w; why[k].add(tag)
grp={r['gcid']:r['grp'] for r in rows}
relmap={}
for e in sec:
    rel=float(e['r']); k=(e['p'],e['s']); relmap[k]=rel
for (p,s),rel in relmap.items():
    if grp[p]!=grp[s]: continue
    recip=(s,p) in relmap
    if rel>=0.9: add(p,s,1.0+(0.2 if recip else 0),'sec.9')
    elif rel>=0.7:
        add(p,s,0.5+(0.2 if recip else 0),'sec.7')
# shared aliases
pairc=collections.Counter()
for a,g in al.items():
    if 2<=len(g)<=8:
        gl=sorted(g)
        for i in range(len(gl)):
            for j in range(i+1,len(gl)):
                if grp.get(gl[i])==grp.get(gl[j]): pairc[(gl[i],gl[j])]+=1
for (a,b),c in pairc.items(): add(a,b,0.5*min(c,3),f'alias x{c}')
# alias == other category's display name
for a,g in al.items():
    if a in dn:
        for x in g:
            for y in dn[a]:
                if x!=y and grp.get(x)==grp.get(y): add(x,y,0.7,'alias=name')
# informative shared tokens (rare tokens only)
bytok=collections.defaultdict(list)
for gc,ts in toks.items():
    for t in set(ts):
        if tokfreq[t]<=15: bytok[t].append(gc)
for t,gl in bytok.items():
    for i in range(len(gl)):
        for j in range(i+1,len(gl)):
            if grp[gl[i]]==grp[gl[j]]: add(gl[i],gl[j],0.4,'tok:'+t)
# authored boundary pairs
for a,b in [('gcid:mortgage_lender','gcid:mortgage_broker'),('gcid:real_estate_agents','gcid:real_estate_agency'),('gcid:insurance_agent','gcid:insurance_agency')]:
    add(a,b,2.0,'boundary')
def comps(edges,nodes):
    par={n:n for n in nodes}
    def f(x):
        while par[x]!=x: par[x]=par[par[x]]; x=par[x]
        return x
    for (a,b) in edges: par[f(a)]=f(b)
    out=collections.defaultdict(list)
    for n in nodes: out[f(n)].append(n)
    return list(out.values())
nodes=[r['gcid'] for r in rows]
def build(thr=1.0,maxsize=30):
    final=[]; work=[(nodes,thr)]
    while work:
        ns,t=work.pop()
        es=[k for k,w in E.items() if w>=t and k[0] in S and k[1] in S] if False else None
    return final

MAX=25
def split(ns,thr):
    S=set(ns)
    es=[k for k,w in E.items() if w>=thr and k[0] in S and k[1] in S]
    out=[]
    for c in comps(es,ns):
        if len(c)>MAX and thr<3.6: out.extend(split(c,thr+0.25))
        else: out.append(c)
    return out
cl=split(nodes,1.0)
# re-attach fragments: singletons with an edge >=1.0 to a cluster of size>=2 -> best cluster (only if that cluster has room)
where={}
for i,c in enumerate(cl):
    for n in c: where[n]=i
adj=collections.defaultdict(list)
for (a,b),w in E.items():
    adj[a].append((b,w)); adj[b].append((a,w))
for i,c in enumerate(cl):
    if len(c)==1:
        n=c[0]; sc=collections.Counter()
        for m,w in adj[n]:
            j=where[m]
            if j!=i and len(cl[j])>=2: sc[j]+=w
        if sc:
            j,w=sc.most_common(1)[0]
            if w>=1.0 and len(cl[j])<MAX+10:
                cl[j].append(n); cl[i]=[]; where[n]=j
cl=[c for c in cl if c]
cl.sort(key=lambda c:(-len(c),min(c)))
cid={}
for i,c in enumerate(cl):
    if len(c)>=2:
        for n in c: cid[n]=f"C{i+1:04d}"
multi=[c for c in cl if len(c)>=2]
for r in rows: r['cid']=cid.get(r['gcid'])
