"""_base baseline: the SQL stream in migrations/ is applied

Revision ID: 866c5f655041
Revises:
Create Date: 2026-10-26 12:50:27.114414

The root of the `_base` branch. Before Alembic, migrations were the numbered SQL files in
`surface-api/migrations/`, applied by migrate.py and recorded in `schema_migrations`. That stream
is closed: this revision changes nothing; it only stops with an error unless every one of those
28 files is recorded as applied. Every Surface branch's first revision depends on it.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "866c5f655041"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = ("_base",)
depends_on: str | Sequence[str] | None = None

# The closed SQL stream (migrations/meta/_journal.json), frozen here.
SQL_STREAM: tuple[str, ...] = (
    '0000_create_exp_us_cities_and_nearby_cities',
    '0001_insurance_team_slack_and_logo_expansion',
    '0002_logo_expansion_row_level_land_and_family_key',
    '0003_exp_territory_logo_profiles',
    '0004_territory_seats',
    '0005_claim_contact_and_verification',
    '0006_claim_audit_actor_safe',
    '0007_territory_group_profiles',
    '0008_territory_group_profiles_fast',
    '0009_claim_queue_verification_entity_cast',
    '0010_crm_phase1_opportunity_lifecycle',
    '0011_crm_phase5_integrations_alerts',
    '0012_crm_phase5_demo_seed_entity_type',
    '0013_crm_phase5_alert_tiering',
    '0014_crm_phase5_stage_actor',
    '0015_crm_phase5_alert_accept_actor',
    '0016_catalog_admin_write_policies',
    '0017_backcommit_nora_os_tables',
    '0018_nora_integration_settings',
    '0019_registry_node_cardinality',
    '0020_score_v5',
    '0021_claim_gate',
    '0022_graph_upsert',
    '0023_search_projection',
    '0024_index_floor',
    '0025_category_proposals',
    '0026_listings_catalog_db',
    '0027_single_pro_office',
)


def upgrade() -> None:
    tags = ", ".join(f"'{t}'" for t in SQL_STREAM)
    op.execute(
        f"""
        do $$
        declare missing text;
        begin
          if to_regclass('public.schema_migrations') is null then
            raise exception 'schema_migrations is missing: apply migrations/ with migrate.py first';
          end if;
          select string_agg(t, ', ') into missing
            from unnest(array[{tags}]) as t
           where t not in (select tag from public.schema_migrations);
          if missing is not null then
            raise exception using message =
              'migrations/ is not fully applied (migrate.py): ' || missing;
          end if;
        end $$;
        """
    )


def downgrade() -> None:
    pass
