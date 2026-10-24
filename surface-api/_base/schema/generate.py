"""Regenerate `_base/schema/tables.py` from the live database.

Run from inside surface-api/ (introspection only, nothing is written to the DB):

    uv run --env-file .env python -m _base.schema.generate

The browser-to-API migration adds the tables each Surface's queries use to TABLES, then
reruns this. Never hand-edit tables.py; regenerate it when the schema changes.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# Tables read or written through SQLAlchemy Core (`_base.schema.tables`). Keep sorted.
TABLES = [
    "aggregate_ratings",
    "audit_log",
    "claim_queue",
    "content_compliance_rules",
    "content_items",
    "credentials",
    "disco_jobs",
    "disco_llm_requests",
    "disco_proposals",
    "disco_site_contract",
    "entity_compliance",
    "exp_activity_events",
    "exp_category_completeness",
    "exp_category_compliance",
    "exp_category_directories",
    "exp_category_eaa",
    "exp_category_eaq",
    "exp_category_ear",
    "exp_category_eav",
    "exp_category_group_memberships",
    "exp_category_groups",
    "exp_category_knowledge",
    "exp_category_page_template",
    "exp_category_profile_config",
    "exp_category_schema",
    "exp_category_schema_type",
    "exp_category_secondaries",
    "exp_category_ui_config",
    "exp_claim",
    "exp_contracts",
    "exp_control_grants",
    "exp_control_nodes",
    "exp_dev_config",
    "exp_dev_demo_days",
    "exp_dev_docs",
    "exp_dev_idea_votes",
    "exp_dev_ideas",
    "exp_dev_launch",
    "exp_dev_members",
    "exp_dev_projects",
    "exp_dev_sprint_items",
    "exp_dev_sprints",
    "exp_dev_teams",
    "exp_dev_weekly_updates",
    "exp_entity",
    "exp_etl_cost_events",
    "exp_etl_field_floors",
    "exp_etl_frontier",
    "exp_etl_hydrate_jobs",
    "exp_etl_jobs",
    "exp_etl_runs",
    "exp_etl_sources",
    "exp_etl_staging",
    "exp_index_agent",
    "exp_index_config",
    "exp_index_queue",
    "exp_index_submission_log",
    "exp_listings_category_status",
    "exp_listings_crosswalk",
    "exp_listings_field_map",
    "exp_listings_overlays",
    "exp_listings_publishers",
    "exp_page_views_rollup",
    "exp_rel",
    "exp_ring",
    "exp_rings",
    "exp_schema_type_ring_map",
    "exp_sitemap_partition",
    "exp_sponsored_pricing",
    "exp_sponsored_slots",
    "exp_taxonomy",
    "exp_vertical_node_registry",
    "exp_web_ads",
    "exp_wiki_comments",
    "exp_wiki_docs",
    "exp_wiki_revisions",
    "exp_wiki_spaces",
    "exp_wiki_watchers",
    "gbp_categories",
    "graph_edges",
    "graph_nodes",
    "media_items",
    "organizations",
    "plg_events",
    "plg_rules",
    "professionals",
    "reviews",
    "search_rank_scores",
    "transaction_signals",
    "v_professional_profile",
]

OUT = Path(__file__).with_name("tables.py")

HEADER = '''"""SQLAlchemy Core table definitions, generated from the live database. Do not edit.

Regenerate with `uv run --env-file .env python -m _base.schema.generate` (see generate.py).
"""
# ruff: noqa
'''


def _url() -> str:
    url = os.environ["DATABASE_URL"]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def main() -> int:
    # The URL carries the password: never let it reach a traceback or the log.
    proc = subprocess.run(
        [
            sys.executable, "-m", "sqlacodegen", "--generator", "tables",
            "--schemas", "public", "--tables", ",".join(TABLES), _url(),
        ],
        check=False, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.replace(_url(), "<DATABASE_URL>")[-4000:], file=sys.stderr)
        return proc.returncode
    OUT.write_text(HEADER + proc.stdout)
    print(f"wrote {OUT} ({len(TABLES)} tables)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
