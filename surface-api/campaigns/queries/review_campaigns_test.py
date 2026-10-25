"""Enterprise review campaigns reads and writes (no live DB): the SQL the writes would send
(never run). Moved from xmp/queries/seat_queries_test.py with the queries, surface audit
2026-10-25."""
from __future__ import annotations

from campaigns.queries import review_campaigns as q

PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"


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
    q.update_campaign_status(log, PID, "paused")
    s, p = log.sent[0]
    assert s == ("UPDATE public.review_campaigns SET status=%(status)s::VARCHAR "
                 "WHERE public.review_campaigns.id = %(id_1)s::UUID")
    assert p == {"status": "paused", "id_1": PID}


def test_campaign_insert_sends_only_the_given_keys_without_returning():
    log = Log()
    q.insert_campaign(log, {"entity_type": "organization", "entity_id": OID, "name": "x",
                                     "status": "draft", "compliance_approved": False})
    s, p = log.sent[0]
    assert s.startswith("INSERT INTO public.review_campaigns (entity_type, entity_id, name, status, "
                        "compliance_approved) VALUES")
    assert "RETURNING" not in s and len(p) == 5
