"""Database unavailability reads as 503 with the reason, not a bare 500."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter
from fastapi.testclient import TestClient
from psycopg_pool import PoolTimeout

from _base.app_factory import create_app

router = APIRouter()


@router.get("/pool")
def pool():
    raise PoolTimeout("couldn't get a connection after 10.00 sec")


@router.get("/conn")
def conn():
    raise psycopg.OperationalError("connection failed: server closed the connection")


def test_pool_timeout_and_lost_connection_are_503_with_the_reason():
    c = TestClient(create_app("t", [router]))
    r = c.get("/pool")
    assert r.status_code == 503 and r.json()["detail"].startswith("database busy:")
    r = c.get("/conn")
    assert r.status_code == 503 and "server closed the connection" in r.json()["detail"]
