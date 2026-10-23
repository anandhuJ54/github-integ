#!/usr/bin/env python3
"""Emit the crosswalk + publisher seed migration once reference/crosswalk_{sic,fsq}.json exist.
Resumable/idempotent: regenerates the full file each run."""
import json, os, sys
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
E = lambda s: str(s).replace("'", "''")
sic_p, fsq_p = [os.path.join(REPO, f"reference/crosswalk_{n}.json") for n in ("sic", "fsq")]
if not (os.path.exists(sic_p) and os.path.exists(fsq_p)):
    print("crosswalks not both ready"); sys.exit(3)
sic, fsq = json.load(open(sic_p)), json.load(open(fsq_p))
U = set(json.load(open(os.path.join(REPO, "reference/gcid_universe.json"))))
rows = []
for cat, v in sorted(sic.items()):
    g = f"gcid:{cat}"; assert g in U, g
    rows.append(f"('{g}','data_axle','{E(v['sic'])}','{E(v.get('label',''))}',NULL,'{E(v.get('confidence','medium'))}',false)")
for cat, v in sorted(fsq.items()):
    g = f"gcid:{cat}"; assert g in U, g
    rows.append(f"('{g}','foursquare','{E(v['fsq_category_id'])}','{E(v.get('fsq_label',''))}','{E(v.get('breadcrumb',''))}','{E(v.get('confidence','medium'))}',false)")
sql = ("-- LISTINGS CROSSWALKS: gcid -> Data Axle SIC + Foursquare category ID (gauntleted; verified=false until first live API check)\n"
 "INSERT INTO exp_listings_publishers (id,name,kind,api_notes,publishes_to,ops_notes) VALUES\n"
 "('data_axle','Data Axle','aggregator','Local Listings Premium API v1','Search engines, IYPs, navigation, smart speakers, 411, AI search','[]'::jsonb),\n"
 "('foursquare','Foursquare','aggregator','Places + Feedback APIs (FSQ OS Places)','Apple Maps, OpenAI, Uber, Nextdoor, navigation and AI surfaces','[]'::jsonb)\n"
 "ON CONFLICT (id) DO NOTHING;\n\n"
 "INSERT INTO exp_listings_crosswalk (gcid,publisher_id,code,label,breadcrumb,confidence,verified) VALUES\n"
 + ",\n".join(rows) + "\nON CONFLICT (gcid,publisher_id) DO NOTHING;\n")
assert sql.count(chr(39)) % 2 == 0
out = os.path.join(REPO, "supabase/migrations/20260709011000_listings_crosswalks.sql")
open(out, "w").write(sql)
print(f"crosswalk migration: {len(rows):,} rows -> {out}")
