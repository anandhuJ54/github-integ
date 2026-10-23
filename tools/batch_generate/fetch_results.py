"""Poll + download batch results. Usage: ANTHROPIC_API_KEY=... python3 fetch_results.py <batch_id> out.jsonl"""
import json, os, sys, urllib.request
key = os.environ["ANTHROPIC_API_KEY"]; bid = sys.argv[1]
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"}))
meta = json.load(get(f"https://api.anthropic.com/v1/messages/batches/{bid}"))
print("status:", meta["processing_status"], "| counts:", meta.get("request_counts"))
if meta["processing_status"] == "ended":
    open(sys.argv[2], "wb").write(get(meta["results_url"]).read())
    print("results ->", sys.argv[2])
