"""Shared external-website fetch library (port of `disco-webscraper-worker.ts`).

The single place for "fetch a target website through Oxylabs": proxying, render fallback and
bot-block detection. It never talks to Anthropic or any first-party API.

Config (read lazily, same env vars as the TS):
  required OXYLABS_USERNAME, OXYLABS_PASSWORD (and DISCO_WORKER_KEY for the HTTP handler);
  optional OXYLABS_ENDPOINT, OXYLABS_GEO_LOCATION, OXYLABS_USER_AGENT_TYPE, OXYLABS_TIMEOUT_MS,
  OXYLABS_RENDER_TIMEOUT_MS, FORCE_PROXY (only the exact value "false" disables the proxy).

Results are plain dicts with the TS keys, so they serialise to the same JSON. The HTTP route
(`POST /public/disco-webscraper-worker`) is wired elsewhere; it should call
`handle_webscraper_request` and return its `(status, body)`.
"""
from __future__ import annotations

import base64
import json
import math
import os
import re
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

VALID_CRAWL_METHODS = ["server_crawl", "needs_proxy", "needs_js_api", "direct"]


# ---- config (lazy) ----------------------------------------------------------------------------
def _endpoint() -> str:
    return os.environ.get("OXYLABS_ENDPOINT") or "https://realtime.oxylabs.io/v1/queries"


def _num_env(name: str, default: float) -> float:
    v = os.environ.get(name)
    if v is None:
        return default
    try:
        return float(v)
    except ValueError:
        return float("nan")


def _normal_timeout_ms() -> float:
    return _num_env("OXYLABS_TIMEOUT_MS", 60_000)


def _render_timeout_ms() -> float:
    return _num_env("OXYLABS_RENDER_TIMEOUT_MS", 180_000)


def _force_proxy() -> bool:
    # Safety default: unless FORCE_PROXY is explicitly "false", every fetch goes through Oxylabs.
    return os.environ.get("FORCE_PROXY") != "false"


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def _now_ms() -> int:
    return int(time.time() * 1000)


def _js_err(e: BaseException) -> str:
    """String(error) as JS prints it ("Error: message")."""
    if isinstance(e, httpx.TimeoutException):
        return "AbortError: This operation was aborted"
    return f"Error: {e}"


def _dumps(v: Any) -> str:
    """JSON.stringify (compact, non-ASCII kept)."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _timeout(ms: float) -> httpx.Timeout:
    s = 60.0 if math.isnan(ms) else ms / 1000  # NaN (bad env value) -> default
    return httpx.Timeout(s)


def _first_result(body: Any) -> Any:
    if isinstance(body, dict):
        res = body.get("results")
        if isinstance(res, list) and res:
            return res[0]
    return None


def _content_str(result: dict) -> str | None:
    c = result.get("content")
    if isinstance(c, str):
        return c
    return None if c is None else _dumps(c)


def _is_num(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def validate_url(value: str) -> None:
    """Raise unless value is an absolute http(s) URL."""
    try:
        u = urlsplit(value)
    except ValueError as e:
        raise ValueError("Invalid URL") from e
    if not u.scheme or not (u.netloc or u.path):
        raise ValueError("Invalid URL")
    if u.scheme.lower() not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are supported")


# ---- block detection -------------------------------------------------------------------------
_SIGNALS = [
    "captcha", "are you a human", "access denied", "attention required", "cf-challenge",
    "/cdn-cgi/challenge-platform", "too many requests", "request blocked", "temporarily blocked",
    "verify you are human", "cloudflare ray id", "unusual traffic",
]
_TITLE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
_STRIP = [
    re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE),
    re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE),
    re.compile(r"<noscript[\s\S]*?</noscript>", re.IGNORECASE),
    re.compile(r"<svg[\s\S]*?</svg>", re.IGNORECASE),
    re.compile(r"<[^>]+>"),
]


def looks_blocked(status: int | None, content: str | None) -> bool:
    """Anti-bot / transport-failure detection only (no minimum-length business rule).

    Phrase signals are judged on the <title> plus the visible text of small pages (< 3000
    chars) — never raw HTML, where reCAPTCHA forms and Cloudflare scripts misfire.
    """
    if (status or 0) in (401, 403, 407, 429, 503):
        return True
    if content is None or not content.strip():
        return True
    m = _TITLE.search(content)
    title = (m.group(1) if m else "").lower().strip()
    visible = content
    for rx in _STRIP:
        visible = rx.sub(" ", visible)
    visible = re.sub(r"\s+", " ", visible).lower().strip()
    title_blocked = any(s in title for s in _SIGNALS)
    visible_blocked = len(visible) < 3000 and any(s in visible for s in _SIGNALS)
    return title_blocked or visible_blocked


# ---- Oxylabs ---------------------------------------------------------------------------------
def _auth() -> str:
    raw = f"{_env('OXYLABS_USERNAME')}:{_env('OXYLABS_PASSWORD')}".encode()
    return base64.b64encode(raw).decode()


def _oxylabs(url: str, render: bool, options: dict) -> dict:
    payload: dict[str, Any] = {"source": "universal", "url": url}
    if render:
        payload["render"] = "html"
    geo = options.get("geo_location")
    if geo is None:
        geo = os.environ.get("OXYLABS_GEO_LOCATION")
    if geo:
        payload["geo_location"] = geo
    uat = options.get("user_agent_type")
    if uat is None:
        uat = os.environ.get("OXYLABS_USER_AGENT_TYPE")
    if uat:
        payload["user_agent_type"] = uat
    auth = _auth()
    timeout = _render_timeout_ms() if render else _normal_timeout_ms()
    response = httpx.post(
        _endpoint(),
        headers={"Content-Type": "application/json", "Authorization": f"Basic {auth}"},
        content=_dumps(payload),
        timeout=_timeout(timeout),
    )
    text = response.text
    try:
        body = json.loads(text)
    except ValueError as e:
        raise RuntimeError(f"Oxylabs returned non-JSON HTTP {response.status_code}") from e
    if not response.is_success:
        raise RuntimeError(f"Oxylabs HTTP {response.status_code}: {_dumps(body)[:1000]}")
    result = _first_result(body)
    if not result:
        raise RuntimeError(f"Oxylabs returned no result: {_dumps(body)[:1000]}")
    job_id = None
    if isinstance(body.get("job_id"), str):
        job_id = body["job_id"]
    elif isinstance(result, dict) and isinstance(result.get("job_id"), str):
        job_id = result["job_id"]
    return {
        "status_code": result.get("status_code") if _is_num(result.get("status_code")) else None,
        "content": _content_str(result),
        "resolved_url": result.get("url") if isinstance(result.get("url"), str) else None,
        "job_id": job_id,
        "status": body.get("status"),
        "raw": body,
    }


def _direct_fetch(url: str) -> dict:
    """A genuine no-proxy fetch. Only for crawl_method 'direct' when FORCE_PROXY=false."""
    try:
        r = httpx.get(url, follow_redirects=True, timeout=_timeout(_normal_timeout_ms()))
        return {"status_code": r.status_code, "content": r.text, "resolved_url": str(r.url) or url}
    except Exception:  # noqa: BLE001
        return {"status_code": None, "content": None, "resolved_url": None}


def _ox_meta(result: dict) -> dict:
    # JSON.stringify drops undefined: job_id only when found, status only when Oxylabs sent one.
    meta: dict[str, Any] = {}
    if result.get("job_id") is not None:
        meta["job_id"] = result["job_id"]
    raw = result.get("raw")
    if isinstance(raw, dict) and "status" in raw:
        meta["status"] = raw["status"]
    meta["raw"] = raw
    return meta


def scrape_website(request: dict) -> dict:
    """Fetch one URL (ScrapeRequest keys: url, crawl_method, render?, fallback_render?,
    geo_location?, user_agent_type?) and return a ScrapeResult dict."""
    url = request["url"]
    crawl_method = request["crawl_method"]
    validate_url(url)

    if crawl_method == "direct" and not _force_proxy():
        d = _direct_fetch(url)
        if (
            d["status_code"] is not None
            and d["content"] is not None
            and d["content"].strip()
            and not looks_blocked(d["status_code"], d["content"])
        ):
            return {
                "ok": True, "url": url, "resolved_url": d["resolved_url"],
                "crawl_method": crawl_method, "rendered": False,
                "attempted_render_fallback": False, "status_code": d["status_code"],
                "content": d["content"],
            }

    initial_render = request.get("render") is True or crawl_method == "needs_js_api"
    allow_fallback = request.get("fallback_render") is not False and not initial_render

    def run(render: bool) -> dict:
        return _oxylabs(url, render, request)

    def shaped(result: dict, rendered: bool, fallback: bool, blocked: bool, msg: str) -> dict:
        out = {
            "ok": not blocked, "url": url, "resolved_url": result["resolved_url"],
            "crawl_method": crawl_method, "rendered": rendered,
            "attempted_render_fallback": fallback, "status_code": result["status_code"],
            "content": result["content"],
        }
        if blocked:
            out["error"] = msg
        out["oxylabs"] = _ox_meta(result)
        return out

    try:
        result = run(initial_render)
        blocked = looks_blocked(result["status_code"], result["content"])
        if blocked and allow_fallback:
            result = run(True)
            blocked = looks_blocked(result["status_code"], result["content"])
            return shaped(result, True, True, blocked, "Rendered response still blocked/unusable")
        return shaped(
            result, initial_render, False, blocked, "Target returned blocked/unusable content"
        )
    except Exception as error:  # noqa: BLE001
        if not allow_fallback:
            return {
                "ok": False, "url": url, "resolved_url": None, "crawl_method": crawl_method,
                "rendered": initial_render, "attempted_render_fallback": False,
                "status_code": None, "content": None, "error": _js_err(error),
            }
        try:
            result = run(True)
            blocked = looks_blocked(result["status_code"], result["content"])
            return shaped(result, True, True, blocked, "Rendered response still blocked/unusable")
        except Exception as render_error:  # noqa: BLE001
            return {
                "ok": False, "url": url, "resolved_url": None, "crawl_method": crawl_method,
                "rendered": True, "attempted_render_fallback": True, "status_code": None,
                "content": None,
                "error": f"normal={_js_err(error)}; render={_js_err(render_error)}",
            }


# ---- background calls (route-based mapper step 5) --------------------------------------------
def oxylabs_raw(payload: dict, timeout_ms: float) -> dict:
    """POST one raw payload to Oxylabs. Returns ``{"httpStatus": int, "body": Any}``."""
    auth = _auth()
    response = httpx.post(
        _endpoint(),
        headers={"Content-Type": "application/json", "Authorization": f"Basic {auth}"},
        content=_dumps(payload),
        timeout=_timeout(max(1_000, timeout_ms)),
    )
    text = response.text
    try:
        body: Any = json.loads(text)
    except ValueError:
        body = {"raw": text[:500]}
    return {"httpStatus": response.status_code, "body": body}


_LC = "translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
_LC_ARIA = "translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
_LC_CLASS = "translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
_LC_PARENT_CLASS = (
    "translate(../@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
)
MORE_XPATH = (
    "(//*[self::button or self::a][string-length(normalize-space(.)) < 40 and ("
    + " or ".join(
        f"contains({_LC},'{w}')"
        for w in ["show more", "load more", "view more", "see more", "view all", "show all"]
    )
    + ")])[1]"
)
NEXT_XPATH = (
    f"(//*[self::button or self::a][not(contains({_LC_ARIA},'slide')) and "
    f"not(contains({_LC_CLASS},'carousel')) and ("
    f"@rel='next' or {_LC}='next' or {_LC}='next page' or {_LC}='›' or {_LC}='»' or "
    f"contains({_LC_ARIA},'next page') or {_LC_ARIA}='next' or "
    f"(ancestor::*[contains({_LC_CLASS},'pagination') or contains({_LC_ARIA},'pagination')] and "
    f"(contains({_LC_ARIA},'next') or contains({_LC_CLASS},'next') or contains({_LC},'next') or "
    f"contains({_LC_PARENT_CLASS},'next')))"
    ")])[1]"
)
INSTRUCTIONS: dict[str, list[dict]] = {
    "scroll+clicks": [
        {"type": "scroll_to_bottom", "timeout_s": 10},
        {"type": "click", "selector": {"type": "xpath", "value": MORE_XPATH}, "timeout_s": 5,
         "on_error": "skip"},
        {"type": "wait", "wait_time_s": 2},
        {"type": "click", "selector": {"type": "xpath", "value": NEXT_XPATH}, "timeout_s": 5,
         "on_error": "skip"},
        {"type": "wait", "wait_time_s": 3},
    ],
    "scroll": [{"type": "scroll_to_bottom", "timeout_s": 10}, {"type": "wait", "wait_time_s": 2}],
}


def _type_instructions(t: dict) -> list[dict]:
    submit = t.get("submitXpath", t.get("submit_xpath"))
    steps: list[dict] = [
        {"type": "input", "selector": {"type": "xpath", "value": t["xpath"]},
         "value": t["value"], "timeout_s": 8},
        {"type": "wait", "wait_time_s": 2},
        {"type": "click", "selector": {"type": "xpath", "value": "(//*[@role='option'])[1]"},
         "timeout_s": 3, "on_error": "skip"},
        {"type": "wait", "wait_time_s": 1},
    ]
    if submit:
        steps.append({"type": "click", "selector": {"type": "xpath", "value": submit},
                      "timeout_s": 5, "on_error": "skip"})
    steps += [
        {"type": "wait", "wait_time_s": 4},
        {"type": "scroll_to_bottom", "timeout_s": 8},
        {"type": "wait", "wait_time_s": 2},
    ]
    return steps


def capture_network_calls(
    url: str,
    options: dict | None = None,
    *,
    timeout_ms: float | None = None,
    scroll: bool | None = None,
    geo_location: str | None = None,
    user_agent_type: str | None = None,
    type_input: dict | None = None,
) -> dict:
    """Open a page in Oxylabs' browser (render=html, xhr=true) and return its background calls.

    Options may be passed as the TS options dict (timeoutMs, scroll, geo_location,
    user_agent_type, typeInput{xpath, value, submitXpath}) or as keyword arguments.
    Returns a CapturedNetworkCallsResult dict.
    """
    o = dict(options or {})
    timeout_ms = timeout_ms if timeout_ms is not None else o.get("timeoutMs", o.get("timeout_ms"))
    scroll = scroll if scroll is not None else o.get("scroll")
    geo_location = geo_location if geo_location is not None else o.get("geo_location")
    user_agent_type = user_agent_type if user_agent_type is not None else o.get("user_agent_type")
    type_input = type_input if type_input is not None else o.get("typeInput", o.get("type_input"))
    if timeout_ms is None:
        raise ValueError("timeout_ms is required")

    validate_url(url)
    started = _now_ms()

    def left() -> float:
        return timeout_ms - (_now_ms() - started)

    base: dict[str, Any] = {"source": "universal", "url": url, "render": "html", "xhr": True}
    geo = geo_location if geo_location is not None else os.environ.get("OXYLABS_GEO_LOCATION")
    if geo:
        base["geo_location"] = geo
    uat = user_agent_type if user_agent_type is not None else os.environ.get(
        "OXYLABS_USER_AGENT_TYPE"
    )
    if uat:
        base["user_agent_type"] = uat
    if type_input:
        ladder = ["type+submit"]
    elif scroll is False:
        ladder = ["none"]
    else:
        ladder = ["scroll+clicks", "scroll", "none"]
    failed: list[dict] = []
    for actions in ladder:
        if failed and left() < 20_000:
            break
        if actions == "type+submit" and type_input:
            instructions: list[dict] | None = _type_instructions(type_input)
        elif actions in ("none", "type+submit"):
            instructions = None
        else:
            instructions = INSTRUCTIONS[actions]
        payload = {**base, "browser_instructions": instructions} if instructions else base
        try:
            res = oxylabs_raw(payload, left())
            result = _first_result(res["body"])
            status = (
                result.get("status_code")
                if isinstance(result, dict) and _is_num(result.get("status_code"))
                else None
            )
            if res["httpStatus"] >= 400 or not result or (status is not None and status >= 600):
                suffix = f" / result {status}" if status is not None else ""
                failed.append({
                    "actions": actions,
                    "error": f"Oxylabs HTTP {res['httpStatus']}{suffix}: "
                    f"{_dumps(res['body'])[:200]}",
                })
                continue
            content = result.get("content")
            return {
                "ok": True, "content": content, "scrolled": actions != "none",
                "actions": actions, "failed_attempts": failed, "status_code": status,
                "ms": _now_ms() - started,
            }
        except Exception as error:  # noqa: BLE001
            failed.append({"actions": actions, "error": _js_err(error)[:200]})
    return {
        "ok": False, "content": None, "scrolled": False, "actions": "none",
        "failed_attempts": failed, "status_code": None, "ms": _now_ms() - started,
        "error": failed[-1]["error"] if failed else "no attempt (time budget)",
    }


def fetch_api_call(request: dict | None = None, **kwargs: Any) -> dict:
    """Repeat one background call (GET/POST) through Oxylabs. Returns an ApiCallResult dict.

    Takes the TS request dict (url, method, headers?, body?, crawl_method, timeoutMs) or the
    same as keyword arguments (``timeout_ms`` is accepted for ``timeoutMs``).
    """
    r = {**(request or {}), **kwargs}
    url: str = r["url"]
    timeout_ms = r.get("timeoutMs", r.get("timeout_ms"))
    validate_url(url)
    started = _now_ms()
    method = str(r["method"]).upper()
    if method not in ("GET", "POST"):
        return {"ok": False, "status_code": None, "content": None, "ms": 0,
                "error": f"method {method} not supported"}
    headers: dict[str, str] = r.get("headers") or {}
    body = r.get("body")
    if r.get("crawl_method") == "direct" and not _force_proxy():
        try:
            resp = httpx.request(
                method, url, headers=headers,
                content=(body or "") if method == "POST" else None,
                follow_redirects=True, timeout=_timeout(max(1_000, timeout_ms)),
            )
            return {"ok": resp.is_success, "status_code": resp.status_code,
                    "content": resp.text, "ms": _now_ms() - started}
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "status_code": None, "content": None,
                    "ms": _now_ms() - started, "error": _js_err(error)[:300]}
    context: list[dict] = []
    if method == "POST":
        context.append({"key": "http_method", "value": "post"})
        context.append({
            "key": "content",
            "value": base64.b64encode((body or "").encode("utf-8")).decode(),
        })
    if headers:
        context.append({"key": "force_headers", "value": True})
        context.append({"key": "headers", "value": headers})
    payload: dict[str, Any] = {"source": "universal", "url": url}
    if context:
        payload["context"] = context
    geo = os.environ.get("OXYLABS_GEO_LOCATION")
    if geo:
        payload["geo_location"] = geo
    try:
        res = oxylabs_raw(payload, timeout_ms)
        result = _first_result(res["body"])
        if res["httpStatus"] >= 400 or not result:
            return {"ok": False, "status_code": None, "content": None,
                    "ms": _now_ms() - started,
                    "error": f"Oxylabs HTTP {res['httpStatus']}: {_dumps(res['body'])[:300]}"}
        status = result.get("status_code") if _is_num(result.get("status_code")) else None
        content = _content_str(result)
        return {"ok": status is not None and status < 400 and bool(content),
                "status_code": status, "content": content, "ms": _now_ms() - started}
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "status_code": None, "content": None, "ms": _now_ms() - started,
                "error": _js_err(error)[:300]}


# ---- HTTP handler logic (route wired by the ETL Surface) ---------------------------------------
def handle_webscraper_request(
    raw_body: bytes | str, worker_key: str | None, method: str = "POST"
) -> tuple[int, dict]:
    """The TS route handler: returns (status, json body). Raises if DISCO_WORKER_KEY is unset."""
    if method != "POST":
        return 405, {"error": "POST required"}
    if worker_key != _env("DISCO_WORKER_KEY"):
        return 401, {"error": "unauthorized"}
    try:
        body = json.loads(raw_body)
    except (ValueError, TypeError):
        return 400, {"error": "Invalid JSON body"}
    if not isinstance(body, dict) or not body.get("url") or not body.get("crawl_method"):
        return 400, {"error": "url and crawl_method are required"}
    if body["crawl_method"] not in VALID_CRAWL_METHODS:
        return 400, {"error": f"crawl_method must be one of {', '.join(VALID_CRAWL_METHODS)}"}
    try:
        result = scrape_website(body)
        return (200 if result["ok"] else 502), result
    except Exception as error:  # noqa: BLE001
        return 400, {"ok": False, "error": _js_err(error)}
