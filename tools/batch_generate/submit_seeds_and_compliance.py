"""One-off closure batch: 9 KM-less seed categories (full contract, identity synthesized
from gcid+classified type) + compliance-only top-up for categories that predate the
compliance contract. custom_id: '<gcid>' for full, 'comp__<gcid>' for compliance-only."""
import json, os, urllib.request
from submit_batch import SPEC, MODEL

SEEDS = ["real_estate_agents","mortgage_broker","dentist","restaurant","italian_restaurant",
         "accounting","hair_salon","hardware_store","plumber"]
PILOTS = ["lawyer","veterinarian","insurance_agency","hotel","church","electrician",
          "auto_repair_shop","chiropractor","financial_planner","pediatric_dentist","family_restaurant"]

def main():
    key = os.environ["ANTHROPIC_API_KEY"]
    types = json.load(open(os.environ.get("TYPES_PATH", "/home/claude/gcid_schema_type.json")))
    km = {c["gcid"]: c for c in json.load(open(os.environ.get("KM_PATH", "/home/claude/base_km_input.json")))}
    reqs = []
    for g in SEEDS:
        gcid = f"gcid:{g}"
        synth = {"gcid": gcid, "display_name": g.replace("_", " ").title(),
                 "entity_type": "both" if g in ("real_estate_agents","mortgage_broker","dentist","accounting","plumber") else "location",
                 "schema_type": types.get(gcid),
                 "note": "NO KM SOURCE — generate from category identity at exemplar grade"}
        user = ("Generate the taxonomy, node registry, and compliance object for this GBP category "
                "to exemplar grade.\n\nCATEGORY INPUT:\n" + json.dumps(synth, ensure_ascii=False)
                + "\n\nRespond with ONLY the JSON object per the output contract.")
        reqs.append({"custom_id": g[:64], "params": {"model": MODEL, "max_tokens": 32000,
                     "system": SPEC, "messages": [{"role": "user", "content": user}]}})
    for g in PILOTS:
        gcid = f"gcid:{g}"
        cat = dict(km[gcid]); cat["schema_type"] = types.get(gcid)
        user = ("Produce ONLY the compliance object (per the Compliance section of the spec) for this "
                "category — no taxonomy, no nodes.\n\nCATEGORY INPUT:\n"
                + json.dumps({k: cat.get(k) for k in ["gcid","display_name","entity_type","schema_type","compliance_rules"]},
                             ensure_ascii=False)
                + '\n\nRespond with ONLY: {"compliance": {...}}')
        reqs.append({"custom_id": f"comp__{g}"[:64], "params": {"model": MODEL, "max_tokens": 2000,
                     "system": SPEC, "messages": [{"role": "user", "content": user}]}})
    body = json.dumps({"requests": reqs}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages/batches", data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    print("batch_id:", json.load(urllib.request.urlopen(req))["id"], "| requests:", len(reqs))

if __name__ == "__main__":
    main()
