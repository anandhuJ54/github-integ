import sys; sys.path.insert(0,'.')
import rules_v3, s0
from s0 import SCH, ARCH, nw
def q(s): return "'"+s.replace("'","''")+"'"
rules=",\n".join(f"  ({i+1},{g},{q(t)},{q(rx)},{nw(t)})" for i,(g,t,rx) in enumerate(rules_v3.RULES))
sch=",\n".join(f"  ({q(st)},{g},{w})" for st,m in sorted(SCH.items()) for g,w in m.items())
arch=",\n".join(f"  ({q(k[0])},{q(k[1])},{g},{w})" for k,m in ARCH.items() for g,w in m.items())
sql=f"""-- =====================================================================================
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
-- Note: the Python pipeline that produced s0_classification.csv uses the identical rule table and weights;
-- this file was run against the live DB to confirm parity (see report).
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
{rules}
),
schema_map(st,grp,w) as (values
{sch}
),
arch_map(cta,cl,grp,w) as (values
{arch}
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
  union all select gcid, 11, 0.8 from c where reg ~* '501\\(c\\)|Charit|Nonprofit|Non-profit|Attorney General.*Charit'
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
"""
open('s0_rules.sql','w').write(sql)
print(len(sql))
