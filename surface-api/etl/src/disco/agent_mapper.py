"""Site mapper version 2 (AI agent) — library parts of `disco-agent-mapper.ts` (2026-10-09).

Claude researches one site with tools — a live remote browser (Oxylabs Headless Browser) whose
page traffic it can read and replay, fetches through the Oxylabs Web Scraper API, sitemap reads —
and must prove a crawl method on samples (test_source), measure coverage from an independent path
(coverage_check, 90% or a written reason) and pass a final validation before its config is
accepted (submit_config).

Dry runs only: nothing is written to any table. A worker call stops about 4 minutes in and
returns {status: 'continue', state}; the next call sends that state back and the research
continues. The state is a JSON dict with the TS keys. The route lives in
`surfaces.etl.routers.disco_agent_mapper`; `handle_request` here holds its logic.

Used by the disco-ai-worker port (`run_v2_research`, `run_v2_step`, `spread_profile_urls`,
`V2_STEP_MS`) and the list worker (`oxy_fetch`).
"""
from __future__ import annotations

import contextvars
import json
import math
import os
import re
import threading
import time
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from surfaces.etl.disco.agent_browser import BrowserError, RemoteBrowser
from surfaces.etl.disco.agent_prompt import HEAVY_TOOLS, PARALLEL_TOOLS, SYSTEM_PROMPT, TOOLS

from _base.disco import agent_engine as E
from _base.disco.ai_cost import PRICES, note_ai_usage

DEFAULT_MODEL = "claude-sonnet-5-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
CALL_BUDGET_MS = 240_000         # one worker call; the platform stops a request at ~300 s
MAX_MINUTES = 10                 # research ceiling across calls (active time)
SUBMIT_RESERVE_MS = 75_000
MAX_RESULT_CHARS = 8_000
SITEMAP_SAMPLE_BYTES = 400_000
TOOL_CAPS: dict[str, int] = {"test_source": 60_000, "coverage_check": 90_000,
                             "submit_config": 75_000, "search_scripts": 45_000}
TEST_LIMITS: dict[str, dict[str, int]] = {
    "listing": {"maxSeeds": 2, "maxPages": 2}, "sitemap": {"maxRequests": 3},
    "autocomplete": {"maxRequests": 6}, "link_crawl": {"maxRequests": 6},
}
CLIENT_MANAGED_HEADERS = {
    "host", "connection", "content-length", "accept-encoding", "user-agent", "cookie", "sec-ch-ua",
    "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-ch-ua-full-version-list", "sec-ch-ua-arch",
    "sec-ch-ua-bitness", "sec-ch-ua-model", "sec-ch-ua-platform-version", "sec-ch-ua-wow64",
    "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user",
    "upgrade-insecure-requests", "priority", "te", "accept-language",
}
_BLOCK_MARKERS = re.compile(
    r"KPSDK|Access Denied|captcha|cf-chl|challenge-platform|px-captcha|_pxCaptcha|datadome"
    r"|Request unsuccessful\. Incapsula",
    re.IGNORECASE,
)


class LimitReached(Exception):
    """A research limit (time / fetch allowance) was reached."""


# ---- helpers ----------------------------------------------------------------------------
def _now() -> float:
    return E.now_ms()


def _run_with_timeout(fn: Callable[[], Any], ms: float, fallback: Any) -> Any:
    """withTimeout: the result of fn, or `fallback` when it fails or takes longer than ms."""
    box: dict[str, Any] = {}
    done = threading.Event()
    ctx = contextvars.copy_context()

    def run() -> None:
        try:
            box["v"] = ctx.run(fn)
        except Exception:  # noqa: BLE001
            box["v"] = fallback
        done.set()

    threading.Thread(target=run, daemon=True).start()
    if not done.wait(max(1, ms) / 1000):
        return fallback
    return box.get("v", fallback)


def stable(v: Any) -> str:
    """JSON with sorted object keys."""
    if isinstance(v, list):
        return f"[{','.join(stable(x) for x in v)}]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{stable(v[k])}"
                              for k in sorted(v)) + "}"
    return E.json_stringify(v)


def category_label(c: str) -> str:
    return re.sub(r"[_-]+", " ", re.sub(r"^gcid:", "", c)).strip()


def looks_blocked(status: int, text: str | None) -> bool:
    t = text or ""
    return status in (401, 403, 407, 429, 503) or (
        len(t) < 20_000 and bool(_BLOCK_MARKERS.search(t)))


def clean_headers(h: dict[str, str] | None) -> dict[str, str]:
    return {k: v for k, v in (h or {}).items()
            if k.lower() not in CLIENT_MANAGED_HEADERS and not k.startswith(":")}


def _err_text(e: BaseException) -> str:
    """`${e.name}: ${e.message}` with JS error names."""
    if isinstance(e, re.error):
        name = "SyntaxError"
    elif isinstance(e, (TypeError, AttributeError, KeyError, IndexError)):
        name = "TypeError"
    else:
        name = "Error"
    return f"{name}: {E.error_message(e)[:300]}"


def oxy_fetch(r: dict) -> dict:
    """The one network path of version 2 (besides the browser): Oxylabs Web Scraper API."""
    from _base.disco import webscraper

    started = _now()
    headers = clean_headers(r.get("headers"))
    url = r.get("url")
    timeout_ms = r.get("timeoutMs") or 45_000

    def miss(error: str) -> dict:
        return {"url": url, "status": 0, "text": "", "blocked": False, "truncated": False,
                "error": error, "ms": _now() - started}

    try:
        final_url = url
        if r.get("render"):
            if r.get("method") != "GET" or headers:
                return miss("render works for GET requests without custom headers only")
            res = _run_with_timeout(
                lambda: webscraper.scrape_website({"url": url, "crawl_method": "needs_js_api",
                                                   "render": True, "fallback_render": False}),
                timeout_ms, None)
            if not res:
                return miss(f"timed out after {math.floor(timeout_ms / 1000 + 0.5)} s")
            if res.get("status_code") is None and not res.get("content"):
                return miss(res.get("error") or "no response")
            status = res.get("status_code") or 0
            text = res.get("content") or ""
            final_url = res.get("resolved_url") or url
        else:
            res = webscraper.fetch_api_call({
                "url": url, "method": r.get("method"), "headers": headers,
                "body": r.get("body"), "crawl_method": "server_crawl", "timeoutMs": timeout_ms,
            })
            if res.get("status_code") is None and not res.get("content"):
                return miss(res.get("error") or "no response")
            status = res.get("status_code") or 0
            text = res.get("content") or ""
        max_bytes = r.get("maxBytes")
        truncated = bool(max_bytes and len(text) > max_bytes)
        if truncated:
            text = text[:max_bytes]
        return {"url": final_url, "status": status, "text": text,
                "blocked": looks_blocked(status, text), "truncated": truncated,
                "ms": _now() - started}
    except Exception as e:  # noqa: BLE001
        return miss(E.error_message(e)[:300])


def _fetch(r: dict) -> dict:
    """oxy_fetch resolved at call time (tests monkeypatch the module attribute)."""
    return globals()["oxy_fetch"](r)


_OTHER_NOISE = re.compile(
    r"prebid|openrtb|auction|bid(?:request)?\b|hbid|/hb[-/]|adsystem|adserver|adnxs|doubleclick"
    r"|gumgum|casalemedia|3lift|media\.net|pubmatic|rubicon|criteo|id5-sync|onetag|yellowblue"
    r"|ingage\.tech|fsrv\.io|t13\.io|ccgateway|flashtalking|ftstatic|adobedc|omtrdc|demdex"
    r"|qualtrics|launchdarkly|go-mpulse|akstat|contentsquare|niceincontact|awswaf"
    r"|maps\.googleapis|places\.googleapis|gen_204|optimizely|segment\.(?:io|com)|newrelic"
    r"|nr-data|sentry|datadog|hotjar|clarity\.ms|onetrust|cookielaw|googletagmanager"
    r"|google-analytics|facebook|tiktok|linkedin|bing\.com|yahoo\.com|amazon-adsystem|criteo"
    r"|taboola|outbrain|on\.aws/events|/events?(?:/|\?|$)|/collect\b|/beacon|/pixel|/track",
    re.IGNORECASE,
)
_PERSON_NOT = re.compile(
    r"office|branch|location|store|restaurant|clinic|hospital|dealer|bank|hotel|school|shop"
    r"|salon|gym|pharmacy|cent(?:er|re)|compan|firm|agenc|brokerage",
    re.IGNORECASE,
)
_KEY_PATTERN = (r"[\"']x-[a-z0-9-]*(?:key|token|auth)[a-z0-9-]*[\"']\s*:\s*[\"'][^\"']{8,}"
                r"|api[-_]?key[\"']?\s*[:=]\s*[\"'][^\"']{8,}")


def _clamp(v: Any, default: float, lo: float, hi: float) -> float:
    """Math.max(lo, Math.min(Number(v ?? d) || d, hi))."""
    n = E.num_or(v, default)
    if not n or math.isnan(n):
        n = default
    return max(lo, min(n, hi))


# ---- the explorer -----------------------------------------------------------------------------
class Explorer:
    def __init__(self, st: dict, call_ms: float = CALL_BUDGET_MS) -> None:
        self.st = st
        self.browser: RemoteBrowser | None = None
        self.call_start = _now()
        self.call_deadline = self.call_start + call_ms
        self.reconnects = 0
        self.api_key = ""
        self._lock = threading.RLock()

    # Fix (site only, 2026-10-09): every request stays on the site's own domain and subdomains.
    def site(self) -> str:
        return E.site_domain(self.st["domain"])

    def on_site(self, url: str) -> bool:
        h = E.host_of(url)
        s = self.site()
        return bool(h) and (h == s or h.endswith(f".{s}"))

    def offsite(self, url: str) -> str:
        self.note_other(url, "request refused by the site-only rule")
        s = self.site()
        return (f"{url} is outside {s}: only {s} and its subdomains may be used (third-party "
                "services are not allowed). If profiles or their data live there, call "
                "note_other_domain with the evidence - it is flagged for a person to approve; "
                "it is not used now.")

    # Fix (other-domain observations, 2026-10-09): recorded with evidence and returned as flags.
    def note_other(self, url_or_host: str, why: str, samples: list[str] | None = None) -> None:
        samples = samples or []
        is_url = bool(re.match(r"^https?://", url_or_host, re.IGNORECASE))
        host = E.host_of(url_or_host) if is_url else re.sub(r"/.*$", "", str(url_or_host).lower())
        host = re.sub(r"^www\.", "", host)
        if not host or self.on_site(f"https://{host}/"):
            return
        reg = E.site_domain(host)
        with self._lock:
            m = self.st.setdefault("other_domains", {})
            if m is None:
                m = self.st["other_domains"] = {}
            brand = self.site().split(".")[0]
            other = reg.split(".")[0]
            common = 0
            for i in range(len(brand)):
                j = i + common + 1
                while j <= len(brand):
                    if brand[i:j] in other:
                        common = j - i
                    else:
                        break
                    j += 1
            entry = m.get(reg) or {"host": reg,
                                   "kind": "sister_domain" if common >= 5 else "third_party",
                                   "why": [], "samples": [], "count": 0}
            entry["count"] += 1
            if why not in entry["why"] and len(entry["why"]) < 6:
                entry["why"].append(why)
            first = url_or_host if re.match(r"^https?:", url_or_host, re.IGNORECASE) else None
            for u in [x for x in [first, *samples] if x]:
                if u not in entry["samples"] and len(entry["samples"]) < 5:
                    entry["samples"].append(str(u)[:300])
            m[reg] = entry

    # Fix (flag noise, 2026-10-09): a third-party data call is flagged only when it is not an
    # ad / analytics service and its JSON response holds a list of records.
    def collect_browser_other_domains(self) -> None:
        if not self.browser:
            return
        for r in list(self.browser.records.values()):
            if (r.get("type") in ("XHR", "Fetch") and not self.on_site(r["url"])
                    and re.search(r"json|graphql", r.get("mime_type") or "", re.IGNORECASE)
                    and not _OTHER_NOISE.search(r["url"])
                    and E.find_lists(E.parse_json(r.get("body") or ""), 3, 1)):
                st = r.get("status")
                why = (f"data call made by the site's pages ({r.get('method')} "
                       f"{'' if st is None else st} {r.get('mime_type') or ''})").strip()
                self.note_other(r["url"], why)

    def other_domain_flags(self) -> dict | None:
        self.collect_browser_other_domains()
        lst = sorted((self.st.get("other_domains") or {}).values(),
                     key=lambda d: (d["kind"] != "sister_domain", -d["count"]))
        if not lst:
            return None
        return {"other_domains": lst[:15], "note": "Not used for mapping. A person can approve "
                "one of these domains on a remap after checking it manually."}

    def t_note_other_domain(self, a: dict) -> dict:
        target = E.js_str(a.get("url") or a.get("host") or "")
        if not target:
            raise ValueError("note_other_domain needs url or host")
        probe = target if re.match(r"^https?:", target, re.IGNORECASE) else f"https://{target}/"
        if self.on_site(probe):
            return {"noted": False, "reason": "that host is part of the site; use it directly"}
        samples = ([E.js_str(x) for x in a["sample_urls"][:5]]
                   if isinstance(a.get("sample_urls"), list) else [])
        self.note_other(target, f"reported by the mapper: {E.js_str(a.get('why') or '')[:300]}",
                        samples)
        return {"noted": True, "note": "Flagged for a person to approve on a remap; it is not "
                "used now. Continue with the site's own options, or give up if there are none."}

    def site_fetch(self, r: dict) -> dict:
        if self.on_site(r.get("url") or ""):
            return _fetch(r)
        return {"url": r.get("url"), "status": 0, "text": "", "blocked": False,
                "truncated": False, "error": self.offsite(r.get("url") or ""), "ms": 0}

    def active_ms(self) -> float:
        return self.st["active_ms"] + (_now() - self.call_start)

    def total_ms(self) -> float:
        return min(self.st["minutes"], MAX_MINUTES) * 60_000

    def research_end_ms(self) -> float:
        return self.total_ms() - min(SUBMIT_RESERVE_MS, self.total_ms() * 0.25)

    def remaining(self) -> float:
        return self.research_end_ms() - self.active_ms()

    def log(self, line: str) -> None:
        with self._lock:
            lg = self.st["log"]
            lg.append(line[:400])
            if len(lg) > 300:
                del lg[: len(lg) - 300]

    def take_fetch(self) -> None:
        if self.remaining() < 10_000:
            raise LimitReached("research time is over - submit the best config you have "
                               "validated (or give_up)")
        with self._lock:
            if self.st["fetches"] >= self.st["max_fetches"]:
                raise LimitReached(
                    f"research fetch budget used up ({self.st['fetches']}/"
                    f"{self.st['max_fetches']}) - inspect stored responses, then test_source / "
                    "coverage_check / submit_config")
            self.st["fetches"] += 1

    def tool_deadline(self, tool: str) -> float:
        call_end = self.call_deadline - 5_000
        if tool == "submit_config":
            return min(_now() + TOOL_CAPS[tool], call_end)
        if self.remaining() < 10_000:
            raise LimitReached("research time is over - submit the best config you have "
                               "validated (or give_up)")
        return min(_now() + TOOL_CAPS[tool], _now() + self.remaining(), call_end)

    def fetch_timeout(self, render: bool) -> float:
        return max(8_000, min(90_000 if render else 45_000, self.remaining(),
                              self.call_deadline - _now() - 5_000))

    def store(self, url: str, status: int, text: str) -> str:
        with self._lock:
            self.st["response_count"] += 1
            ref = f"r{self.st['response_count']}"
            self.st["responses"].append({"ref": ref, "url": url, "status": status,
                                         "text": (text or "")[:400_000]})
        return ref

    def text_for(self, ref: str) -> tuple[str, str]:
        r = next((x for x in self.st["responses"] if x["ref"] == ref), None)
        if r:
            return r.get("text") or "", r["url"]
        m = re.match(r"^c(\d+)\Z", str(ref))
        rec = self.browser.records.get(int(m.group(1))) if m and self.browser else None
        if rec:
            return rec.get("body") or "", rec["url"]
        raise ValueError(f"unknown ref {ref}")

    # Fix (v2 browser reconnect, 2026-10-09): a closed browser is reconnected up to 3 times.
    def browser_ready(self) -> RemoteBrowser:
        cur = self.b()
        if not cur.closed:
            return cur
        if self.reconnects >= 3:
            raise BrowserError("browser connection closed (reconnected 3 times in this call "
                               "already)")
        self.reconnects += 1
        saved = cur.export_state()
        try:
            self.browser = RemoteBrowser.connect(saved, saved["session_name"])
            self.log(f"browser reconnected ({self.reconnects})")
            return self.browser
        except Exception as e:
            self.st["browser_error"] = E.error_message(e)[:300]
            raise BrowserError("browser connection closed and could not be reopened: "
                               f"{self.st['browser_error']}") from e

    def b(self) -> RemoteBrowser:
        if not self.browser:
            err = self.st.get("browser_error")
            raise BrowserError("the browser is not available in this run"
                               f"{f' ({err})' if err else ''} - use http_fetch")
        return self.browser

    # ---- tools ----------------------------------------------------------------------------
    def t_sitemap_probe(self, a: dict) -> dict:
        out: dict[str, Any] = {}
        if a.get("url") and not self.on_site(a["url"]):
            raise ValueError(self.offsite(a["url"]))
        targets: list[str] = [a["url"]] if a.get("url") else []
        origin = E.JsUrl(self.st["start_url"]).origin
        if not a.get("url"):
            self.take_fetch()
            robots = self.site_fetch({"method": "GET", "url": f"{origin}/robots.txt",
                                      "timeoutMs": self.fetch_timeout(False)})
            rtext = robots.get("text") or ""
            ml = re.IGNORECASE | re.MULTILINE
            found = ([m.group(1) for m in re.finditer(r"^\s*sitemap:\s*(\S+)", rtext, ml)]
                     if robots.get("status") == 200 else [])
            out["robots_status"] = robots.get("status") or robots.get("error")
            out["robots_sitemaps"] = found
            out["robots_disallow_sample"] = [
                m.group(1) for m in re.finditer(r"^\s*disallow:\s*(\S+)", rtext, ml)][:12]
            targets = found[:2] if found[:2] else [f"{origin}/sitemap.xml"]
        out["sitemaps"] = []
        for t in targets[:2]:
            self.take_fetch()
            resp = self.site_fetch({"method": "GET", "url": t, "maxBytes": SITEMAP_SAMPLE_BYTES,
                                    "timeoutMs": self.fetch_timeout(False)})
            text = resp.get("text") or ""
            locs = [m.group(1) for m in E.LOC_RE.finditer(text)]
            entry: dict[str, Any] = {"url": t, "status": resp.get("status") or resp.get("error"),
                                     "locs_in_sample": len(locs), "sampled": resp.get("truncated")}
            if re.search(r"<sitemapindex", text[:2000], re.IGNORECASE):
                entry.update({"type": "sitemap index", "children": locs[:50]})
            else:
                groups: dict[str, dict] = {}
                for loc in locs:
                    g = groups.setdefault(E.url_pattern(loc), {"count": 0, "examples": []})
                    g["count"] += 1
                    if len(g["examples"]) < 2:
                        g["examples"].append(loc)
                entry["type"] = "url set"
                entry["url_patterns"] = [[p, g["count"], g["examples"]] for p, g in
                                         sorted(groups.items(), key=lambda x: -x[1]["count"])[:10]]
            out["sitemaps"].append(entry)
        return out

    def t_http_fetch(self, a: dict) -> dict:
        url, method, headers, body = a.get("url"), a.get("method"), a.get("headers"), a.get("body")
        if a.get("replay"):
            rm = re.fullmatch(r"c?(\d+)", E.js_str(a["replay"]))
            rec = self.b().records.get(int(rm.group(1))) if rm else None
            if not rec:
                raise ValueError(f"unknown browser record {a['replay']}")
            url = url or rec["url"]
            method = method or rec["method"]
            headers = {**clean_headers(rec.get("request_headers")), **(headers or {})}
            body = body if body is not None else rec.get("post_data")
        if not url:
            raise ValueError("http_fetch needs url or replay")
        if not self.on_site(url):
            raise ValueError(self.offsite(url))
        method = "POST" if E.js_str(method or "GET").upper() == "POST" else "GET"
        self.take_fetch()
        render = bool(a.get("render"))
        partial = (SITEMAP_SAMPLE_BYTES if method == "GET" and re.search(
            r"\.xml(\.gz)?$|sitemap", E.JsUrl(url).pathname, re.IGNORECASE) else None)
        resp = self.site_fetch({"method": method, "url": url, "headers": headers or {},
                                "body": body if method == "POST" else None, "render": render,
                                "maxBytes": partial, "timeoutMs": self.fetch_timeout(render)})
        text = resp.get("text") or ""
        ref = self.store(resp.get("url"), resp.get("status"), text)
        seconds = math.floor((resp.get("ms") or 0) / 1000 + 0.5)
        status = resp.get("status") or 0
        if resp.get("error") or resp.get("blocked") or status >= 400:
            err = resp.get("error") or ("bot challenge / blocked" if resp.get("blocked")
                                        else f"HTTP {status}")
            out: dict[str, Any] = {"ref": ref, "status": resp.get("status"), "error": err,
                                   "seconds": seconds, "body_start": E.clip(text, 500)}
            hint = self.hint(method, url, resp)
            if hint:
                out["hint"] = hint
            if hint and hint.startswith("API") and self.browser and not self.st["key_search_done"]:
                self.st["key_search_done"] = True
                try:
                    found = self.t_search_scripts({"pattern": _KEY_PATTERN, "max_files": 40,
                                                   "prefer": E.host_of(url)})
                    hits = (found.get("hits") or [])[:6]
                    out["auto_script_search_for_keys"] = (
                        hits if hits else "no key-like headers found in the JS bundles")
                except Exception:  # noqa: BLE001,S110 - budget
                    pass
            return out
        ctype = "application/json" if re.match(r"^\s*[\[{]", text) else ""
        out = {"ref": ref, "status": resp.get("status"), "seconds": seconds,
               "final_url": resp.get("url"), "bytes": len(text),
               "sampled_first_bytes_only": resp.get("truncated"), "blocked": resp.get("blocked")}
        if a.get("replay"):
            out["sent_headers"] = {k: E.clip(E.js_str(v), 80) for k, v in (headers or {}).items()}
        out["summary"] = E.summarize_body(resp.get("url"), ctype, text)
        return out

    def hint(self, method: str, url: str, resp: dict) -> str | None:
        if method == "POST" or "graphql" in url or "/api" in url:
            if ((resp.get("error") and re.search(r"timed out", resp["error"], re.IGNORECASE))
                    or resp.get("status") in (401, 403)):
                return ("API calls that work in the browser but fail here usually need a key or "
                        "header defined in the site's JavaScript: search_scripts(pattern='api[-_]?"
                        "key|x-[a-z-]+-key|authorization') and add it to the headers; also try "
                        "http_fetch replay='cN' of the browser's own call.")
        elif self.browser and any(r.get("type") in ("XHR", "Fetch")
                                  and "json" in (r.get("mime_type") or "")
                                  for r in list(self.browser.records.values())):
            return ("This HTML is bot-protected. The browser saw JSON data calls (network_log "
                    "all=true) - replay one with http_fetch replay='cN'; APIs usually work without "
                    "render, which is slow and costly.")
        return None

    def t_inspect(self, a: dict) -> dict:
        text, url = self.text_for(a.get("ref"))
        lim = E.num_or(a.get("limit"), 30)
        limit = int(max(1, min(lim if lim and not math.isnan(lim) else 30, 100)))
        if a.get("css"):
            if re.match(r"^\s*[\[{]", text):
                return {"error": "body is JSON; use jsonpath"}
            values = E.css_values(text, a["css"])
            return {"count": len(values), "values": [E.clip(v, 250) for v in values[:limit]]}
        if a.get("jsonpath"):
            data = (E.embedded_json(text, a["embedded_css"]) if a.get("embedded_css")
                    else E.parse_json(text))
            values = E.jsonpath(data, a["jsonpath"]) if data is not None else []
            return {"count": len(values), "values": [
                E.clip(E.json_stringify(E.trim_json(v, 120, 3, 4)), 350) for v in values[:limit]]}
        if a.get("regex"):
            values = [E.group1_or_0(m) for m in E.js_re(a["regex"]).finditer(text)]
            return {"count": len(values), "values": [E.clip(E.js_str(v), 250)
                                                     for v in values[:limit]]}
        if a.get("search"):
            needle = E.js_str(a["search"])
            hits: list[int] = []
            i = text.find(needle)
            while i >= 0 and len(hits) < 200:
                hits.append(i)
                i = text.find(needle, i + 1)
            return {"count": len(hits), "snippets": [text[max(0, h - 180): h + 220]
                                                     for h in hits[: min(limit, 6)]]}
        return {"url": url, "bytes": len(text), "summary": E.summarize_body(url, "", text)}

    def needs_browser_evidence(self) -> str | None:
        if self.browser and self.st["browser_actions"] < 2 and self.remaining() > 45_000:
            return ("First look at the listing in the browser: open a results page (city / search "
                    "/ directory), go to page 2 or run a search, and check its DATA CALLS for an "
                    "API and for page caps. Then decide.")
        return None

    def page_view(self) -> str:
        self.st["browser_actions"] += 1
        calls: list[str] = self.t_network_log({})["requests"]
        head = ("DATA CALLS this action triggered (network_detail cN / http_fetch replay=cN):\n"
                + "\n".join(calls[-15:]) if calls else
                "DATA CALLS: none (results are in the HTML, or load on scroll/search)")
        restarted = ("NOTE: the browser session was restarted; the last page was reopened.\n"
                     if self.browser and self.browser.restarted else "")
        if self.browser:
            self.browser.restarted = False
        return f"{restarted}{head}\n\n{self.browser_ready().snapshot(70, 1_200)}"

    def t_browser_open(self, a: dict) -> str:
        url = E.js_str(a.get("url"))
        if not self.on_site(url):
            raise ValueError(self.offsite(url))
        self.browser_ready().open(url)
        return self.page_view()

    def t_browser_snapshot(self, _a: dict) -> str:
        self.browser_ready()
        return self.page_view()

    def t_browser_click(self, a: dict) -> str:
        self.browser_ready().click(int(E.js_number(a.get("element"))))
        return self.page_view()

    def t_browser_type(self, a: dict) -> str:
        self.browser_ready().type(int(E.js_number(a.get("element"))),
                                  E.js_str(a.get("text") if a.get("text") is not None else ""),
                                  bool(a.get("submit")))
        return self.page_view()

    def t_browser_scroll(self, a: dict) -> str:
        self.browser_ready().scroll("up" if a.get("direction") == "up" else "down")
        return self.page_view()

    def t_browser_back(self, _a: dict) -> str:
        self.browser_ready().back()
        return self.page_view()

    def t_network_log(self, a: dict) -> dict:
        b = self.b()
        seqs = sorted(b.records) if a.get("all") else list(b.unread)
        b.unread = []
        lines: list[str] = []
        skipped = offsite = 0
        for seq in seqs:
            r = b.records.get(seq)
            if not r:
                continue
            if not self.on_site(r["url"]):
                offsite += 1
                continue
            data_call = r.get("type") in ("XHR", "Fetch", "Other")
            if not (data_call or r.get("type") == "Document") or (
                    a.get("filter") and a["filter"] not in r["url"]):
                skipped += 1
                continue
            op = re.search(r'"operationName"\s*:\s*"([^"]+)"', r.get("post_data") or "")
            st = r.get("status")
            lines.append(f"c{seq} {r.get('method')} {'' if st is None else st} {r.get('type')} "
                         f"{E.clip(r['url'], 200)} {r.get('mime_type') or ''} "
                         f"{len(r.get('body') or '')}B{f' op={op.group(1)}' if op else ''}")
        out: dict[str, Any] = {"navigations": b.navigations[-6:], "requests": lines[-60:],
                               "skipped": skipped}
        if offsite:
            out["third_party_calls_hidden"] = offsite
        return out

    def t_search_scripts(self, a: dict) -> dict:
        rx = E.js_re(a.get("pattern"), "i")
        site = re.sub(r"^www\.", "", self.st["domain"])
        uf = E.js_re(a["url_filter"], "i") if a.get("url_filter") else None
        urls = [u for u in self.b().scripts if self.on_site(u) and (not uf or uf.search(u))]
        mf = E.num_or(a.get("max_files"), 40)
        mf = mf if mf and not math.isnan(mf) else 40
        urls = sorted(urls, key=lambda u: not E.host_of(u).endswith(site))[: int(max(1, min(mf,
                                                                                         40)))]
        for _ in range(max(1, len(urls) // 10)):
            self.take_fetch()
        deadline = self.tool_deadline("search_scripts")
        hits: list[dict] = []
        seen: set[str] = set()
        i = 0
        while i < len(urls) and _now() < deadline:
            batch_urls = urls[i: i + 8]

            def get(u: str) -> tuple[str, str]:
                t = max(5_000, min(30_000, deadline - _now()))
                return u, self.site_fetch({"method": "GET", "url": u, "timeoutMs": t}).get(
                    "text") or ""

            for u, text in _parallel([lambda u=u: get(u) for u in batch_urls]):
                for m in rx.finditer(text):
                    ctx = text[max(0, m.start() - 150): m.start() + len(m.group(0)) + 150]
                    if ctx in seen:
                        continue
                    seen.add(ctx)
                    hits.append({"script": E.clip(u, 110), "match": m.group(0)[:100],
                                 "context": ctx})
                    if len(hits) > 60:
                        break
            i += 8
        if a.get("prefer"):
            pref = a["prefer"]
            hits.sort(key=lambda x: (
                not re.search(r"[\"']x-[a-z0-9-]+[\"']\s*:", x["context"], re.IGNORECASE),
                pref not in x["context"]))
        return {"scripts_known": len(self.b().scripts), "searched": len(urls), "hits": hits[:12]}

    def t_network_detail(self, a: dict) -> dict:
        try:
            seq = int(E.js_number(a.get("seq")))
        except (ValueError, OverflowError):
            seq = -1
        r = self.b().records.get(seq)
        if not r:
            return {"error": f"c{E.js_str(a.get('seq'))} not found (it may still be loading)"}
        return {
            "ref": f"c{r['seq']}", "method": r.get("method"), "url": r["url"],
            "status": r.get("status"), "type": r.get("type"),
            "request_headers": {k: E.clip(E.js_str(v), 180)
                                for k, v in (r.get("request_headers") or {}).items()},
            "post_data": E.clip(r.get("post_data"), 2_500),
            "response_headers": {k: E.clip(E.js_str(v), 150)
                                 for k, v in (r.get("response_headers") or {}).items()},
            "body": E.summarize_body(r["url"], r.get("mime_type") or "", r.get("body") or ""),
        }

    def config_with(self, sources: list, settings: Any = None) -> dict:
        if isinstance(settings, dict):
            self.st["settings"].update(settings)
        s = self.st["settings"]
        return {**s, "start_url": s.get("start_url") or self.st["start_url"], "sources": sources}

    def source_key(self, cfg: dict, src: dict) -> str:
        rest = {k: v for k, v in src.items() if k != "name"}
        settings = {"render": E.js_truthy(cfg.get("render")), "headers": cfg.get("headers") or {},
                    "profile_url_pattern": cfg.get("profile_url_pattern"),
                    "strip_query": E.js_truthy(cfg.get("strip_query"))}
        return stable([rest, settings])

    def remember(self, cfg: dict, src: dict, summary: dict) -> None:
        if summary["new_unique"] > 0 and not summary["rejected_by_profile_pattern"]:
            self.st["proven"][self.source_key(cfg, src)] = summary

    def sample(self, cfg: dict, deadline: float, sample: Any = None,
               reuse: bool = False) -> list[dict]:
        out: list[dict] = []
        for src in cfg["sources"]:
            known = self.st["proven"].get(self.source_key(cfg, src)) if reuse else None
            if known:
                out.append({**known, "source": src.get("name"), "reused_from_earlier_test": True})
                continue
            limits: dict[str, Any] = {"workers": 4, "deadline": deadline,
                                      "sitemapBytes": SITEMAP_SAMPLE_BYTES,
                                      **TEST_LIMITS.get(src.get("type"), {})}
            if sample:
                n = int(max(1, min(E.js_number(sample), 20)))
                if limits.get("maxSeeds"):
                    limits["maxSeeds"] = n
                if limits.get("maxRequests"):
                    limits["maxRequests"] = n
            render = E.js_truthy(src["render"] if "render" in src else cfg.get("render"))
            timeout = max(5_000, min(90_000 if render else 45_000, deadline - _now()))
            stats = E.run_config({**cfg, "sources": [src]}, E.Collector(cfg), limits,
                                 self.site_fetch, timeout)[0]
            summary = stats.summary()
            self.remember(cfg, src, summary)
            out.append(summary)
        return out

    def t_test_source(self, a: dict) -> dict:
        src = a.get("source") or {}
        cfg, problems = E.normalize_config({
            **self.config_with([{"name": src.get("name") or "test", **src}], a.get("settings")),
            "domain": self.st["domain"]})
        if problems:
            return {"config_problems": problems}
        return self.sample(cfg, self.tool_deadline("test_source"), a.get("sample"))[0]

    def t_coverage_check(self, a: dict) -> Any:
        src0 = a.get("source") or {}
        source = {"name": src0.get("name") or "coverage", **src0}
        cfg, problems = E.normalize_config({**self.config_with([source], a.get("settings")),
                                            "domain": self.st["domain"]})
        if problems:
            return {"config_problems": problems}
        collector = E.Collector(cfg)
        probes = list(dict.fromkeys(collector.normalize(E.js_str(u))
                                    for u in (a.get("probe_urls") or [])[:40]))
        if len(probes) < 10:
            return ({"error": f"only {len(probes)} probe URLs; collect at least 10 from "
                              "different pages"}, True)
        deadline = self.tool_deadline("coverage_check")
        # Fix (coverage reads whole sitemaps, 2026-10-09): up to 6 whole sitemap files.
        mp = E.num_or(a.get("max_pages"), 3)
        ms = E.num_or(a.get("max_seeds"), 12)
        limits = {
            "workers": 8, "deadline": deadline,
            "maxPages": int(max(1, min(mp if mp and not math.isnan(mp) else 3, 20))),
            "maxSeeds": int(max(1, min(ms if ms and not math.isnan(ms) else 12, 30))),
            "maxRequests": 6 if source.get("type") == "sitemap" else 120,
        }
        render = E.js_truthy(source["render"] if "render" in source else cfg.get("render"))
        stats = E.run_config(cfg, collector, limits, self.site_fetch,
                             max(5_000, min(90_000 if render else 45_000, deadline - _now())))[0]
        self.remember(cfg, cfg["sources"][0], stats.summary())
        hit = [u for u in probes if u in collector.seen]
        percent = E.as_num(math.floor(1000 * len(hit) / len(probes) + 0.5) / 10)
        self.st["coverage"][source["name"]] = percent
        return {
            "probe_urls": len(probes), "contained": len(hit), "coverage_percent": percent,
            "missing_examples": sorted(u for u in probes if u not in collector.seen)[:8],
            "note": "partial runs of looped sources under-count", "source_stats": stats.summary(),
        }

    def profile_loads(self, url: str, cfg: dict) -> dict:
        for render in list(dict.fromkeys([E.js_truthy(cfg.get("render")), True])):
            left = self.call_deadline - 10_000 - _now()
            if left < 8_000:
                return {"problem": None, "html": ""}
            resp = self.site_fetch({"method": "GET", "url": url, "render": render,
                                    "timeoutMs": min(40_000, left)})
            if resp.get("status") == 200:
                return {"problem": None, "html": resp.get("text") or ""}
            if resp.get("status") in (404, 410):
                return {"problem": f"sample profile {url} does not exist (HTTP {resp['status']})",
                        "html": ""}
        return {"problem": None, "html": ""}

    # Fix (person pages for person categories, 2026-10-09): one short AI check of the sample page.
    def person_category(self) -> bool:
        return not _PERSON_NOT.search(self.st["category_label"])

    def page_kind(self, url: str, html: str, api_key: str) -> dict | None:
        if not html:
            return None
        types = " ".join([m.group(1) for m in re.finditer(
            r'"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")', html)][:12])
        tm = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.IGNORECASE)
        title = (tm.group(1) if tm else "").strip()[:200]
        text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()[:4_000]
        prompt = (f"URL: {url}\nTITLE: {title}\nJSON-LD TYPES: {types or 'none'}\n"
                  f"VISIBLE TEXT (start):\n{text}\n\n"
                  "Is this page about ONE individual person (their own profile), ONE "
                  "office/branch/location, a LIST of several people or offices, or OTHER? "
                  'Answer with JSON only: {"kind":"person|office|list|other","reason":"one short '
                  'sentence"}')
        try:
            res = httpx.post(ANTHROPIC_URL, headers=_headers(api_key), timeout=30.0, content=
                             E.json_stringify({"model": self.st["model"], "max_tokens": 200,
                                               "messages": [{"role": "user",
                                                             "content": prompt}]}))
            if not res.is_success:
                return None
            body = res.json()
            self.account(body.get("usage"))
            out = "".join(b.get("text") or "" for b in body.get("content") or [])
            jm = re.search(r"\{[\s\S]*\}", out)
            j = E.parse_json(jm.group(0) if jm else "")
            if isinstance(j, dict) and j.get("kind"):
                return {"kind": E.js_str(j["kind"]), "reason": E.js_str(j.get("reason") or "")}
            return None
        except Exception:  # noqa: BLE001
            return None

    def t_submit_config(self, a: dict) -> Any:
        evidence = self.needs_browser_evidence()
        if evidence:
            return ({"refused": evidence}, True)
        cfg, problems = E.normalize_config({"version": 2, **(a.get("config") or {}),
                                            "domain": self.st["domain"]})
        if not cfg.get("profile_url_pattern"):
            problems.append("profile_url_pattern is required")
        if cfg.get("start_url") and not self.on_site(cfg["start_url"]):
            problems.append(self.offsite(cfg["start_url"]))
        # Fix (complete lists in the config, 2026-10-09): the config must cover the whole site.
        if not E.js_str(a.get("complete_list_reason") or "").strip():
            for src in cfg["sources"]:
                for name, seed in (src.get("seeds") or {}).items():
                    if (isinstance(seed, dict) and seed.get("type") == "list"
                            and isinstance(seed.get("values"), list) and len(seed["values"]) < 100):
                        problems.append(
                            f"source {src.get('name')}: seed '{name}' is a hand-picked list of "
                            f"{len(seed['values'])} values; the config must cover the whole site - "
                            "use systematic seeds (us_states, alphabet with expand_at, range, or "
                            "values extracted from the site's own hub pages), or pass "
                            "complete_list_reason if this list is the site's complete set")
                if (src.get("type") == "link_crawl" and isinstance(src.get("start_urls"), list)
                        and len(src["start_urls"]) > 3):
                    problems.append(
                        f"source {src.get('name')}: {len(src['start_urls'])} hand-picked start "
                        "URLs; start from the site's hub page(s) that list every area and follow "
                        "them (follow regex), or pass complete_list_reason if these are all the "
                        "hubs")
        values = list(self.st["coverage"].values())
        best = max(values) if values else None
        if best is None and self.remaining() > 60_000:
            problems.append("run coverage_check first (profile URLs from an independent path, "
                            "e.g. directory pages)")
        elif (best is not None and best < 90
              and not E.js_str(a.get("coverage_justification") or "").strip()):
            problems.append(f"best coverage is {E.js_str(best)}% (< 90%): improve it, or resubmit "
                            "with coverage_justification")
        if problems:
            return ({"validation_failed": problems}, True)
        proven = all(self.source_key(cfg, s) in self.st["proven"] for s in cfg["sources"])
        self.st["pending"] = {"config": cfg, "report": a.get("report_markdown"), "proven": proven,
                              "coverage_justification": a.get("coverage_justification")}
        stats = self.sample(cfg, self.tool_deadline("submit_config"), None, True)
        bad = [f"source {s.get('source')} produced no profile URLs: errors="
               f"{E.json_stringify((s.get('errors') or [])[:2])} stops="
               f"{E.json_stringify(s.get('stop_reasons'))} rejected="
               f"{E.json_stringify((s.get('rejected_samples') or [])[:3])}"
               for s in stats if not s.get("new_unique")]
        sample_url = next((u for s in stats for u in (s.get("sample_urls") or [])), None)
        if sample_url and not bad:
            loaded = self.profile_loads(sample_url, cfg)
            if loaded["problem"]:
                bad.append(loaded["problem"])
            elif loaded["html"]:
                kind = self.page_kind(sample_url, loaded["html"], self.api_key)
                person = self.person_category()
                if kind and person and kind["kind"] != "person":
                    what = ("an office / branch page" if kind["kind"] == "office"
                            else "a list page" if kind["kind"] == "list" else "not a profile page")
                    bad.append(f"the sample profile {sample_url} looks like {what} "
                               f"({kind['reason']}); the category \"{self.st['category_label']}\" "
                               "needs one page per individual person - look for the site's "
                               "individual profile pages")
                if kind and not person and kind["kind"] not in ("office", "person"):
                    bad.append(f"the sample profile {sample_url} does not look like one office or "
                               f"business page ({kind['reason']})")
                if kind:
                    self.log(f"sample page check: {kind['kind']} ({kind['reason'][:120]})")
        if bad:
            return ({"validation_failed": bad, "source_stats": stats}, True)
        self.st["result"] = {"outcome": "config", "config": cfg,
                             "report_markdown": a.get("report_markdown"),
                             "coverage_justification": a.get("coverage_justification"),
                             "validation": stats}
        self.st["pending"] = None
        return {"accepted": True}

    def t_give_up(self, a: dict) -> Any:
        used = self.active_ms() / max(1, self.research_end_ms())
        if self.needs_browser_evidence() or used < 0.6:
            return ({"refused": "Too early to give up. Keep researching: follow the site's own "
                     "navigation/search links (not guessed URLs), open the directory in the "
                     "browser and read its DATA CALLS, look for keys the API needs "
                     "(search_scripts), and check the sitemap. Give up only when those all "
                     "fail."}, True)
        self.st["result"] = {"outcome": "gave_up", "reason": a.get("reason"),
                             "report_markdown": a.get("report_markdown")}
        return {"stopped": True}

    def call_tool(self, name: str, args: Any) -> tuple[str, bool]:
        fn = getattr(self, f"t_{name}", None)
        if not callable(fn):
            return f"unknown tool {name}", True
        try:
            out = fn(args if isinstance(args, dict) else {})
            is_error = False
            if isinstance(out, tuple) and len(out) == 2 and isinstance(out[1], bool):
                out, is_error = out
            text = out if isinstance(out, str) else E.json_stringify(out)
            if len(text) > MAX_RESULT_CHARS:
                text = (f"{text[:MAX_RESULT_CHARS]}… [truncated {len(text) - MAX_RESULT_CHARS} "
                        "chars; use inspect]")
            return text, is_error
        except LimitReached as e:
            return f"Limit: {e}", True
        except Exception as e:  # noqa: BLE001
            return _err_text(e), True

    # ---- model ----------------------------------------------------------------------------
    def account(self, usage: dict | None) -> None:
        price = PRICES.get(self.st["model"]) or PRICES[DEFAULT_MODEL]
        u = usage or {}
        inp = u.get("input_tokens") or 0
        cr = u.get("cache_read_input_tokens") or 0
        cw = u.get("cache_creation_input_tokens") or 0
        outp = u.get("output_tokens") or 0
        with self._lock:
            t = self.st["tokens"]
            t["input"] = (t.get("input") or 0) + inp
            t["cache_read"] = (t.get("cache_read") or 0) + cr
            t["cache_write"] = (t.get("cache_write") or 0) + cw
            t["output"] = (t.get("output") or 0) + outp
            self.st["cost"] += (inp * price[0] + cr * price[1] + cw * price[2]
                                + outp * price[3]) / 1e6
        # ETL AI cost log (2026-10-22): one row per research call.
        note_ai_usage(model=self.st["model"], usage=usage, activity="map_research",
                      step="research")

    def call_model(self, api_key: str, timeout_ms: float) -> dict:
        msgs = list(self.st["messages"])
        if msgs and msgs[-1].get("role") == "user":
            m = msgs[-1]
            content = ([{"type": "text", "text": m["content"]}] if isinstance(m["content"], str)
                       else list(m["content"]))
            content[-1] = {**content[-1], "cache_control": {"type": "ephemeral"}}
            msgs[-1] = {**m, "content": content}
        tools = [({**t, "cache_control": {"type": "ephemeral"}} if i == len(TOOLS) - 1 else t)
                 for i, t in enumerate(TOOLS)]
        for attempt in range(3):
            body: dict[str, Any] = {
                "model": self.st["model"], "max_tokens": 8_000,
                "system": [{"type": "text", "text": SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"}}],
                "tools": tools, "messages": msgs,
            }
            if self.st.get("effort"):
                body["output_config"] = {"effort": self.st["effort"]}
            res = httpx.post(ANTHROPIC_URL, headers=_headers(api_key),
                             content=E.json_stringify(body),
                             timeout=max(10_000, timeout_ms) / 1000)
            text = res.text
            if res.is_success:
                return json.loads(text)
            if (res.status_code == 400 and self.st.get("effort")
                    and re.search(r"output_config|effort", text, re.IGNORECASE)):
                self.log(f"model: effort not accepted, retrying without ({text[:120]})")
                self.st["effort"] = None
                continue
            if res.status_code in (429, 500, 502, 503, 529) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"anthropic {res.status_code}: {text[:400]}")
        raise RuntimeError("anthropic: no response")

    def notice(self) -> str | None:
        used = self.active_ms() / max(1, self.research_end_ms())
        st = self.st
        checks = [
            ("submit_now", used >= 1, ("Research time is over. Call submit_config now with the "
             "best config you have validated (or give_up with a report).")),
            ("half_time", used >= 0.5, ("Halfway through the research time. Stop exploring "
             "alternatives: test your best method, run one coverage_check and submit.")),
            ("half_cost", st["cost"] >= st["budget"] * 0.5,
             (f"Half of the ${st['budget']:.2f} cost cap is used. Converge now: test, check "
              "coverage once, submit.")),
            ("fetches", st["fetches"] >= st["max_fetches"] * 0.75, ("Most research fetches are "
             "used. Use inspect on stored responses and finish with test_source / coverage_check "
             "/ submit_config.")),
        ]
        for key, cond, text in checks:
            if cond and key not in st["notices"]:
                st["notices"].append(key)
                return text
        return None

    def first_message(self, snapshot: str) -> str:
        st = self.st
        reserve = math.floor(min(SUBMIT_RESERVE_MS, self.total_ms() * 0.25) / 1000 + 0.5)
        return "\n".join([
            f"Website: {st['start_url']}",
            (f"Category (map profile pages of this kind only): {st['category_label']} "
             f"({st['category']})"),
            (f"Limits: ${st['budget']:.2f} cost cap (aim for well under half), "
             f"{E.js_str(min(st['minutes'], MAX_MINUTES))} minutes of research time in total (the "
             f"last {reserve} s are kept for submit_config), {st['max_fetches']} research "
             "fetches."),
            "",
            "The browser has opened the start page:" if self.browser else "Browser:",
            snapshot,
            "",
            "Research the site and deliver the crawler config.",
        ])

    def execute_calls(self, calls: list[dict]) -> list[dict]:
        for c in calls:
            self.log(f"-> {c.get('name')} {E.clip(E.json_stringify(c.get('input') or {}), 150)}")
        if len(calls) > 1 and all(c.get("name") in PARALLEL_TOOLS for c in calls):
            outputs = _parallel([lambda c=c: self.call_tool(c["name"], c.get("input"))
                                 for c in calls])
        else:
            outputs = [self.call_tool(c.get("name"), c.get("input")) for c in calls]
        out = []
        for c, (text, is_error) in zip(calls, outputs, strict=True):
            if is_error:
                self.log(f"   ! {E.clip(text, 180)}")
            out.append({"type": "tool_result", "tool_use_id": c.get("id"), "content": text,
                        "is_error": is_error})
        return out

    def run(self, api_key: str) -> None:
        """One worker call of research. Returns when finished or this call's time is used."""
        st = self.st
        self.api_key = api_key
        if st.get("other_domains") is None:
            st["other_domains"] = {}
        st["calls"] += 1
        if st["use_browser"]:
            try:
                name = ((st.get("browser") or {}).get("session_name")
                        or "disco-agent-"
                        f"{re.sub(r'[^a-z0-9]', '-', st['domain'], flags=re.IGNORECASE)}"
                        f"-{int(_now())}")
                self.browser = _browser_cls().connect(st.get("browser"), name)
                st["browser_error"] = None
            except Exception as e:  # noqa: BLE001
                st["browser_error"] = E.error_message(e)[:300]
                self.log(f"browser unavailable: {st['browser_error']}")
                self.browser = None
        try:
            if not st["messages"]:
                snapshot = "(browser unavailable - use http_fetch)"
                if self.browser:
                    try:
                        self.browser.open(st["start_url"])
                        snapshot = self.page_view()
                        st["browser_actions"] = 0
                    except Exception as e:  # noqa: BLE001
                        snapshot = ("(the start page did not open in the browser: "
                                    f"{E.error_message(e)[:200]})")
                st["messages"].append({"role": "user", "content": self.first_message(snapshot)})
            if st.get("pending_calls"):
                results = self.execute_calls(st["pending_calls"])
                st["pending_calls"] = None
                st["messages"].append({"role": "user", "content": results})
            while not st.get("result"):
                if self.active_ms() > self.total_ms():
                    self.log("hard time limit reached")
                    break
                if st["cost"] >= st["budget"]:
                    self.log("cost cap reached")
                    break
                if self.call_deadline - _now() < 45_000:
                    return  # continue in the next call
                msg = self.call_model(api_key, min(120_000, self.call_deadline - _now() - 10_000))
                self.account(msg.get("usage"))
                st["messages"].append({"role": "assistant", "content": msg.get("content")})
                for block in msg.get("content") or []:
                    if block.get("type") == "text" and (block.get("text") or "").strip():
                        self.log(f"[AI] {block['text'].strip()}")
                if msg.get("stop_reason") == "refusal":
                    st["result"] = {"outcome": "stopped", "reason": "Claude declined the request"}
                    break
                calls = [b for b in msg.get("content") or [] if b.get("type") == "tool_use"]
                st["turns"] += 1
                if not calls:
                    if st["nudges"] >= 2:
                        self.log("no tool calls after two reminders")
                        break
                    st["nudges"] += 1
                    st["messages"].append({"role": "user", "content": "Continue with the tools. "
                                           "Finish with submit_config or give_up."})
                    continue
                heavy = any(c.get("name") in HEAVY_TOOLS or str(c.get("name")).startswith(
                    "browser_") for c in calls)
                if heavy and self.call_deadline - _now() < 100_000:
                    st["pending_calls"] = calls
                    return
                results = self.execute_calls(calls)
                notice = self.notice()
                st["messages"].append({"role": "user", "content": [
                    *results, {"type": "text", "text": notice}] if notice else results})
                self.log(f"   turn {st['turns']}, {self.active_ms() / 60_000:.1f} min active, "
                         f"${st['cost']:.2f}")
            if not st.get("result"):
                pend = st.get("pending") or {}
                if pend.get("proven"):
                    st["result"] = {
                        "outcome": "config", "config": pend["config"],
                        "report_markdown": f"{pend.get('report') or ''}\n\n**Note:** the time or "
                        "cost limit was reached during the final check of this config. Every "
                        "source had already produced profile URLs in test_source / "
                        "coverage_check, so it was kept; the sample profile page was not "
                        "re-checked.",
                        "validation": None}
                else:
                    reason = ("time limit reached" if self.active_ms() > self.total_ms()
                              else "cost cap reached" if st["cost"] >= st["budget"]
                              else "stopped without a config")
                    st["result"] = {"outcome": "stopped", "reason": reason}
        finally:
            st["active_ms"] += _now() - self.call_start
            if self.browser:
                st["browser"] = self.browser.export_state()
                self.browser.close()
            if len(st["responses"]) > 12:
                st["responses"] = st["responses"][-12:]
            st["responses"] = [{**r, "text": (r.get("text") or "")[:120_000]}
                               for r in st["responses"]]


def _browser_cls() -> type[RemoteBrowser]:
    """RemoteBrowser resolved at call time (tests monkeypatch the module attribute)."""
    return globals()["RemoteBrowser"]


def _headers(api_key: str) -> dict[str, str]:
    return {"x-api-key": api_key, "anthropic-version": "2023-06-01",
            "content-type": "application/json"}


def _parallel(fns: list[Callable[[], Any]]) -> list[Any]:
    """Promise.all: run thunks concurrently, each in a copy of the caller's context."""
    if not fns:
        return []
    with ThreadPoolExecutor(max_workers=len(fns)) as ex:
        futs = [ex.submit(contextvars.copy_context().run, fn) for fn in fns]
        return [f.result() for f in futs]


def new_state(body: dict) -> dict:
    domain = re.sub(r"/.*$", "", re.sub(r"^https?://", "", E.js_str(body.get("domain")).lower()))
    su = body.get("start_url")
    start_url = (su if isinstance(su, str) and re.match(r"^https?://", su)
                 else f"https://www.{re.sub(r'^www[.]', '', domain)}/")
    cat = body.get("category")
    if "effort" in body and body["effort"] is None:
        effort = None
    else:
        effort = body["effort"] if isinstance(body.get("effort"), str) else "high"
    model = body.get("model")
    return {
        "v": 1, "domain": domain, "category": E.js_str(cat if cat is not None else ""),
        "category_label": category_label(E.js_str(cat if cat is not None else "profiles")),
        "start_url": start_url,
        "model": model if isinstance(model, str) and model else DEFAULT_MODEL,
        "effort": effort,
        "budget": E.as_num(_clamp(body.get("budget"), 3, 0.5, 5)),
        "minutes": E.as_num(_clamp(body.get("minutes"), 8, 2, MAX_MINUTES)),
        "max_fetches": E.as_num(_clamp(body.get("max_fetches"), 40, 10, 80)),
        "use_browser": body.get("no_browser") is not True,
        "active_ms": 0, "calls": 0, "turns": 0, "cost": 0, "tokens": {}, "fetches": 0,
        "browser_actions": 0, "key_search_done": False, "settings": {"domain": domain},
        "coverage": {}, "proven": {}, "responses": [], "response_count": 0, "browser": None,
        "browser_error": None, "messages": [], "notices": [], "nudges": 0, "pending_calls": None,
        "result": None, "pending": None, "log": [], "other_domains": {},
    }


# G1 (one mapper behind Map, 2026-10-13): version 2 research for the mapping worker's map job.
def spread_profile_urls(urls: list[str], n: int) -> list[str]:
    """Up to n URLs spread over the site's sections, evenly through each section."""
    groups: dict[str, list[str]] = {}
    for u in dict.fromkeys(urls):
        p = E.try_url(u)
        if not p:
            continue
        key = "/".join([x for x in p.pathname.split("/") if x][:-2])
        groups.setdefault(key, []).append(u)
    lists: list[list[str]] = []
    for g in groups.values():
        per = math.ceil(n / max(1, len(groups)))
        step = max(1, math.floor(len(g) / max(1, per)))
        lists.append([g[i] for i in range(0, len(g), step)])
    out: list[str] = []
    rnd = 0
    while len(out) < n and any(len(lst) > rnd for lst in lists):
        for lst in lists:
            if len(out) >= n:
                break
            if len(lst) > rnd:
                out.append(lst[rnd])
        rnd += 1
    return out


def _opts(opts: dict | None, kw: dict) -> dict:
    o = dict(opts or {})
    for k, v in kw.items():
        o[{"start_url": "start_url", "call_ms": "callMs"}.get(k, k)] = v
    return o


def run_v2_research(api_key: str, opts: dict | None = None, **kw: Any) -> dict:
    """One-call version 2 research (opts: domain, category, start_url?, budget?, minutes?,
    callMs?). Writes nothing; returns a V2Research dict."""
    o = _opts(opts, kw)
    st = new_state({"domain": o.get("domain"), "category": o.get("category"),
                    "start_url": o.get("start_url"), "budget": o.get("budget") or 3,
                    "minutes": o.get("minutes") or 8})
    call_ms = o.get("callMs") if o.get("callMs") is not None else 480_000
    ex = Explorer(st, max(120_000, min(call_ms, 900_000)))
    error = None
    try:
        ex.run(api_key)
    except Exception as e:  # noqa: BLE001
        error = E.error_message(e)[:500]
    return finish_research(st, ex, error, "did not finish within one call")


def finish_research(st: dict, ex: Explorer, error: str | None, unfinished: str) -> dict:
    r = st.get("result") or None
    config = r["config"] if r and r.get("outcome") == "config" else None
    pool_urls: list[str] = []
    for s in (r or {}).get("validation") or []:
        pool_urls.extend((s or {}).get("sample_urls") or [])
    pool_urls.extend(((config or {}).get("validation") or {}).get("sample_profile_urls") or [])
    pool = [u for u in dict.fromkeys(pool_urls) if isinstance(u, str)]
    return {
        "outcome": (r or {}).get("outcome") or "stopped",
        "reason": (r or {}).get("reason") if (r or {}).get("reason") is not None
        else (None if st.get("result") else unfinished),
        "config": config, "profile_urls": spread_profile_urls(pool, 60) if config else [],
        "sample_pool": len(pool), "cost_usd": E.as_num(math.floor(st["cost"] * 100 + 0.5) / 100),
        "active_seconds": math.floor(st["active_ms"] / 1000 + 0.5), "coverage": st["coverage"],
        "coverage_justification": (r or {}).get("coverage_justification"),
        "flags": ex.other_domain_flags(), "error": error, "log": st["log"][-40:],
    }


# Fix (map in steps, 2026-10-14): research in steps of at most V2_STEP_MS; the state carries over.
V2_STEP_MS = 240_000
V2_MAX_STEPS = 10                 # safety stop: a run that keeps failing mid-step ends 'stopped'
STEP_RECORDS = 40
STEP_BODY = 8_000


def run_v2_step(api_key: str, opts: dict | None = None, **kw: Any) -> dict:
    """One step (opts: domain, category, start_url?, budget?, state?). Returns
    {status: 'continue', state, ...} or {status: 'done', research}."""
    o = _opts(opts, kw)
    prev = o.get("state")
    if isinstance(prev, dict) and prev.get("v") == 1 and isinstance(prev.get("messages"), list):
        st = prev
    else:
        st = new_state({"domain": o.get("domain"), "category": o.get("category"),
                        "start_url": o.get("start_url"), "budget": o.get("budget") or 3,
                        "minutes": 8})
    ex = Explorer(st, V2_STEP_MS)
    error = None
    try:
        ex.run(api_key)
    except Exception as e:  # noqa: BLE001
        error = E.error_message(e)[:500]
        ex.log(f"call stopped: {error}")
    if st.get("result") or (error and not st["messages"]) or st["calls"] >= V2_MAX_STEPS:
        why = (f"stopped after {V2_MAX_STEPS} steps" if st["calls"] >= V2_MAX_STEPS
               else "stopped without a config")
        return {"status": "done", "research": finish_research(st, ex, error, why)}
    if st.get("browser"):
        b = st["browser"]
        st["browser"] = {**b, "records": [
            {**r, "body": r["body"][:STEP_BODY] if r.get("body") else r.get("body"),
             "post_data": r["post_data"][:4_000] if r.get("post_data") else r.get("post_data")}
            for r in (b.get("records") or [])[-STEP_RECORDS:]]}
    return {"status": "continue", "state": st, "calls": st["calls"], "turns": st["turns"],
            "active_seconds": math.floor(st["active_ms"] / 1000 + 0.5),
            "cost_usd": E.as_num(math.floor(st["cost"] * 100 + 0.5) / 100),
            "log": st["log"][-10:]}


# ---- route logic (POST /public/disco-agent-mapper) ------------------------------------------
def handle_request(raw_body: bytes, worker_key: str | None, base_url: str) -> tuple[int, Any]:
    """Returns (status, body); a str body is plain text. Any escaping error is a JSON 500
    (Fix (no bare 502, 2026-10-09))."""
    try:
        return _handle_inner(raw_body, worker_key, base_url)
    except Exception:  # noqa: BLE001
        return 500, {"dry_run": True, "version": 2, "status": "failed",
                     "error": traceback.format_exc()[:1_500]}


def _handle_inner(raw_body: bytes, worker_key: str | None, base_url: str) -> tuple[int, Any]:
    key = os.environ.get("DISCO_WORKER_KEY")
    if not key or worker_key != key:
        return 401, "Unauthorized"
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return 500, {"error": "ANTHROPIC_API_KEY not configured"}
    try:
        body = json.loads(raw_body)
    except (ValueError, TypeError):
        return 400, {"error": "invalid JSON body"}
    if not isinstance(body, dict):
        body = {}
    if body.get("dry_run") is not True:
        return 400, {"error": "version 2 runs as a dry run only (dry_run: true)"}
    state = body.get("state")
    if isinstance(state, dict) and state.get("v") == 1:
        st = state
    elif body.get("domain"):
        st = new_state(body)
    else:
        return 400, {"error": "domain (or state) is required"}
    # Per-call time: 240 s by default; a caller may ask for up to 15 minutes (call_seconds).
    cs = E.num_or(body.get("call_seconds"), CALL_BUDGET_MS / 1000)
    if not cs or math.isnan(cs):
        cs = CALL_BUDGET_MS / 1000
    call_ms = max(120, min(cs, 900)) * 1000
    ex = Explorer(st, call_ms)
    error = None
    try:
        ex.run(api_key)
    except Exception as e:  # noqa: BLE001
        error = E.error_message(e)[:500]
        ex.log(f"call stopped: {error}")
    summary: dict[str, Any] = {
        "dry_run": True, "version": 2, "domain": st["domain"], "category": st["category"],
        "model": st["model"], "calls": st["calls"], "turns": st["turns"],
        "active_seconds": math.floor(st["active_ms"] / 1000 + 0.5),
        "cost_usd": E.as_num(math.floor(st["cost"] * 100 + 0.5) / 100), "tokens": st["tokens"],
        "research_fetches": st["fetches"],
        "browser": {"used": st["use_browser"], "error": st["browser_error"],
                    "actions": st["browser_actions"]},
        "coverage": st["coverage"],
    }
    if error:
        summary["error"] = error
    if st.get("result"):
        flags = ex.other_domain_flags()
        res = st["result"]
        urls: list[str] = []
        for s in res.get("validation") or []:
            urls.extend((s or {}).get("sample_urls") or [])
        profile_urls = list(dict.fromkeys(urls))[:60]
        field_learning = None
        if body.get("learn_fields") is True and res.get("outcome") == "config" and profile_urls:
            try:
                r = httpx.post(
                    f"{base_url.rstrip('/')}/api/public/disco-ai-worker", timeout=330.0,
                    headers={"Content-Type": "application/json", "x-disco-worker-key": key},
                    content=E.json_stringify({"dry_run": True, "domain": st["domain"],
                                              "category": st["category"],
                                              "profile_urls": profile_urls}))
                try:
                    field_learning = r.json()
                except ValueError:
                    field_learning = {"ok": False, "error": f"HTTP {r.status_code}"}
            except Exception as e:  # noqa: BLE001
                field_learning = {"ok": False, "error": E.error_message(e)[:300]}
        out = {**summary, "status": "done", **res, "profile_urls": profile_urls}
        if field_learning is not None:
            out["field_learning"] = field_learning
        if flags:
            out["flags"] = flags
        out["log"] = st["log"][-80:]
        return 200, out
    if error and not st["messages"]:
        return 200, {**summary, "status": "failed", "log": st["log"][-40:]}
    return 200, {**summary, "status": "continue", "log_tail": st["log"][-25:], "state": st}
