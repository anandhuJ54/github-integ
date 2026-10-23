"""Detail route (port of `-disco-detail-api.ts`, 2026-10-14): a profile API, one profile at a time.

After site mapper v2 has proven how profiles are listed, this checks whether the site also
serves each profile's data through its own API (a background call the profile page makes), and
learns a field map from that JSON. Evidence only:

- `probe_detail_api` opens up to 2 sample profile pages in the remote browser and keeps a
  captured call only when it is on the site itself, returns JSON with this profile's id or name
  words, and its request carries the profile's id or slug. The call is then replayed outside the
  browser (no cookies / login headers) for 3 different profiles and must return each profile's
  own data.
- `learn_json_fields` asks the AI once which JSON path holds each field id; code keeps a path
  only when it gives a plausible value on at least 2 profiles.

Nothing here writes to the database. Result dicts keep the TS keys (they are stored as JSON).
Helpers from sibling modules ported in parallel (`network_route`, `agent_engine`,
`site_contract`) are resolved at call time by the shared naming convention.
"""
from __future__ import annotations

import contextvars
import importlib
import math
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from _base.disco import webscraper

LIST_LIMIT = 25


def _mod(name: str) -> Any:
    return importlib.import_module(f"_base.disco.{name}")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _js_round2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


def _g(o: Any, k: str) -> Any:
    """Field of a CapturedCall / result given as a dict or an object."""
    if isinstance(o, dict):
        return o.get(k)
    return getattr(o, k, None)


def _parse_json_loose(s: str | None) -> Any:
    """parseJsonLoose; None means "not JSON" (the TS `undefined`)."""
    return _mod("network_route").parse_json_loose(s)


def _js_str(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _parallel(fns: list[Callable[[], Any]]) -> list[Any]:
    """Promise.all: run thunks concurrently, each in a copy of the caller's context."""
    if not fns:
        return []
    with ThreadPoolExecutor(max_workers=len(fns)) as ex:
        futs = [ex.submit(contextvars.copy_context().run, fn) for fn in fns]
        return [f.result() for f in futs]


# ---- profile tokens -------------------------------------------------------------------------
def _segments(u: str) -> list[str]:
    try:
        p = urlsplit(u)
        if not p.scheme or not p.netloc:
            return []
        return [unquote(s, errors="strict") for s in p.path.split("/") if s]
    except (ValueError, UnicodeDecodeError):
        return []


def profile_tokens(u: str) -> dict:
    """The profile's numeric id, name slug and slug words from its URL."""
    segs = _segments(u)
    pid: str | None = None
    for seg in reversed(segs):
        m = re.search(r"(\d{4,})", seg)
        if m:
            pid = m.group(1)
            break
    slug: str | None = None
    words: list[str] = []
    # The name slug is the segment nearest the end with 2+ words and no long number.
    for seg in reversed(segs):
        w = [x for x in re.split(r"[-_.]+", seg.lower()) if re.fullmatch(r"[a-z]{2,}", x)]
        if len(w) >= 2 and not re.search(r"\d{4,}", seg):
            slug, words = seg, w
            break
    return {"id": pid, "slug": slug, "words": words}


def _re_esc(s: str) -> str:
    """The TS reEsc (kept identical: seg_pattern strings are stored and replayed)."""
    return re.sub(r"[.*+?^${}()|\[\]\\]", lambda m: "\\" + m.group(0), s)


def _token_spec(profile_url: str, kind: str, value: str) -> dict | None:
    segs = _segments(profile_url)
    for i in range(len(segs) - 1, -1, -1):
        at = segs[i].lower().find(value.lower())
        if at < 0:
            continue
        pre = segs[i][:at]
        post = segs[i][at + len(value):]
        if kind == "id":
            group = r"(\d+)"
        else:
            group = "([a-z0-9-]+)" if pre or post else "([^/]+)"
        return {
            "kind": kind, "seg_from_end": len(segs) - i,
            "seg_pattern": f"{_re_esc(pre)}{group}{_re_esc(post)}",
        }
    return None


def token_from(profile_url: str, t: dict) -> str | None:
    """The id/slug token of a profile URL, per a learned DetailToken."""
    segs = _segments(profile_url)
    idx = len(segs) - int(t["seg_from_end"])
    if idx < 0 or idx >= len(segs):
        return None
    seg = segs[idx]
    if not seg:
        return None
    try:
        m = re.fullmatch(t["seg_pattern"], seg, re.IGNORECASE)
    except re.error:
        return None
    return m.group(1) if m and m.lastindex else None


def build_detail_call(api: dict, profile_url: str) -> dict | None:
    """{url, body} of the profile API call for one profile URL, or None."""
    tok = token_from(profile_url, api["token"])
    if not tok:
        return None
    enc = quote(tok, safe="-_.!~*'()")
    body_t = api.get("body_template")
    return {
        "url": api["url_template"].replace("{token}", enc),
        "body": None if body_t is None else body_t.replace("{token}", tok),
    }


# ---- evidence checks ------------------------------------------------------------------------
def _holds(text: str, t: dict) -> bool:
    low = text.lower()
    if t.get("id") and t["id"] in low:
        return True
    words = t.get("words") or []
    return len(words) >= 2 and all(w in low for w in words)


def _max_object_array(v: Any, depth: int = 0) -> int:
    if depth > 6 or not v or not isinstance(v, dict | list):
        return 0
    if isinstance(v, list):
        own = sum(1 for x in v if isinstance(x, dict))
        return max([own, *(_max_object_array(x, depth + 1) for x in v[:50])])
    return max([0, *(_max_object_array(x, depth + 1) for x in v.values())])


# ---- probe ----------------------------------------------------------------------------------
def probe_detail_api(*, domain: str, profile_urls: list[str], deadline_at: float) -> dict:
    """Find and prove a profile API. `deadline_at` is an epoch time in ms. Returns DetailProbe."""
    ae = _mod("agent_engine")
    nr = _mod("network_route")
    started = _now_ms()

    def left() -> float:
        return deadline_at - _now_ms()

    site = ae.site_domain(re.sub(r"^www\.", "", domain))

    def on_site(u: str) -> bool:
        h = ae.host_of(u)
        return bool(h) and (h == site or h.endswith(f".{site}"))

    pool = []
    for u in dict.fromkeys(profile_urls):
        if not on_site(u):
            continue
        t = profile_tokens(u)
        if t["id"] or len(t["words"]) >= 2:
            pool.append({"u": u, "t": t})
    checked: list[dict] = []
    out: dict[str, Any] = {
        "status": "none", "reason": "", "proven_on": [], "checked": checked, "captures": 0, "ms": 0,
    }
    if len(pool) < 3:
        out["reason"] = f"fewer than 3 profile pages with an id or name in the URL ({len(pool)})"
        out["ms"] = _now_ms() - started
        return out

    cands: list[dict] = []
    failed_captures = 0

    def read_capture(p: dict, res: Any) -> None:
        nonlocal failed_captures
        if not _g(res, "ok"):
            failed_captures += 1
            err = _g(res, "error")
            checked.append({"url": p["u"], "why": f"capture failed: {str(err or '')[:120]}"})
            return
        for c in nr.normalize_captured_calls(_g(res, "content")):
            url = _g(c, "url")
            if nr.is_noise_call(url):
                continue
            if not on_site(url):
                checked.append({"url": url, "why": "other domain (site-only rule)"})
                continue
            body = _g(c, "response_body")
            if not body:
                continue
            js = _parse_json_loose(body)
            if js is None:
                continue
            if not _holds(body, p["t"]):
                checked.append({"url": url, "why": "JSON without this profile"})
                continue
            if _max_object_array(js) > LIST_LIMIT:
                checked.append({"url": url, "why": "looks like a list"})
                continue
            req = f"{url}\n{_g(c, 'request_payload') or ''}".lower()
            t = p["t"]
            if t["id"] and t["id"] in req:
                kind = "id"
            elif t["slug"] and t["slug"].lower() in req:
                kind = "slug"
            else:
                checked.append({
                    "url": url, "why": "request does not carry the profile id or slug",
                })
                continue
            cands.append({
                "call": c, "kind": kind, "value": t["id"] if kind == "id" else t["slug"],
                "size": len(body), "from": p["u"],
            })

    def capture(p: dict) -> Any:
        try:
            return webscraper.capture_network_calls(
                p["u"], timeout_ms=max(20_000, min(100_000, left() - 40_000)), scroll=False
            )
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "content": None, "error": f"Error: {e}"}

    if left() >= 60_000:
        first = pool[:2]
        out["captures"] += len(first)
        res = _parallel([lambda p=p: capture(p) for p in first])
        for p, r in zip(first, res, strict=True):
            read_capture(p, r)
        if not cands and failed_captures == len(first) and len(pool) > 2 and left() >= 80_000:
            out["captures"] += 1
            read_capture(pool[2], capture(pool[2]))

    if not cands:
        if not out["captures"]:
            out["reason"] = "time budget (no capture)"
        elif failed_captures == out["captures"]:
            out["reason"] = (
                f"capture failed on all {out['captures']} profile pages (inconclusive)"
            )
        else:
            out["reason"] = (
                "no captured call returned this profile's data with its id or slug in the request"
            )
        out["ms"] = _now_ms() - started
        return out

    cands.sort(key=lambda c: c["size"], reverse=True)
    for c in cands[:2]:
        token = _token_spec(c["from"], c["kind"], c["value"])
        if not token:
            continue
        rx = re.compile(_re_esc(c["value"]), re.IGNORECASE)
        call = c["call"]
        method = "POST" if _g(call, "method") == "POST" else "GET"
        payload = _g(call, "request_payload") or ""
        api = {
            "method": method,
            "url_template": rx.sub(lambda _m: "{token}", _g(call, "url")),
            "body_template": rx.sub(lambda _m: "{token}", payload) if method == "POST" else None,
            "headers": nr.replay_headers(_g(call, "request_headers") or {}),
            "token": token,
        }
        if "{token}" not in api["url_template"] and "{token}" not in (api["body_template"] or ""):
            continue
        origin = next(x for x in pool if x["u"] == c["from"])
        check_set = [origin, *(x for x in pool if x["u"] != c["from"])][:3]
        if left() < 15_000:
            break

        def check(p: dict, api: dict = api, method: str = method, check_set: list = check_set):
            dc = build_detail_call(api, p["u"])
            if not dc:
                return {"profile_url": p["u"], "ok": False,
                        "why": "token not found in this profile URL"}
            try:
                r = webscraper.fetch_api_call(
                    url=dc["url"], method=method, headers=api["headers"], body=dc["body"],
                    crawl_method="server_crawl",
                    timeout_ms=max(5_000, min(30_000, left() - 5_000)),
                )
            except Exception as e:  # noqa: BLE001
                r = {"ok": False, "status_code": None, "content": None, "ms": 0,
                     "error": f"Error: {e}"}
            content = r.get("content")
            if not r.get("ok") or not content:
                why = r.get("status_code") or r.get("error") or "no response"
                return {"profile_url": p["u"], "api_url": dc["url"], "ok": False,
                        "why": f"replay failed ({why})"}
            if _parse_json_loose(content) is None:
                return {"profile_url": p["u"], "api_url": dc["url"], "ok": False,
                        "why": "replay is not JSON"}
            if not _holds(content, p["t"]):
                return {"profile_url": p["u"], "api_url": dc["url"], "ok": False,
                        "why": "replay without this profile's data"}
            other = next(
                (q for q in check_set if q["u"] != p["u"] and len(q["t"]["words"]) >= 2
                 and _holds(content, {"id": None, "slug": None, "words": q["t"]["words"]})),
                None,
            )
            if other:
                return {"profile_url": p["u"], "api_url": dc["url"], "ok": False,
                        "why": f"replay also holds another profile ({other['u']})"}
            return {"profile_url": p["u"], "api_url": dc["url"], "ok": True,
                    "why": "returns this profile"}

        checks = _parallel([lambda p=p: check(p) for p in check_set])
        out["proven_on"] = checks
        if len(checks) >= 3 and all(x["ok"] for x in checks):
            out["status"] = "proven"
            out["api"] = api
            out["reason"] = f"replayed for {len(checks)} profiles without cookies or login"
            out["ms"] = _now_ms() - started
            return out
    out["reason"] = "a profile call was captured but did not replay for 3 profiles"
    out["ms"] = _now_ms() - started
    return out


def _fetch(api: dict, call: dict, timeout_ms: float) -> dict:
    try:
        return webscraper.fetch_api_call(
            url=call["url"], method=api["method"], headers=api.get("headers") or {},
            body=call["body"], crawl_method="server_crawl", timeout_ms=timeout_ms,
        )
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status_code": None, "content": None, "ms": 0, "error": f"Error: {e}"}


def fetch_detail_json(api: dict, profile_url: str, timeout_ms: float) -> Any:
    """The parsed profile API JSON for one profile, or None."""
    call = build_detail_call(api, profile_url)
    if not call:
        return None
    r = _fetch(api, call, timeout_ms)
    if not r.get("ok") or not r.get("content") or not _holds(
        r["content"], profile_tokens(profile_url)
    ):
        return None
    return _parse_json_loose(r["content"])


# ---- JSON field map -------------------------------------------------------------------------
def _trim_json(v: Any, depth: int = 0) -> Any:
    if isinstance(v, str):
        return f"{v[:160]}…" if len(v) > 160 else v
    if not v or not isinstance(v, dict | list) or depth > 7:
        return v
    if isinstance(v, list):
        return [_trim_json(x, depth + 1) for x in v[:3]]
    return {k: _trim_json(x, depth + 1) for k, x in list(v.items())[:80]}


def _leaf_values(nodes: list) -> list[str]:
    out: list[str] = []
    for n in nodes:
        if n is None:
            continue
        if isinstance(n, str):
            if n.strip():
                out.append(n.strip())
        elif isinstance(n, bool | int | float):
            out.append(_js_str(n))
        elif isinstance(n, list):
            out.extend(_leaf_values(n))
    return out


def _plausible(fid: str, vals: list[str]) -> bool:
    parts = fid.split(".")
    k = parts[1] if len(parts) > 1 else fid
    if re.search("email", k):
        return any("@" in v for v in vals)
    if re.search("phone|fax|mobile", k):
        return any(len(re.sub(r"\D", "", v)) >= 7 for v in vals)
    if re.search("url|website|photo|image|logo|link", k):
        return any(re.search(r"^(https?:)?//|^/|^www\.", v, re.IGNORECASE) for v in vals)
    return True


JSON_FIELDS_TOOL: dict = {
    "name": "return_json_field_map",
    "description": "Map our field ids to JSON paths in the profile API response.",
    "input_schema": {
        "type": "object",
        "properties": {
            "fields": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string",
                               "description": "One of our field ids, exactly as listed"},
                        "path": {
                            "type": "string",
                            "description": "JSONPath from the response root, e.g. "
                            "$.data.agent.phone or $.agent.languages[*].name",
                        },
                    },
                    "required": ["id", "path"],
                },
            },
        },
        "required": ["fields"],
    },
}

_IDENT = re.compile(r"[A-Za-z_$][\w$]*", re.ASCII)


def _path_inventory(items: list) -> dict[str, dict]:
    inv: dict[str, dict] = {}
    for js in items:
        seen: dict[str, str] = {}

        def walk(v: Any, path: str, depth: int, seen: dict = seen) -> None:
            if depth > 7 or v is None:
                return
            if isinstance(v, str | bool | int | float):
                t = _js_str(v).strip()
                if t and path not in seen:
                    seen[path] = f"{t[:80]}…" if len(t) > 80 else t
                return
            if isinstance(v, list):
                for x in v[:20]:
                    walk(x, f"{path}[*]", depth + 1)
                return
            if isinstance(v, dict):
                for k, x in list(v.items())[:120]:
                    sub = (
                        f"{path}.{k}" if _IDENT.fullmatch(k)
                        else f"{path}['{k.replace(chr(39), '')}']"
                    )
                    walk(x, sub, depth + 1)

        walk(js, "$", 0)
        for p, ex in seen.items():
            e = inv.setdefault(p, {"count": 0, "examples": []})
            e["count"] += 1
            if len(e["examples"]) < 3 and ex not in e["examples"]:
                e["examples"].append(ex)
    return inv


def learn_json_fields(
    *,
    items: list[dict],
    field_ids: list[str],
    meanings: dict[str, str],
    ask: Callable[[str], Any],
    must_have: Callable[[dict], bool],
) -> dict:
    """Learn a JSON field map from fetched profile API responses. Returns JsonFieldMap."""
    jsonpath = _mod("agent_engine").jsonpath
    items = [x for x in items if x.get("json") is not None]
    inv = sorted(_path_inventory([x["json"] for x in items]).items(),
                 key=lambda kv: kv[1]["count"], reverse=True)[:300]
    inv_text = "\n".join(
        f"{p}  ({e['count']} of {len(items)}): {' | '.join(e['examples'])}" for p, e in inv
    )[:24_000]
    # Timezone ids are not offered; the profile URL is always the page URL, never a JSON value.
    offered = [i for i in field_ids if not re.search(r"\.(profile_url|timezone)$", i)]
    ids_text = "\n".join(f"{i}{f' — {meanings[i]}' if meanings.get(i) else ''}" for i in offered)
    prompt = (
        f"These are key paths found in a website's own API responses for {len(items)} single "
        "professional profiles, with how many profiles have a value there and example values. "
        "Map each of our field ids that these responses hold to one JSONPath (copy a path from "
        "the list; [*] means every item of a list). A field that only some profiles have is "
        "still a field: map it. Only map a field when the path really holds that information "
        "about this profile; leave the rest out. Use each path for one field id only.\n\n"
        f"OUR FIELD IDS:\n{ids_text}\n\nKEY PATHS:\n{inv_text}"
    )
    res = ask(prompt)
    raw_fields = res.get("fields") if isinstance(res, dict) else None
    proposed = [
        f for f in (raw_fields if isinstance(raw_fields, list) else [])
        if isinstance(f, dict) and isinstance(f.get("id"), str) and isinstance(f.get("path"), str)
    ]
    allowed = set(offered)
    need = min(2, len(items))
    fields: dict[str, str] = {}
    fill: dict[str, float] = {}
    used_path: dict[str, str] = {}
    dropped: list[dict] = []
    for f in proposed:
        fid, path = f["id"], f["path"]
        if fid not in allowed:
            dropped.append({**f, "why": "unknown field id"})
            continue
        if fields.get(fid):
            continue
        if path in used_path:
            dropped.append({**f, "why": f"path already used for {used_path[path]}"})
            continue
        hits, ok = 0, True
        all_vals: list[str] = []
        for it in items:
            try:
                vals = _leaf_values(jsonpath(it["json"], path))
            except Exception:  # noqa: BLE001
                ok = False
                break
            if vals:
                hits += 1
                all_vals.extend(vals[:3])
        if not ok:
            dropped.append({**f, "why": "path not supported"})
            continue
        if hits < need:
            dropped.append({**f, "why": f"value on {hits} of {len(items)} profiles"})
            continue
        if not _plausible(fid, all_vals):
            dropped.append({**f, "why": "values do not look like this field"})
            continue
        fields[fid] = path
        used_path[path] = fid
        fill[fid] = _js_round2(hits / max(1, len(items)))
    per = [len(json_values(it["json"], fields)) for it in items]
    srt = sorted(per)
    median = srt[len(srt) // 2] if srt else 0
    mh = (
        sum(1 for it in items if must_have(json_values(it["json"], fields))) / len(items)
        if items else 0
    )
    out: dict[str, Any] = {
        "fields": fields, "per_item": per, "median": median, "items": len(items),
        "must_have_share": _js_round2(mh), "dropped": dropped, "fill": fill,
    }
    if items:
        out["sample"] = _trim_json(items[0]["json"])
    return out


def json_values(js: Any, fields: dict[str, str]) -> dict[str, Any]:
    """Field values of one profile API response with a learned JSON field map."""
    jsonpath = _mod("agent_engine").jsonpath
    field_type = _mod("site_contract").field_type
    v: dict[str, Any] = {}
    for fid, path in (fields or {}).items():
        if re.search(r"\.profile_url$", fid):
            continue
        try:
            vals = _leaf_values(jsonpath(js, path))
            # A [*] path can give several values; only list fields keep them all.
            if vals:
                v[fid] = vals[0] if len(vals) == 1 or field_type(fid) != "list" else vals
        except Exception:  # noqa: BLE001, S112
            continue
    return v


def fetch_detail_for(api: dict, profile_url: str, timeout_ms: float) -> dict:
    """The profile API call for one profile URL, fetched and checked. Returns {json?, why, api_url?}."""
    call = build_detail_call(api, profile_url)
    if not call:
        return {"why": "profile id / slug not found in the URL"}
    r = _fetch(api, call, timeout_ms)
    if not r.get("ok") or not r.get("content"):
        why = r.get("status_code") or r.get("error") or "no response"
        return {"why": f"api call failed ({why})", "api_url": call["url"]}
    js = _parse_json_loose(r["content"])
    if js is None:
        return {"why": "api reply is not JSON", "api_url": call["url"]}
    if not _holds(r["content"], profile_tokens(profile_url)):
        return {"why": "api reply without this profile's id or name", "api_url": call["url"]}
    return {"json": js, "why": "ok", "api_url": call["url"]}
