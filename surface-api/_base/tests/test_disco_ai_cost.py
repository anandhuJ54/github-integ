"""Tests for _base.disco.ai_cost (no live DB: a fake connection records the SQL)."""
from __future__ import annotations

import contextvars
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import pytest

from _base.disco import ai_cost
from _base.disco.ai_cost import CostContext, cost_of, note_ai_usage, price_for, with_cost_context


class FakeConn:
    def __init__(self, fail: bool = False):
        self.calls: list[tuple[str, list]] = []
        self.fail = fail

    @contextmanager
    def transaction(self):
        yield

    @contextmanager
    def cursor(self):
        conn = self

        class Cur:
            description = None

            def execute(self, sql, params=None):
                if conn.fail:
                    raise RuntimeError("insert boom")
                conn.calls.append((sql, list(params or [])))

        yield Cur()


def test_price_for_exact_and_dated_ids():
    assert price_for("claude-sonnet-5") == (2.0, 0.2, 2.5, 10.0)
    # Longest prefix wins: sonnet-5-5 is not priced as sonnet-5.
    assert price_for("claude-sonnet-5-5-20261001") == (2.0, 0.1, 2.5, 10.0)
    assert price_for("claude-sonnet-4-6-20260101") == (3.0, 0.3, 3.75, 15.0)
    assert price_for("gpt-x") is None
    assert price_for(None) is None


def test_cost_of():
    usage = {"input_tokens": 1_000_000, "output_tokens": 1_000_000,
             "cache_read_input_tokens": 1_000_000, "cache_creation_input_tokens": 1_000_000}
    assert cost_of("claude-opus-5-5", usage) == pytest.approx(4.0 + 0.2 + 5.0 + 20.0)
    assert cost_of("claude-opus-5-5", None) == 0
    assert cost_of("unknown-model", usage) is None


def test_note_outside_context_is_ignored():
    note_ai_usage(model="claude-sonnet-5", usage={"input_tokens": 5})
    assert ai_cost.pending_rows() is None


def test_rows_are_written_once_at_the_end():
    conn = FakeConn()
    ctx = CostContext(db=conn, activity="discovery", gcid="gcid:accountant", domain="x.com",
                      request_id=7, job_id=None)

    def work():
        note_ai_usage(model="claude-sonnet-5", usage={"input_tokens": 1000, "output_tokens": 10})
        note_ai_usage(model="claude-sonnet-5", usage=None, tool="define_category_boundary")
        note_ai_usage(model="mystery", usage={"input_tokens": 3}, step="s1")
        rows = ai_cost.pending_rows()
        assert rows is not None and len(rows) == 3
        assert conn.calls == []  # nothing written until the context ends
        return "done"

    assert with_cost_context(ctx, work) == "done"
    assert len(conn.calls) == 1
    sql, params = conn.calls[0]
    assert sql.startswith("insert into exp_etl_cost_events (activity, model, calls,")
    assert len(params) == 3 * 14
    r1, r2, r3 = (params[i * 14:(i + 1) * 14] for i in range(3))
    assert r1[0] == "discovery" and r1[1] == "claude-sonnet-5" and r1[2] == 1
    assert r1[3] == 1000 and r1[6] == 10
    assert r1[7] == pytest.approx((1000 * 2.0 + 10 * 10.0) / 1e6)
    assert r1[8:12] == ["gcid:accountant", "x.com", 7, None]
    assert r1[12].obj["price_per_mtok"] == {"input": 2.0, "cache_read": 0.2,
                                             "cache_write": 2.5, "output": 10.0}
    # tool -> its own activity; missing usage flagged
    assert r2[0] == "boundary"
    assert r2[12].obj["tool"] == "define_category_boundary"
    assert r2[12].obj["usage_missing"] is True
    # unpriced model: cost 0, flagged
    assert r3[7] == 0 and r3[12].obj == {"step": "s1", "unpriced": True}
    assert ai_cost.pending_rows() is None


def test_explicit_activity_wins_and_batches_of_200():
    conn = FakeConn()

    def work():
        for _ in range(450):
            note_ai_usage(model="claude-sonnet-5", usage={}, activity="extra_match")

    with_cost_context(CostContext(db=conn, activity="map_contract"), work)
    assert [len(p) // 14 for _, p in conn.calls] == [200, 200, 50]
    assert conn.calls[0][1][0] == "extra_match"


def test_insert_failure_never_raises_and_rows_still_flushed_on_error():
    conn = FakeConn(fail=True)

    def work():
        note_ai_usage(model="claude-sonnet-5", usage={"input_tokens": 1})
        raise ValueError("work failed")

    with pytest.raises(ValueError, match="work failed"):
        with_cost_context(CostContext(db=conn, activity="discovery"), work)


def test_db_factory_is_opened_only_when_rows_exist():
    opened: list[FakeConn] = []

    @contextmanager
    def factory():
        c = FakeConn()
        opened.append(c)
        yield c

    with_cost_context(CostContext(db=factory, activity="a"), lambda: None)
    assert opened == []
    with_cost_context(
        CostContext(db=factory, activity="a"),
        lambda: note_ai_usage(model="claude-sonnet-5", usage={"input_tokens": 1}),
    )
    assert len(opened) == 1 and len(opened[0].calls) == 1


def test_contexts_do_not_mix_across_threads():
    c1, c2 = FakeConn(), FakeConn()

    def run(conn, act, n):
        def work():
            for _ in range(n):
                note_ai_usage(model="claude-sonnet-5", usage={"input_tokens": 1})
        with_cost_context(CostContext(db=conn, activity=act), work)

    with ThreadPoolExecutor(2) as ex:
        list(ex.map(lambda a: run(*a), [(c1, "one", 3), (c2, "two", 5)]))
    assert len(c1.calls[0][1]) // 14 == 3 and c1.calls[0][1][0] == "one"
    assert len(c2.calls[0][1]) // 14 == 5 and c2.calls[0][1][0] == "two"


def test_copied_context_in_worker_threads_notes_into_same_store():
    conn = FakeConn()

    def work():
        with ThreadPoolExecutor(2) as ex:
            futs = [
                ex.submit(contextvars.copy_context().run, note_ai_usage,
                          model="claude-sonnet-5", usage={"input_tokens": 1})
                for _ in range(2)
            ]
            [f.result() for f in futs]

    with_cost_context(CostContext(db=conn, activity="a"), work)
    assert len(conn.calls[0][1]) // 14 == 2
