"""POST /public/disco-agent-probe — site mapper version 2 feasibility check (2026-10-09).

Port of `routes/api/public/disco-agent-probe.ts`. Read-only checks; nothing is written, no
database access:
- model:  one tiny Anthropic call with the requested model (default claude-sonnet-5-5);
- hb:     Oxylabs Headless Browser over the Chrome DevTools protocol: connect, open a page, read
          title / links / background calls, scroll once, and time each step;
- render: the same page through the Oxylabs render + background-call capture.

Header x-disco-worker-key. Body: { checks?: ('model'|'hb'|'render')[], url?, model?, country? }.
Credentials: OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD when set, else OXYLABS_USERNAME /
OXYLABS_PASSWORD.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from starlette.concurrency import run_in_threadpool

from _base.disco import webscraper
from _base.disco.agent_engine import now_ms
from surfaces.etl.disco import agent_browser
from surfaces.etl.disco.agent_mapper import ANTHROPIC_URL, _parallel

router = APIRouter(tags=["etl:disco"])

_BOT_TITLE = re.compile(
    r"just a moment|attention required|checking your browser|verify you are human|access denied",
    re.IGNORECASE,
)
_READ_EXPR = (
    "JSON.stringify({ url: location.href, title: document.title, links: "
    "document.querySelectorAll('a[href]').length, text: (document.body?.innerText || '').length, "
    "inputs: document.querySelectorAll('input').length })"
)


def _ms(start: float) -> int:
    return int(now_ms() - start)


def _err(e: BaseException) -> str:
    """`String(e)` of an Error."""
    return f"Error: {e}"


# ---- model check ------------------------------------------------------------------------
def check_model(model: str) -> dict[str, Any]:
    started = now_ms()
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"ok": False, "error": "ANTHROPIC_API_KEY not configured"}
    try:
        res = httpx.post(ANTHROPIC_URL, timeout=120.0, headers={
            "x-api-key": api_key, "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }, content=json.dumps({"model": model, "max_tokens": 16, "messages": [
            {"role": "user", "content": "Reply with the word OK."}]}))
        text = res.text
        try:
            body = json.loads(text)
        except ValueError:
            body = None
        b = body if isinstance(body, dict) else {}
        content = b.get("content")
        out: dict[str, Any] = {
            "ok": res.is_success, "status": res.status_code, "model_requested": model,
            "model_answered": b.get("model"),
            "reply": ("".join((x or {}).get("text") or "" for x in content)[:40]
                      if isinstance(content, list) else None),
            "usage": b.get("usage"),
        }
        if not res.is_success:
            out["error"] = text[:400]
        out["ms"] = _ms(started)
        return out
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": _err(e)[:300], "ms": _ms(started)}


# ---- headless browser check ---------------------------------------------------------------
def _connect_ws(user: str, password: str, country: str) -> Any:
    return agent_browser.open_websocket("hb.oxylabs.io", f"?p_cc={quote(country, safe='')}",
                                        user, password, timeout_s=20)


def check_headless_browser(url: str, country: str) -> dict[str, Any]:
    steps: list[dict] = []
    started = now_ms()
    hb_user = os.environ.get("OXYLABS_HB_USERNAME")
    user = hb_user if hb_user is not None else os.environ.get("OXYLABS_USERNAME", "")
    pw = os.environ.get("OXYLABS_HB_PASSWORD")
    password = pw if pw is not None else os.environ.get("OXYLABS_PASSWORD", "")
    credentials = "OXYLABS_HB_*" if hb_user is not None else "OXYLABS_* (scraper account)"
    if not user or not password:
        return {"ok": False, "credentials": credentials,
                "error": "no Oxylabs credentials configured"}

    def step(name: str, fn: Callable[[], Any], detail: Callable[[Any], Any] | None = None) -> Any:
        t = now_ms()
        try:
            v = fn()
            s: dict[str, Any] = {"step": name, "ms": _ms(t), "ok": True}
            if detail:
                s["detail"] = detail(v)
            steps.append(s)
            return v
        except Exception as e:
            steps.append({"step": name, "ms": _ms(t), "ok": False, "detail": _err(e)[:300]})
            raise

    cdp: agent_browser.Cdp | None = None
    try:
        ws = step("connect", lambda: _connect_ws(user, password, country), lambda _v: "websocket")
        cdp = agent_browser.Cdp(ws)
        events: list[dict] = []
        cdp.on_any(lambda m, p, sid: events.append({"method": m, "params": p, "sessionId": sid})
                   if len(events) < 5000 else None)
        step("Browser.getVersion", lambda: cdp.send("Browser.getVersion"),
             lambda v: (v or {}).get("product"))
        target_id = step("Target.createTarget", lambda: cdp.send(
            "Target.createTarget", {"url": "about:blank"}))["targetId"]
        session_id = step("Target.attachToTarget", lambda: cdp.send(
            "Target.attachToTarget", {"targetId": target_id, "flatten": True}))["sessionId"]

        def enable() -> None:
            cdp.send("Page.enable", {}, session_id)
            cdp.send("Network.enable", {}, session_id)
            cdp.send("Runtime.enable", {}, session_id)

        step("enable", enable)
        mark = len(events)
        step("Page.navigate", lambda: cdp.send("Page.navigate", {"url": url}, session_id, 60_000))

        def load_event() -> None:
            end = now_ms() + 60_000
            while now_ms() < end:
                if any(e["method"] == "Page.loadEventFired" and e["sessionId"] == session_id
                       for e in events[mark:]):
                    return
                time.sleep(0.2)
            raise RuntimeError("no load event in 60 s")

        step("load event", load_event)

        def read() -> Any:
            r = cdp.send("Runtime.evaluate", {"expression": _READ_EXPR, "returnByValue": True},
                         session_id)
            return (r.get("result") or {}).get("value")

        # A bot-check interstitial clears itself in the remote browser after a few seconds.
        def bot_check() -> str:
            end = now_ms() + 25_000
            while True:
                v = read()
                title = str(json.loads(v).get("title") or "") if v else ""
                if not _BOT_TITLE.search(title):
                    return title
                if now_ms() > end:
                    raise RuntimeError(f'still on "{title}" after 25 s')
                time.sleep(1)

        try:
            step("bot check cleared", bot_check, lambda t: t)
        except Exception:  # noqa: BLE001,S110
            pass
        page1 = step("read page", read, lambda v: json.loads(v) if v else None)

        def data_calls() -> list[str]:
            return [f"{(e['params'].get('response') or {}).get('status')} "
                    f"{str((e['params'].get('response') or {}).get('url') or '')[:140]}"
                    for e in list(events) if e["method"] == "Network.responseReceived"
                    and e["sessionId"] == session_id
                    and e["params"].get("type") in ("XHR", "Fetch")]

        calls_after_load = len(data_calls())
        scroll_mark = len(events)

        def scroll() -> None:
            cdp.send("Runtime.evaluate",
                     {"expression": "window.scrollTo(0, document.body.scrollHeight)"}, session_id)
            time.sleep(2)

        step("scroll to bottom", scroll)
        page2 = step("read page after scroll", read, lambda v: json.loads(v) if v else None)
        calls_after_scroll = len([e for e in list(events)[scroll_mark:]
                                  if e["method"] == "Network.responseReceived"
                                  and e["params"].get("type") in ("XHR", "Fetch")])
        try:
            cdp.send("Target.closeTarget", {"targetId": target_id})
        except Exception:  # noqa: BLE001,S110
            pass
        return {
            "ok": True, "credentials": credentials, "via": "websocket",
            "page": json.loads(page1) if page1 else None,
            "page_after_scroll": json.loads(page2) if page2 else None,
            "data_calls_after_load": calls_after_load,
            "data_calls_after_scroll": calls_after_scroll,
            "data_call_sample": data_calls()[:12], "steps": steps, "ms": _ms(started),
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "credentials": credentials, "error": _err(e)[:400], "steps": steps,
                "ms": _ms(started)}
    finally:
        if cdp is not None:
            cdp.close()


# ---- render check -------------------------------------------------------------------------
def check_render(url: str) -> dict[str, Any]:
    started = now_ms()
    try:
        r = webscraper.capture_network_calls(url, timeout_ms=120_000, scroll=True)
        content = r.get("content")
        return {"ok": r.get("ok"), "status_code": r.get("status_code"),
                "scrolled": r.get("scrolled"), "error": r.get("error"),
                "calls": len(content) if isinstance(content, list) else None, "ms": _ms(started)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": _err(e)[:300], "ms": _ms(started)}


def handle_probe(raw: bytes, worker_key: str | None) -> tuple[int, Any]:
    key = os.environ.get("DISCO_WORKER_KEY")
    if not key or worker_key != key:
        return 401, "Unauthorized"
    try:
        body = json.loads(raw)
    except (ValueError, TypeError):
        body = {}
    if not isinstance(body, dict):
        body = {}
    checks = body["checks"] if isinstance(body.get("checks"), list) and body["checks"] else [
        "model", "hb", "render"]
    url = (body["url"] if isinstance(body.get("url"), str) and re.match(r"^https?://", body["url"])
           else "https://kw.com/agents")
    model = body["model"] if isinstance(body.get("model"), str) and body["model"] else (
        "claude-sonnet-5-5")
    country = body["country"] if isinstance(body.get("country"), str) and body["country"] else "US"
    started = now_ms()
    m, hb, render = _parallel([
        lambda: check_model(model) if "model" in checks else None,
        lambda: check_headless_browser(url, country) if "hb" in checks else None,
        lambda: check_render(url) if "render" in checks else None,
    ])
    # Which credential names this build can see (names only, never values).
    env_seen = {k: bool(os.environ.get(k)) for k in (
        "OXYLABS_HB_USERNAME", "OXYLABS_HB_PASSWORD", "OXYLABS_USERNAME", "OXYLABS_PASSWORD",
        "ANTHROPIC_API_KEY")}
    return 200, {"probe": "disco-agent", "url": url, "ms": _ms(started), "env_seen": env_seen,
                 "model": m, "headless_browser": hb, "render": render}


@router.post("/public/disco-agent-probe")
async def disco_agent_probe(request: Request) -> Response:
    raw = await request.body()
    status, body = await run_in_threadpool(handle_probe, raw,
                                           request.headers.get("x-disco-worker-key"))
    if isinstance(body, str):
        return PlainTextResponse(body, status_code=status)
    return JSONResponse(body, status_code=status)
