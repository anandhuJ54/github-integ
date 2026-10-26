"""City centroids — replaces the direct supabase-js read in surface-ui/_base/src/lib/geo-coords.ts
(map pins on /find, city and home pages).

Runs as the visitor (`anon` when signed out, the user otherwise), as the browser's Supabase
client did. The TS ignored a failed read (no centroids), so a failure is no rows here too.
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from _base.db import session as db
from _base.server_fn import optional_user
from search.queries import geo as q

log = logging.getLogger(__name__)

router = APIRouter(prefix="/search/geo", tags=["search"])


class SrpGeoCentroidsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # withCoordinates() sends at most 200 distinct city names
    cities: list[str] = Field(max_length=200)


@router.post("/city-centroids")
def city_centroids(body: SrpGeoCentroidsIn,
                   claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """exp_us_cities rows (city, state_abbr, lat, lng) whose city is one of `cities`.
    A read, sent as POST so 200 city names don't ride in the URL."""
    if not body.cities:
        return []
    try:
        cm = db.role_connection("anon") if claims is None \
            else db.role_connection("authenticated", claims)
        with cm as conn:
            return q.centroids(conn, body.cities)
    except psycopg.Error as exc:
        log.warning("city centroids read failed: %s", type(exc).__name__)
        return []
