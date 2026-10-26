"""Export every category prompt bundle as one JSON file (port of `export-prompt-bundles.ts`).

 GET|POST /public/export-prompt-bundles

Reads `exp_prompt_bundle` (service role) and, once all 4,041 bundles are built, uploads
`exports/category_prompt_bundles.json` to Supabase Storage (upsert) and returns a signed URL
(the `exports` bucket is private) plus the public URL. Like the TS, no key is checked.
Storage is reached over its REST API with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from _base.db.session import role_connection

router = APIRouter(tags=["etl"])

EXPECTED_COUNT = 4041
CHUNK_SIZE = 200
BUCKET = "exports"
OBJECT_PATH = "category_prompt_bundles.json"
SIGNED_SECONDS = 60 * 60 * 24 * 7
PATH = "/public/export-prompt-bundles"


def _iso_now() -> str:
    d = datetime.now(UTC)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _dumps(v: Any) -> str:
    """JSON.stringify (compact, non-ASCII kept)."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _error(message: str) -> JSONResponse:
    return JSONResponse({"status": "error", "message": message}, status_code=500)


def _storage() -> tuple[str, dict[str, str]]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return base, {"Authorization": f"Bearer {key}", "apikey": key}


def _storage_error(res: httpx.Response) -> str:
    try:
        body = res.json()
        if isinstance(body, dict):
            return str(body.get("message") or body.get("error") or res.text)
    except ValueError:
        pass
    return res.text or f"HTTP {res.status_code}"


def run_export() -> Any:
    try:
        with role_connection("service_role") as conn, conn.cursor() as cur:
            cur.execute("select count(*) as n from exp_prompt_bundle")
            row = cur.fetchone()
    except Exception as e:  # noqa: BLE001
        return _error(str(e))
    built = int(row["n"]) if row else 0
    if built < EXPECTED_COUNT:
        return {"status": "not_ready", "built": built}

    head = (
        '{"format":"exp_category_bundle_universe","format_version":"1.0","generated_at":'
        f'{_dumps(_iso_now())},"count":{EXPECTED_COUNT},"categories":['
    )
    parts: list[str] = [head]
    emitted = 0
    offset = 0
    while True:
        try:
            with role_connection("service_role") as conn, conn.cursor() as cur:
                cur.execute(
                    "select gcid, bundle from exp_prompt_bundle order by gcid asc "
                    "limit %s offset %s",
                    (CHUNK_SIZE, offset),
                )
                data = cur.fetchall()
        except Exception as e:  # noqa: BLE001
            return _error(str(e))
        if not data:
            break
        for r in data:
            parts.append("" if emitted == 0 else ",")
            parts.append(_dumps(r["bundle"]))
            emitted += 1
        if len(data) < CHUNK_SIZE:
            break
        offset += CHUNK_SIZE
    parts.append("]}")

    content = "".join(parts).encode("utf-8")
    size = len(content)

    base, auth = _storage()
    try:
        up = httpx.post(
            f"{base}/storage/v1/object/{BUCKET}/{OBJECT_PATH}",
            headers={**auth, "x-upsert": "true", "content-type": "application/json"},
            content=content,
            timeout=120,
        )
    except httpx.HTTPError as e:
        return _error(str(e))
    if not up.is_success:
        return _error(_storage_error(up))

    public_url = f"{base}/storage/v1/object/public/{BUCKET}/{OBJECT_PATH}"

    # The workspace blocks public buckets, so `exports` is private: also mint a long-lived
    # signed URL that actually resolves today.
    signed_url: str | None = None
    try:
        sres = httpx.post(
            f"{base}/storage/v1/object/sign/{BUCKET}/{OBJECT_PATH}",
            headers={**auth, "content-type": "application/json"},
            content=json.dumps({"expiresIn": SIGNED_SECONDS}),
            timeout=30,
        )
        if sres.is_success:
            rel = (sres.json() or {}).get("signedURL")
            if rel:
                signed_url = f"{base}/storage/v1{rel}" if rel.startswith("/") else rel
    except (httpx.HTTPError, ValueError, AttributeError):
        signed_url = None

    return {
        "status": "done",
        "url": signed_url or public_url,
        "public_url": public_url,
        "bytes": size,
        "rows": emitted,
    }


@router.get(PATH)
def export_get() -> Any:
    return run_export()


@router.post(PATH)
def export_post() -> Any:
    return run_export()
