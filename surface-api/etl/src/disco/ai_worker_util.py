"""Shared helpers for the disco AI worker port (`disco-ai-worker.ts`).

JavaScript semantics the worker relies on (WHATWG URL, `new RegExp(...).test`, `String(e)`,
`Promise.race` time caps, `Promise.all`), the supabase-js style database access (each call is
its own short service-role statement, like one PostgREST request), the Anthropic call and the
page fetch adapter. Other worker modules reach these through this module (``u.fetch_page``),
so tests can monkeypatch one place.

Helpers ported in parallel are resolved at call time by the shared naming convention:
`_base.disco.site_contract` (`sc()`), `_base.disco.network_route` (`nr()`) and
`surfaces.etl.disco.agent_mapper` (`mapper()`).
"""
from __future__ import annotations

import contextvars
import functools
import importlib
import inspect
import logging
import math
import re
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, TypeVar

import httpx

from _base.db.session import role_connection
from _base.disco import ai_cost, webscraper
from _base.disco.site_contract._js import JsURL, js_number, js_str, json_stringify, try_url

log = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_MODEL = "claude-sonnet-4-6"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
# The TS fetch had no timeout; a Python worker thread blocked forever is worse than a JS
# request the runtime ends, so the model call is capped generously.
ANTHROPIC_TIMEOUT_S = 600.0

__all__ = [
    "JsURL", "js_number", "js_str", "json_stringify", "try_url",
]


# ---- sibling modules (ported in parallel) ---------------------------------------------------
def sc() -> Any:
    """`-disco-site-contract.ts` exports."""
    return importlib.import_module("_base.disco.site_contract")


def nr() -> Any:
    """`-disco-network-route.ts` exports."""
    return importlib.import_module("_base.disco.network_route")


def mapper() -> Any:
    """`disco-agent-mapper.ts` library exports (runV2Research, runV2Step)."""
    return importlib.import_module("surfaces.etl.disco.agent_mapper")


def _snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: "_" + m.group(1).lower(), name)


def call_opts(fn: Callable[..., T], *args: Any, opts: dict[str, Any]) -> T:
    """Call a ported `fn(...args, opts)`: with the TS options object when the port takes one
    positionally, else with snake_case keyword arguments (unset options left to defaults)."""
    kw = {_snake(k): v for k, v in opts.items() if v is not None}
    try:
        params = list(inspect.signature(fn).parameters.values())
    except (TypeError, ValueError):
        return fn(*args, opts)
    positional = [p for p in params if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    if len(positional) > len(args) and positional[len(args)].name not in kw:
        return fn(*args, opts)
    if not any(p.kind == p.VAR_KEYWORD for p in params):
        names = {p.name for p in params}
        kw = {k: v for k, v in kw.items() if k in names}
    return fn(*args, **kw)


def g(o: Any, key: str, default: Any = None) -> Any:
    """`o?.key` for a result given as a dict (TS camelCase or snake_case keys) or an object."""
    if o is None:
        return default
    if isinstance(o, dict):
        if key in o:
            return o[key]
        s = _snake(key)
        return o.get(s, default)
    if hasattr(o, key):
        return getattr(o, key)
    return getattr(o, _snake(key), default)


# ---- time ------------------------------------------------------------------------------------
def now_ms() -> int:
    """`Date.now()`."""
    return int(time.time() * 1000)


def iso_now() -> str:
    """`new Date().toISOString()`."""
    d = datetime.now(UTC)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def js_round(x: float) -> int:
    """Math.round (half up)."""
    return math.floor(x + 0.5)


def num(x: Any) -> float:
    """`Number(x)` (None = undefined = NaN)."""
    return js_number(x)


def finite(x: Any) -> bool:
    return isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(x)


def numz(x: Any) -> float:
    """`Number(x) || 0`."""
    n = js_number(x)
    return n if math.isfinite(n) and n else 0


def is_num(x: Any) -> bool:
    """`typeof x === 'number'`."""
    return isinstance(x, int | float) and not isinstance(x, bool)


def as_int(x: float) -> int | float:
    """Integral numbers as int (JSON output like JS)."""
    if isinstance(x, float) and math.isfinite(x) and x == int(x):
        return int(x)
    return x


# ---- errors ----------------------------------------------------------------------------------
class MapSiteError(Exception):
    """A map_site failure that carries diagnostics (stored on the request row)."""

    def __init__(self, message: str, diagnostics: dict[str, Any]):
        super().__init__(message)
        self.diagnostics = diagnostics


def err_message(e: BaseException) -> str:
    """`String(e?.message ?? e)`."""
    return str(e)


def err_string(e: BaseException) -> str:
    """`String(e)` for an Error: "<name>: <message>"."""
    name = "MapSiteError" if isinstance(e, MapSiteError) else "Error"
    msg = str(e)
    return f"{name}: {msg}" if msg else name


def diagnostics_of(e: BaseException) -> dict[str, Any] | None:
    d = getattr(e, "diagnostics", None)
    return d if isinstance(d, dict) else None


# ---- NUL removal (Fix 2026-10-15) ------------------------------------------------------------
def no_nul(v: Any) -> Any:
    """Remove NUL characters from every string and key (Postgres jsonb cannot store them)."""
    if isinstance(v, str):
        return v.replace("\u0000", "") if "\u0000" in v else v
    if isinstance(v, list | tuple):
        return [no_nul(x) for x in v]
    if isinstance(v, dict):
        return {no_nul(k) if isinstance(k, str) else k: no_nul(x) for k, x in v.items()}
    return v


def to_json(v: Any) -> Any:
    """A JSON-ready copy: sets become lists, integral floats ints (stored as JS would)."""
    if isinstance(v, dict):
        return {str(k): to_json(x) for k, x in v.items()}
    if isinstance(v, list | tuple | set | frozenset):
        return [to_json(x) for x in v]
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return as_int(v)
    return v


def js_json(v: Any) -> str:
    """`JSON.stringify(v)`."""
    return json_stringify(to_json(v))


# ---- regular expressions ---------------------------------------------------------------------
@functools.lru_cache(maxsize=4096)
def _compile(pattern: str, flags: int) -> re.Pattern[str]:
    p = re.sub(r"\(\?<([A-Za-z_][A-Za-z0-9_]*)>", r"(?P<\1>", pattern)
    return re.compile(p, flags)


def js_re(pattern: str, ignore_case: bool = False) -> re.Pattern[str]:
    """`new RegExp(pattern)`; raises ValueError when the pattern is not valid."""
    try:
        return _compile(pattern, re.IGNORECASE if ignore_case else 0)
    except re.error as e:
        raise ValueError(f"Invalid regular expression: /{pattern}/: {e}") from e


def re_test(rx: re.Pattern[str] | None, s: str) -> bool:
    """`rx.test(s)` (False when there is no regex)."""
    return bool(rx and rx.search(s))


def re_esc(t: str) -> str:
    """The TS reEsc: `t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')`."""
    return re.sub(r"[.*+?^${}()|\[\]\\]", lambda m: "\\" + m.group(0), t)


def regexp_source(pattern: str) -> str:
    """`new RegExp(p).source` (V8 escapes an unescaped "/" outside character classes)."""
    out: list[str] = []
    in_class = False
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\" and i + 1 < len(pattern):
            out.append(pattern[i:i + 2])
            i += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            out.append("\\/")
            i += 1
            continue
        elif c == "\n":
            out.append("\\n")
            i += 1
            continue
        elif c == "\r":
            out.append("\\r")
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out) or "(?:)"


# ---- URLs ------------------------------------------------------------------------------------
def url_of(s: str, base: str | None = None) -> JsURL:
    """`new URL(s, base)`; raises ValueError when invalid."""
    try:
        return JsURL(str(s), None if base is None else str(base))
    except (ValueError, UnicodeError) as e:
        raise ValueError(f"Invalid URL: {s}") from e


def absolutize(href: str, base: str) -> str | None:
    u = try_url(href, base)
    return u.href if u else None


def host_of(u: str) -> str:
    x = try_url(u)
    return x.host if x else ""


def path_segs(u: JsURL) -> list[str]:
    return [s for s in u.pathname.split("/") if s]


def form_encode(s: str) -> str:
    """application/x-www-form-urlencoded byte serializer (URLSearchParams)."""
    out: list[str] = []
    for b in s.encode("utf-8", "surrogatepass"):
        c = chr(b)
        if c.isascii() and (c.isalnum() or c in "*-._"):
            out.append(c)
        elif c == " ":
            out.append("+")
        else:
            out.append(f"%{b:02X}")
    return "".join(out)


def search_params_string(pairs: list[tuple[str, str]] | dict[str, str]) -> str:
    """`new URLSearchParams(pairs).toString()`."""
    items = list(pairs.items()) if isinstance(pairs, dict) else pairs
    return "&".join(f"{form_encode(k)}={form_encode(v)}" for k, v in items)


def set_search_param(u: JsURL, key: str, value: str) -> None:
    """`u.searchParams.set(key, value)` (the whole query is re-serialized, as in WHATWG)."""
    pairs = u.search_params()
    out: list[tuple[str, str]] = []
    done = False
    for k, v in pairs:
        if k == key:
            if not done:
                out.append((k, value))
                done = True
            continue
        out.append((k, v))
    if not done:
        out.append((key, value))
    ser = search_params_string(out)
    u._query = ser if ser else None


def clear_search(u: JsURL) -> None:
    """`u.search = ''`."""
    u._query = None


def clear_hash(u: JsURL) -> None:
    """`u.hash = ''`."""
    u._fragment = None


def set_pathname(u: JsURL, path: str) -> None:
    """`u.pathname = path` (special URL: percent-encodes like the path parser)."""
    from _base.disco.site_contract import _js as jsmod

    p = path if path.startswith("/") else "/" + path
    u._path = jsmod._pct(p, jsmod._PATH_ENC)


_DECODE_URI_RESERVED = set(";/?:@&=+$,#")


def decode_uri(s: str) -> str:
    """`decodeURI` (escapes of reserved characters are kept); ValueError when malformed."""
    def dec(m: re.Match[str]) -> str:
        seq = m.group(0)
        bs = bytes(int(seq[i + 1:i + 3], 16) for i in range(0, len(seq), 3))
        out: list[str] = []
        i = 0
        while i < len(bs):
            b = bs[i]
            n = 1 if b < 0x80 else 2 if b >> 5 == 6 else 3 if b >> 4 == 14 else 4 if b >> 3 == 30 else 0
            if not n or i + n > len(bs):
                raise ValueError("URI malformed")
            ch = bs[i:i + n].decode("utf-8")
            out.append(seq[i * 3:(i + n) * 3] if ch in _DECODE_URI_RESERVED else ch)
            i += n
        return "".join(out)

    if re.search(r"%(?![0-9A-Fa-f]{2})", s):
        raise ValueError("URI malformed")
    return re.sub(r"(?:%[0-9A-Fa-f]{2})+", dec, s)


# ---- concurrency (Promise.race / Promise.all) ------------------------------------------------
_PENDING = object()


def _spawn(fn: Callable[[], Any]) -> tuple[threading.Thread, dict[str, Any]]:
    box: dict[str, Any] = {"value": _PENDING}
    ctx = contextvars.copy_context()

    def run() -> None:
        try:
            box["value"] = ctx.run(fn)
        except BaseException as e:  # noqa: BLE001
            box["error"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, box


def with_timeout(fn: Callable[[], T], ms: float, fallback: T) -> T:
    """`withTimeout(p, ms, fallback)`: the thunk's result, or `fallback` after `ms`.

    Like the JS promise, work that misses the cap keeps running in the background.
    """
    t, box = _spawn(fn)
    t.join(max(0.0, ms) / 1000)
    if "error" in box:
        raise box["error"]
    if box["value"] is _PENDING:
        return fallback
    return box["value"]


def start(fn: Callable[[], T]) -> Callable[[], T]:
    """Start `fn` now (an un-awaited JS promise); the returned callable awaits it."""
    t, box = _spawn(fn)

    def wait() -> T:
        t.join()
        if "error" in box:
            raise box["error"]
        return box["value"]

    return wait


def parallel(fns: list[Callable[[], Any]]) -> list[Any]:
    """`Promise.all`: run thunks concurrently; the first failure (in list order) is raised."""
    if not fns:
        return []
    if len(fns) == 1:
        return [fns[0]()]
    started = [_spawn(fn) for fn in fns]
    for t, _ in started:
        t.join()
    for _, box in started:
        if "error" in box:
            raise box["error"]
    return [box["value"] for _, box in started]


def safe(fn: Callable[[], T], fallback: T) -> T:
    """`fn()` or `fallback` when it raises (the TS `.catch(() => fallback)`)."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return fallback


# ---- database (supabase-js parity: one statement per call, service role) --------------------
class Db:
    """The TS `supabaseAdmin` client. Each call runs in its own short service-role transaction,
    like one PostgREST request, so a long map run never holds a connection."""

    def rows(self, sql: str, params: tuple | list = ()) -> list[dict]:
        with role_connection("service_role") as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def row(self, sql: str, params: tuple | list = ()) -> dict | None:
        """`.maybeSingle()`: None when no row; error when several."""
        rs = self.rows(sql, params)
        if len(rs) > 1:
            raise RuntimeError("JSON object requested, multiple (or no) rows returned")
        return rs[0] if rs else None

    def write(self, sql: str, params: tuple | list = ()) -> list[dict]:
        with role_connection("service_role", write=True) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            try:
                return list(cur.fetchall())
            except Exception:  # noqa: BLE001  (no result set)
                return []

    def rows_or_none(self, sql: str, params: tuple | list = ()) -> list[dict] | None:
        """`const { data } = await ...` with the error ignored: None on error."""
        try:
            return self.rows(sql, params)
        except Exception as e:  # noqa: BLE001
            log.warning("db read failed: %s", e)
            return None

    def row_or_none(self, sql: str, params: tuple | list = ()) -> dict | None:
        try:
            return self.row(sql, params)
        except Exception as e:  # noqa: BLE001
            log.warning("db read failed: %s", e)
            return None

    def connection(self, write: bool = True) -> Any:
        """A connection context for library code that takes a connection."""
        return role_connection("service_role", write=write)


def db() -> Db:
    return Db()


# ---- Anthropic (always direct, never through the proxy) --------------------------------------
def call_claude(
    api_key: str,
    model: str,
    prompt: str,
    tool: dict,
    max_tokens: int = 4096,
    temperature: float | None = None,
) -> Any:
    """One forced tool call; returns the tool input (no retries, like the TS)."""
    body: dict[str, Any] = {"model": model, "max_tokens": max_tokens}
    if temperature is not None:
        body["temperature"] = temperature
    body["tools"] = [tool]
    body["tool_choice"] = {"type": "tool", "name": tool["name"]}
    body["messages"] = [{"role": "user", "content": prompt}]
    res = httpx.post(
        ANTHROPIC_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        content=json_stringify(body).encode("utf-8"),
        timeout=ANTHROPIC_TIMEOUT_S,
    )
    if not res.is_success:
        raise RuntimeError(f"anthropic {res.status_code}: {res.text[:400]}")
    data = res.json()
    # Fix (ETL AI cost log, 2026-10-22): every call notes its token usage.
    ai_cost.note_ai_usage(
        model=str(data.get("model") if isinstance(data, dict) and data.get("model") else model),
        usage=data.get("usage") if isinstance(data, dict) else None,
        tool=tool["name"],
    )
    content = data.get("content") if isinstance(data, dict) else None
    block = next(
        (b for b in (content or []) if isinstance(b, dict) and b.get("type") == "tool_use"), None
    )
    if not block:
        raise RuntimeError("model returned no tool_use block")
    inp = block.get("input")
    return inp if inp is not None else {}


# Fix (temperature rejected, 2026-10-06): the mapping model rejects temperature; none is sent.
MAP_TEMPERATURE: float | None = None


def call_claude_map(
    api_key: str, model: str, prompt: str, tool: dict, max_tokens: int = 4096
) -> Any:
    return call_claude(api_key, model, prompt, tool, max_tokens, MAP_TEMPERATURE)


# ---- website fetches (all through the shared webscraper layer) -------------------------------
def fetch_page(url: str, method: str = "server_crawl") -> dict:
    """scrapeWebsite adapted to the FetchResult shape {ok, status, body, url, networkError,
    rendered, oxylabsJobId}."""
    result = webscraper.scrape_website({"url": url, "crawl_method": method})
    ox = result.get("oxylabs") or {}
    return {
        "ok": bool(result.get("ok")),
        "status": result.get("status_code") or 0,
        "body": result.get("content") or "",
        "url": result.get("resolved_url") or url,
        "networkError": result.get("error"),
        "rendered": result.get("rendered"),
        "oxylabsJobId": ox.get("job_id") if isinstance(ox, dict) else None,
    }


def miss(url: str) -> dict:
    """A FetchResult for a fetch cut short by a time cap."""
    return {"ok": False, "status": 0, "body": "", "url": url, "networkError": "time cap"}


def looks_bot_blocked(r: dict) -> bool:
    return webscraper.looks_blocked(r.get("status"), r.get("body"))


def page_did_not_load(r: dict | None) -> bool:
    return (
        not r or not r.get("ok") or not r.get("body") or (r.get("status") or 0) >= 400
        or looks_bot_blocked(r)
    )


def capture_network_calls(url: str, options: dict) -> dict:
    return webscraper.capture_network_calls(url, options)


def fetch_api_call(request: dict) -> dict:
    return webscraper.fetch_api_call(request)
