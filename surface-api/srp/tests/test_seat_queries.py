"""srp seat / dashboard reads (no live DB): the SQL each read compiles to, the PostgREST orderings
and caps, and the RPC allow-list. Moved from xmp/queries/seat_queries_test.py with the reads,
surface audit 2026-10-25."""
from __future__ import annotations

import pytest
from surfaces.srp.queries import common, dashboard, seat

from _base.db.sql import capped, compile_sql

PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"
UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


def params(stmt) -> dict:
    return compile_sql(capped(stmt))[1]


# --- seat --------------------------------------------------------------------------------------

def test_score_is_newest_one():
    s = sql(seat.score_stmt("professional", PID))
    assert "ORDER BY public.search_rank_scores.calculated_at DESC LIMIT" in s
    assert params(seat.score_stmt("professional", PID))["param_1"] == 1


def test_reviews_and_listings_orderings():
    s = sql(seat.reviews_stmt("professional", [PID], 25))
    assert "reviews.entity_id IN (" in s and "ORDER BY public.reviews.review_date DESC" in s
    assert params(seat.reviews_stmt("professional", [PID], 25))["param_1"] == 25
    s = sql(seat.listings_stmt("organization", OID))
    assert "ORDER BY public.listings.directory_key LIMIT" in s
    assert params(seat.listings_stmt("organization", OID))["param_1"] == 100


def test_ratings_unfiltered_in_sql():
    s = sql(seat.ratings_stmt("organization", [OID]))
    assert "aggregate_ratings.entity_type = " in s and "review_count >" not in s


# --- dashboard ---------------------------------------------------------------------------------

def test_dashboard_professional_by_user_or_by_id():
    s = sql(dashboard.pro_stmt(dashboard.PRO_COLS, UID))
    assert "professionals.user_id = " in s and params(dashboard.pro_stmt("id", UID))["param_1"] == 2
    s = sql(dashboard.pro_stmt(dashboard.PRO_COLS, UID, PID))
    assert "professionals.id = " in s and "user_id" not in s


# --- RPC allow-list ----------------------------------------------------------------------------

def test_scalar_rpc():
    s, _, rows = common.rpc_sql("exp_office_mode", {"p_entity_type": "professional",
                                                    "p_entity_id": PID})
    assert s == ("select public.exp_office_mode(p_entity_type => %(p_entity_type)s::text, "
                 "p_entity_id => %(p_entity_id)s::uuid) as v") and not rows


@pytest.mark.parametrize("name,args", [
    ("exp_graph_upsert_nodes", {}),
    ("exp_xmp_top_depth", {"p_brand": OID}),
    ("exp_office_mode", {"p_entity_type": "professional", "p_evil": 1}),
])
def test_rpc_outside_the_allow_list_is_refused(name, args):
    with pytest.raises(common.UnknownRpc):
        common.rpc_sql(name, args)
