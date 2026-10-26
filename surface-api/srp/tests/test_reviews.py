"""Review reply drafting, compliance check, save and flag."""
from __future__ import annotations

import json

import pytest
from surfaces.srp.routers import reviews_fn
from surfaces.srp.routers.reviews_fn import build_prompts, check_compliance, review_style

RID = "11111111-1111-4111-8111-111111111111"
PID = "22222222-2222-4222-8222-222222222222"


def responder(sql, params):
    if "from reviews" in sql:
        return [{"id": RID, "rating": 5, "title": None, "body": "Great!", "reviewer_name": "Ann"}]
    if "from professionals" in sql:
        return [{"id": PID, "display_name": "Sam Realty", "first_name": "Sam", "gcid": "gcid:real_estate_agents"}]
    if "exp_category_knowledge" in sql:
        return [{"ai_agents": {"review_response": {"style": "brief"}}}]
    if "content_compliance_rules" in sql:
        return [{"rule_name": "No guarantee", "rule_type": "prohibited_phrase",
                 "rule_value": "Guaranteed", "severity": "block", "applies_to": ["review_reply"]},
                {"rule_name": "Ads only", "rule_type": "prohibited_phrase",
                 "rule_value": "great", "severity": "warn", "applies_to": ["ad"]}]
    if "exp_category_compliance" in sql:
        return [{"prohibited_phrases": ["best neighborhood", ""]}]
    return []


def test_check_compliance_scopes_to_review_replies():
    rules = responder("content_compliance_rules", None)
    issues = check_compliance("We GUARANTEED a great sale", rules)
    assert issues == [{"rule_name": "No guarantee", "severity": "block",
                       "rule_type": "prohibited_phrase", "rule_value": "Guaranteed"}]


def test_review_style_fallbacks():
    assert review_style({"review_response_style": "x"}) == "x"
    assert review_style({"review_responder": {"style": "y"}}) == "y"
    assert review_style(None).startswith("warm, professional")


def test_prompts():
    system, user = build_prompts(
        {"display_name": None, "first_name": "Sam"},
        {"rating": 4, "title": "Nice", "body": None, "reviewer_name": None},
        "brief",
        [{"rule_type": "prohibited_phrase", "rule_value": "a"},
         {"rule_type": "category_restriction", "rule_value": "b"}],
    )
    assert system.startswith("You write public review replies for Sam. Style: brief.\n")
    assert "Never use any of these phrases: a; b." in system
    assert user == "Reviewer: Customer\nRating: 4/5\nTitle: Nice\nReview: \n\nWrite a public reply."


def test_draft_requires_auth(anon_client):
    res = anon_client.post("/srp/fn/draftReviewReply", json={"data": {"reviewId": RID, "professionalId": PID}})
    assert res.status_code in (401, 403)


def test_draft_bad_input(fake_db, client):
    fake_db(responder)
    res = client.post("/srp/fn/draftReviewReply", json={"data": {"reviewId": "nope", "professionalId": PID}})
    assert res.status_code == 400


def test_draft_review_not_found(fake_db, client):
    fake_db(lambda sql, p: [])
    res = client.post("/srp/fn/draftReviewReply", json={"data": {"reviewId": RID, "professionalId": PID}})
    assert res.status_code == 400 and res.json()["detail"] == "Review not found"


def test_draft_calls_model_checks_compliance_and_audits(fake_db, client, monkeypatch):
    db = fake_db(responder)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    sent = {}

    class Res:
        is_success = True
        status_code = 200

        def json(self):
            return {"content": [{"type": "text", "text": "  Thanks Ann, best neighborhood!  "}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent.update(url=url, headers=headers, body=json)
        return Res()

    monkeypatch.setattr(reviews_fn.httpx, "post", fake_post)
    res = client.post("/srp/fn/draftReviewReply", json={"data": {"reviewId": RID, "professionalId": PID}})
    assert res.status_code == 200
    body = res.json()
    assert body["draft"] == "Thanks Ann, best neighborhood!"
    assert body["issues"] == [{"rule_name": "Category prohibited phrase", "severity": "block",
                               "rule_type": "prohibited_phrase", "rule_value": "best neighborhood"}]
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["body"]["model"] == "claude-sonnet-4-6" and sent["body"]["max_tokens"] == 400
    assert sent["headers"]["anthropic-version"] == "2023-06-01"
    role, write, _sql, params = db.find("insert into audit_log")[0]
    assert role == "authenticated" and write
    assert params[:3] == ["user-1", "review.reply.draft", RID]
    assert json.loads(params[3]) == {"length": 30, "issues": 1}


def test_draft_without_key_is_500(fake_db, client, monkeypatch):
    fake_db(responder)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = client.post("/srp/fn/draftReviewReply", json={"data": {"reviewId": RID, "professionalId": PID}})
    assert res.status_code == 500 and res.json()["detail"] == "ANTHROPIC_API_KEY not configured"


def test_check_reply_compliance(fake_db, client):
    db = fake_db(responder)
    res = client.post("/srp/fn/checkReplyCompliance", json={"data": {"text": "guaranteed", "gcid": None}})
    assert [i["rule_name"] for i in res.json()["issues"]] == ["No guarantee"]
    assert db.log[0][3] == [""]  # gcid null → `gcid.eq.` (empty) or null
    assert not db.find("exp_category_compliance")


@pytest.mark.parametrize(
    ("fn", "data", "update", "action"),
    [
        ("saveReviewReply", {"reviewId": RID, "replyBody": "Thanks!"}, "reply_body", "review.reply.save"),
        ("flagReview", {"reviewId": RID, "reason": "spam"}, "is_flagged = true", "review.flag"),
    ],
)
def test_save_and_flag(fake_db, client, fn, data, update, action):
    db = fake_db(lambda sql, p: [{"id": RID}])
    res = client.post(f"/srp/fn/{fn}", json={"data": data})
    assert res.json() == {"ok": True}
    upd = db.find("update reviews")[0]
    assert upd[0] == "authenticated" and upd[1] and update in upd[2]
    assert db.find("insert into audit_log")[0][3][1] == action


def test_save_rejects_empty_body(fake_db, client):
    fake_db(responder)
    res = client.post("/srp/fn/saveReviewReply", json={"data": {"reviewId": RID, "replyBody": ""}})
    assert res.status_code == 400
