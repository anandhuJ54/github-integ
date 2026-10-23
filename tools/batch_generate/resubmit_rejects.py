"""Resubmit rejected categories with their gate failures injected.
Usage: ANTHROPIC_API_KEY=... python3 resubmit_rejects.py rejects.json"""
import json, os, sys, urllib.request
sys.path.append(os.path.dirname(__file__))
from submit_batch import build_request, KM_PATH
rejects = json.load(open(sys.argv[1]))
km = {c["gcid"]: c for c in json.load(open(KM_PATH))}
reqs = []
for g, reasons in rejects.items():
    r = build_request(km[f"gcid:{g}"])
    r["params"]["messages"][0]["content"] += (
        "\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BY THESE GATES — fix every one:\n- "
        + "\n- ".join(reasons[:25]))
    reqs.append(r)
body = json.dumps({"requests": reqs}).encode()
req = urllib.request.Request("https://api.anthropic.com/v1/messages/batches", data=body,
    headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01",
             "content-type": "application/json"})
print("batch_id:", json.load(urllib.request.urlopen(req))["id"], "| requests:", len(reqs))
