"""Claim page profile read — port of `profileQuery` in
surface-ui/srp/src/routes/_authenticated/claim.$professional.tsx."""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db.sql import fetch_all
from _base.db.tables import t_exp_category_compliance as comp_t
from _base.db.tables import t_professionals as pro_t

PROFILE_COLUMNS = (
    "id", "first_name", "last_name", "display_name", "slug", "headline", "photo_url",
    "address_city", "address_state", "gcid", "claimed", "search_rank_score", "local_rank",
    "local_rank_of", "gbp_connected", "bio", "primary_license_type",
)


class MultipleRows(RuntimeError):
    """`.maybeSingle()` on more than one row."""


def claim_profile(conn: psycopg.Connection, slug: str) -> dict[str, Any] | None:
    """{prof, licenseLabel}, or None when no professional has this slug."""
    p = pro_t.c
    rows = fetch_all(conn, select(*(p[k] for k in PROFILE_COLUMNS)).where(p.slug == slug).limit(2))
    if len(rows) > 1:
        raise MultipleRows("JSON object requested, multiple (or no) rows returned")
    if not rows:
        return None
    prof = rows[0]
    label = "License Number"
    if prof["gcid"]:
        # The TS ignored this read's error, and .maybeSingle() yields no data on 2+ rows.
        try:
            with conn.transaction():
                comp = fetch_all(conn, select(comp_t.c.license_label)
                                 .where(comp_t.c.gcid == prof["gcid"]).limit(2))
        except psycopg.Error:
            comp = []
        if len(comp) == 1 and comp[0]["license_label"]:
            label = comp[0]["license_label"]
    return {"prof": prof, "licenseLabel": label}
