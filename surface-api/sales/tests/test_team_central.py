"""sales Team Central endpoints (no live DB/auth): moved from xmp (/xmp/team/*), surface audit
2026-10-25. The reads run as the signed-in user; the family reads are skipped when there is
nothing to read. No write exists here."""
from __future__ import annotations

import pytest
from surfaces.sales.routers.team_central_data import router

from sales.tests.test_contracts import (
    AUTH_READ,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)

P = "/sales/team-central"
TID = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


@pytest.mark.parametrize("method,path", [("get", f"{P}/insurance"), ("post", f"{P}/family")])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method == "post" else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


def test_team_base_reads_the_five_tables_as_the_user(dbfake):
    log, _, leases = dbfake
    r = client().get(f"{P}/insurance")
    assert r.status_code == 200
    assert set(r.json()) == {"reps", "territories", "revenue", "quotas", "groups"}
    assert set(leases) == {AUTH_READ}
    assert sorted(table_of(s) for s in sqls(log)) == sorted([
        "exp_sales_reps", "exp_territories", "exp_revenue_components", "exp_sales_quotas",
        "exp_category_groups"])
    assert "insurance" in [v for _, _, p in log for v in p.values()]


def test_team_family_skips_reads_without_territories_or_family(dbfake):
    log, _, _ = dbfake
    r = client().post(f"{P}/family", json={"family_key": None, "territory_ids": [], "year": 2026})
    assert r.json() == {k: [] for k in ("links", "orgs", "sellers", "expansion", "months")}
    assert sqls(log) == []


def test_team_family_reads_links_orgs_sellers_and_expansion(dbfake):
    log, _, leases = dbfake
    r = client().post(f"{P}/family",
                      json={"family_key": "insurance", "territory_ids": [TID], "year": 2026})
    assert r.status_code == 200
    assert set(leases) == {AUTH_READ}
    assert sorted(table_of(s) for s in sqls(log)) == sorted([
        "exp_territory_brand", "organizations", "exp_sales_reps", "v_logo_expansion",
        "v_logo_expansion_month"])


def test_family_body_is_an_allow_list(dbfake):
    r = client().post(f"{P}/family", json={"year": 2026, "other": 1})
    assert r.status_code == 422
