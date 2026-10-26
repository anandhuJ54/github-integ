"""Submit category-generation batch to Anthropic Batches API.
Usage: ANTHROPIC_API_KEY=... python3 submit_batch.py gcids.txt
Reads KM source (base_km_input.json path in CONFIG), builds one request per gcid,
prints batch_id. State lives server-side; results retrievable for 29 days."""
import json, os, sys, urllib.request

KM_PATH = os.environ.get("KM_PATH", "/content/drive/MyDrive/base_km_input.json")
MODEL = "claude-sonnet-4-6"
SPEC = open(os.path.join(os.path.dirname(__file__), "GENERATION_SPEC.md")).read()

def build_request(cat):
    user = ("Generate the taxonomy and node registry for this Google Business Profile "
            "category to exemplar grade.\n\nCATEGORY INPUT:\n" + json.dumps({
                k: cat.get(k) for k in ["gcid","display_name","entity_type","schema_type",
                "terminology","search_intents","content_topics","services",
                "expertise_signals","compliance_rules","conversion_actions"]}, ensure_ascii=False)
            + "\n\nRespond with ONLY the JSON object per the output contract.")
    return {"custom_id": cat["gcid"].replace("gcid:","")[:64],
            "params": {"model": MODEL, "max_tokens": 32000,
                       "system": SPEC,
                       "messages": [{"role": "user", "content": user}]}}

TYPES_PATH = os.environ.get("TYPES_PATH", "/home/claude/gcid_schema_type.json")

def main():
    key = os.environ["ANTHROPIC_API_KEY"]
    types = json.load(open(TYPES_PATH))
    want = {l.strip() for l in open(sys.argv[1]) if l.strip()}
    km = {c["gcid"]: c for c in json.load(open(KM_PATH))}
    for g in want:
        if g in km: km[g]["schema_type"] = types.get(g)
    reqs = [build_request(km[g]) for g in want if g in km]
    missing = want - set(km)
    if missing: print("NOT IN KM SOURCE (seed categories — generate in-session):", sorted(missing))
    body = json.dumps({"requests": reqs}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages/batches", data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    resp = json.load(urllib.request.urlopen(req))
    print("batch_id:", resp["id"], "| requests:", len(reqs))

if __name__ == "__main__":
    main()
