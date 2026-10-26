"""Live remote browser of site mapper version 2 (port of `-disco-agent-browser.ts`, 2026-10-09).

Drives Oxylabs Headless Browser (a real Chrome on Oxylabs IPs) over the Chrome DevTools
protocol: open a page, take a snapshot (numbered links and controls, visible text), click, type,
scroll, go back, and record the page's documents and data calls (XHR / fetch, incl. request
headers, post data and response bodies) so the AI can replay an API without the browser. Like
the original, the Runtime domain is never enabled and no script is injected.

A later worker call starts a fresh browser and reopens the last page (network records carry
over). Credentials: OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD (read lazily).

The websocket client is the `websockets` sync client (installed with uvicorn[standard]). A
reader thread resolves command replies and dispatches events; event handlers never block it
(follow-up commands are sent asynchronously with callbacks). NetRecord / BrowserState are
dicts with the TS keys (they are stored as JSON in the worker state).
"""
from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from _base.disco.agent_engine import now_ms, try_url


class BrowserError(Exception):
    """A remote-browser failure (the TS BrowserError)."""


_NOISE_URL = re.compile(
    r"google-analytics|googletagmanager|googlesyndication|googleadservices|doubleclick"
    r"|adservice\.google|google\.[a-z.]+/(?:ads|pagead|ccm|gmp)|facebook\.(?:com|net)|fbcdn"
    r"|bat\.bing|clarity\.ms|hotjar|segment\.(?:com|io)|amplitude|nr-data\.net|newrelic"
    r"|datadoghq|sentry|optimizely|mixpanel|heapanalytics|fullstory|tiktok|snapchat|pinterest"
    r"|linkedin|ads-twitter|adnxs|criteo|taboola|outbrain|quantserve|scorecardresearch|demdex"
    r"|everesttech|adobedtm|omtrdc|medallia|onetrust|cookielaw|cookiebot|recaptcha|gstatic"
    r"|youtube|ytimg|spotify|nextdoor|adsrvr|rubiconproject|pubmatic|moatads|krxd|bluekai"
    r"|rlcdn|tapad|cloudflareinsights|cdn-cgi/rum|cdn-cgi/challenge-platform|liveperson"
    r"|intercom|zendesk|hubspot|hs-analytics|marketo|pardot|braze|branch\.io|appsflyer"
    r"|glassbox|schemaapp|cls_report"
    r"|/(?:collect|beacon|pixel|telemetry|tracking|clickstream|ingestion|metrics|analytics)\b"
    r"|/tl$",
    re.IGNORECASE,
)
_RELEVANT_TYPES = {"Document", "XHR", "Fetch", "Other", "EventSource"}
_DATA_MIME = re.compile(r"json|xml|html|text|graphql|x-www-form-urlencoded|x-component",
                        re.IGNORECASE)
_TEXT_MIME = re.compile(r"json|text|javascript|xml|html|css|x-www-form-urlencoded|graphql",
                        re.IGNORECASE)
_FILE_URL = re.compile(r"\.(?:gz|zip|pdf|csv|xlsx?|docx?|tar|tgz|7z|rar|mp4|mp3)$", re.IGNORECASE)
_BOT_CHECK_TITLE = re.compile(
    r"just a moment|attention required|checking your browser|verify you are human|please wait"
    r"|security check",
    re.IGNORECASE,
)
_SKIP_HREF = re.compile(r"^(javascript:|mailto:|tel:|#)", re.IGNORECASE)
BODY_CAP = 200_000  # Fix (v2 memory, 2026-10-09): 200 KB per recorded body; at most 300 records


def _sleep(ms: float) -> None:
    time.sleep(ms / 1000)


def _b64decode(s: str) -> str:
    try:
        return base64.b64decode(s).decode("utf-8", "replace")
    except (ValueError, TypeError):
        return ""


def _js_err(e: BaseException) -> str:
    """`String(e)` of an Error: 'Name: message'."""
    return f"{type(e).__name__}: {e}"


class Cdp:
    """Minimal Chrome DevTools protocol client over a sync websocket."""

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self._id = 0
        self._lock = threading.Lock()
        self._pending: dict[int, Future] = {}
        self._handlers: dict[str, list[Callable[[dict, str | None], None]]] = {}
        self._any: list[Callable[[str, dict, str | None], None]] = []
        self.closed = False
        self._reader = threading.Thread(target=self._read, name="cdp-reader", daemon=True)
        self._reader.start()

    def _read(self) -> None:
        try:
            while True:
                raw = self.ws.recv()
                try:
                    msg = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    continue
                mid = msg.get("id")
                if isinstance(mid, int):
                    with self._lock:
                        fut = self._pending.pop(mid, None)
                    if fut is not None and not fut.done():
                        err = msg.get("error")
                        if err:
                            fut.set_exception(BrowserError(
                                f"{err.get('message') or 'CDP error'} ({err.get('code', '')})"
                            ))
                        else:
                            fut.set_result(msg.get("result") or {})
                    continue
                method = msg.get("method")
                if method:
                    for h in list(self._any):
                        try:
                            h(method, msg.get("params") or {}, msg.get("sessionId"))
                        except Exception:  # noqa: BLE001,S110 - never breaks the reader
                            pass
                    for h in list(self._handlers.get(method, [])):
                        try:
                            h(msg.get("params") or {}, msg.get("sessionId"))
                        except Exception:  # noqa: BLE001,S110 - a handler never breaks the reader
                            pass
        except Exception:  # noqa: BLE001,S110 - connection closed / broken
            pass
        self._on_close()

    def _on_close(self) -> None:
        self.closed = True
        with self._lock:
            pend = list(self._pending.values())
            self._pending.clear()
        for f in pend:
            if not f.done():
                f.set_exception(BrowserError("browser connection closed"))

    def on(self, method: str, fn: Callable[[dict, str | None], None]) -> None:
        self._handlers.setdefault(method, []).append(fn)

    def on_any(self, fn: Callable[[str, dict, str | None], None]) -> None:
        """Every event (method, params, sessionId) — used by the feasibility probe."""
        self._any.append(fn)

    def send_async(self, method: str, params: dict | None = None,
                   session_id: str | None = None, timeout_ms: float = 30_000) -> Future:
        fut: Future = Future()
        if self.closed:
            fut.set_exception(BrowserError("browser connection closed"))
            return fut
        with self._lock:
            self._id += 1
            mid = self._id
            self._pending[mid] = fut
        msg: dict[str, Any] = {"id": mid, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id

        def expire() -> None:
            with self._lock:
                self._pending.pop(mid, None)
            if not fut.done():
                try:
                    fut.set_exception(BrowserError(
                        f"{method}: timed out after {int(max(1, timeout_ms))} ms"))
                except Exception:  # noqa: BLE001,S110 - resolved concurrently
                    pass

        timer = threading.Timer(max(1, timeout_ms) / 1000, expire)
        timer.daemon = True
        timer.start()
        fut.add_done_callback(lambda _f: timer.cancel())
        try:
            self.ws.send(json.dumps(msg))
        except Exception as e:  # noqa: BLE001
            with self._lock:
                self._pending.pop(mid, None)
            if not fut.done():
                fut.set_exception(BrowserError(f"browser connection closed ({e})"))
        return fut

    def send(self, method: str, params: dict | None = None, session_id: str | None = None,
             timeout_ms: float = 30_000) -> dict:
        fut = self.send_async(method, params, session_id, timeout_ms)
        try:
            return fut.result(timeout=max(1, timeout_ms) / 1000 + 1)
        except FutureTimeout as e:
            raise BrowserError(f"{method}: timed out after {int(max(1, timeout_ms))} ms") from e

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001,S110 - already closed
            pass


def open_websocket(host: str, query: str, user: str, password: str,
                   timeout_s: float = 25) -> Any:
    """Opens the client websocket to the remote browser (Basic auth)."""
    from websockets.sync.client import connect

    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    try:
        return connect(f"wss://{host}/{query}",
                       additional_headers={"Authorization": f"Basic {token}"},
                       open_timeout=timeout_s, max_size=None, compression=None)
    except Exception as e:
        raise BrowserError(
            f"could not connect to the remote browser: connect: {str(e)[:200]}") from e


class RemoteBrowser:
    def __init__(self, session_name: str) -> None:
        self.session_name = session_name
        self.cdp: Any = None
        self.session: str | None = None
        self.target_id: str | None = None
        self.records: dict[int, dict] = {}
        self.unread: list[int] = []
        self.scripts: list[str] = []
        self.navigations: list[str] = []
        self.last_url: str | None = None
        self.restarted = False
        self.seq = 0
        self._exchanges: dict[str, dict] = {}
        self._extra_req: dict[str, dict] = {}
        self._extra_res: dict[str, dict] = {}
        self._sessions: dict[str, str] = {}
        self._elements: dict[int, int] = {}
        self._last_activity = now_ms()
        self._pending_bodies = 0
        self._lock = threading.RLock()

    @classmethod
    def connect(cls, state: dict | None, session_name: str, country: str = "US",
                ws_factory: Callable[[], Any] | None = None) -> RemoteBrowser:
        user = os.environ.get("OXYLABS_HB_USERNAME")
        password = os.environ.get("OXYLABS_HB_PASSWORD")
        if ws_factory is None and (not user or not password):
            raise BrowserError("OXYLABS_HB_USERNAME / OXYLABS_HB_PASSWORD are not configured")
        b = cls((state or {}).get("session_name") or session_name)
        if state:
            b.seq = state.get("seq") or 0
            for r in state.get("records") or []:
                b.records[r["seq"]] = r
            b.unread = list(state.get("unread") or [])
            b.scripts = list(state.get("scripts") or [])
            b.navigations = list(state.get("navigations") or [])
            b.last_url = state.get("last_url")
        # Fix (v2 browser session, 2026-10-09): no Oxylabs session_name; a later worker call
        # starts a fresh browser and reopens the last page.
        from urllib.parse import quote

        ws = (ws_factory() if ws_factory else
              open_websocket("hb.oxylabs.io", f"?p_cc={quote(country, safe='')}", user or "",
                             password or ""))
        b.cdp = Cdp(ws)
        b._wire()
        # Fix (v2 browser attach, 2026-10-09): our own tab is created unless a saved tab of this
        # session still exists. One retry on a fresh tab.
        targets = b.cdp.send("Target.getTargets").get("targetInfos") or []
        saved = None
        if state and state.get("target_id"):
            saved = next((t for t in targets if t.get("type") == "page"
                          and t.get("targetId") == state["target_id"]), None)
        if not saved and state and state.get("last_url"):
            b.restarted = True

        def attach(target_id: str) -> None:
            sid = b.cdp.send("Target.attachToTarget",
                             {"targetId": target_id, "flatten": True})["sessionId"]
            b.cdp.send("Network.enable", {"maxPostDataSize": 1_000_000}, sid)
            b.cdp.send("Page.enable", {}, sid)
            b.cdp.send("DOM.enable", {}, sid)
            b.target_id = target_id
            b.session = sid
            b._sessions[sid] = "page"

        def fresh() -> str:
            return b.cdp.send("Target.createTarget", {"url": "about:blank"})["targetId"]

        try:
            attach(saved["targetId"] if saved else fresh())
        except Exception as e:  # noqa: BLE001
            try:
                attach(fresh())
                b.restarted = bool(state and state.get("last_url"))
            except Exception as e2:
                raise BrowserError(f"could not attach to a browser tab: {_js_err(e)[:120]} / "
                                   f"{_js_err(e2)[:120]}") from e2
        try:
            b.cdp.send("Target.setAutoAttach", {"autoAttach": True,
                                                "waitForDebuggerOnStart": False,
                                                "flatten": True}, b.session)
        except Exception:  # noqa: BLE001,S110
            pass
        if b.restarted and state and state.get("last_url"):
            try:
                b.open(state["last_url"])
            except Exception:  # noqa: BLE001,S110
                pass
        return b

    def export_state(self) -> dict:
        with self._lock:
            recs = sorted(self.records.values(), key=lambda r: r["seq"])[-80:]
        out = []
        for r in recs:
            x = {k: v for k, v in r.items() if k != "_start"}
            if x.get("body"):
                x["body"] = x["body"][:15_000]
            if x.get("post_data"):
                x["post_data"] = x["post_data"][:8_000]
            out.append(x)
        return {"session_name": self.session_name, "target_id": self.target_id, "seq": self.seq,
                "records": out, "unread": self.unread[-200:], "scripts": self.scripts[:300],
                "navigations": self.navigations[-20:], "last_url": self.last_url}

    def close(self) -> None:
        if self.cdp:
            self.cdp.close()

    @property
    def closed(self) -> bool:
        return not self.cdp or bool(self.cdp.closed)

    # ---- recorder ------------------------------------------------------------------------
    @staticmethod
    def relevant(e: dict) -> bool:
        url = e.get("url") or ""
        if (e.get("type") not in _RELEVANT_TYPES or url.startswith("data:")
                or _NOISE_URL.search(url.split("?")[0])):
            return False
        mime = e.get("mime_type")
        return e.get("type") != "Other" or mime is None or bool(_DATA_MIME.search(mime))

    def _wire(self) -> None:
        c = self.cdp

        def attached(p: dict, _sid: str | None) -> None:
            sid = p.get("sessionId")
            info = p.get("targetInfo") or {}
            ttype = info.get("type")
            # Fix (v2 own tab detached, 2026-10-09): page targets are left alone.
            if ttype == "page" or info.get("targetId") == self.target_id:
                return
            if ttype not in ("iframe", "worker", "service_worker", "shared_worker"):
                c.send_async("Target.detachFromTarget", {"sessionId": sid}, None, 5_000)
                return
            self._sessions[sid] = ttype
            c.send_async("Network.enable", {"maxPostDataSize": 1_000_000}, sid, 10_000)

        def info_changed(p: dict, _sid: str | None) -> None:
            info = p.get("targetInfo") or {}
            url = info.get("url") or ""
            if (info.get("targetId") == self.target_id and re.match(r"^https?:", url)
                    and (not self.navigations or self.navigations[-1] != url)):
                self.navigations.append(url)
                self.last_url = url

        def will_send(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            prev = self._exchanges.get(k)
            req = p.get("request") or {}
            if prev is not None and p.get("redirectResponse"):
                self._apply_response(prev, p["redirectResponse"])
                self._complete(k, prev, None, req.get("url"))
            with self._lock:
                self.seq += 1
                seq = self.seq
            e: dict[str, Any] = {
                "seq": seq, "url": req.get("url") or "", "method": req.get("method") or "GET",
                "type": p.get("type") or "Other",
                "request_headers": self._extra_req.get(k, req.get("headers") or {}),
                "post_data": req.get("postData"),
            }
            self._extra_req.pop(k, None)
            e["_start"] = now_ms()
            self._exchanges[k] = e
            if self.relevant(e):
                self._last_activity = now_ms()
                if req.get("hasPostData") and e["post_data"] is None:
                    f = c.send_async("Network.getRequestPostData",
                                     {"requestId": p.get("requestId")}, sid, 10_000)

                    def got(fut: Future, e: dict = e) -> None:
                        if fut.exception() is None:
                            e["post_data"] = (fut.result() or {}).get("postData")

                    f.add_done_callback(got)

        def extra_req(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            e = self._exchanges.get(k)
            if e is not None:
                e["request_headers"] = p.get("headers") or {}
            else:
                self._extra_req[k] = p.get("headers") or {}

        def response(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            e = self._exchanges.get(k)
            if e is None:
                return
            self._apply_response(e, p.get("response") or {})
            if k in self._extra_res:
                e["response_headers"] = self._extra_res.pop(k)

        def extra_res(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            e = self._exchanges.get(k)
            if e is not None and e.get("status") is not None:
                e["response_headers"] = p.get("headers") or {}
            else:
                self._extra_res[k] = p.get("headers") or {}

        def finished(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            e = self._exchanges.pop(k, None)
            if e is None:
                return
            url = e["url"]
            if (e["type"] == "Script" and not _NOISE_URL.search(url.split("?")[0])
                    and url not in self.scripts):
                self.scripts.append(url)
            if (self.relevant(e) and not url.startswith("data:")
                    and _TEXT_MIME.search(e.get("mime_type") or "")):
                with self._lock:
                    self._pending_bodies += 1
                f = c.send_async("Network.getResponseBody", {"requestId": p.get("requestId")},
                                 sid, 15_000)

                def got(fut: Future, k: str = k, e: dict = e) -> None:
                    try:
                        if fut.exception() is None:
                            r = fut.result() or {}
                            body = (_b64decode(r.get("body") or "") if r.get("base64Encoded")
                                    else (r.get("body") or ""))
                            self._complete(k, e, body[:BODY_CAP], None)
                        else:
                            self._complete(k, e, None, None)
                    finally:
                        with self._lock:
                            self._pending_bodies -= 1

                f.add_done_callback(got)
            else:
                self._complete(k, e, None, None)

        def failed(p: dict, sid: str | None) -> None:
            k = f"{sid}:{p.get('requestId')}"
            e = self._exchanges.pop(k, None)
            if e is None:
                return
            e["error"] = " · ".join(x for x in (p.get("errorText"), p.get("blockedReason"),
                                                "canceled" if p.get("canceled") else "") if x)
            self._complete(k, e, None, None)

        c.on("Target.attachedToTarget", attached)
        c.on("Target.targetInfoChanged", info_changed)
        c.on("Network.requestWillBeSent", will_send)
        c.on("Network.requestWillBeSentExtraInfo", extra_req)
        c.on("Network.responseReceived", response)
        c.on("Network.responseReceivedExtraInfo", extra_res)
        c.on("Network.loadingFinished", finished)
        c.on("Network.loadingFailed", failed)

    @staticmethod
    def _apply_response(e: dict, r: dict) -> None:
        if r.get("status") is not None:
            e["status"] = r["status"]
        if r.get("mimeType") is not None:
            e["mime_type"] = r["mimeType"]
        if not e.get("response_headers"):
            e["response_headers"] = r.get("headers") or {}

    def _complete(self, _k: str, e: dict, body: str | None, redirect_to: str | None) -> None:
        e["body"] = body
        e["redirect_to"] = redirect_to
        start = e.pop("_start", None)
        e["duration_ms"] = int(now_ms() - (start if start is not None else now_ms()))
        if not self.relevant(e):
            return
        with self._lock:
            self._last_activity = now_ms()
            self.records[e["seq"]] = e
            self.unread.append(e["seq"])
            if len(self.records) > 300:
                for old in sorted(self.records)[: len(self.records) - 300]:
                    del self.records[old]

    def wait_idle(self, quiet_ms: float = 1_200, timeout_ms: float = 15_000) -> None:
        start = now_ms()
        while now_ms() - start < timeout_ms:
            if (now_ms() - self._last_activity >= quiet_ms and now_ms() - start >= quiet_ms
                    and self._pending_bodies == 0):
                return
            _sleep(200)

    # ---- page control ----------------------------------------------------------------------
    def info(self) -> dict[str, str]:
        t = self.cdp.send("Target.getTargetInfo", {"targetId": self.target_id}).get("targetInfo")
        t = t or {}
        return {"url": t.get("url") or "", "title": t.get("title") or ""}

    def _wait_bot_check(self, max_ms: float = 20_000) -> None:
        """A bot-check interstitial clears itself in the remote browser after a few seconds."""
        end = now_ms() + max_ms
        while now_ms() < end:
            if not _BOT_CHECK_TITLE.search(self.info()["title"]):
                return
            _sleep(1_000)

    def open(self, url: str) -> None:
        u = try_url(url)
        if not u:
            raise BrowserError(f"not a URL: {url}")
        if _FILE_URL.search(u.pathname):
            raise BrowserError("that URL is a file download, not a page; use sitemap_probe or "
                               "http_fetch for it")
        r = self.cdp.send("Page.navigate", {"url": url}, self.session, 45_000)
        if r.get("errorText"):
            raise BrowserError(f"navigation failed: {r['errorText']}")
        self.last_url = url
        _sleep(500)
        self.wait_idle(1_500, 20_000)
        self._wait_bot_check()
        self.wait_idle(1_200, 10_000)

    def snapshot(self, max_elements: int = 70, max_text: int = 1_200) -> str:
        page = self.info()
        root = self.cdp.send("DOM.getDocument", {"depth": -1, "pierce": True}, self.session,
                             30_000).get("root") or {}
        pu = try_url(page["url"])
        host = re.sub(r"^www\.", "", pu.hostname) if pu else ""
        texts: list[str] = []
        controls: list[tuple[int, str]] = []
        links: list[tuple[int, str, bool]] = []
        nodes = 0

        def walk(node: dict) -> str:
            nonlocal nodes
            nodes += 1
            if nodes > 60_000:
                return ""
            name = node.get("nodeName") or ""
            if node.get("nodeType") == 3:
                v = str(node.get("nodeValue") or "").strip()
                if v and len(texts) < 4_000:
                    texts.append(v)
                return v
            if name in ("SCRIPT", "STYLE", "NOSCRIPT", "SVG", "HEAD", "TEMPLATE", "IFRAME"):
                return ""
            own: list[str] = []
            for child in [*(node.get("children") or []), *(node.get("shadowRoots") or [])]:
                t = walk(child)
                if t:
                    own.append(t)
            if node.get("contentDocument"):
                walk(node["contentDocument"])
            raw: list[str] = node.get("attributes") or []
            a: dict[str, str] = {}
            for i in range(0, len(raw) - 1, 2):
                a[raw[i]] = raw[i + 1]
            label = (a.get("aria-label") or " ".join(own)[:70] or a.get("placeholder")
                     or a.get("title") or a.get("value") or a.get("name") or a.get("alt")
                     or "").strip()[:70]
            backend = node.get("backendNodeId")
            href = a.get("href")
            if name == "A" and href and not _SKIP_HREF.match(href):
                hu = try_url(href, page["url"])
                full = hu.href if hu else href
                fu = try_url(full)
                same = bool(fu and fu.hostname.endswith(host))
                links.append((backend, f"link {json.dumps(label, ensure_ascii=False)} -> {full}",
                              same))
            elif (name in ("BUTTON", "SELECT", "TEXTAREA")
                  or (name == "INPUT" and a.get("type", "text") != "hidden")
                  or a.get("role", "") in ("button", "link", "tab", "option", "menuitem",
                                            "combobox", "searchbox", "checkbox", "radio")):
                kind = f"input[{a.get('type', 'text')}]" if name == "INPUT" else name.lower()
                nm = f" name={a['name']}" if a.get("name") else ""
                controls.append((backend, f"{kind} {json.dumps(label, ensure_ascii=False)}{nm}"))
            return " ".join(own)[:80]

        walk(root)
        seen: set[str] = set()
        ordered: list[tuple[int, str]] = []
        for backend, desc, _same in sorted(links, key=lambda x: -int(x[2])):
            if desc not in seen:
                seen.add(desc)
                ordered.append((backend, desc))
        chosen = [*controls[:40],
                  *ordered[: max(0, max_elements - min(len(controls), 40))]]
        self._elements = {i + 1: backend for i, (backend, _d) in enumerate(chosen)}
        body = " | ".join(texts)
        return "\n".join([
            f"URL: {page['url']}", f"TITLE: {page['title']}",
            f"ELEMENTS ({len(controls)} controls, {len(links)} links; showing {len(chosen)}):",
            *[f"[{i + 1}] {desc}" for i, (_b, desc) in enumerate(chosen)],
            f"TEXT: {body[:max_text]}{'…' if len(body) > max_text else ''}",
        ])

    def _center(self, element: int) -> tuple[float, float]:
        backend = self._elements.get(element)
        if backend is None:
            raise BrowserError(f"element [{element}] is not in the last snapshot; take a new "
                               "snapshot")
        try:
            self.cdp.send("DOM.scrollIntoViewIfNeeded", {"backendNodeId": backend}, self.session)
            quad = self.cdp.send("DOM.getBoxModel", {"backendNodeId": backend},
                                 self.session)["model"]["content"]
            return ((quad[0] + quad[2] + quad[4] + quad[6]) / 4,
                    (quad[1] + quad[3] + quad[5] + quad[7]) / 4)
        except Exception as e:
            raise BrowserError(f"element [{element}] is not visible or clickable "
                               f"({_js_err(e)[:80]}); open its URL instead") from e

    def _target_ids(self) -> list[dict]:
        return self.cdp.send("Target.getTargets").get("targetInfos") or []

    def click(self, element: int) -> None:
        before = {t.get("targetId") for t in self._target_ids()}
        x, y = self._center(element)
        self.cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y},
                      self.session)
        for typ in ("mousePressed", "mouseReleased"):
            self.cdp.send("Input.dispatchMouseEvent", {"type": typ, "x": x, "y": y,
                                                       "button": "left", "clickCount": 1},
                          self.session)
        _sleep(800)
        popups = [t for t in self._target_ids() if t.get("type") == "page"
                  and t.get("targetId") not in before and re.match(r"^http", t.get("url") or "")]
        if popups:
            try:
                self.cdp.send("Target.closeTarget", {"targetId": popups[0]["targetId"]})
            except Exception:  # noqa: BLE001,S110
                pass
            self.open(popups[0]["url"])
        else:
            self.wait_idle()
            self._wait_bot_check(10_000)

    def type(self, element: int, text: str, submit: bool = False) -> None:
        x, y = self._center(element)
        for typ in ("mousePressed", "mouseReleased"):
            self.cdp.send("Input.dispatchMouseEvent", {"type": typ, "x": x, "y": y,
                                                       "button": "left", "clickCount": 1},
                          self.session)
        self.cdp.send("Input.insertText", {"text": text}, self.session)
        _sleep(600)
        if submit:
            key = {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13,
                   "nativeVirtualKeyCode": 13}
            self.cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", **key, "text": "\r"},
                          self.session)
            self.cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", **key}, self.session)
        self.wait_idle()

    def scroll(self, direction: str = "down") -> None:
        self.cdp.send("Input.dispatchMouseEvent", {
            "type": "mouseWheel", "x": 400, "y": 400, "deltaX": 0,
            "deltaY": 1800 if direction == "down" else -1800}, self.session)
        self.wait_idle(1_000)

    def back(self) -> None:
        h = self.cdp.send("Page.getNavigationHistory", {}, self.session)
        if not h.get("currentIndex"):
            raise BrowserError("no previous page")
        self.cdp.send("Page.navigateToHistoryEntry",
                      {"entryId": h["entries"][h["currentIndex"] - 1]["id"]}, self.session)
        self.wait_idle()
