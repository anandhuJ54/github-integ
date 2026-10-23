"""Cross-sibling bleed detector: flags categories whose taxonomy is boilerplate shared
with name-adjacent siblings instead of differentiated on their distinguishing line.
Usage: python3 bleed_detector.py staged_dir/ [threshold=0.6]"""
import re, sys, glob, os
from collections import defaultdict

def terms(path, gcid):
    return set(m.lower() for m in re.findall(r"\('"+gcid+r"','[^']+','([^']+)'", open(path).read()))

def main():
    d = sys.argv[1]; thresh = float(sys.argv[2]) if len(sys.argv) > 2 else 0.6
    cats = {}
    for f in glob.glob(os.path.join(d, "stage_*.sql")):
        g = os.path.basename(f)[6:-4]
        cats[g] = terms(f, "gcid:" + g)
    # sibling = shares a leading or trailing token (italian_restaurant ~ restaurant, auto_repair ~ ...)
    tokens = defaultdict(list)
    for g in cats:
        parts = g.split("_")
        for tok in {parts[0], parts[-1]}:
            if len(tok) > 3: tokens[tok].append(g)
    flagged = []
    for tok, group in tokens.items():
        if len(group) < 2: continue
        for i, a in enumerate(group):
            for b in group[i+1:]:
                inter = len(cats[a] & cats[b]); denom = min(len(cats[a]), len(cats[b])) or 1
                ov = inter / denom
                if ov > thresh: flagged.append((round(ov, 2), a, b, inter))
    for ov, a, b, n in sorted(flagged, reverse=True)[:40]:
        print(f"BLEED {ov:.0%}  {a} <-> {b}  ({n} shared terms)")
    print(f"\npairs flagged over {thresh:.0%}: {len(flagged)}")

if __name__ == "__main__":
    main()
