"""xmp enterprise / seat / dashboard reads (no live DB): the SQL each read compiles to, the
PostgREST orderings and caps, the RPC allow-list, and the SQL the writes would send (never run)."""
from __future__ import annotations

import pytest
from psycopg.types.json import Jsonb

from _base.core.sql import capped, compile_sql
from xmp.queries import common, dashboard, enterprise, seat

PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"
UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


def params(stmt) -> dict:
    return compile_sql(capped(stmt))[1]


# --- enterprise --------------------------------------------------------------------------------

def test_brand_by_slug_limit_2_for_maybe_single():
    s = sql(enterprise.brand_stmt("state-farm"))
    assert "organizations.slug = " in s and "search_rank_score" in s
    assert params(enterprise.brand_stmt("state-farm"))["param_1"] == 2


def test_office_pros_by_display_name_nulls_last():
    s = sql(enterprise.office_pros_stmt(OID, 50))
    assert "ORDER BY public.professionals.display_name ASC NULLS LAST" in s
    assert params(enterprise.office_pros_stmt(OID, 50))["param_1"] == 50
    # a larger limit keeps the PostgREST cap
    assert params(enterprise.office_pros_stmt(OID, 5000))["param_1"] == 1000


def test_top_offices_scored_best_first():
    s = sql(enterprise.top_offices_stmt(OID, 20))
    assert "organizations.parent_org_id = " in s and "search_rank_score > " in s
    assert "ORDER BY public.organizations.search_rank_score DESC LIMIT" in s
    assert "NULLS" not in s


# --- writes: compiled only ---------------------------------------------------------------------

class Log:
    def __init__(self, fail_on: str | None = None):
        self.sent: list = []
        self.fail_on = fail_on

    def cursor(self):
        log = self

        class C:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, s, p=None):
                if log.fail_on and log.fail_on in s:
                    import psycopg
                    raise psycopg.errors.InsufficientPrivilege("new row violates row-level security")
                log.sent.append((" ".join(s.split()), p))

        return C()

    def transaction(self):
        from contextlib import nullcontext
        return nullcontext()


def test_campaign_status_update_is_the_pages_statement():
    log = Log()
    enterprise.update_campaign_status(log, PID, "paused")
    s, p = log.sent[0]
    assert s == ("UPDATE public.review_campaigns SET status=%(status)s::VARCHAR "
                 "WHERE public.review_campaigns.id = %(id_1)s::UUID")
    assert p == {"status": "paused", "id_1": PID}


def test_campaign_insert_sends_only_the_given_keys_without_returning():
    log = Log()
    enterprise.insert_campaign(log, {"entity_type": "organization", "entity_id": OID, "name": "x",
                                     "status": "draft", "compliance_approved": False})
    s, p = log.sent[0]
    assert s.startswith("INSERT INTO public.review_campaigns (entity_type, entity_id, name, status, "
                        "compliance_approved) VALUES")
    assert "RETURNING" not in s and len(p) == 5


def test_invitations_insert_one_row_per_record():
    log = Log()
    rec = {"email": "a@b.c", "full_name": None, "role": "member", "entity_type": "organization",
           "entity_id": OID, "status": "pending", "expires_at": "2026-11-23T00:00:00.000Z",
           "invited_by": UID}
    enterprise.insert_invitations(log, [rec, {**rec, "email": "d@e.f"}])
    s, p = log.sent[0]
    assert s.startswith("INSERT INTO public.invitations (") and "RETURNING" not in s
    assert "%(expires_at_m1)s::TIMESTAMP WITH TIME ZONE" in s
    assert p["email_m0"] == "a@b.c" and p["email_m1"] == "d@e.f" and p["invited_by_m1"] == UID


def test_impersonate_audit_insert_raises_its_error():
    log = Log()
    enterprise.impersonate(log, UID, PID, OID, "state-farm")
    s, p = log.sent[0]
    assert s.startswith("INSERT INTO public.audit_log (user_id, impersonating, action, entity_type, "
                        "entity_id, field_changes) VALUES")
    assert p["action"] == "user.impersonate" and p["entity_type"] == "professional"
    assert isinstance(p["field_changes"], Jsonb) and p["field_changes"].obj == {"org_slug": "state-farm"}
    import psycopg
    with pytest.raises(psycopg.Error):
        enterprise.impersonate(Log(fail_on="audit_log"), UID, PID, OID, "s")


def test_deactivate_updates_then_audits_ignoring_the_audit_error():
    log = Log()
    enterprise.deactivate(log, UID, PID)
    (u, up), (a, ap) = log.sent
    assert u == ("UPDATE public.professionals SET is_active=%(is_active)s "
                 "WHERE public.professionals.id = %(id_1)s::UUID") and up["is_active"] is False
    assert "INSERT INTO public.audit_log" in a and ap["action"] == "user.deactivate"
    assert ap["field_changes"].obj == {"is_active": False}
    failing = Log(fail_on="audit_log")
    enterprise.deactivate(failing, UID, PID)  # no raise
    assert len(failing.sent) == 1


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

def test_set_returning_rpc_casts_and_caps():
    s, p, rows = common.rpc_sql("exp_xmp_offices_page", {"p_brand": OID, "p_q": "", "p_state": "",
                                                         "p_limit": 25, "p_offset": 0})
    assert s == ("select * from public.exp_xmp_offices_page(p_brand => %(p_brand)s::uuid, "
                 "p_q => %(p_q)s::text, p_state => %(p_state)s::text, "
                 "p_limit => %(p_limit)s::integer, p_offset => %(p_offset)s::integer) limit 1000")
    assert rows and p["p_limit"] == 25


def test_scalar_rpc():
    s, _, rows = common.rpc_sql("exp_office_mode", {"p_entity_type": "professional",
                                                    "p_entity_id": PID})
    assert s == ("select public.exp_office_mode(p_entity_type => %(p_entity_type)s::text, "
                 "p_entity_id => %(p_entity_id)s::uuid) as v") and not rows
    s, _, _ = common.rpc_sql("exp_xmp_brand_overview", {"p_brand": OID})
    assert s.endswith("as v")


@pytest.mark.parametrize("name,args", [
    ("exp_graph_upsert_nodes", {}),
    ("exp_xmp_top_depth", {"p_brand": OID, "p_evil": 1}),
    ("exp_score_v5_persist", {}),
])
def test_rpc_outside_the_allow_list_is_refused(name, args):
    with pytest.raises(common.UnknownRpc):
        common.rpc_sql(name, args)
