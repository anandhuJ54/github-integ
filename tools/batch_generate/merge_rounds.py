"""Union-salvage across batch rounds: per category, merge valid taxonomy/node rows from
all rounds (dedupe by slug), drop invalid rows individually (logged), floors on the union.
Usage: KM_PATH=... python3 merge_rounds.py out_dir results1.jsonl [results2.jsonl ...]"""
import json, sys, os
sys.path.append(os.path.dirname(__file__))
import process_results as pr

def main():
    out_dir, files = sys.argv[1], sys.argv[2:]
    os.makedirs(out_dir, exist_ok=True)
    types = json.load(open(os.environ.get("TYPES_PATH", "/home/claude/gcid_schema_type.json")))
    pr.BIZ = {g.replace("gcid:", ""): t for g, t in types.items()}
    km_path = os.environ.get("KM_PATH", "/home/claude/base_km_input.json")
    pr.ENTITY = {c["gcid"].replace("gcid:", ""): c.get("entity_type")
                 for c in json.load(open(km_path))} if os.path.exists(km_path) else {}
    # seed categories absent from KM: entity types per the seed synthesis
    pr.ENTITY.update({"real_estate_agents":"both","mortgage_broker":"both","dentist":"both",
        "accounting":"both","plumber":"both","restaurant":"location","italian_restaurant":"location",
        "hair_salon":"location","hardware_store":"location"})
    cats = {}
    for fp in files:
        for line in open(fp):
            r = json.loads(line)
            if r["result"]["type"] != "succeeded": continue
            text = "".join(b.get("text", "") for b in r["result"]["message"]["content"])
            body = text[text.find("{"): text.rfind("}") + 1]
            try: out = json.loads(body)
            except Exception: continue
            cats.setdefault(r["custom_id"], []).append(out)
    report = {}
    for gcid, outs in cats.items():
        tax_u, node_u, dropped, comp_last = {}, {}, [], None
        for out in outs:
            try:
                tax, nodes, comp, errs = pr.gauntlet(gcid, out, pr.BIZ.get(gcid))
            except Exception as e:
                dropped.append(f"processor_error {type(e).__name__}"); continue
            if comp: comp_last = comp
            row_errs = [e for e in errs if not e.startswith("DEPTH")]
            dropped += row_errs
            # gauntlet returns only rows that passed; union them
            for t in tax: tax_u.setdefault((t["level"], pr.slugify(t["term"])), t)
            for n in nodes: node_u.setdefault(pr.slugify(n["node_name"]), n)
        tax, nodes = list(tax_u.values()), list(node_u.values())
        rings = {n["ring"] for n in nodes}
        LEVEL_FLOORS = {"product_service": 10, "specialization": 8, "question": 8,
                        "audience": 6, "keyword": 12, "topic": 8}
        by_level = {}
        for tr in tax: by_level[tr["level"]] = by_level.get(tr["level"], 0) + 1
        level_ok = all(by_level.get(l, 0) >= f for l, f in LEVEL_FLOORS.items())
        ok = (len(tax) >= 150 and len({t["level"] for t in tax}) >= 13
              and len(nodes) >= 110 and len(rings - {"conversion"}) >= 9 and level_ok)
        if not level_ok:
            thin = {l: by_level.get(l, 0) for l, f in LEVEL_FLOORS.items() if by_level.get(l, 0) < f}
        else:
            thin = {}
        report[gcid] = {"taxonomy": len(tax), "nodes": len(nodes),
                        "rings": len(rings - {"conversion"}), "rows_dropped": len(set(dropped)), "thin_levels": thin,
                        "verdict": "PASS" if ok else "FAIL"}
        if ok: pr.stage(gcid, tax, nodes, out_dir, comp_last)
    json.dump(report, open(os.path.join(out_dir, "merge_report.json"), "w"), indent=1)
    for g, v in sorted(report.items()):
        print(f"{v['verdict']} {g:20} taxonomy {v['taxonomy']} | nodes {v['nodes']} | rings {v['rings']} | dropped {v['rows_dropped']}")

if __name__ == "__main__":
    main()
