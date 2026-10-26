"""Background deep-hydration tick (port of `routes/api/public/etl-deep-hydrate.ts`).

Deterministic parsing, no AI.

 GET  /public/etl-deep-hydrate   -> progress snapshot (no auth needed, no PII)
 POST /public/etl-deep-hydrate   -> process one bounded batch
      body: { job_key?, batch_size?, action?: 'run'|'pause'|'resume' }

Single-flight: a lease on exp_etl_hydrate_jobs; a second concurrent tick exits. Bounded:
batch_size rows per tick. Idempotent: rows already deep are skipped and every write is keyed on
detail_url. Paused jobs exit at the entry point. Like the TS, neither method checks a key.
Nothing here schedules itself: the DB-side scheduler decides whether ticks are sent.
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse

from _base.db.session import role_connection
from surfaces.etl.deep_hydrate import services as mod

router = APIRouter(tags=["etl"])

DEFAULT_JOB = "statefarm_deep_hydrate"
MAX_BATCH = 250
LEASE_MINUTES = 5
CONCURRENCY = 6
PATH = "/public/etl-deep-hydrate"


def _db():
    return role_connection("service_role", write=True)


def _json(body: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(jsonable_encoder(body), status_code=status)


def _load_job(job_key: str) -> dict | None:
    with _db() as conn, conn.cursor() as cur:
        cur.execute("select * from exp_etl_hydrate_jobs where job_key = %s limit 2", (job_key,))
        rows = cur.fetchall()
    return dict(rows[0]) if len(rows) == 1 else None


def _update_job(job_key: str, patch: dict[str, Any]) -> None:
    cols = list(patch)
    sets = ", ".join(f"{c} = %s" for c in cols)  # column names are fixed in this module
    with _db() as conn, conn.cursor() as cur:
        cur.execute(f"update exp_etl_hydrate_jobs set {sets} where job_key = %s",
                    (*(patch[c] for c in cols), job_key))


def _num(v: Any, default: float = 0) -> float:
    try:
        return float(v if v is not None else default)
    except (TypeError, ValueError):
        return default


def _as_int(v: float) -> int | float:
    return int(v) if float(v).is_integer() else v


def _lease_ms(v: Any) -> float:
    if not v:
        return 0
    if isinstance(v, datetime):
        d = v if v.tzinfo else v.replace(tzinfo=UTC)
        return d.timestamp() * 1000
    try:
        d = datetime.fromisoformat(str(v))
        if d.tzinfo is None:
            d = d.replace(tzinfo=UTC)
        return d.timestamp() * 1000
    except ValueError:
        return float("nan")


@router.get(PATH)
def progress(job_key: str | None = None):
    key = job_key if job_key is not None else DEFAULT_JOB
    job = _load_job(key)
    if not job:
        return PlainTextResponse("Unknown job", status_code=404)
    with _db() as conn:
        prog = mod.hydration_progress(conn, str(job.get("gcid")))
    return _json({"job": job, "progress": prog})


def _run_batch(rows: list[dict], floor: dict) -> list[dict]:
    results: list[dict] = []
    lock = threading.Lock()
    cursor = {"i": 0}

    def worker() -> None:
        while True:
            with lock:
                if cursor["i"] >= len(rows):
                    return
                row = rows[cursor["i"]]
                cursor["i"] += 1
            if not row or not row.get("detail_url"):
                continue
            try:
                html = mod.fetch_agent_html(row["detail_url"])
                # one connection lease (one transaction) per row
                with _db() as conn:
                    res = mod.hydrate_staging_row(conn, row, html, floor, mod.fetch_agent_html)
            except Exception as err:  # noqa: BLE001
                res = {"stage_id": row.get("stage_id"), "detail_url": row["detail_url"],
                       "ok": False, "error": str(err)}
            with lock:
                results.append(res)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        for f in [ex.submit(worker) for _ in range(CONCURRENCY)]:
            f.result()
    return results


@router.post(PATH)
async def tick(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    return _tick(body)


def _tick(body: dict[str, Any]) -> Any:
    job_key = body.get("job_key") if body.get("job_key") is not None else DEFAULT_JOB
    job = _load_job(job_key)
    if not job:
        return PlainTextResponse("Unknown job", status_code=404)

    # job control
    action = body.get("action")
    if action in ("pause", "resume"):
        status = "paused" if action == "pause" else "idle"
        _update_job(job_key, {"status": status, "lease_until": None, "last_error": None})
        return _json({"job_key": job_key, "status": status})

    # paused-state guard: the scheduler keeps firing regardless of job state
    if job.get("status") in ("paused", "done"):
        return _json({"skipped": f"job {job.get('status')}"})

    # single-flight lease
    now = datetime.now(UTC)
    now_ms = now.timestamp() * 1000
    lease = _lease_ms(job.get("lease_until"))
    if job.get("status") == "running" and lease > now_ms:
        return _json({"skipped": "another tick holds the lease", "lease_until": job.get("lease_until")})
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            "update exp_etl_hydrate_jobs set status = 'running', lease_until = %s, "
            "last_run_at = %s where job_key = %s and updated_at = %s returning job_key",
            (now + timedelta(minutes=LEASE_MINUTES), datetime.now(UTC), job_key,
             job.get("updated_at")),
        )
        claimed = cur.fetchall()
    if not claimed:
        return _json({"skipped": "lease race lost"})

    gcid = str(job.get("gcid"))
    raw = body.get("batch_size")
    if raw is None:
        raw = job.get("batch_size")
    batch = int(min(max(_num(raw, 50), 1), MAX_BATCH))

    try:
        with _db() as conn:
            floor = mod.load_field_floor(conn, gcid)
            rows = mod.load_pending_staging_rows(conn, gcid, batch)
        results = _run_batch(rows, floor)

        summary = mod.summarize(results)
        with _db() as conn:
            prog = mod.hydration_progress(conn, gcid)
        done = prog["remaining"] == 0

        # circuit breaker: the source edge blocks this runtime's egress - stop instead of
        # burning ticks on requests that can never succeed.
        blocked = (
            len(results) > 0
            and summary["parsed"] == 0
            and all(re.search(r"fetch (401|403|429)", f.get("error") or "")
                    for f in summary["failures"])
        )
        if blocked:
            first = summary["failures"][0].get("error") if summary["failures"] else None
            _update_job(job_key, {
                "status": "paused",
                "lease_until": None,
                "failed": _as_int(_num(job.get("failed")) + summary["failed"]),
                "last_error": f"source blocked this runtime ({first}); paused",
            })
            return _json({"job_key": job_key, "paused": "source_blocked", "summary": summary,
                          "progress": prog})

        _update_job(job_key, {
            "status": "done" if done else "idle",
            "lease_until": None,
            "processed": _as_int(_num(job.get("processed")) + summary["processed"]),
            "promoted": _as_int(_num(job.get("promoted")) + summary["promoted"]),
            "shallow": _as_int(_num(job.get("shallow")) + summary["shallow"]),
            "failed": _as_int(_num(job.get("failed")) + summary["failed"]),
            "last_error": summary["failures"][0].get("error") if summary["failures"] else None,
        })
        return _json({"job_key": job_key, "batch": batch, "summary": summary, "progress": prog})
    except Exception as err:  # noqa: BLE001
        message = str(err)
        _update_job(job_key, {"status": "paused", "lease_until": None, "last_error": message})
        return _json({"error": message, "status": "paused"}, 500)
