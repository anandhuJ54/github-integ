"""City centroids for map pins — port of the supabase-js read in
surface-ui/_base/src/lib/geo-coords.ts (withCoordinates). The jitter and matching stay in
TypeScript; this returns the exp_us_cities rows the read returned.

exp_us_cities is public reference data (read policy for anon and authenticated).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all
from _base.schema.tables import t_exp_us_cities as cities_t


def centroids_stmt(cities: list[str]) -> Any:
    """`.select("city, state_abbr, lat, lng").in("city", cities)` — every state's city of that
    name (1000-row cap, as PostgREST)."""
    c = cities_t.c
    return select(c.city, c.state_abbr, c.lat, c.lng).where(c.city.in_(cities))


def centroids(conn: psycopg.Connection, cities: list[str]) -> list[dict[str, Any]]:
    return fetch_all(conn, centroids_stmt(cities)) if cities else []
