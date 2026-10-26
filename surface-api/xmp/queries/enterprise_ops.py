"""xmp enterprise operations reads — port of the supabase-js calls in
surface-ui/_base/src/lib/enterprise-ops.ts (loadIngestion, loadEnterpriseSettings), used by the
enterprise transactions and settings pages.

Runs as the signed-in user, so RLS decides as it did for the browser. (These tables have RLS on
and no policy for `authenticated`, so today they read empty for every user; the page renders its
"instrument to activate" state. That is kept, not worked around.) The page ignored every error
(`res.data ?? []`, `count ?? 0`): each read comes back empty on a database error, for example an
org id that isn't a uuid. The page still derives feeds / audit / totals from these raw rows.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, nulls_last, select

from _base.db import tables as T
from _base.db.sql import fetch_many
from xmp.queries.common import cols, single, soft_all

crm = T.t_crm_integrations
oauth = T.t_oauth_connections
jobs = T.t_sync_jobs
settings_t = T.t_enterprise_settings
roles = T.t_user_roles
invites = T.t_invitations
sso = T.t_sso_config

CRM_COLS = ("id, crm_type, display_name, sync_direction, sync_frequency, last_sync_at, "
            "sync_status, records_synced, is_active, config")
OAUTH_COLS = "id, provider, provider_name, last_sync_at, sync_status, sync_error, sync_count, is_active"
JOB_COLS = ("id, job_type, status, records_processed, records_failed, error_log, started_at, "
            "completed_at, duration_ms")
ROLE_COLS = ("id, role, is_active, can_manage_users, can_publish_content, can_manage_billing, "
             "invited_at, accepted_at")
INVITE_COLS = "id, email, full_name, role, status, invited_at, expires_at"
SSO_COLS = "id, provider, issuer_url, is_active"


def load_ingestion(conn: psycopg.Connection, org_id: str) -> dict[str, Any]:
    """The CRM feeds and OAuth connections of the org (one round trip), then the sync jobs of
    those CRM feeds (only when there are any, as the page did)."""
    r = fetch_many(conn, {
        "crm": select(*cols(crm, CRM_COLS)).where(crm.c.org_id == org_id)
        .order_by(crm.c.created_at.desc()),
        "oauth": select(*cols(oauth, OAUTH_COLS))
        .where(oauth.c.entity_type == "organization", oauth.c.entity_id == org_id)
        .order_by(oauth.c.connected_at.desc()),
    }, tolerant=True)
    job_rows: list[dict[str, Any]] = []
    ids = [str(row["id"]) for row in r["crm"]]
    if ids:
        job_rows = soft_all(conn, select(*cols(jobs, JOB_COLS))
                            .where(jobs.c.integration_id.in_(ids))
                            .order_by(nulls_last(jobs.c.started_at.desc())).limit(200))
    return {"crm": r["crm"], "oauth": r["oauth"], "jobs": job_rows}


def load_enterprise_settings(conn: psycopg.Connection, org_id: str) -> dict[str, Any]:
    """The five reads of the settings page in one round trip. `settings` is `.maybeSingle()`
    (error ignored: null unless exactly one row), `integrations` the exact CRM count (0 on
    error)."""
    r = fetch_many(conn, {
        "settings": select(settings_t).where(settings_t.c.org_id == org_id).limit(2),
        "users": select(*cols(roles, ROLE_COLS))
        .where(roles.c.entity_type == "organization", roles.c.entity_id == org_id).limit(200),
        "invites": select(*cols(invites, INVITE_COLS))
        .where(invites.c.entity_type == "organization", invites.c.entity_id == org_id)
        .order_by(invites.c.invited_at.desc()).limit(50),
        "sso": select(*cols(sso, SSO_COLS)).where(sso.c.org_id == org_id),
        "count": select(func.count().label("n")).select_from(crm).where(crm.c.org_id == org_id),
    }, tolerant=True)
    return {
        "settings": single(r["settings"]),
        "users": r["users"],
        "invites": r["invites"],
        "sso": r["sso"],
        "integrations": int(r["count"][0]["n"]) if r["count"] else 0,
    }
