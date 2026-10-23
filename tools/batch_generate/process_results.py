"""Gauntlet + SQL stager for batch results (component 2 back half + component 4).
Usage: python3 process_results.py results.jsonl out_dir/
Per category: parse JSON -> gauntlet every row -> PASS: staged SQL chunk; FAIL: rejects
report with reasons (for resubmission). Nothing reaches SQL without passing."""
import json, os, sys, re
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from projection_linter import lint_field

REF = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..",
                     "reference", "schema_type_reference.json")))["types"]
PROPSET = set().union(*[set(v["valid_properties"]) for v in REF.values()])
LEVELS = {"profession_title","alias","specialization","product_service","audience","topic",
          "content_title","industry_term","tag","keyword","negative_keyword","question",
          "review_aspect","modifier"}
RINGS = {"identity","presence","location","authority","services","content","reputation",
         "engagement","conversion","entity_graph"}
CONN = {"manual","platform","etl","oauth","crm_sync","rss"}
INTENTS = {"head","local","service","transactional","question","informational","comparison","urgency",None}

def slugify(t):
    return re.sub(r"[^a-z0-9_+-]", "", t.lower().replace(" ", "_").replace("/", "_"))[:60]

REWRITE = {"credentialId": "identifier", "availableChannel": "potentialAction", "mentions": "subjectOf", "video": "subjectOf",
           "license": "hasCredential.identifier", "postalCode": "address.postalCode",
           "streetAddress": "address.streetAddress", "reservationFor": "potentialAction",
           # main-batch round-1 classes (fixture-verified; author-on-Person has no valid rewrite -> rows drop):
           "hasMenuItem": "hasMenu", "reservations": "acceptsReservations",
           "reservationUrl": "acceptsReservations", "issuedBy": "recognizedBy",
           "mainEntity": "subjectOf", "availableLanguage": "knowsLanguage",
           "floorSize": "additionalProperty.value", "citation": "subjectOf"}

def autofix_facet(st, sp, biz):
    """If property invalid on st but valid on an allowed facet, reassign. Returns (st, fixed?)."""
    root = (sp or "").split(".")[0]
    if st in REF and root in REF[st]["valid_properties"]:
        return st, False
    for cand in ("Person", biz, "Organization", "LocalBusiness"):
        if cand and cand in REF and root in REF[cand]["valid_properties"]:
            return cand, True
    return st, False

def gauntlet(gcid, out, biz=None):
    errs, tax_rows, node_rows = [], [], []
    seen = set()
    for t in out.get("taxonomy", []):
        if not isinstance(t, dict) or not t.get("term") or "level" not in t:
            errs.append("taxonomy row missing keys"); continue
        if t["level"] in INTENTS and t["level"] and t["level"] not in LEVELS:  # intent-as-level
            t["search_intent"], t["level"] = t["level"], "keyword"
        if t["level"] not in LEVELS: errs.append(f"taxonomy level '{t['level']}'"); continue
        if t.get("search_intent") not in INTENTS: errs.append(f"intent '{t.get('search_intent')}'"); continue
        st, sp = t.get("schema_type"), t.get("schema_property")
        # taxonomy convention: st = the TERM's type, sp = the attaching edge (domain is
        # the profile entity, not the term) -> validate existence of each, not sp-on-st
        if st and st not in REF: errs.append(f"taxonomy term type '{st}'"); continue
        if sp and sp.split(".")[0] not in PROPSET:
            errs.append(f"taxonomy edge '{sp}'"); continue
        key = (t["level"], slugify(t["term"]))
        if key in seen: continue                       # dedupe silently
        seen.add(key); tax_rows.append(t)
    rings_hit = set()
    for n in out.get("nodes", []):
        if not isinstance(n, dict) or not n.get("node_name") or "ring" not in n or "connection_method" not in n:
            errs.append(f"node row missing keys: {str(n)[:60]}"); continue
        if n["ring"] not in RINGS: errs.append(f"ring '{n['ring']}'"); continue
        if n["connection_method"] not in CONN: errs.append(f"conn '{n['connection_method']}'"); continue
        st, sp = n.get("schema_type"), n.get("schema_property")
        if sp:
            parts = sp.split(".")
            def _path_valid(styp, path):
                cur = styp
                if cur not in REF: return False
                for hop in path.split("."):
                    m = REF.get(cur, {}).get("valid_properties", {}).get(hop)
                    if not m: return False
                    nxt = [x for x in m["range"] if x in REF and REF[x]["valid_properties"]]
                    cur = nxt[0] if nxt else cur
                return True
            if parts[-1] in REWRITE and parts[-1] != "identifier" and not _path_valid(st, sp):
                parts[-1] = REWRITE[parts[-1]]
                n["schema_property"] = sp = ".".join(p for seg in parts for p in seg.split("."))
                n["note"] = (n.get("note","") + " [autofix: property rewritten]").strip()
        if st:
            if st not in REF:
                st2, fixed = autofix_facet(biz or "LocalBusiness", sp, biz)
                if not fixed: errs.append(f"node type '{st}'"); continue
                n["schema_type"] = st = st2
                n["note"] = (n.get("note","") + " [autofix: invented type -> valid facet]").strip()
            if ENTITY.get(gcid) == "location" and st == "Person":
                # location entities carry no Person facet: staff->employee, partners->memberOf
                root0 = (sp or "").split(".")[0]
                n["schema_type"] = st = (biz if biz in REF else "Organization")
                n["schema_property"] = sp = {"affiliation": "memberOf", "worksFor": "memberOf",
                                             "colleague": "employee"}.get(root0, sp)
                n["note"] = (n.get("note","") + " [autofix: location entity, no Person facet]").strip()
            st2, fixed = autofix_facet(st, sp, biz)
            if fixed:
                n["schema_type"] = st = st2
                n["note"] = (n.get("note","") + " [autofix: facet reassigned]").strip()
            ok = True
            # per-hop dotted-path lint
            cur = st
            for hop in (sp or "").split("."):
                m = REF.get(cur, {}).get("valid_properties", {}).get(hop)
                if not m: errs.append(f"{n['node_name']}: '{hop}' invalid on {cur}"); ok = False; break
                nxt = [r for r in m["range"] if r in REF and REF[r]["valid_properties"]]
                cur = nxt[0] if nxt else cur
            if not ok: continue
            if lint_field(n["node_name"], st, (sp or "").split(".")[0], "value",
                          {"interactionType": "typed"} if sp and sp.startswith("interactionStatistic") else None):
                errs.append(f"{n['node_name']}: usage rule"); continue
        rings_hit.add(n["ring"]); node_rows.append(n)
    out["conversion_actions"] = [a for a in out.get("conversion_actions", [])
                                 if a["schema_action"] in REF]  # drop invented actions silently
    # compliance object (same-pass fill of exp_category_compliance)
    comp = out.get("compliance")
    if not isinstance(comp, dict):
        errs.append("MISSING compliance object")
    # depth floors — aggregate AND per-level (conversion agents need complete level coverage:
    # a category passing 150 total with 4 products starves the agent; floors calibrated from
    # the exemplar band, set below it so thin-but-real venue categories aren't forced to fabricate)
    LEVEL_FLOORS = {"product_service": 10, "specialization": 8, "question": 8,
                    "audience": 6, "keyword": 12, "topic": 8}
    by_level = {}
    for tr in tax_rows: by_level[tr["level"]] = by_level.get(tr["level"], 0) + 1
    for lvl, floor in LEVEL_FLOORS.items():
        if by_level.get(lvl, 0) < floor:
            errs.append(f"DEPTH level {lvl} {by_level.get(lvl,0)}<{floor}")
    if len(tax_rows) < 150: errs.append(f"DEPTH taxonomy {len(tax_rows)}<150")
    if len({t['level'] for t in tax_rows}) < 13: errs.append("DEPTH taxonomy levels")
    if len(node_rows) < 110: errs.append(f"DEPTH nodes {len(node_rows)}<110")
    if len(rings_hit - {'conversion'}) < 9: errs.append(f"DEPTH rings {sorted(rings_hit)}")
    return tax_rows, node_rows, comp if isinstance(comp, dict) else None, errs

def sql_escape(s): return (s or "").replace("'", "''")

def comp_sql(g, c):
    """Upsert against the REAL exp_category_compliance schema (mig 20260628173644).
    Contract->column map: age_restricted->age_gate_required, hipaa_applicable->hipaa_applies,
    financial_regulations_apply->glba_applies, advertising_restrictions->content_restrictions."""
    def arr(xs): return "ARRAY["+",".join("'"+sql_escape(x)+"'" for x in xs)+"]::text[]" if xs else "ARRAY[]::text[]"
    def b(x): return "true" if x else "false"
    def s(x): return "NULL" if not x else "'"+sql_escape(x)+"'"
    cols = {"display_license_on_profile": b(c.get("display_license_on_profile")),
            "license_display_format": s(c.get("license_display_format")),
            "regulated_by": arr(c.get("regulated_by") or []),
            "prohibited_phrases": arr(c.get("prohibited_phrases") or []),
            "required_disclaimers": arr(c.get("required_disclaimers") or []),
            "age_gate_required": b(c.get("age_restricted")),
            "hipaa_applies": b(c.get("hipaa_applicable")),
            "glba_applies": b(c.get("financial_regulations_apply")),
            "content_restrictions": arr(c.get("advertising_restrictions") or [])}
    names = ",".join(cols); vals = ",".join(cols.values())
    sets = ",".join(f"{k}=EXCLUDED.{k}" for k in cols)
    return (f"INSERT INTO exp_category_compliance (gcid,{names}) VALUES ('{g}',{vals})\n"
            f"ON CONFLICT (gcid) DO UPDATE SET {sets}, updated_at=now();\n")

UNIVERSE = None
def stage(gcid, tax, nodes, out_dir, comp=None):
    g = f"gcid:{gcid}" if not gcid.startswith("gcid:") else gcid
    global UNIVERSE
    if UNIVERSE is None:
        import os as _os
        up = _os.path.join(_os.path.dirname(__file__), "..", "..", "reference", "gcid_universe.json")
        UNIVERSE = set(json.load(open(up)))
    assert g in UNIVERSE, f"CATEGORY INTEGRITY: {g} not in gbp_categories universe"
    tr = [f"('{g}','{t['level']}','{sql_escape(t['term'])}','{slugify(t['term'])}','{sql_escape(t['term'])}','batch_generated',"
          f"{('NULL' if not t.get('schema_type') else chr(39)+t['schema_type']+chr(39))},"
          f"{('NULL' if not t.get('schema_property') else chr(39)+t['schema_property']+chr(39))},"
          f"{('NULL' if not t.get('search_intent') else chr(39)+t['search_intent']+chr(39))})" for t in tax]
    nr = [f"('{g}','{sql_escape(n['node_name'])}','{slugify(n['node_name'])}','{n['ring']}','{n['connection_method']}',"
          f"{('NULL' if not n.get('schema_type') else chr(39)+n['schema_type']+chr(39))},"
          f"{('NULL' if not n.get('schema_property') else chr(39)+n['schema_property']+chr(39))},"
          f"false,0,{i+1},'{sql_escape(n.get('note',''))}')" for i, n in enumerate(nodes)]
    open(os.path.join(out_dir, f"stage_{gcid}.sql"), "w").write(
        f"DELETE FROM exp_taxonomy WHERE gcid='{g}';\n"
        f"INSERT INTO exp_taxonomy (gcid,level,term,term_slug,term_display,source,schema_type,schema_property,search_intent) VALUES\n"
        + ",\n".join(tr) + ";\n\n"
        f"DELETE FROM exp_vertical_node_registry WHERE gcid='{g}';\n"
        f"INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES\n"
        + ",\n".join(nr) + ";\n"
        + (("\n" + comp_sql(g, comp)) if comp else ""))

def main():
    results, out_dir = sys.argv[1], sys.argv[2]
    global BIZ
    km_path = os.environ.get("KM_PATH", "/home/claude/base_km_input.json")
    types_path = os.environ.get("TYPES_PATH", "/home/claude/gcid_schema_type.json")
    BIZ = {g.replace("gcid:",""): t for g, t in json.load(open(types_path)).items()} if os.path.exists(types_path) else {}
    global ENTITY
    ENTITY = {c["gcid"].replace("gcid:",""): c.get("entity_type") for c in json.load(open(km_path))} if os.path.exists(km_path) else {}
    os.makedirs(out_dir, exist_ok=True)
    passed, rejects = [], {}
    for line in open(results):
        r = json.loads(line)
        gcid = r["custom_id"]
        if r["result"]["type"] != "succeeded":
            rejects[gcid] = [r["result"]["type"]]; continue
        text = "".join(b.get("text", "") for b in r["result"]["message"]["content"])
        try:
            body = text[text.find("{"): text.rfind("}") + 1]  # tolerate prose preamble
            out = json.loads(body)
        except Exception as e:
            rejects[gcid] = [f"unparseable: {e}"]; continue
        try:
            tax, nodes, comp, errs = gauntlet(gcid, out, BIZ.get(gcid))
            if errs: rejects[gcid] = errs
            else: stage(gcid, tax, nodes, out_dir, comp); passed.append(gcid)
        except Exception as e:
            rejects[gcid] = [f"processor_error: {type(e).__name__}: {str(e)[:100]}"]
    print(f"PASS {len(passed)} | REJECT {len(rejects)}")
    json.dump(rejects, open(os.path.join(out_dir, "rejects.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
