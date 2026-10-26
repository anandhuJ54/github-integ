"""Route wiring + shape for the graph server functions (DB and HTTP faked)."""
from __future__ import annotations

import json
import sys
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from graph.router import router
from graph.routers import (
    category_boundary_fn,
    category_brief_fn,
    expertise_schema_fn,
)

CLAIMS = {"sub": "u-1", "role": "authenticated", "email": "a@x.com"}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def test_category_brief_reads_as_user_and_compiles(client, fakedb):
    db = fakedb(category_brief_fn)
    db.on("from gbp_categories", [{"gcid": "gcid:x", "display_name": "X Shop"}])
    db.on("from exp_category_shape", [{"gcid": "gcid:x", "shape": "location_first",
                                       "allowed_entity_types": ["location"],
                                       "required_entity_types": ["location"],
                                       "claimable_types": ["location"]}])
    db.on("from exp_vertical_node_registry", [{
        "node_slug": "menu", "node_name": "Menu", "ring": "services", "entity_scope": "location",
        "node_class": None, "connection_method": "manual", "schema_type": None,
        "schema_property": "hasMenu", "required_for_score": True, "score_points": 5,
        "counts_toward_m": True, "owns_lane": None, "requires_verification": False}])
    res = client.post("/graph/fn/getCategoryBrief", json={"data": {"gcid": "gcid:x"}})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["displayName"] == "X Shop" and body["primaryEntityType"] == "location"
    assert body["entityTypes"][0]["collections"][0]["key"] == "offers"
    assert {lease["role"] for lease in db.leases} == {"authenticated"}
    tax = db.sql("from exp_taxonomy")[0]
    assert tax[2][0] == "gcid:x" and "product_service" in tax[2][1]


def test_category_brief_requires_gcid(client, fakedb):
    fakedb(category_brief_fn)
    assert client.post("/graph/fn/getCategoryBrief", json={"data": {}}).status_code == 400


def test_get_boundary_service_role_and_gcid_check(client, fakedb):
    db = fakedb(category_boundary_fn)
    db.on("from exp_category_boundary", [{"gcid": "gcid:x", "definition": "d"}])
    res = client.post("/graph/fn/getCategoryBoundary", json={"data": {"gcid": " gcid:x "}})
    assert res.json() == {"gcid": "gcid:x", "definition": "d"}
    assert db.leases[0]["role"] == "service_role"
    bad = client.post("/graph/fn/getCategoryBoundary", json={"data": {"gcid": "x"}})
    assert (bad.status_code, bad.json()["detail"]) == (400, "gcid required")


def test_regenerate_boundary_requires_role(client, fakedb):
    db = fakedb(category_boundary_fn)
    db.on("exp_ctrl_has_role", [{"ok": False}])
    res = client.post("/graph/fn/regenerateCategoryBoundary", json={"data": {"gcid": "gcid:x"}})
    assert (res.status_code, res.json()["detail"]) == (403, "insufficient_privilege")
    assert db.sql("exp_ctrl_has_role")[0][2] == (["super_admin", "architect"],)


def test_regenerate_boundary_runs_generator(client, fakedb, monkeypatch):
    db = fakedb(category_boundary_fn)
    db.on("exp_ctrl_has_role", [{"ok": True}])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    seen = {}

    def gen(conn, model, gcid, ask, regenerate=False):
        seen.update(model=model, gcid=gcid, regenerate=regenerate)
        return {"boundary": None, "saved": True, "reason": "generated"}

    monkeypatch.setitem(sys.modules, "_base.disco.boundary",
                        types.SimpleNamespace(generate_category_boundary=gen))
    res = client.post("/graph/fn/regenerateCategoryBoundary", json={"data": {"gcid": "gcid:x"}})
    assert res.json() == {"saved": True, "reason": "generated"}
    assert seen == {"model": "claude-sonnet-4-6", "gcid": "gcid:x", "regenerate": True}


# --- expertise schema: pure gates + stamping --------------------------------------------

KM_ACTS = [{"lane": "professional", "profile_button": "Call", "schema_action": "CommunicateAction",
            "label": "Call"},
           {"lanes": ["professional"], "profileButton": "Book", "schemaAction": "ReserveAction",
            "label": "Book"},
           {"lane": "location", "profile_button": "Visit", "label": "Visit"}]


def _lane(n_fields=120, scored=36, seo=20):
    fields = [{"label": f"f{i}", "scored": i < scored} for i in range(n_fields)]
    per = n_fields // 9
    elements = [{"n": i + 1, "name": f"E{i}", "fields": fields[i * per:(i + 1) * per]}
                for i in range(8)]
    elements.append({"n": 9, "name": "E8", "fields": fields[8 * per:]})
    return {"elements": elements, "seo": [["a", "b"]] * seo,
            "jsonld": json.dumps({"@graph": [{"@id": "x"}, {"@type": "Person"}]}),
            "profile": [{"kind": "stats"}]}


def test_stamp_and_gate_lane():
    acts = expertise_schema_fn.km_actions_for_lane({"conversion_actions": KM_ACTS},
                                                   "professional")
    assert [a["label"] for a in acts] == ["Call", "Book"]
    lane = _lane()
    expertise_schema_fn.stamp_tether(lane, acts)
    assert lane["profile"][0] == {"kind": "header", "name": "", "subtitle": "", "initials": "",
                                  "ctas": ["Call", "Book"]}
    jl = json.loads(lane["jsonld"])
    assert jl["@graph"][1]["potentialAction"] == [
        {"@type": "CommunicateAction", "name": "Call"}, {"@type": "ReserveAction", "name": "Book"}]
    assert expertise_schema_fn.gate_lane(lane, acts) == {"pass": True, "failures": []}


def test_gate_failures():
    lane = _lane(n_fields=90, scored=5, seo=3)
    lane["jsonld"] = "not json"
    g = expertise_schema_fn.gate_lane(lane, KM_ACTS[:1])
    assert g["failures"] == ["fields 90 < 100", "scored ratio 6% out of range", "seo rows 3 < 18",
                             "jsonld invalid", "header.ctas != KM buttons",
                             "potentialAction -1 != KM 1"]


def test_extract_json():
    assert expertise_schema_fn.extract_json('```json\n{"a": {"b": 1}}\n```') == {"a": {"b": 1}}
    with pytest.raises(ValueError):
        expertise_schema_fn.extract_json("no json")


def test_generate_schema_requires_km(client, fakedb, monkeypatch):
    fakedb(expertise_schema_fn)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    data = {"gcid": "gcid:x", "displayName": "X", "entityType": "both"}
    res = client.post("/graph/fn/generateCategorySchema", json={"data": data})
    assert res.status_code == 400 and "No Knowledge Model" in res.json()["detail"]


def test_generate_schema_end_to_end(client, fakedb, monkeypatch):
    db = fakedb(expertise_schema_fn)
    db.on("from exp_category_knowledge", [{"conversion_actions": KM_ACTS, "services": ["s"],
                                           "updated_at": None}])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    def fake_call(api_key, system, user, max_tokens=16000):
        if "Produce ONLY the 9 expertise elements" in system:
            return {"schemaType": "Person", "elements": _lane()["elements"]}
        lane = _lane()
        return {"seo": lane["seo"], "jsonld": lane["jsonld"], "html": "<div/>",
                "profile": [{"kind": "header", "ctas": []}]}

    monkeypatch.setattr(expertise_schema_fn, "call_anthropic", fake_call)
    data = {"gcid": "gcid:x", "displayName": "X", "entityType": "professional"}
    res = client.post("/graph/fn/generateCategorySchema", json={"data": data})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] and body["persisted"] and body["persistError"] is None
    assert body["stats"] == [{"lane": "professional", "schemaType": "Person", "fields": 120,
                              "scored": 36}]
    assert db.sql("insert into exp_category_schema")[0][0] == "service_role"
    assert db.sql("insert into audit_log")[0][0] == "authenticated"
