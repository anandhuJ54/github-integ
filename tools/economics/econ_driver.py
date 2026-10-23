#!/usr/bin/env python3
"""Economics batch driver: polls, gauntlets (structural + band-vs-lineage + anchors),
auto-retries rejects ONCE with reasons, emits reference/category_economics.json.
Resumable; safe to re-run. Usage: ANTHROPIC_API_KEY=... python3 tools/economics/econ_driver.py"""
import json, os, re, sys, urllib.request

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
    if b["processing_status"] != "ended": return None
    out = {}
    req = urllib.request.Request(b["results_url"], headers=HDRS)
    for line in urllib.request.urlopen(req).read().decode().splitlines():
        r = json.loads(line)
        if r["result"]["type"] != "succeeded":
            out[r["custom_id"]] = {"_error": r["result"]["type"]}; continue
        text = "".join(blk.get("text", "") for blk in r["result"]["message"]["content"])
        try: out[r["custom_id"]] = json.loads(text[text.find("{"):text.rfind("}") + 1])
        except Exception: out[r["custom_id"]] = {"_error": "unparseable"}
    return out

def load_lineage():
    REF = json.load(open(os.path.join(REPO, "reference/schema_type_reference.json")))["types"]
    T = json.load(open(os.path.join(ST, "gcid_schema_type.json")))
    mig = open(os.path.join(REPO, "supabase/migrations/20260706024000_corrections_package.sql")).read()
    for m in re.finditer(r"SET schema_type='([A-Za-z]+)'[^;]+WHERE gcid IN\s*\(([^)]+)\)", mig):
        for g in re.findall(r"'(gcid:[a-z_]+)'", m.group(2)): T[g] = m.group(1)
    def anc(t):
        s, q = set(), [t]
        while q:
            x = q.pop()
            if x in s or x not in REF: continue
            s.add(x); q += REF[x].get("parents", [])
        return s
    return T, anc

def band(txns): return "floor" if 0.25 * txns <= 50 else ("cap" if 0.25 * txns >= 1200 else "mid")

HIGH_VOLUME = {"FoodEstablishment", "Store", "GroceryStore", "Supermarket", "GasStation", "ConvenienceStore"}
LOW_VOLUME = {"Attorney", "RealEstateAgent", "InsuranceAgency", "FuneralHome", "GeneralContractor"}
ANCHORS = {"mortgage_broker": (200, 8000), "real_estate_agency": (50, 5000), "dentist": (800, 8000),
           "restaurant": (8000, 300000), "plumber": (200, 5000), "supermarket": (50000, 3000000)}
BOTH = set(json.load(open(os.path.join(ST, "both_lane.json"))))

def gauntlet(cat, v, T, anc):
    if "_error" in v: return v["_error"]
    t = v.get("annual_transactions"); tk = v.get("avg_ticket_usd"); rev = v.get("annual_revenue_usd")
    if not isinstance(t, (int, float)) or not (1 <= t <= 10_000_000): return f"annual_transactions {t} implausible"
    if not isinstance(tk, (int, float)) or not (0.5 <= tk <= 10_000_000): return f"avg_ticket {tk} implausible"
    if isinstance(rev, (int, float)) and rev > 0 and not (0.2 <= (t * tk) / rev <= 5): return "txns*ticket inconsistent with revenue"
    styp = T.get("gcid:" + cat)
    if styp:
        a = anc(styp) | {styp}
        if a & HIGH_VOLUME and band(t) == "floor": return f"floor-bound {t} vs high-volume lineage"
        if a & LOW_VOLUME and band(t) == "cap": return f"cap-bound {t} vs low-volume lineage"
    lo_hi = ANCHORS.get(cat)
    if lo_hi and not (lo_hi[0] <= t <= lo_hi[1]): return f"anchor breach {t} not in {lo_hi}"
    if ("gcid:" + cat) in BOTH:
        p = v.get("professional_annual_transactions")
        if not isinstance(p, (int, float)) or not (1 <= p <= 100_000): return f"professional lane missing/implausible ({p})"
        if p > t: return "professional lane exceeds establishment volume"
    return None

SYS = ("You estimate US business economics. Reason from typical annual revenue per establishment divided by average "
       "transaction value. Anchors: mortgage LO ~40 closings; realtor ~12 sides; dentist practice ~2,000 visits; "
       'restaurant ~30,000 covers; plumber ~600 jobs. Return ONLY bare JSON: {"annual_transactions": N, '
       '"avg_ticket_usd": N, "annual_revenue_usd": N, "professional_annual_transactions": N_or_null, '
       '"basis": "one line", "confidence": "high|medium|low"}')

def run():
    outp = os.path.join(REPO, "reference/category_economics.json")
    if os.path.exists(outp): print("econ: already complete"); return True
    bid_f, rid_f = os.path.join(ST, "econ_batch_id.txt"), os.path.join(ST, "econ_retry_id.txt")
    res = batch_results(open(bid_f).read().strip())
    if res is None: print("econ: round-1 still processing"); return False
    T, anc = load_lineage()
    good, rejects = {}, {}
    for cat, v in res.items():
        err = gauntlet(cat, v, T, anc)
        (rejects if err else good)[cat] = (err if err else v)
    print(f"econ round 1: {len(good)} PASS / {len(rejects)} reject")
    if rejects:
        if not os.path.exists(rid_f):
            km = {c["gcid"]: c for c in json.load(open(os.path.join(ST, "base_km_input.json")))}
            reqs = []
            for cat, reason in rejects.items():
                g = "gcid:" + cat
                lane = " Include professional_annual_transactions (one practitioner)." if g in BOTH else ""
                p = (f"Category: {cat.replace('_',' ')}\nSchema type: {T.get(g)}\n"
                     f"Description: {str(km.get(g,{}).get('description',''))[:180]}\n"
                     f"Estimate for ONE typical US establishment.{lane}\n\nPREVIOUS ATTEMPT REJECTED: {reason}. Fix this specifically.")
                reqs.append({"custom_id": cat, "params": {"model": "claude-sonnet-4-6", "max_tokens": 300,
                             "system": SYS, "messages": [{"role": "user", "content": p}]}})
            resp = api("/messages/batches", {"requests": reqs})
            open(rid_f, "w").write(resp["id"])
            print(f"econ retry batch: {resp['id']} ({len(reqs)})"); return False
        r2 = batch_results(open(rid_f).read().strip())
        if r2 is None: print("econ: retry still processing"); return False
        final = {}
        for cat, v in r2.items():
            err = gauntlet(cat, v, T, anc)
            if err: final[cat] = err
            else: good[cat] = v
        if final:
            json.dump(final, open(os.path.join(REPO, "reference/category_economics_rejects.json"), "w"), indent=1)
            print(f"econ: {len(final)} unrecoverable (hand-finish)")
    for cat, v in good.items():
        v["band"] = band(v["annual_transactions"])
        if ("gcid:" + cat) in BOTH: v["band_professional"] = band(v["professional_annual_transactions"])
    json.dump(dict(sorted(good.items())), open(outp, "w"), indent=1)
    from collections import Counter
    print("bands:", dict(Counter(v["band"] for v in good.values())))
    print(f"econ: COMPLETE — {len(good)} -> {outp}")
    return True

if __name__ == "__main__":
    sys.exit(0 if run() else 3)
