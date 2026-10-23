import re,sys
sys.path.insert(0,'.')
from nm import *
REGC = [
 ('BAR', r'State Bar|Bar Association|Rules of Professional Conduct|Legal Services|Supreme Court'),
 ('MED', r'Medical Board|Board of Medicine|CMS|Centers for Medicare|Joint Commission|HIPAA|Board of (Nursing|Dentistry|Pharmacy|Optometry|Chiropractic|Psychology|Behavioral)|Department of Health|Public Health|Health Care|Healthcare|Medical Council|NHS|Care Quality|FDA'),
 ('VET', r'Veterinar|AVMA|APHIS|Animal'),
 ('ABC', r'Alcohol|ABC|TTB|Liquor|Tobacco'),
 ('CAN', r'Cannabis|Marijuana|Firearms|Gaming|Lottery'),
 ('CON', r'Contractor|Building (Code|Department|Authority)|Plumbing|Electrical (Board|Safety)|Home Improvement|Building Standards|Construction'),
 ('EDU', r'Department of Education|Accredit|Ministry of Education|FERPA|School Board|Higher Education'),
 ('NPO', r'501\(c\)|Charit|Nonprofit|Non-profit|Attorney General.*Charit'),
 ('FIN', r'CFPB|Consumer Financial|SEC\b|Securities|FINRA|NMLS|OCC|FDIC|NCUA|Insurance (Commissioner|Department|Regulat)|Banking|Truth in Lending|Fair Credit|Federal Reserve|Dodd'),
 ('RE',  r'HUD|Fair Housing|Real Estate Commission|RESPA|Real Estate Board'),
 ('TRN', r'DOT\b|Department of Transportation|FMCSA|FAA|Aviation|Motor Vehicle|NHTSA|Motor Carrier|Federal Aviation|Transport'),
 ('FOOD',r'Health Department|FDA|FSIS|Food Code|Food Safety|ServSafe|USDA'),
 ('OSHA',r'OSHA|Occupational Safety'),
 ('GOV', r'Public Records|Open Meetings|Government Ethics|Sunshine'),
 ('ADA', r'Americans with Disabilities'),
]
REGC=[(c,re.compile(x,re.I if c!='FIN' else 0)) for c,x in REGC]
ATF=re.compile(r'ATF')
for r in rows:
    reg=r.get('reg') or ''
    r['rc']=[c for c,rx in REGC if rx.search(reg)]
    if ATF.search(reg) and 'CAN' not in r['rc']: r['rc'].append('CAN')
