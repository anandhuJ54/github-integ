"""Network route (port of `-disco-network-route.ts`, route-based mapper step 5, 2026-10-07).

Pure helpers (no network, no DB) used by the site mapper to find a background call (XHR /
fetch) that lists profile pages, and how it pages. Everything here is evidence from the
captured calls themselves:

- a call counts only when its response holds >= 3 profile links that match the run's
  code-built profile rule (or IDs that build such links, which the caller must still prove
  with the normal profile-page check);
- paging comes from the call's own query / body (preferably from two captured calls to the
  same endpoint that differ only in a page/offset value);
- the caller proves paging by replaying the next call and finding new profiles.

No AI is used. Cookies and login/session headers are never kept. Result dicts keep the TS keys
(they are stored as JSON); a ParamRef omits `param` when the TS left it undefined.
"""
from __future__ import annotations

import base64
import json
import math
import re
from collections.abc import Callable
from typing import Any

from _base.disco.agent_engine import (
    JsUrl,
    decode_uri_component,
    encode_uri_component,
    form_set,
    is_num,
    js_str,
    json_stringify,
    nfkd_strip_marks,
    parse_form,
    serialize_form,
    try_url,
)

Matches = Callable[[str], bool]


def normalize_captured_calls(content: Any) -> list[dict]:
    """Oxylabs returns captured calls as `content` (an array) or `content.xhr`; accept both."""
    c = content
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except (ValueError, RecursionError):
            return []
    if isinstance(c, dict) and isinstance(c.get("xhr"), list):
        c = c["xhr"]
    if not isinstance(c, list):
        return []
    out: list[dict] = []
    for x in c:
        if not isinstance(x, dict):
            continue
        url = x["url"] if isinstance(x.get("url"), str) else ""
        if not re.match(r"^https?://", url, re.IGNORECASE):
            continue
        hdrs: dict[str, str] = {}
        rh = x.get("request_headers")
        if isinstance(rh, dict):
            for k, v in rh.items():
                if isinstance(v, str) or is_num(v):
                    hdrs[str(k).lower()] = js_str(v)
        body = x.get("response_body")
        payload = x.get("request_payload")
        method = x.get("method")
        out.append({
            "url": url,
            "method": js_str(method if method is not None else "GET").upper(),
            "status_code": x["status_code"] if is_num(x.get("status_code")) else None,
            "request_headers": hdrs,
            "request_payload": payload if isinstance(payload, str)
            else None if payload is None else json_stringify(payload),
            "response_body": body if isinstance(body, str)
            else None if body is None else json_stringify(body),
        })
    return out


_XSSI = re.compile(r"^\)\]\}',?\s*")
_FOR_LOOP = re.compile(r"^for\s*\(;;\);\s*")
_B64 = re.compile(r"^[A-Za-z0-9+/=\s]+\Z")


def parse_json_loose(s: str | None) -> Any:
    """JSON body of a response (None = not JSON); tolerates an anti-XSSI prefix and base64."""
    if s is None:
        return None
    t = _FOR_LOOP.sub("", _XSSI.sub("", s.strip()), count=1)
    if not t:
        return None
    if t[0] not in "{[" and _B64.match(t) and len(t) % 4 == 0:
        try:
            t = base64.b64decode(re.sub(r"\s+", "", t)).decode("utf-8", "replace").strip()
        except ValueError:
            return None
    if not t or t[0] not in "{[":
        return None
    try:
        return json.loads(t)
    except (ValueError, RecursionError):
        return None


_WALK_MAX = 200_000


def _walk_leaves(js: Any, max_depth: int = 25) -> list[dict]:
    """Every primitive value with its generalised path (array indexes written as [])."""
    out: list[dict] = []
    stack: list[tuple[Any, str, str, int]] = [(js, "$", "", 0)]
    n = 0
    while stack and n < _WALK_MAX:
        v, path, key, d = stack.pop()
        n += 1
        if not isinstance(v, (dict, list)):
            out.append({"path": path, "key": key, "value": v})
            continue
        if d >= max_depth:
            continue
        if isinstance(v, list):
            for i in range(len(v) - 1, -1, -1):
                stack.append((v[i], f"{path}[]", key, d + 1))
        else:
            entries = list(v.items())
            for i in range(len(entries) - 1, -1, -1):
                k, x = entries[i]
                stack.append((x, f"{path}.{k}", k, d + 1))
    return out


def _abs_url(s: str, base: str) -> str | None:
    t = s.strip()
    if not t or len(t) > 2000:
        return None
    if not re.match(r"^https?://", t, re.IGNORECASE) and not (
        t.startswith("/") and not t.startswith("//")
    ):
        return None
    u = try_url(t, base)
    if not u:
        return None
    u.hash = ""
    return u.href


def profile_urls_in_json(js: Any, page_url: str, matches: Matches) -> dict[str, Any]:
    """Profile links in a JSON response that match the run's profile rule, and where they sit."""
    by_path: dict[str, dict[str, None]] = {}
    for leaf in _walk_leaves(js):
        if not isinstance(leaf["value"], str):
            continue
        u = _abs_url(leaf["value"], page_url)
        if not u:
            continue
        hit = u if matches(u) else None
        if not hit:
            x = try_url(u)
            if x:
                x.search = ""
                y = x.href
                if matches(y):
                    hit = y
        if not hit:
            continue
        by_path.setdefault(leaf["path"], {})[hit] = None
    all_urls: dict[str, None] = {}
    for s in by_path.values():
        all_urls.update(s)
    best = sorted(by_path.items(), key=lambda kv: -len(kv[1]))
    return {"urls": list(all_urls), "path": best[0][0] if best else None}


_ID_VALUE = re.compile(r"^[A-Za-z0-9._~%-]+\Z")


def _leaf_str(v: Any) -> str | None:
    return js_str(v).strip() if isinstance(v, str) or is_num(v) else None


def id_template_hits(js: Any, known_profile_urls: list[str], matches: Matches) -> dict | None:
    """Profile IDs that build profile links (field repeated across one array's objects).

    Evidence level: `known_match` when a built link equals a profile link the run already saw;
    otherwise the caller must prove one built link with the profile-page check.
    """
    templates: dict[str, None] = {}
    for k in known_profile_urls[:20]:
        u = try_url(k)
        if not u:
            continue
        u.search = ""
        u.hash = ""
        segs = u.pathname.split("/")
        for i, seg in enumerate(segs):
            if not seg:
                continue
            t = list(segs)
            t[i] = "{v}"
            templates[f"{u.origin}{'/'.join(t)}"] = None
    if not templates:
        return None
    known = {re.sub(r"/+$", "", re.sub(r"[?#].*$", "", u)).lower() for u in known_profile_urls}
    by_path: dict[str, list[str]] = {}
    for leaf in _walk_leaves(js):
        if "[]" not in leaf["path"]:
            continue
        v = _leaf_str(leaf["value"])
        if not v or len(v) > 120 or not _ID_VALUE.match(v):
            continue
        by_path.setdefault(leaf["path"], []).append(v)
    best: dict | None = None
    for path, vals in by_path.items():
        distinct = list(dict.fromkeys(vals))
        if len(distinct) < 3 or len(distinct) < len(vals) * 0.9:
            continue
        for t in templates:
            built = [t.replace("{v}", encode_uri_component(v), 1) for v in distinct]
            ok = [u for u in built if matches(u) or matches(f"{u}/")]
            if len(ok) < 3 or len(ok) < len(built) * 0.8:
                continue
            known_match = any(re.sub(r"/+$", "", u).lower() in known for u in ok)
            cand = {"field_path": path, "template": t, "urls": ok, "known_match": known_match}
            if (not best or (known_match and not best["known_match"])
                    or (known_match == best["known_match"] and len(ok) > len(best["urls"]))):
                best = cand
    return best


def id_urls_at(js: Any, field_path: str, template: str, matches: Matches) -> list[str]:
    """Profile links built from the ID field found by id_template_hits."""
    out: dict[str, None] = {}
    for leaf in _walk_leaves(js):
        if leaf["path"] != field_path:
            continue
        v = _leaf_str(leaf["value"])
        if not v or not _ID_VALUE.match(v):
            continue
        u = template.replace("{v}", encode_uri_component(v), 1)
        if matches(u) or matches(f"{u}/"):
            out[u] = None
    return list(out)


# ---- profile links built from a record's own fields (2026-10-07) ------------------------------
def _record_arrays(js: Any, min_items: int = 3) -> list[dict]:
    out: list[dict] = []
    stack: list[tuple[Any, str, int]] = [(js, "$", 0)]
    n = 0
    while stack and n < 50_000:
        v, path, d = stack.pop()
        n += 1
        if not isinstance(v, (dict, list)) or d > 12:
            continue
        if isinstance(v, list):
            objs = [x for x in v if isinstance(x, dict)]
            if len(objs) >= min_items and len(objs) >= len(v) * 0.8:
                out.append({"path": f"{path}[]", "items": objs})
            for x in v[:3]:
                stack.append((x, f"{path}[]", d + 1))
        else:
            for k, x in v.items():
                stack.append((x, f"{path}.{k}", d + 1))
    return out


def _record_fields(r: dict, prefix: str = "", out: list | None = None,
                   depth: int = 0) -> list[tuple[str, str]]:
    """Primitive fields of one record (nested objects flattened with dots; arrays skipped)."""
    if out is None:
        out = []
    if depth > 3:
        return out
    for k, v in r.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            _record_fields(v, key, out, depth + 1)
        elif isinstance(v, str) or is_num(v):
            t = js_str(v).strip()
            if t and len(t) <= 120:
                out.append((key, t))
    return out


def slugify(v: str, drop_apostrophes: bool = True) -> str:
    t = nfkd_strip_marks(v).lower()
    if drop_apostrophes:
        t = re.sub(r"['’`]", "", t)
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", t))


def _field_value(r: dict, path: str) -> str | None:
    v: Any = r
    for k in path.split("."):
        if not isinstance(v, (dict, list)):
            return None
        v = v.get(k) if isinstance(v, dict) else None
    return js_str(v).strip() if isinstance(v, str) or is_num(v) else None


def build_from_template(t: dict, r: dict) -> str | None:
    segs: list[str] = []
    for p in t["parts"]:
        if "lit" in p:
            segs.append(p["lit"])
            continue
        v = _field_value(r, p["field"])
        if not v:
            return None
        s = encode_uri_component(v) if p["mode"] == "raw" else slugify(v, p["mode"] == "slug")
        if not s:
            return None
        segs.append(s)
    return f"{t['origin']}/{'/'.join(segs)}{'/' if t['trailingSlash'] else ''}"


def template_label(t: dict) -> str:
    parts = [p["lit"] if "lit" in p else f"{{{'' if p['mode'] == 'raw' else 'slug:'}{p['field']}}}"
             for p in t["parts"]]
    return f"{t['origin']}/{'/'.join(parts)}{'/' if t['trailingSlash'] else ''}"


def record_template_hits(js: Any, known_profile_urls: list[str], matches: Matches) -> dict | None:
    """Learn a record template from a record whose profile URL is known; apply it to all."""
    known: list[dict] = []
    for k in known_profile_urls[:300]:
        u = try_url(k)
        if not u:
            continue
        try:
            segs = [decode_uri_component(x).lower() for x in u.pathname.split("/") if x]
        except ValueError:
            continue
        if segs:
            known.append({"origin": u.origin, "segs": segs, "slash": u.pathname.endswith("/")})
    if not known:
        return None
    # A part may stay literal only when it is a site section: the same value at that position in
    # at least half of the known profile URLs with the same number of parts (e.g. "agent").
    pos_count: dict[str, int] = {}
    len_count: dict[int, int] = {}
    for k in known:
        n = len(k["segs"])
        len_count[n] = len_count.get(n, 0) + 1
        for i, seg in enumerate(k["segs"]):
            key = f"{n}|{i}|{seg}"
            pos_count[key] = pos_count.get(key, 0) + 1

    def is_section(n: int, i: int, seg: str) -> bool:
        return (len_count.get(n, 0) >= 2
                and pos_count.get(f"{n}|{i}|{seg}", 0) >= len_count.get(n, 0) * 0.5)

    best: dict | None = None
    for arr in _record_arrays(js):
        learned: dict[str, dict] = {}
        for r in arr["items"][:100]:
            fields = _record_fields(r)
            if not fields:
                continue
            for k in known:
                mapped = 0
                id_like = False
                parts: list[dict] = []
                for seg in k["segs"]:
                    part = None
                    for f, v in fields:
                        if v.lower() == seg:
                            mapped += 1
                            if re.search(r"\d", v):
                                id_like = True
                            part = {"field": f, "mode": "raw"}
                            break
                    if part is None:
                        for f, v in fields:
                            if slugify(v, True) == seg:
                                mapped += 1
                                part = {"field": f, "mode": "slug"}
                                break
                            if slugify(v, False) == seg:
                                mapped += 1
                                part = {"field": f, "mode": "slug2"}
                                break
                    parts.append(part if part is not None else {"lit": seg})
                # The record must explain the profile-specific part: at least one id-like value,
                # and no segment left literal that looks like it belongs to one person.
                if not mapped or not id_like:
                    continue
                n = len(k["segs"])
                if any("lit" in p and not is_section(n, i, p["lit"]) for i, p in enumerate(parts)):
                    continue
                t = {"origin": k["origin"], "parts": parts, "trailingSlash": k["slash"]}
                learned[template_label(t)] = t
        for label, t in learned.items():
            built = [u for u in (build_from_template(t, r) for r in arr["items"]) if u]
            ok = list(dict.fromkeys(u for u in built if matches(u)))
            if len(ok) < 3 or len(ok) < len(arr["items"]) * 0.8:
                continue
            if not best or len(ok) > len(best["urls"]):
                best = {"array_path": arr["path"], "template": t, "label": label, "urls": ok}
    return best


def record_urls_at(js: Any, array_path: str, t: dict, matches: Matches) -> list[str]:
    """Profile links from a response using a learned record template (same array path)."""
    arr = next((a for a in _record_arrays(js, 1) if a["path"] == array_path), None)
    if not arr:
        return []
    built = (build_from_template(t, r) for r in arr["items"])
    return list(dict.fromkeys(u for u in built if u and matches(u)))


# ---- paging ------------------------------------------------------------------------------------
_PAGE_KEY_RE = re.compile(
    r"^(page|pagenum|pagenumber|page_number|pageno|page_no|pg|p|currentpage|current_page"
    r"|pageindex|page_index)\Z", re.IGNORECASE)
_OFFSET_KEY_RE = re.compile(
    r"^(offset|start|from|skip|startindex|start_index|startrow|start_row)\Z", re.IGNORECASE)
# Fix (numeric cursor offsets, 2026-10-07): a numeric value in a cursor-named field is an offset.
_CURSOR_NUM_KEY_RE = re.compile(
    r"^(after|cursor|startafter|start_after|searchafter|search_after|skiptoken|skip_token)\Z",
    re.IGNORECASE)
_SIZE_KEY_RE = re.compile(
    r"^(size|pagesize|page_size|limit|rows|perpage|per_page|hitsperpage|hits_per_page"
    r"|resultsperpage|results_per_page|take|first|count|num)\Z", re.IGNORECASE)
_TOTAL_KEY_RE = re.compile(
    r"^(total|numfound|num_found|nbhits|nb_hits|(total|num|result|results|hit|hits|record|records"
    r"|item|items|match|matches)_?(count|total|results|hits|records|items|matches|size|elements"
    r"|resultcount|result_count|resultscount|results_count))\Z", re.IGNORECASE)
_TOTAL_PAGES_KEY_RE = re.compile(
    r"^(totalpages|total_pages|nbpages|pagecount|page_count|numpages|num_pages|lastpage"
    r"|last_page)\Z", re.IGNORECASE)
_OP_KEY_RE = re.compile(r"^(operationname|operation|query|queryid|queryname|op|action)\Z",
                        re.IGNORECASE)
_FORM_BODY = re.compile(r"^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*\Z")


def _ref(where: str, param: str | None, path: list[str]) -> dict:
    r: dict[str, Any] = {"where": where}
    if param is not None:
        r["param"] = param
    r["path"] = path
    return r


def _flat_json(obj: Any, where: str, param: str | None, path: list[str] | None = None,
               out: list[dict] | None = None, depth: int = 0) -> list[dict]:
    if out is None:
        out = []
    path = path or []
    if depth > 12 or obj is None or not isinstance(obj, dict):
        return out  # paging values do not live inside arrays
    for k, v in obj.items():
        p = [*path, k]
        if isinstance(v, (dict, list)):
            _flat_json(v, where, param, p, out, depth + 1)
        else:
            out.append({"ref": _ref(where, param, p), "name": k, "value": v})
    return out


def call_params(call: dict) -> list[dict]:
    """Every request parameter of a call: query values (and JSON inside one) and body fields."""
    out: list[dict] = []
    u = try_url(call.get("url"))
    if u:
        for k, v in u.params():
            j = parse_json_loose(v) if v.strip().startswith("{") else None
            if isinstance(j, (dict, list)):
                _flat_json(j, "query_json", k, [], out)
            else:
                out.append({"ref": _ref("query", None, [k]), "name": k, "value": v})
    body = call.get("request_payload")
    if body and body.strip():
        j = parse_json_loose(body)
        if isinstance(j, (dict, list)):
            _flat_json(j, "body_json", None, [], out)
        elif _FORM_BODY.match(body.strip()):
            for k, v in parse_form(body.strip()):
                out.append({"ref": _ref("body_form", None, [k]), "name": k, "value": v})
    return out


def _ref_key(r: dict) -> str:
    return f"{r['where']}|{r.get('param') or ''}|{'.'.join(r['path'])}"


def _num(v: Any) -> int | float | None:
    if is_num(v) and math.isfinite(v):
        return v
    if isinstance(v, str) and re.match(r"^\d{1,7}\Z", v.strip()):
        return int(v.strip())
    return None


def endpoint_key(c: dict) -> str:
    u = try_url(c.get("url"))
    if u:
        return f"{js_str(c.get('method')).upper()} {u.origin}{u.pathname}"
    return f"{c.get('method')} {c.get('url')}"


def _size_from(params: list[dict]) -> int | float | None:
    for f in params:
        if _SIZE_KEY_RE.match(f["name"]):
            n = _num(f["value"])
            if n and 0 < n <= 1000:
                return n
    return None


def paging_from_two_calls(a: dict, b: dict) -> dict | None:
    """Paging from two captured calls to one endpoint that differ only in one numeric value."""
    if endpoint_key(a) != endpoint_key(b):
        return None
    pa = call_params(a)
    pb = {_ref_key(f["ref"]): f for f in call_params(b)}
    diffs: list[tuple[dict, Any, Any]] = []
    other_diff = 0
    for f in pa:
        g = pb.get(_ref_key(f["ref"]))
        if not g:
            continue
        if js_str(f["value"]) == js_str(g["value"]):
            continue
        # A different operation on a shared endpoint (GraphQL operationName / query) is not page 2.
        if _OP_KEY_RE.match(f["name"]):
            return None
        va, vb = _num(f["value"]), _num(g["value"])
        if va is not None and vb is not None:
            diffs.append((f, va, vb))
        else:
            other_diff += 1
    # also a page key present only in the second call (page 1 often sends none)
    if not diffs:
        a_keys = {_ref_key(f["ref"]) for f in pa}
        for g in pb.values():
            if _ref_key(g["ref"]) in a_keys:
                continue
            vb = _num(g["value"])
            if vb is None:
                continue
            if _PAGE_KEY_RE.match(g["name"]) and vb == 2:
                diffs.append((g, 1, 2))
            elif vb > 0 and (_OFFSET_KEY_RE.match(g["name"])
                             or _CURSOR_NUM_KEY_RE.match(g["name"])):
                diffs.append((g, 0, vb))
    if len(diffs) != 1 or other_diff > 2:
        return None
    f, va, vb = diffs[0]
    if vb <= va:
        return None
    is_offset = bool(_OFFSET_KEY_RE.match(f["name"]) or _CURSOR_NUM_KEY_RE.match(f["name"])
                     or vb - va > 1)
    size = _size_from(pa)
    return {
        "kind": "offset" if is_offset else "page", "key": f["ref"], "key_name": f["name"],
        "current": vb, "step": vb - va,
        "page_size": size if size is not None else (vb - va if is_offset else None),
        "found_by": "two_captured_calls",
    }


def paging_from_params(call: dict, items_on_page: int) -> dict | None:
    """Paging from a page / offset parameter the call itself sends (no guessing)."""
    params = call_params(call)
    size = _size_from(params)
    for f in params:
        if not _PAGE_KEY_RE.match(f["name"]):
            continue
        n = _num(f["value"])
        if n is None or n > 10_000:
            continue
        return {"kind": "page", "key": f["ref"], "key_name": f["name"], "current": n, "step": 1,
                "page_size": size, "found_by": "parameter_name"}
    for f in params:
        if not _OFFSET_KEY_RE.match(f["name"]) and not _CURSOR_NUM_KEY_RE.match(f["name"]):
            continue
        n = _num(f["value"])
        if n is None:
            continue
        step = size if size is not None else items_on_page
        if not step:
            continue
        return {"kind": "offset", "key": f["ref"], "key_name": f["name"], "current": n,
                "step": step, "page_size": size if size is not None else items_on_page,
                "found_by": "parameter_name"}
    return None


def totals_in_json(js: Any, items_on_page: int) -> dict[str, Any]:
    """Total results / total pages the response states, if any."""
    total = total_key = pages = None
    for leaf in _walk_leaves(js, 5):
        if "[]" in leaf["path"]:
            continue
        n = _num(leaf["value"])
        if n is None:
            continue
        key = ("total" if leaf["key"] == "value"
               and re.search(r"\.total\.value\Z", leaf["path"], re.IGNORECASE) else leaf["key"])
        if _TOTAL_KEY_RE.match(key) and n > items_on_page and (total is None or n > total):
            total, total_key = n, leaf["path"]
        elif _TOTAL_PAGES_KEY_RE.match(key) and n >= 1 and (pages is None or n > pages):
            pages = n
    return {"total": total, "total_key": total_key, "total_pages": pages}


def _set_in(obj: Any, path: list[str], value: Any) -> None:
    o = obj
    for k in path[:-1]:
        nxt = o.get(k) if isinstance(o, dict) else None
        if not isinstance(nxt, (dict, list)):
            return
        o = nxt
    if not isinstance(o, dict):
        return
    last = path[-1]
    o[last] = js_str(value) if isinstance(o.get(last), str) else value


def call_with_page(call: dict, key: dict, value: Any) -> dict | None:
    """The call with its paging value set to `value` (same method, headers and other fields)."""
    try:
        u = JsUrl(call.get("url"))
    except ValueError:
        return None
    body = call.get("request_payload")
    where = key.get("where")
    path = key.get("path") or []
    if where == "query":
        u.set_param(path[0], js_str(value))
    elif where == "query_json" and key.get("param"):
        got = u.get_param(key["param"])
        j = parse_json_loose(got if got is not None else "")
        if not isinstance(j, (dict, list)):
            return None
        _set_in(j, path, value)
        u.set_param(key["param"], json_stringify(j))
    elif where == "body_json":
        j = parse_json_loose(body or "")
        if not isinstance(j, (dict, list)):
            return None
        _set_in(j, path, value)
        body = json_stringify(j)
    elif where == "body_form":
        body = serialize_form(form_set(parse_form(body or ""), path[0], js_str(value)))
    return {"url": u.href, "body": body}


_DROP_HEADER = re.compile(
    r"^(cookie|authorization|proxy-authorization|host|content-length|accept-encoding|connection"
    r"|user-agent|upgrade-insecure-requests|priority|te)\Z")
_SECRET_HEADER = re.compile(r"token|session|csrf|xsrf|auth|cookie|bearer")


def replay_headers(h: dict[str, str]) -> dict[str, str]:
    """Headers safe to replay and store: no cookies, no login / session / token headers."""
    out: dict[str, str] = {}
    for k0, v in (h or {}).items():
        k = str(k0).lower()
        if k.startswith((":", "sec-")):
            continue
        if _DROP_HEADER.match(k) or _SECRET_HEADER.search(k):
            continue
        out[k] = v
    return out


# Fix (trackers dropped, 2026-10-07): analytics, ad, tag-manager, session-recording, consent,
# bot-detection / challenge and error-monitoring calls are never profile listings.
_NOISE_HOSTS = [
    # analytics, tags, ads, attribution
    r"google-analytics\.com", r"analytics\.google\.com", r"googletagmanager\.com",
    r"doubleclick\.net", r"googlesyndication\.com", r"googleadservices\.com",
    r"adservice\.google\.[a-z.]+", r"facebook\.(com|net)", r"fbcdn\.net", r"connect\.facebook",
    r"adsrvr\.org", r"criteo\.(com|net)", r"quantserve\.com", r"scorecardresearch\.com",
    r"taboola\.com", r"outbrain\.com", r"bing\.com", r"bat\.bing", r"clarity\.ms",
    r"tiktok\.com", r"analytics\.tiktok", r"snapchat\.com", r"sc-static\.net", r"licdn\.com",
    r"ads\.linkedin\.com", r"pinterest\.com", r"pinimg\.com", r"twitter\.com",
    r"ads-twitter\.com", r"reddit\.com", r"redditstatic\.com", r"yahoo\.com",
    r"amazon-adsystem\.com", r"adnxs\.com", r"rubiconproject\.com", r"pubmatic\.com",
    r"casalemedia\.com", r"demdex\.net", r"omtrdc\.net", r"everesttech\.net", r"agkn\.com",
    r"rlcdn\.com", r"bluekai\.com", r"krxd\.net", r"mathtag\.com", r"tapad\.com",
    r"adroll\.com", r"zemanta\.com", r"branch\.io", r"appsflyer\.com", r"adjust\.com",
    r"segment\.(io|com)", r"mixpanel\.com", r"amplitude\.com", r"heap(analytics)?\.(io|com)",
    r"fullstory\.com", r"hotjar\.(com|io)", r"mouseflow\.com", r"crazyegg\.com",
    r"quantummetric\.com", r"contentsquare\.net", r"glassboxdigital\.io", r"logrocket\.(com|io)",
    r"smartlook\.com", r"optimizely\.com", r"abtasty\.com", r"vwo\.com",
    r"visualwebsiteoptimizer\.com", r"kameleoon\.(com|eu)", r"launchdarkly\.com", r"split\.io",
    r"tealiumiq\.com", r"tiqcdn\.com", r"ensighten\.com", r"cdn\.mxpnl\.com",
    r"hs-analytics\.net", r"hubspot\.com", r"hsforms\.com", r"hs-scripts\.com",
    r"marketo\.(com|net)", r"mktoresp\.com", r"pardot\.com", r"salesforceliveagent\.com",
    r"intercom\.io", r"intercomcdn\.com", r"drift\.com", r"zendesk\.com", r"zdassets\.com",
    r"livechatinc\.com", r"qualtrics\.com", r"medallia\.com", r"usabilla\.com",
    # consent managers
    r"onetrust\.com", r"cookielaw\.org", r"cookiebot\.com", r"trustarc\.com", r"osano\.com",
    r"usercentrics\.eu", r"didomi\.io", r"termly\.io", r"consensu\.org", r"privacymanager\.io",
    r"evidon\.com", r"ketchjs\.com",
    # bot detection, challenges, fingerprinting
    r"px-cloud\.net", r"perimeterx\.net", r"px-cdn\.net", r"pxchk\.net", r"kasada\.io", r"kpsdk",
    r"datadome\.co", r"captcha-delivery\.com", r"incapsula\.com", r"imperva\.com",
    r"hcaptcha\.com", r"recaptcha\.net", r"arkoselabs\.com", r"funcaptcha\.com",
    r"fingerprint\.com", r"fpjs\.io", r"fpcdn\.io", r"distil(networks)?\.(com|net)",
    r"shapesecurity\.com", r"forter\.com", r"sift(science)?\.com", r"iesnare\.com",
    r"threatmetrix\.com", r"online-metrix\.net", r"challenges\.cloudflare\.com",
    r"cloudflareinsights\.com",
    # monitoring
    r"newrelic\.com", r"nr-data\.net", r"datadoghq\.(com|eu)", r"browser-intake-datadoghq",
    r"sentry\.io", r"sentry-cdn\.com", r"bugsnag\.com", r"rollbar\.com", r"trackjs\.com",
    r"raygun\.io", r"dynatrace\.com", r"akstat\.io", r"go-mpulse\.net", r"speedcurve\.com",
    r"elastic-apm",
    # maps, fonts, video, social widgets
    r"maps\.googleapis\.com", r"maps\.gstatic\.com", r"fonts\.googleapis\.com",
    r"fonts\.gstatic\.com", r"use\.typekit\.net", r"youtube\.com", r"ytimg\.com",
    r"vimeo\.com", r"vimeocdn\.com", r"wistia\.(com|net)", r"brightcove\.(com|net)",
]
_NOISE_HOST_RE = re.compile(r"(^|[./])(" + "|".join(_NOISE_HOSTS) + ")", re.IGNORECASE)
# Tracking-style paths on any host (including the site's own collectors and event endpoints).
_NOISE_PATH_RE = re.compile(
    r"/(collect|collector|collectors|events?|track|tracking|tracker|beacon|beacons|pixel|pixels"
    r"|telemetry|rum|metrics|analytics|log|logs|logging|ping|heartbeat|gen_204|generate_204"
    r"|impression|impressions|identify|batch|vitals|web-vitals|cdn-cgi|\.well-known)(/|\?|$|\.)",
    re.IGNORECASE,
)
_ASSET_RE = re.compile(
    r"\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|eot|ico|mp4|webm|mp3|m3u8|ts"
    r"|map)(\?|#|$)",
    re.IGNORECASE,
)


def noise_reason(url: str) -> str | None:
    u = try_url(url)
    if not u:
        return "bad url"
    if _NOISE_HOST_RE.search(u.host):
        return "tracker / third-party service"
    if _ASSET_RE.search(u.pathname):
        return "static asset"
    if _NOISE_PATH_RE.search(u.pathname):
        return "tracking-style path"
    return None


def is_noise_call(url: str) -> bool:
    return noise_reason(url) is not None
