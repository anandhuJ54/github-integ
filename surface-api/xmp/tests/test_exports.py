"""xmp exports for other Surfaces (fake connection, no live DB): the SQL each read sends and the
shapes it returns; soft-deleted rows are left out (increment
surface-spec/campaigns/campaigns-xmp-tables)."""
from __future__ import annotations

from surfaces.xmp import exports as x


class Conn:
    def __init__(self, rows: list[dict]):
        self.rows, self.sent = rows, []

    def cursor(self):
        conn = self

        class C:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, s, p=None):
                conn.sent.append((" ".join(s.split()), p or {}))

            def fetchall(self):
                return conn.rows

        return C()


ACCOUNT = {"id": 7, "organization_id": 1, "name": "Acme", "slug": "acme", "status": 1}


def test_get_account_leaves_out_soft_deleted():
    conn = Conn([ACCOUNT])
    assert x.get_account(conn, 7) == x.AccountRef(**ACCOUNT)
    s, p = conn.sent[0]
    assert s.startswith("SELECT xmp.accounts.id, xmp.accounts.organization_id, "
                        "xmp.accounts.name, xmp.accounts.slug, xmp.accounts.status "
                        "FROM xmp.accounts WHERE xmp.accounts.id = %(id_1)s::BIGINT "
                        "AND xmp.accounts.deleted_at IS NULL")
    assert p["id_1"] == 7


def test_get_account_unknown_is_none():
    assert x.get_account(Conn([]), 7) is None


def test_get_accounts_is_one_query_keyed_by_id_without_a_cap():
    conn = Conn([ACCOUNT])
    assert x.get_accounts(conn, [7, 7, 8]) == {7: x.AccountRef(**ACCOUNT)}
    s, p = conn.sent[0]
    assert "xmp.accounts.id IN (" in s and "deleted_at IS NULL" in s and "LIMIT" not in s
    assert sorted(p.values()) == [7, 8]


def test_get_accounts_of_nothing_sends_nothing():
    conn = Conn([])
    assert x.get_accounts(conn, []) == {} and conn.sent == []


def test_get_all_vertical_is_the_lowest_id_named_all():
    conn = Conn([{"id": 3, "name": "All", "status": 0}])
    assert x.get_all_vertical(conn) == x.VerticalRef(id=3, name="All", status=0)
    s, p = conn.sent[0]
    assert "WHERE xmp.verticals.name = %(name_1)s::VARCHAR ORDER BY xmp.verticals.id " \
           "LIMIT %(param_1)s::INTEGER" in s
    assert p == {"name_1": "All", "param_1": 1}


def test_get_vertical_has_no_soft_delete_filter():
    conn = Conn([{"id": 2, "name": "Mortgage", "status": 0}])
    assert x.get_vertical(conn, 2).name == "Mortgage"
    assert "deleted_at" not in conn.sent[0][0]


def test_get_tier_and_tier_agent_leave_out_soft_deleted():
    conn = Conn([{"id": 4, "account_id": 7, "name": "HQ", "parent": 0, "status": 1}])
    assert x.get_tier(conn, 4).parent == 0
    conn2 = Conn([{"id": 5, "account_id": 7, "tier_id": 4, "user_id": 9, "publish_name": None,
                   "status": 1}])
    assert x.get_tier_agent(conn2, 5).tier_id == 4
    for c, table in ((conn, "tiers"), (conn2, "tier_agents")):
        assert f"xmp.{table}.deleted_at IS NULL" in c.sent[0][0]
