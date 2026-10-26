#!/usr/bin/env python3
"""Crosswalk driver: polls SIC + FSQ batches, gauntlets, auto-retries rejects ONCE
with reasons, emits reference JSONs. Fully resumable: state on disk, safe to re-run
any number of times. Usage: ANTHROPIC_API_KEY=... python3 tools/listings/crosswalk_driver.py
State files (in /home/claude or $XW_STATE): sic_batch_id.txt, fsq_batch_id.txt,
sic_retry_id.txt, fsq_retry_id.txt. Outputs: reference/crosswalk_sic.json,
reference/crosswalk_fsq.json (+ *_rejects.json for anything unrecoverable)."""
import json, os, re, sys, time, urllib.request

ST = os.environ.get("XW_STATE", "/home/claude")
KEY = os.environ["ANTHROPIC_API_KEY"]
HDRS = {"x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def api(path, data=None):
    req = urllib.request.Request("https://api.anthropic.com/v1" + path,
        data=json.dumps(data).encode() if data else None, headers=HDRS)
    return json.load(urllib.request.urlopen(req))

def batch_results(bid):
    b = api(f"/messages/batches/{bid}")
    if b["processing_status"] != "ended":
        return None
    url = b["results_url"]
    req = urllib.request.Request(url, headers=HDRS)
    out = {}
    for line in urllib.request.urlopen(req).read().decode().splitlines():
        r = json.loads(line)
        if r["result"]["type"] != "succeeded":
            out[r["custom_id"]] = {"_error": r["result"]["type"]}
            continue
        text = "".join(blk.get("text", "") for blk in r["result"]["message"]["content"])
        try:
            out[r["custom_id"]] = json.loads(text[text.find("{"):text.rfind("}") + 1])
        except Exception:
            out[r["custom_id"]] = {"_error": "unparseable"}
    return out

def load_lineage():
    REF = json.load(open(os.path.join(REPO, "reference/schema_type_reference.json")))["types"]
    T = json.load(open(os.path.join(ST, "gcid_schema_type.json")))
    mig = open(os.path.join(REPO, "supabase/migrations/20260706024000_corrections_package.sql")).read()
    for m in re.finditer(r"SET schema_type='([A-Za-z]+)'[^;]+WHERE gcid IN\s*\(([^)]+)\)", mig):
        for g in re.findall(r"'(gcid:[a-z_]+)'", m.group(2)):
            T[g] = m.group(1)
    def anc(t):
        s, q = set(), [t]
        while q:
            x = q.pop()
            if x in s or x not in REF: continue
            s.add(x); q += REF[x].get("parents", [])
        return s
    return T, anc

def gauntlet_sic(cat, v):
    if "_error" in v: return v["_error"]
    sic = str(v.get("sic", ""))
    if not re.fullmatch(r"\d{6}", sic): return f"sic '{sic}' not 6 digits"
    if not v.get("label"): return "label missing"
    return None

FSQ_BANDS = {"FoodEstablishment": {13}, "MedicalBusiness": {15, 11}, "MedicalOrganization": {15},
             "Physician": {15}, "Dentist": {15}, "Hospital": {15}, "Store": {17, 13, 11},
             "LodgingBusiness": {19}, "Attorney": {11}, "LegalService": {11, 12},
             "SportsActivityLocation": {18}, "EntertainmentBusiness": {10},
             "PlaceOfWorship": {12}, "GovernmentOffice": {12}, "School": {12, 11},
             "TouristAttraction": {10, 16, 19}, "Park": {16}}

def gauntlet_fsq(cat, v, T, anc):
    if "_error" in v: return v["_error"]
    cid = v.get("fsq_category_id")
    if not isinstance(cid, int) or not (10000 <= cid <= 19999):
        return f"id {cid} outside 10000-19999"
    if not v.get("fsq_label"): return "label missing"
    t = T.get("gcid:" + cat)
    if t:
        fam = (anc(t) | {t}) & set(FSQ_BANDS)
        if fam:
            allowed = set()
            for f in fam: allowed |= FSQ_BANDS[f]
            if cid // 1000 not in allowed:
                return f"band {cid//1000} not in {sorted(allowed)} for lineage {sorted(fam)}"
    return None

def retry_batch(name, rejects, sys_prompt_builder):
    km = {c["gcid"]: c for c in json.load(open(os.path.join(ST, "base_km_input.json")))}
    T = json.load(open(os.path.join(ST, "gcid_schema_type.json")))
    reqs = []
    for cat, reason in rejects.items():
        g = "gcid:" + cat
        sysp, prompt = sys_prompt_builder(g, km.get(g, {}), T.get(g), reason)
        reqs.append({"custom_id": cat, "params": {"model": "claude-sonnet-4-6", "max_tokens": 200,
                     "system": sysp, "messages": [{"role": "user", "content": prompt}]}})
    resp = api("/messages/batches", {"requests": reqs})
    open(os.path.join(ST, f"{name}_retry_id.txt"), "w").write(resp["id"])
    print(f"{name} retry batch: {resp['id']} ({len(reqs)} requests)")
    return resp["id"]

SIC_SYS = ("You assign US SIC codes for Data Axle listing submissions. Return ONLY bare JSON: "
           '{"sic":"NNNNNN","confidence":"high|medium|low","label":"official activity name"} '
           "6-digit infogroup extended format. Anchors: attorneys=811103, Mexican restaurant=581208, ATM=602103.")
FSQ_SYS = ("You map business categories to the NEW Foursquare integer taxonomy (bands: 10xxx Arts, 11xxx Business Svcs, "
           "12xxx Community/Govt, 13xxx Dining, 14xxx Event, 15xxx Health, 16xxx Outdoors, 17xxx Retail, 18xxx Sports, "
           '19xxx Travel; Mexican Restaurant=13303). Return ONLY bare JSON: {"fsq_category_id": NNNNN, '
           '"fsq_label": "...", "breadcrumb": "...", "confidence": "high|medium|low"}')

def run_track(name, sys_prompt, gauntlet_fn):
    outp = os.path.join(REPO, f"reference/crosswalk_{name}.json")
    if os.path.exists(outp):
        print(f"{name}: already complete ({outp})"); return True
    bid_f = os.path.join(ST, f"{name}_batch_id.txt")
    rid_f = os.path.join(ST, f"{name}_retry_id.txt")
    if not os.path.exists(bid_f):
        print(f"{name}: no batch id — submit first"); return False
    res = batch_results(open(bid_f).read().strip())
    if res is None:
        print(f"{name}: round-1 still processing"); return False
    T, anc = load_lineage()
    good, rejects = {}, {}
    for cat, v in res.items():
        err = gauntlet_fn(cat, v, T, anc) if name == "fsq" else gauntlet_fn(cat, v)
        (rejects if err else good)[cat] = (v if not err else err)
    print(f"{name} round 1: {len(good)} PASS / {len(rejects)} reject")
    if rejects:
        if not os.path.exists(rid_f):
            def build(g, kmrow, styp, reason):
                p = (f"Category: {g[5:].replace('_',' ')}\nSchema type: {styp}\n"
                     f"Description: {str(kmrow.get('description',''))[:180]}\n\n"
                     f"PREVIOUS ATTEMPT REJECTED: {reason}. Fix this specifically.")
                return sys_prompt, p
            retry_batch(name, rejects, build)
            return False
        r2 = batch_results(open(rid_f).read().strip())
        if r2 is None:
            print(f"{name}: retry still processing"); return False
        final_rej = {}
        for cat, v in r2.items():
            err = gauntlet_fn(cat, v, T, anc) if name == "fsq" else gauntlet_fn(cat, v)
            if err: final_rej[cat] = err
            else: good[cat] = v
        if final_rej:
            json.dump(final_rej, open(os.path.join(REPO, f"reference/crosswalk_{name}_rejects.json"), "w"), indent=1)
            print(f"{name}: {len(final_rej)} unrecoverable after retry (saved for hand-finish)")
    json.dump(dict(sorted(good.items())), open(outp, "w"), indent=1)
    print(f"{name}: COMPLETE — {len(good)} entries -> {outp}")
    return True

if __name__ == "__main__":
    done_sic = run_track("sic", SIC_SYS, gauntlet_sic)
    done_fsq = run_track("fsq", FSQ_SYS, gauntlet_fsq)
    sys.exit(0 if (done_sic and done_fsq) else 3)
