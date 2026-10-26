"""Tests for surfaces.etl.disco.agent_browser (fake CDP; no network)."""
from __future__ import annotations

from concurrent.futures import Future

import pytest

from surfaces.etl.disco import agent_browser as ab


class FakeCdp:
    def __init__(self, replies=None):
        self.replies = replies or {}
        self.sent: list[tuple[str, dict, str | None]] = []
        self.handlers: dict = {}
        self.closed = False

    def on(self, method, fn):
        self.handlers.setdefault(method, []).append(fn)

    def emit(self, method, params, sid="S1"):
        for h in self.handlers.get(method, []):
            h(params, sid)

    def send(self, method, params=None, session_id=None, timeout_ms=30_000):
        self.sent.append((method, params or {}, session_id))
        r = self.replies.get(method, {})
        return r(params or {}) if callable(r) else r

    def send_async(self, method, params=None, session_id=None, timeout_ms=30_000):
        f: Future = Future()
        try:
            f.set_result(self.send(method, params, session_id, timeout_ms))
        except Exception as e:  # noqa: BLE001
            f.set_exception(e)
        return f

    def close(self):
        self.closed = True


def el(name, attrs=(), children=(), backend=0):
    return {"nodeName": name, "nodeType": 1, "attributes": list(attrs), "children": list(children),
            "backendNodeId": backend}


def txt(v):
    return {"nodeName": "#text", "nodeType": 3, "nodeValue": v}


def test_snapshot_walk_and_numbering():
    dom = el("#document", children=[el("HTML", children=[
        el("HEAD", children=[el("TITLE", children=[txt("hidden")])]),
        el("BODY", children=[
            el("A", ["href", "https://other.com/x"], [txt("Elsewhere")], 1),
            el("A", ["href", "/agents/jane"], [txt("Jane Doe")], 2),
            el("A", ["href", "mailto:x@y.z"], [txt("Mail")], 3),
            el("INPUT", ["type", "text", "name", "q", "placeholder", "Search"], [], 4),
            el("INPUT", ["type", "hidden", "name", "t"], [], 5),
            el("BUTTON", [], [txt("Go")], 6),
            el("SCRIPT", [], [txt("var x")], 7),
        ]),
    ])])
    cdp = FakeCdp({
        "Target.getTargetInfo": {"targetInfo": {"url": "https://www.ex.com/agents",
                                                "title": "Agents"}},
        "DOM.getDocument": {"root": dom},
    })
    b = ab.RemoteBrowser("s")
    b.cdp = cdp
    snap = b.snapshot()
    lines = snap.split("\n")
    assert lines[0] == "URL: https://www.ex.com/agents"
    assert lines[1] == "TITLE: Agents"
    assert lines[2] == "ELEMENTS (2 controls, 2 links; showing 4):"
    assert lines[3] == '[1] input[text] "Search" name=q'
    assert lines[4] == '[2] button "Go"'
    # same-site link first
    assert lines[5] == '[3] link "Jane Doe" -> https://www.ex.com/agents/jane'
    assert lines[6] == '[4] link "Elsewhere" -> https://other.com/x'
    assert lines[7] == "TEXT: Elsewhere | Jane Doe | Mail | Go"
    assert b._elements == {1: 4, 2: 6, 3: 2, 4: 1}


def test_recorder_keeps_relevant_calls_with_bodies():
    cdp = FakeCdp({"Network.getResponseBody": {"body": "eyJhIjoxfQ==", "base64Encoded": True}})
    b = ab.RemoteBrowser("s")
    b.cdp = cdp
    b.target_id = "T1"
    b._wire()
    cdp.emit("Network.requestWillBeSent", {"requestId": "1", "type": "XHR", "request": {
        "url": "https://api.ex.com/agents?page=2", "method": "POST", "headers": {"a": "b"},
        "postData": '{"page":2}'}})
    cdp.emit("Network.responseReceived", {"requestId": "1", "response": {
        "status": 200, "mimeType": "application/json", "headers": {"x": "y"}}})
    cdp.emit("Network.loadingFinished", {"requestId": "1"})
    # tracker: dropped
    cdp.emit("Network.requestWillBeSent", {"requestId": "2", "type": "XHR", "request": {
        "url": "https://www.google-analytics.com/collect?v=1", "method": "GET"}})
    cdp.emit("Network.loadingFinished", {"requestId": "2"})
    # script: remembered for search_scripts
    cdp.emit("Network.requestWillBeSent", {"requestId": "3", "type": "Script", "request": {
        "url": "https://www.ex.com/app.js", "method": "GET"}})
    cdp.emit("Network.loadingFinished", {"requestId": "3"})
    # failed call
    cdp.emit("Network.requestWillBeSent", {"requestId": "4", "type": "Fetch", "request": {
        "url": "https://www.ex.com/api/x", "method": "GET"}})
    cdp.emit("Network.loadingFailed", {"requestId": "4", "errorText": "net::ERR", "canceled": True})
    assert sorted(b.records) == [1, 4]
    r = b.records[1]
    assert r["body"] == '{"a":1}' and r["status"] == 200 and r["post_data"] == '{"page":2}'
    assert r["response_headers"] == {"x": "y"} and "_start" not in r
    assert b.records[4]["error"] == "net::ERR · canceled"
    assert b.unread == [1, 4] and b.scripts == ["https://www.ex.com/app.js"]
    st = b.export_state()
    assert st["seq"] == 4 and [x["seq"] for x in st["records"]] == [1, 4]
    assert b._pending_bodies == 0


def test_relevance_rules():
    rel = ab.RemoteBrowser.relevant
    assert rel({"url": "https://x.com/a", "type": "Document"})
    assert not rel({"url": "https://x.com/a.png", "type": "Image"})
    assert not rel({"url": "data:text/plain,1", "type": "XHR"})
    assert rel({"url": "https://x.com/a", "type": "Other", "mime_type": "application/json"})
    assert not rel({"url": "https://x.com/a", "type": "Other", "mime_type": "image/png"})
    assert not rel({"url": "https://x.com/beacon", "type": "XHR"})


def test_open_refuses_files_and_click_needs_snapshot():
    b = ab.RemoteBrowser("s")
    b.cdp = FakeCdp()
    with pytest.raises(ab.BrowserError, match="file download"):
        b.open("https://x.com/sitemap.xml.gz")
    with pytest.raises(ab.BrowserError, match="not in the last snapshot"):
        b.click(3)


def test_connect_requires_credentials(monkeypatch):
    monkeypatch.delenv("OXYLABS_HB_USERNAME", raising=False)
    with pytest.raises(ab.BrowserError, match="not configured"):
        ab.RemoteBrowser.connect(None, "s")


def test_connect_attaches_fresh_tab_and_restores_state(monkeypatch):
    replies = {
        "Target.getTargets": {"targetInfos": []},
        "Target.createTarget": {"targetId": "T9"},
        "Target.attachToTarget": {"sessionId": "S9"},
    }
    fake = FakeCdp(replies)
    monkeypatch.setattr(ab, "Cdp", lambda ws: fake)
    monkeypatch.setattr(ab.RemoteBrowser, "open", lambda self, url: setattr(self, "opened", url))
    state = {"session_name": "old", "target_id": "T1", "seq": 7, "records": [
        {"seq": 7, "url": "https://x.com/a", "method": "GET", "type": "XHR"}], "unread": [7],
        "scripts": [], "navigations": [], "last_url": "https://x.com/p"}
    b = ab.RemoteBrowser.connect(state, "new", ws_factory=lambda: object())
    assert b.session_name == "old" and b.target_id == "T9" and b.session == "S9"
    assert b.restarted and b.opened == "https://x.com/p"
    assert b.records[7]["url"] == "https://x.com/a"
    assert [m for m, _p, _s in fake.sent][:6] == [
        "Target.getTargets", "Target.createTarget", "Target.attachToTarget", "Network.enable",
        "Page.enable", "DOM.enable"]
