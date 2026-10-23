# S0: category group, sibling cluster and demand-tier classification (2026-10-15)

Output of the S0 stage of the taxonomy enrichment plan: all 4,041 active categories classified into 11 groups
(professional services, finance and insurance, home and trade, health, restaurants and food, retail, personal
services and fitness, lodging and venues, auto, B2B and niche, civic and education), with a confidence score,
sibling clusters (categories that compete for the same searches) and a demand tier.

- `s0_classification.csv`: one row per category (gcid, display_name, group, confidence, signals, cluster_id, family_id, demand_tier, flags ...)
- `s0_classification.json.gz`: the same plus full cluster and family member lists
- `s0_rules.sql`: the rule set as one SELECT (partly verified against the Python on a hash sample; the neighbour-propagation stage was not run in SQL)
- `*.py`: the scripts that produced the files

Status: a first pass. Accuracy has not been verified against ground truth (a by-eye sample of 90 judged about 95% right).
The 503 low-confidence rows and the clusters need human review. Demand tier is built on LLM-generated estimates;
real demand comes from the keyword volume pull (the plan's first measured step).
