"""sales opportunity endpoints (no live DB/auth): the SQL each one sends, in the browser's order,
the PostgREST-shaped answers, the tolerance of the reads whose errors the browser ignored, and
the exp_opp_* calls as compiled SQL. No write and no exp_opp_* function reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest
from psycopg.types.json import Jsonb
from surfaces.sales.queries import opportunity as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.opportunity_data import router

from sales.tests.test_contracts import (
    AUTH_READ,
    AUTH_WRITE,
    CLAIMS,
    ORG,
    RID,
    RID2,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)

P = "/sales/opportunities"
OPP = "44444444-4444-4444-8444-444444444444"
ACCT = "55555555-5555-4555-8555-555555555555"
REP = "66666666-6666-4666-8666-666666666666"
REP2 = "77777777-7777-4777-8777-777777777777"
TERR = "88888888-8888-4888-8888-888888888888"
ENT = "99999999-9999-4999-8999-999999999999"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client(claims=CLAIMS):
    return make_client(router, claims)


def opp_row(**kw):
    base = {"id": uuid.UUID(OPP), "name": "Acme deal", "owner": REP, "stage": "discovery",
            "value": Decimal("12000.50"), "probability": None, "account_id": uuid.UUID(ACCT),
            "org_id": ORG, "created_at": dt.datetime(2026, 10, 1, tzinfo=dt.UTC)}
    return {**base, **kw}


def stmt_for(log, needle):
    """The one statement containing `needle` (a tolerant batch that failed is re-sent one
    statement at a time: the same statement twice counts once)."""
    hits = []
    for _, s, p in log:
        if needle in s and "savepoint" not in s and (s, p) not in hits:
            hits.append((s, p))
    assert len(hits) == 1, (needle, [s for s, _ in hits])
    return hits[0]


def insert_cols(sql):
    """The column list of an INSERT, as a set (SQLAlchemy writes them in table order)."""
    return set(sql.split("(", 1)[1].split(")", 1)[0].split(", "))


# --- auth ------------------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/stages"), ("get", f"{P}/stage-requirements?stage_key=x"),
    ("get", f"{P}/list-rows"), ("post", f"{P}/rpc/exp_opp_close_won"),
    ("post", f"{P}/contacts"), ("patch", f"{P}/tasks/{RID}"), ("get", f"{P}/{OPP}/file"),
    ("get", f"{P}/{OPP}/audit-trail"), ("post", f"{P}/{OPP}/contact-links"),
    ("patch", f"{P}/{OPP}/contact-links/{RID}"), ("post", f"{P}/{OPP}/notes"),
    ("patch", f"{P}/{OPP}/notes/{RID}"), ("post", f"{P}/{OPP}/tasks"),
    ("post", f"{P}/{OPP}/activity"), ("post", f"{P}/{OPP}/audit"), ("post", f"{P}/{OPP}/demos"),
    ("post", f"{P}/{OPP}/demos/{RID}/complete"), ("post", f"{P}/{OPP}/files"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


# --- stages, requirements, list --------------------------------------------------------------

def test_stages_by_sort(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"key": "discovery", "label": None, "sort": 10, "is_open": True}]
    assert client().get(f"{P}/stages").json() == [
        {"key": "discovery", "label": None, "sort": 10, "is_open": True}]
    assert leases == [AUTH_READ]
    (_, sql, params), = log
    assert sql == ("SELECT public.exp_pipeline_stages.key, public.exp_pipeline_stages.label, "
                   "public.exp_pipeline_stages.sort, public.exp_pipeline_stages.is_open \n"
                   "FROM public.exp_pipeline_stages ORDER BY public.exp_pipeline_stages.sort ASC \n"
                   " LIMIT %(param_1)s::INTEGER")
    assert params == {"param_1": 1000}


def test_stage_requirements_for_the_key_by_sort(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/stage-requirements", params={"stage_key": "demo"}).json() == []
    (_, sql, params), = log
    assert "WHERE public.exp_stage_requirements.stage_key = %(stage_key_1)s::VARCHAR" in sql
    assert "ORDER BY public.exp_stage_requirements.sort ASC" in sql
    assert params["stage_key_1"] == "demo"


def test_list_rows_opps_by_value_then_names_tolerant(dbfake):
    log, state, _ = dbfake

    def answer(sql, params):
        t = table_of(sql)
        if t == "exp_sales_reps":
            return psycopg.errors.InsufficientPrivilege("permission denied for table exp_sales_reps")
        return {"exp_sales_pipeline": [opp_row()],
                "exp_accounts": [{"id": uuid.UUID(ACCT), "name": "Acme"}]}[t]

    state["answer"] = answer
    out = client().get(f"{P}/list-rows").json()
    assert out["opps"][0]["value"] == 12000.5 and out["opps"][0]["id"] == OPP
    assert out["accounts"] == [{"id": ACCT, "name": "Acme"}]
    assert out["reps"] == []  # `repRes.data ?? []`
    sql, params = stmt_for(log, "FROM public.exp_sales_pipeline")
    # PostgREST's order=value.desc is a plain DESC (nulls first)
    assert sql.endswith("ORDER BY public.exp_sales_pipeline.value DESC \n LIMIT %(param_1)s::INTEGER")
    assert params == {"param_1": 500}
    assert "created_by" in sql


def test_list_rows_opps_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/list-rows").status_code == 403


# --- loadOpportunityFile ---------------------------------------------------------------------

def branded_answer(opp, *, brand_rows=None, fail=()):
    def answer(sql, params):
        t = table_of(sql)
        if t in fail:
            return psycopg.errors.InvalidTextRepresentation(f"bad input for {t}")
        if t == "organizations":
            if "count(*)" in sql:
                return [{"n": 19882}]
            return brand_rows if brand_rows is not None else [
                {"id": uuid.UUID(ORG), "name": "Acme", "gcid": "gcid:real_estate_agency",
                 "logo_url": None}]
        return {
            "exp_sales_pipeline": [opp],
            "exp_pipeline_stages": [{"key": "discovery", "label": "Discovery", "sort": 10,
                                     "is_open": True}],
            "exp_opportunity_contacts": [{"id": RID, "contact_id": uuid.UUID(RID2), "role": "Champion"},
                                         {"id": RID2, "contact_id": None, "role": None}],
            "exp_opportunity_products": [{"id": RID, "product": "nora", "qty": 2,
                                          "unit_price": Decimal("99.99"), "amount": Decimal("199.98")}],
            "exp_sales_notes": [], "exp_sales_tasks": [], "exp_opportunity_files": [],
            "exp_activity_events": [], "exp_opportunity_stage_history": [],
            "exp_accounts": [{"id": uuid.UUID(ACCT), "name": "Acme", "active_arr": Decimal(0)}],
            "exp_sales_reps": ([{"name": "Rep One"}] if "photo_url" not in sql else
                               [{"id": uuid.UUID(REP), "name": "Rep One", "photo_url": None,
                                 "role": "ae", "title": None}]),
            "exp_sales_demos": [],
            "exp_claim_events": [{"id": RID, "entity_id": ENT, "event_type": "claimed"},
                                 {"id": RID2, "entity_id": "not-a-uuid", "event_type": "claimed"},
                                 {"id": OPP, "entity_id": ENT, "event_type": "upgraded"}],
            "exp_contracts": [{"id": uuid.UUID(RID), "mrr": Decimal("1234.56"), "status": "active"}],
            "exp_price_book": [{"product_key": "nora", "list_price": Decimal("99.99")}],
            "exp_products": [{"product_key": "nora", "name": "NORA"}],
            "exp_quotes": [{"name": "Q-1"}],
            "exp_territory_brand": [{"territory_id": uuid.UUID(TERR)},
                                    {"territory_id": uuid.UUID(TERR)}],
            "exp_territory_seats": [{"rep_id": uuid.UUID(REP2), "lane_role": "SDR",
                                     "is_nora_default": False}],
            "exp_contacts": [{"id": uuid.UUID(RID2), "first_name": "Pat"}],
            "exp_contract_line_items": [{"product_key": "nora"}],
            "search_rank_scores": [{"entity_id": uuid.UUID(ENT), "total_score": 612}],
        }[t]
    return answer


def test_file_reads_in_the_browsers_order_raw(dbfake):
    log, state, leases = dbfake
    state["answer"] = branded_answer(opp_row())
    out = client().get(f"{P}/{OPP}/file").json()
    assert leases == [AUTH_READ]
    order = [table_of(s) for s in sqls(log)]
    assert order == [
        "exp_sales_pipeline", "exp_pipeline_stages",
        # the Promise.all, in its order
        "exp_opportunity_contacts", "exp_opportunity_products", "exp_sales_notes",
        "exp_sales_tasks", "exp_opportunity_files", "exp_activity_events",
        "exp_opportunity_stage_history", "exp_accounts", "exp_sales_reps", "exp_sales_demos",
        "organizations", "exp_claim_events", "exp_contracts", "exp_price_book", "exp_products",
        "exp_quotes",
        # the follow-ups: brand count + links, contacts, line items, scores; seats; team
        "organizations", "exp_territory_brand", "exp_contacts", "exp_contract_line_items",
        "search_rank_scores", "exp_territory_seats", "exp_sales_reps",
    ]
    # raw, PostgREST-shaped rows; money stays the database's number
    assert out["opp"]["value"] == 12000.5
    assert out["products"][0]["unit_price"] == 99.99 and out["products"][0]["amount"] == 199.98
    assert out["contracts"] == [{"id": RID, "mrr": 1234.56, "status": "active"}]
    assert out["account"]["id"] == ACCT and out["ownerRep"] == {"name": "Rep One"}
    assert out["brand"]["gcid"] == "gcid:real_estate_agency" and out["quote"] == {"name": "Q-1"}
    assert out["locations"] == 19882
    assert out["territoryLinks"] == [{"territory_id": TERR}, {"territory_id": TERR}]
    assert out["seats"] == [{"rep_id": REP2, "lane_role": "SDR", "is_nora_default": False}]
    assert out["teamReps"][0]["id"] == REP
    assert out["people"] == [{"id": RID2, "first_name": "Pat"}]
    assert out["lines"] == [{"product_key": "nora"}]
    assert out["scores"] == [{"entity_id": ENT, "total_score": 612}]

    # the claim events: .limit(10000) lowered to the cap; newest first
    sql, params = stmt_for(log, "FROM public.exp_claim_events")
    assert "WHERE public.exp_claim_events.logo_org_id = %(logo_org_id_1)s::UUID" in sql
    assert "ORDER BY public.exp_claim_events.occurred_at DESC" in sql
    assert params["param_1"] == 1000
    # activity: the opportunity's own events OR the account's, newest first, 200
    sql, params = stmt_for(log, "FROM public.exp_activity_events")
    assert ("WHERE public.exp_activity_events.subject_type = %(subject_type_1)s::VARCHAR AND "
            "public.exp_activity_events.subject_id = %(subject_id_1)s::VARCHAR OR "
            "public.exp_activity_events.account_id = %(account_id_1)s::VARCHAR") in sql
    assert params["subject_type_1"] == "opportunity" and params["account_id_1"] == ACCT
    assert params["param_1"] == 200
    # owner is uuid-shaped: by id; the single reads ask for 2 rows to see a second one
    sql, params = stmt_for(log, "SELECT public.exp_sales_reps.name \n")
    assert "WHERE public.exp_sales_reps.id = " in sql and params["param_1"] == 2
    # the quote: latest by updated_at, a plain DESC (no nullsFirst option in the browser)
    sql, params = stmt_for(log, "FROM public.exp_quotes")
    assert sql.endswith("ORDER BY public.exp_quotes.updated_at DESC \n LIMIT %(param_1)s::INTEGER")
    assert params["param_1"] == 1
    # contracts: active or won for the org
    sql, params = stmt_for(log, "FROM public.exp_contracts")
    assert [v for k, v in params.items() if k.startswith("status")] == ["active", "won"]
    # location count is exact (not capped rows)
    sql, params = stmt_for(log, "count(*)")
    assert "WHERE public.organizations.parent_org_id = " in sql
    # territories deduplicated; the team is the seats' reps plus the owner
    _, params = stmt_for(log, "FROM public.exp_territory_seats")
    assert [v for k, v in params.items() if k.startswith("territory_id")] == [str(TERR)]
    _, params = stmt_for(log, "public.exp_sales_reps.photo_url")
    assert [v for k, v in params.items() if k.startswith("id_")] == [REP2, REP]
    # contacts: every link's contact id (falsy dropped); scores: uuid-shaped entity ids, unique
    _, params = stmt_for(log, "FROM public.exp_contacts")
    assert [v for k, v in params.items() if k.startswith("id_")] == [RID2]
    _, params = stmt_for(log, "FROM public.search_rank_scores")
    assert [v for k, v in params.items() if k.startswith("entity_id")] == [ENT]


def test_file_named_owner_non_uuid_org_and_no_account(dbfake):
    log, state, _ = dbfake
    state["answer"] = branded_answer(opp_row(owner="Some Rep", org_id="legacy-org", account_id=None))
    out = client().get(f"{P}/{OPP}/file").json()
    tables = [table_of(s) for s in sqls(log)]
    # no account read; no brand or claims (org not uuid-shaped); contracts still read (org truthy)
    assert "exp_accounts" not in tables and "organizations" not in tables
    assert "exp_claim_events" not in tables and "exp_contracts" in tables
    assert out["account"] is None and out["brand"] is None and out["claims"] == []
    assert out["locations"] is None and out["teamReps"] == [] and out["seats"] == []
    sql, params = stmt_for(log, "SELECT public.exp_sales_reps.name \n")
    assert "WHERE public.exp_sales_reps.name = " in sql and params["name_1"] == "Some Rep"
    sql, _ = stmt_for(log, "FROM public.exp_activity_events")
    assert " OR " not in sql


def test_file_without_owner_or_org(dbfake):
    log, state, _ = dbfake
    state["answer"] = branded_answer(opp_row(owner=None, org_id=None, account_id=None))
    out = client().get(f"{P}/{OPP}/file").json()
    tables = [table_of(s) for s in sqls(log)]
    assert "exp_contracts" not in tables and tables.count("exp_sales_reps") == 0
    assert out["ownerRep"] is None and out["contracts"] == [] and out["lines"] == []


def test_file_no_brand_row_skips_the_team(dbfake):
    log, state, _ = dbfake
    state["answer"] = branded_answer(opp_row(), brand_rows=[])
    out = client().get(f"{P}/{OPP}/file").json()
    tables = [table_of(s) for s in sqls(log)]
    assert "exp_territory_brand" not in tables and "exp_territory_seats" not in tables
    assert out["brand"] is None and out["locations"] is None and out["teamReps"] == []


def test_file_ignored_errors_are_empty_and_two_rows_is_null(dbfake):
    _, state, _ = dbfake
    two = [{"id": uuid.UUID(ORG), "name": "A", "gcid": None, "logo_url": None}] * 2
    state["answer"] = branded_answer(opp_row(), brand_rows=two,
                                     fail=("exp_sales_notes", "exp_contract_line_items",
                                           "exp_claim_events"))
    out = client().get(f"{P}/{OPP}/file").json()
    assert out["notes"] == [] and out["claims"] == []
    assert out["brand"] is None  # .maybeSingle() on two rows: PostgREST's error, data null
    assert out["opp"]["id"] == OPP


def test_file_failed_location_count_is_null(dbfake):
    _, state, _ = dbfake
    inner = branded_answer(opp_row())

    def answer(sql, params):
        if "count(*)" in sql:
            return psycopg.errors.QueryCanceled("canceling statement due to statement timeout")
        return inner(sql, params)

    state["answer"] = answer
    out = client().get(f"{P}/{OPP}/file").json()
    assert out["locations"] is None and out["brand"]["name"] == "Acme"


def test_file_null_when_missing_406_on_two_and_stage_error_thrown(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/{OPP}/file").json() is None
    assert len(log) == 1
    state["answer"] = lambda s, p: [opp_row(), opp_row()]
    assert client().get(f"{P}/{OPP}/file").status_code == 406
    inner = branded_answer(opp_row())
    state["answer"] = lambda s, p: (psycopg.errors.InsufficientPrivilege("permission denied")
                                    if table_of(s) == "exp_pipeline_stages" else inner(s, p))
    assert client().get(f"{P}/{OPP}/file").status_code == 403


def test_uuidish_is_the_browsers_regex():
    assert q.uuidish(ORG) and q.uuidish(ORG.upper()) and q.uuidish("-" * 36)
    assert not q.uuidish(ORG + "\n") and not q.uuidish(ORG[:-1]) and not q.uuidish(None)
    assert not q.uuidish("Some Rep")


# --- AuditPanel ------------------------------------------------------------------------------

def test_audit_trail_owner_changes_and_the_quotes_promos(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: (
        [{"id": RID, "code": "SAVE10", "redeemed_at": None}] if table_of(s) == "exp_promo_redemptions"
        else psycopg.errors.InsufficientPrivilege("permission denied"))
    out = client().get(f"{P}/{OPP}/audit-trail", params={"quote_id": "Q-1"}).json()
    assert out == {"owners": [], "promos": [{"id": RID, "code": "SAVE10", "redeemed_at": None}]}
    sql, _ = stmt_for(log, "FROM public.exp_opportunity_owner_history")
    assert "ORDER BY public.exp_opportunity_owner_history.changed_at DESC" in sql
    _, params = stmt_for(log, "FROM public.exp_promo_redemptions")
    assert params["subject_id_1"] == "Q-1"


def test_audit_trail_without_a_quote_skips_promos(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/{OPP}/audit-trail").json() == {"owners": [], "promos": []}
    assert [table_of(s) for s in sqls(log)] == ["exp_opportunity_owner_history"]


# --- writes (compiled SQL against the fake; nothing reaches a database) ----------------------

def only_write(log):
    (lease, sql, params), = log
    return lease, sql, params


def test_add_contact_insert_returns_id_with_manual_origin(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    r = client().post(f"{P}/contacts", json={"account_id": ACCT, "first_name": "Pat",
                                            "last_name": None, "email": None, "phone": None,
                                            "job_title": None})
    assert r.json() == {"id": RID}
    lease, sql, params = only_write(log)
    assert lease == AUTH_WRITE
    assert sql.startswith("INSERT INTO public.exp_contacts (") and insert_cols(sql) == {"account_id", "first_name", "last_name", "email", "phone", "job_title", "source_origin"}
    assert sql.endswith("RETURNING public.exp_contacts.id")
    assert params["source_origin"] == "manual"


def test_add_contact_refuses_source_origin_and_406_without_a_row(dbfake):
    _, state, _ = dbfake
    assert client().post(f"{P}/contacts", json={"source_origin": "import"}).status_code == 422
    state["answer"] = lambda s, p: []
    assert client().post(f"{P}/contacts", json={"first_name": "x"}).status_code == 406


def test_contact_link_insert_and_update(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/{OPP}/contact-links", json={
        "contact_id": RID, "role": "Champion", "is_champion": True, "is_primary": False,
        "relationship_strength": 4, "last_touch_at": None,
        "champion_detail": {"pain": "leads"}})
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_opportunity_contacts (") and insert_cols(sql) == {"opportunity_id", "contact_id", "role", "is_champion", "is_primary", "relationship_strength", "last_touch_at", "champion_detail", "source_origin"}
    assert "RETURNING" not in sql
    assert params["opportunity_id"] == OPP and params["source_origin"] == "manual"
    assert isinstance(params["champion_detail"], Jsonb)
    assert params["champion_detail"].obj == {"pain": "leads"}
    log.clear()
    client().patch(f"{P}/{OPP}/contact-links/{RID}", json={
        "is_champion": True, "relationship_strength": None, "last_touch_at": "2026-10-01",
        "champion_detail": None})
    _, sql, params = only_write(log)
    assert sql.startswith("UPDATE public.exp_opportunity_contacts SET is_champion=")
    assert ("WHERE public.exp_opportunity_contacts.id = %(id_1)s::UUID AND "
            "public.exp_opportunity_contacts.opportunity_id = %(opportunity_id_1)s::UUID") in sql
    assert params["champion_detail"] is None  # JSON null stays SQL NULL
    assert client().patch(f"{P}/{OPP}/contact-links/{RID}",
                          json={"relationship_strength": 3.5}).status_code == 422


def test_note_insert_and_update(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    r = client().post(f"{P}/{OPP}/notes", json={
        "subject_label": "Acme", "seller_id": REP, "created_by": REP, "body": "hi @pat",
        "pinned": False, "mentions": ["pat"]})
    assert r.json() == {"id": RID}
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_sales_notes (") and insert_cols(sql) == {"subject_type", "subject_id", "subject_label", "seller_id", "created_by", "body", "pinned", "mentions"}
    assert params["subject_type"] == "opportunity" and params["subject_id"] == OPP
    assert params["created_by"] == REP and params["mentions"] == ["pat"]
    log.clear()
    state["answer"] = lambda s, p: []
    client().patch(f"{P}/{OPP}/notes/{RID}", json={"body": "b", "pinned": True, "mentions": []})
    _, sql, params = only_write(log)
    assert ("WHERE public.exp_sales_notes.id = %(id_1)s::UUID AND "
            "public.exp_sales_notes.subject_type = %(subject_type_1)s::VARCHAR AND "
            "public.exp_sales_notes.subject_id = %(subject_id_1)s::VARCHAR") in sql
    assert params["subject_id_1"] == OPP


def test_task_insert_done_false_and_set_done(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().post(f"{P}/{OPP}/tasks", json={
        "account_id": ACCT, "owner_id": REP, "title": "Call back", "task_type": "reminder",
        "due_at": None, "priority": "high"}).json() == {"id": RID}
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_sales_tasks (") and insert_cols(sql) == {"opportunity_id", "account_id", "owner_id", "title", "task_type", "due_at", "priority", "done"}
    assert params["done"] is False
    log.clear()
    state["answer"] = lambda s, p: []
    client().patch(f"{P}/tasks/{RID}", json={"done": True})
    _, sql, params = only_write(log)
    assert sql == ("UPDATE public.exp_sales_tasks SET done=%(done)s "
                   "WHERE public.exp_sales_tasks.id = %(id_1)s::UUID")
    assert params == {"done": True, "id_1": RID}


def test_activity_uses_the_server_clock(dbfake):
    log, _, _ = dbfake
    before = dt.datetime.now(dt.UTC)
    client().post(f"{P}/{OPP}/activity", json={"event_type": "call_logged", "account_id": ACCT,
                                              "actor": "Rep One", "value": {"summary": "x"}})
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_activity_events (") and insert_cols(sql) == {"event_type", "account_id", "actor", "value", "subject_type", "subject_id", "source", "occurred_at"}
    assert params["subject_type"] == "opportunity" and params["subject_id"] == OPP
    assert params["source"] == "manual" and params["actor"] == "Rep One"
    assert before <= params["occurred_at"] <= dt.datetime.now(dt.UTC)
    assert isinstance(params["value"], Jsonb)
    assert client().post(f"{P}/{OPP}/activity", json={"occurred_at": "2020-01-01"}).status_code == 422


def test_audit_row(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/{OPP}/audit", json={"action": "opportunity_task_added",
                                           "field_changes": {"task_id": RID}})
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.audit_log (") and insert_cols(sql) == {"action", "field_changes", "entity_type", "entity_id"}
    assert params["entity_type"] == "opportunity" and params["entity_id"] == OPP
    assert params["field_changes"].obj == {"task_id": RID}
    assert client().post(f"{P}/{OPP}/audit", json={"action": "x", "user_id": RID}).status_code == 422


def test_audit_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "audit_log"')
    assert client().post(f"{P}/{OPP}/audit", json={"action": "x"}).status_code == 403


def test_demo_book_and_complete(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    client().post(f"{P}/{OPP}/demos", json={"seller_id": REP, "booked_at": "2026-11-01T15:00:00Z",
                                           "objective": "o", "agenda": None,
                                           "attendees": ["a@example.com"]})
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_sales_demos (") and insert_cols(sql) == {"opportunity_id", "seller_id", "booked_at", "objective", "agenda", "attendees", "is_demo"}
    assert params["is_demo"] is False and params["attendees"].obj == ["a@example.com"]
    log.clear()
    state["answer"] = lambda s, p: []
    client().post(f"{P}/{OPP}/demos/{RID}/complete", json={
        "outcome": "good", "follow_up": None, "disposition": "completed", "recording_url": None})
    _, sql, params = only_write(log)
    assert sql.startswith("UPDATE public.exp_sales_demos SET attended=%(attended)s, ")
    assert ("WHERE public.exp_sales_demos.id = %(id_1)s::UUID AND "
            "public.exp_sales_demos.opportunity_id = %(opportunity_id_1)s::UUID") in sql
    assert params["attended"] is True


def test_file_row(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/{OPP}/files", json={"filename": "a.pdf", "kind": "proposal",
                                           "size_bytes": 1024, "uploaded_by": None})
    _, sql, params = only_write(log)
    assert sql.startswith("INSERT INTO public.exp_opportunity_files (") and insert_cols(sql) == {"opportunity_id", "filename", "kind", "size_bytes", "uploaded_by"}
    assert "RETURNING" not in sql and params["size_bytes"] == 1024


# --- exp_opp_* RPCs (compiled only, never called against a database) ------------------------

def test_allow_list_matches_the_live_signatures():
    # pg_get_function_identity_arguments(oid), read-only at port time; all SECURITY DEFINER,
    # search_path=public, returning uuid; none takes an actor parameter
    live = {
        "exp_opp_advance_stage": "p_opp uuid, p_target text, p_captured jsonb",
        "exp_opp_close_lost": "p_opp uuid, p_reason text, p_competitor text, p_revisit date",
        "exp_opp_close_won": "p_opp uuid, p_captured jsonb",
    }
    assert {n: ", ".join(f"{p} {t}" for p, t in ps) for n, ps in q.OPP_RPCS.items()} == live


def test_advance_stage_sql():
    sql, params = q.rpc_sql("exp_opp_advance_stage", {
        "p_opp": OPP, "p_target": "demo", "p_captured": {"Economic buyer identified": "x"}})
    assert sql == ("select public.exp_opp_advance_stage(p_opp => %(p_opp)s::uuid, "
                   "p_target => %(p_target)s::text, p_captured => %(p_captured)s::jsonb) as v")
    assert params["p_opp"] == OPP and params["p_captured"].obj == {"Economic buyer identified": "x"}


def test_close_lost_sql_with_nulls():
    sql, params = q.rpc_sql("exp_opp_close_lost", {
        "p_opp": OPP, "p_reason": "price", "p_competitor": None, "p_revisit": "2027-01-01"})
    assert "p_revisit => %(p_revisit)s::date" in sql
    assert params == {"p_opp": OPP, "p_reason": "price", "p_competitor": None,
                      "p_revisit": "2027-01-01"}


@pytest.mark.parametrize("name,args,why", [
    ("exp_opp_create", {}, "unknown function"),
    ("exp_opp_owner_history_trg", {}, "unknown function"),
    ("exp_opp_close_won", {"p_opp": OPP, "p_actor": "x"}, "unknown parameter"),
    ("exp_opp_close_won", {"p_opp": 5}, "must be a string"),
])
def test_rpc_refusals(name, args, why):
    with pytest.raises(UnknownRpc, match=why):
        q.rpc_sql(name, args)


def test_rpc_endpoint_runs_as_the_user(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": uuid.UUID(OPP)}]
    r = client().post(f"{P}/rpc/exp_opp_close_won", json={"args": {"p_opp": OPP, "p_captured": {}}})
    assert r.json() == OPP
    assert leases == [AUTH_WRITE]
    (_, sql, params), = log
    assert params["p_opp"] == OPP and params["p_captured"].obj == {}
    assert sql == ("select public.exp_opp_close_won(p_opp => %(p_opp)s::uuid, "
                   "p_captured => %(p_captured)s::jsonb) as v")


def test_rpc_refused_before_a_connection_and_errors_reach_the_page(dbfake):
    log, state, leases = dbfake
    assert client().post(f"{P}/rpc/exp_opp_create", json={"args": {}}).status_code == 400
    assert client().post(f"{P}/rpc/exp_opp_close_won", json={"args": {}, "x": 1}).status_code == 422
    assert leases == [] and log == []
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("required field missing: Budget")
    r = client().post(f"{P}/rpc/exp_opp_advance_stage", json={"args": {"p_opp": OPP,
                                                                       "p_target": "demo"}})
    assert r.status_code == 400 and r.json()["detail"] == "required field missing: Budget"
