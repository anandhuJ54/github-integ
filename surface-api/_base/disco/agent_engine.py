"""Crawler engine of site mapper version 2 (port of `-disco-agent-engine.ts`, 2026-10-09).

The no-AI part of version 2: runs a crawler config ("sources") and collects profile URLs. Used
while mapping to test a method on a small sample (test_source), to measure coverage
(coverage_check), to validate a submitted config, and by the list harvest (one list unit at a
time). The network layer is injected (`fetch`: a callable taking an EngineRequest dict and
returning an EngineResponse dict), so this module has no network or database code of its own.

Source types: sitemap, listing (page / offset / cursor / next_link paging, looped over seeds:
list, range, alphabet with automatic deepening, us_states, extract incl. dependent extract
seeds), link_crawl, autocomplete. Extractors: html (CSS with ::attr(x) / ::text), json
(JSONPath subset), embedded_json (script tag or regex), header.

Dict shapes keep the TS keys (they are stored as JSON and sent to the AI):
- EngineRequest: method, url, headers?, body?, render?, maxBytes?, timeoutMs
- EngineResponse: url, status, text, blocked, truncated, error?, ms
- Limits: workers, maxPages?, maxSeeds?, maxRequests?, deadline? (epoch ms), sitemapBytes?
- ListUnit: s, k ('root'|'combo'|'url'|'prefix'), c?, p?, u?, d?, x?

The module also carries the small JavaScript-semantics helpers (WHATWG-like URL, URLSearchParams
form encoding, `String(x)`, JS regex syntax) shared with `network_route` and the ETL ports.
"""
from __future__ import annotations

import contextvars
import json
import math
import re
import threading
import time
import unicodedata
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any
from urllib.parse import quote, unquote_to_bytes

from bs4 import BeautifulSoup, Tag

EngineFetch = Callable[[dict], dict]


# =============================================================================================
# JavaScript-semantics helpers
# =============================================================================================
def now_ms() -> float:
    return time.time() * 1000


def js_truthy(v: Any) -> bool:
    """JS truthiness: empty objects / arrays are truthy; 0, '', null, NaN, false are not."""
    if v is None or v is False:
        return False
    if isinstance(v, (dict, list, tuple)):
        return True
    if isinstance(v, float) and math.isnan(v):
        return False
    return bool(v)


def is_num(v: Any) -> bool:
    """`typeof v === 'number'` (booleans excluded)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def as_num(n: float) -> int | float:
    """Integral floats back to int, so str() / JSON output match JS numbers."""
    if isinstance(n, float) and math.isfinite(n) and n == int(n):
        return int(n)
    return n


def js_str(v: Any) -> str:
    """`String(v)`."""
    if v is None:
        return "null"
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        if math.isinf(v):
            return "Infinity" if v > 0 else "-Infinity"
        if v == int(v) and abs(v) < 1e21:
            return str(int(v))
        return repr(v)
    if isinstance(v, (list, tuple)):
        return ",".join("" if x is None else js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def js_number(v: Any) -> float:
    """`Number(v)` (None is treated as undefined: NaN)."""
    if v is None:
        return math.nan
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if is_num(v):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0.0
        try:
            return float(s)
        except ValueError:
            return math.nan
    return math.nan


def _u(v: Any) -> str:
    """`${v}` in a template literal (None is undefined)."""
    return "undefined" if v is None else js_str(v)


def num_or(v: Any, default: float) -> float:
    """`Number(v ?? default)`."""
    return js_number(default if v is None else v)


def json_stringify(v: Any) -> str:
    """`JSON.stringify(v)` (compact, non-ASCII kept)."""
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def error_message(e: BaseException) -> str:
    """`String(e?.message ?? e)`."""
    return str(e) or type(e).__name__


_NAMED_GROUP = re.compile(r"\(\?<(?![=!])")
_REGEX_CACHE: dict[tuple[str, int], re.Pattern] = {}


def js_re(pattern: Any, flags: str = "") -> re.Pattern:
    """`new RegExp(pattern, flags)`: JS named groups become Python's; i/s/m flags map over."""
    src = js_str(pattern)
    f = 0
    if "i" in flags:
        f |= re.IGNORECASE
    if "s" in flags:
        f |= re.DOTALL
    if "m" in flags:
        f |= re.MULTILINE
    key = (src, f)
    rx = _REGEX_CACHE.get(key)
    if rx is None:
        rx = re.compile(_NAMED_GROUP.sub("(?P<", src), f)
        if len(_REGEX_CACHE) < 2000:
            _REGEX_CACHE[key] = rx
    return rx


def group1_or_0(m: re.Match) -> str:
    """`m[1] ?? m[0]`."""
    if m.re.groups >= 1 and m.group(1) is not None:
        return m.group(1)
    return m.group(0)


def encode_uri_component(s: str) -> str:
    return quote(s, safe="-_.!~*'()")


def decode_uri_component(s: str) -> str:
    """`decodeURIComponent` (raises ValueError on malformed input, like URIError)."""
    if re.search(r"%(?![0-9A-Fa-f]{2})", s):
        raise ValueError("URI malformed")
    try:
        return unquote_to_bytes(s).decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError("URI malformed") from e


def form_encode(s: str) -> str:
    """application/x-www-form-urlencoded byte serializer (URLSearchParams.toString)."""
    out: list[str] = []
    for b in s.encode("utf-8", "surrogatepass"):
        c = chr(b)
        if b < 0x80 and (c.isalnum() or c in "*-._"):
            out.append(c)
        elif c == " ":
            out.append("+")
        else:
            out.append(f"%{b:02X}")
    return "".join(out)


def form_decode(s: str) -> str:
    return unquote_to_bytes(s.replace("+", " ")).decode("utf-8", "replace")


def parse_form(s: str) -> list[tuple[str, str]]:
    """`new URLSearchParams(s)` entries."""
    s = s.removeprefix("?")
    out: list[tuple[str, str]] = []
    for part in s.split("&"):
        if not part:
            continue
        k, _, v = part.partition("=")
        out.append((form_decode(k), form_decode(v)))
    return out


def serialize_form(pairs: Iterable[tuple[str, str]]) -> str:
    return "&".join(f"{form_encode(k)}={form_encode(v)}" for k, v in pairs)


def form_set(pairs: list[tuple[str, str]], name: str, value: str) -> list[tuple[str, str]]:
    """URLSearchParams.set: replace the first pair named `name`, drop the others (or append)."""
    out: list[tuple[str, str]] = []
    done = False
    for k, v in pairs:
        if k == name:
            if not done:
                out.append((k, value))
                done = True
            continue
        out.append((k, v))
    if not done:
        out.append((name, value))
    return out


def url_search_params(obj: Any) -> str:
    """`new URLSearchParams(obj).toString()` for a string or a plain object."""
    if isinstance(obj, str):
        return serialize_form(parse_form(obj))
    if isinstance(obj, dict):
        return serialize_form((str(k), js_str(v)) for k, v in obj.items())
    return ""


# ---- WHATWG-like URL --------------------------------------------------------------------
_SPECIAL_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443", "ftp": "21"}
_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
_PATH_ENC = set(' "#<>?`{}')
_QUERY_ENC = set(" \"#<>'")
_FRAG_ENC = set(' "<>`')
_STRIP = "".join(chr(i) for i in range(0x21))


def _pct(s: str, enc: set[str]) -> str:
    out: list[str] = []
    for ch in s:
        o = ord(ch)
        if o <= 0x20 or o >= 0x7F or ch in enc:
            out.append("".join(f"%{b:02X}" for b in ch.encode("utf-8", "surrogatepass")))
        else:
            out.append(ch)
    return "".join(out)


def _remove_dots(path: str) -> str:
    segs = path.split("/")
    out: list[str] = []
    for i, seg in enumerate(segs):
        low = seg.lower()
        last = i == len(segs) - 1
        if low in (".", "%2e"):
            if last:
                out.append("")
            continue
        if low in ("..", ".%2e", "%2e.", "%2e%2e"):
            if len(out) > 1:
                out.pop()
            if last:
                out.append("")
            continue
        out.append(seg)
    res = "/".join(out)
    return res if res.startswith("/") else "/" + res


class JsUrl:
    """Small WHATWG `URL` work-alike: http(s) resolution, normalisation, searchParams."""

    scheme: str
    special: bool
    username: str
    password: str
    hostname: str
    port: str
    path: str
    query: str | None
    fragment: str | None

    def __init__(self, url: Any, base: Any = None) -> None:
        if url is None:
            raise ValueError("Invalid URL")
        s = str(url).strip(_STRIP)
        s = re.sub(r"[\t\n\r]", "", s)
        b = None if base is None else (base if isinstance(base, JsUrl) else JsUrl(base))
        m = _SCHEME_RE.match(s)
        if m:
            self._absolute(s, m.group(1).lower())
            return
        if b is None or not b.special:
            raise ValueError("Invalid URL")
        self._resolve(s, b)

    def _absolute(self, s: str, scheme: str) -> None:
        self.scheme = scheme
        rest = s[len(scheme) + 1:]
        self.username = self.password = self.hostname = self.port = ""
        if scheme not in _SPECIAL_PORTS:
            self.special = False
            frag = query = None
            if "#" in rest:
                rest, frag = rest.split("#", 1)
            if "?" in rest:
                rest, query = rest.split("?", 1)
            self.path, self.query, self.fragment = rest, query, frag
            return
        self.special = True
        rest = rest.replace("\\", "/")
        self._authority_and_rest(rest.lstrip("/"))

    def _authority_and_rest(self, s: str) -> None:
        end = len(s)
        for ch in "/?#":
            i = s.find(ch)
            if 0 <= i < end:
                end = i
        self._authority(s[:end])
        self._tail(s[end:])

    def _authority(self, auth: str) -> None:
        self.username = self.password = ""
        if "@" in auth:
            userinfo, auth = auth.rsplit("@", 1)
            self.username, _, self.password = userinfo.partition(":")
        port = ""
        if auth.startswith("["):
            close = auth.find("]")
            host, rest = auth[: close + 1], auth[close + 1:]
            if rest.startswith(":"):
                port = rest[1:]
        elif ":" in auth:
            host, port = auth.rsplit(":", 1)
        else:
            host = auth
        try:
            host = unquote_to_bytes(host).decode("utf-8").lower()
        except UnicodeDecodeError as e:
            raise ValueError("Invalid URL") from e
        if not host:
            raise ValueError("Invalid URL")
        if not (host.startswith("[") and host.endswith("]")) and re.search(
            r"[\x00-\x20#/:<>?@\[\\\]^|%]", host
        ):
            raise ValueError("Invalid URL")
        if any(ord(c) > 0x7F for c in host):
            try:
                host = host.encode("idna").decode("ascii")
            except UnicodeError as e:
                raise ValueError("Invalid URL") from e
        if port:
            if not port.isdigit() or int(port) > 65535:
                raise ValueError("Invalid URL")
            port = str(int(port))
        if port == _SPECIAL_PORTS.get(self.scheme):
            port = ""
        self.hostname, self.port = host, port

    def _tail(self, tail: str) -> None:
        frag = query = None
        if "#" in tail:
            tail, frag = tail.split("#", 1)
        if "?" in tail:
            tail, query = tail.split("?", 1)
        self.path = _pct(_remove_dots(tail or "/"), _PATH_ENC)
        self.query = None if query is None else _pct(query, _QUERY_ENC)
        self.fragment = None if frag is None else _pct(frag, _FRAG_ENC)

    def _resolve(self, s: str, b: JsUrl) -> None:
        self.scheme, self.special = b.scheme, True
        s = s.replace("\\", "/")
        if s.startswith("//"):
            self._authority_and_rest(s[2:].lstrip("/"))
            return
        self.username, self.password = b.username, b.password
        self.hostname, self.port = b.hostname, b.port
        if s == "":
            self.path, self.query, self.fragment = b.path, b.query, None
        elif s.startswith("#"):
            self.path, self.query, self.fragment = b.path, b.query, _pct(s[1:], _FRAG_ENC)
        elif s.startswith("?"):
            q, frag = s[1:], None
            if "#" in q:
                q, frag = q.split("#", 1)
            self.path = b.path
            self.query = _pct(q, _QUERY_ENC)
            self.fragment = None if frag is None else _pct(frag, _FRAG_ENC)
        elif s.startswith("/"):
            self._tail(s)
        else:
            self._tail(b.path[: b.path.rfind("/") + 1] + s)

    # -- accessors ---------------------------------------------------------------------------
    @property
    def host(self) -> str:
        return self.hostname + (":" + self.port if self.port else "")

    @property
    def pathname(self) -> str:
        return self.path

    @property
    def origin(self) -> str:
        return f"{self.scheme}://{self.host}" if self.special else "null"

    @property
    def search(self) -> str:
        return "?" + self.query if self.query else ""

    @search.setter
    def search(self, value: str) -> None:
        v = value.removeprefix("?")
        self.query = _pct(v, _QUERY_ENC) if v else None

    @property
    def hash(self) -> str:
        return "#" + self.fragment if self.fragment else ""

    @hash.setter
    def hash(self, value: str) -> None:
        v = value.removeprefix("#")
        self.fragment = _pct(v, _FRAG_ENC) if v else None

    @property
    def href(self) -> str:
        if not self.special:
            out = f"{self.scheme}:{self.path}"
        else:
            cred = ""
            if self.username or self.password:
                cred = self.username + (":" + self.password if self.password else "") + "@"
            out = f"{self.scheme}://{cred}{self.host}{self.path}"
        if self.query is not None:
            out += "?" + self.query
        if self.fragment is not None:
            out += "#" + self.fragment
        return out

    def __str__(self) -> str:
        return self.href

    # -- searchParams ------------------------------------------------------------------------
    def params(self) -> list[tuple[str, str]]:
        return parse_form(self.query or "")

    def get_param(self, name: str) -> str | None:
        for k, v in self.params():
            if k == name:
                return v
        return None

    def set_param(self, name: str, value: str) -> None:
        ser = serialize_form(form_set(self.params(), name, value))
        self.query = ser or None


def try_url(url: Any, base: Any = None) -> JsUrl | None:
    try:
        return JsUrl(url, base)
    except (ValueError, UnicodeError, TypeError):
        return None


class OrderedSet:
    """A JS `Set` of strings: insertion-ordered, thread-safe adds."""

    def __init__(self, items: Iterable[str] = ()) -> None:
        self._d: dict[str, None] = dict.fromkeys(items)
        self._lock = threading.Lock()

    def add(self, v: str) -> None:
        with self._lock:
            self._d[v] = None

    def __contains__(self, v: object) -> bool:
        return v in self._d

    def __iter__(self) -> Iterator[str]:
        return iter(list(self._d))

    def __len__(self) -> int:
        return len(self._d)

    @property
    def size(self) -> int:
        return len(self._d)


# =============================================================================================
# The engine
# =============================================================================================
SOURCE_TYPES = ("listing", "sitemap", "autocomplete", "link_crawl")
LOC_RE = re.compile(
    r"<loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*</loc>", re.IGNORECASE | re.DOTALL
)
_ID_SEGMENT = re.compile(
    r"^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f-]{27,}|\d+|(?=.*\d)[A-Za-z0-9_-]{16,})\Z",
    re.IGNORECASE | re.ASCII,
)
US_STATES: list[tuple[str, str]] = [
    ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"),
    ("CA", "California"), ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"),
    ("DC", "District of Columbia"), ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"),
    ("ID", "Idaho"), ("IL", "Illinois"), ("IN", "Indiana"), ("IA", "Iowa"), ("KS", "Kansas"),
    ("KY", "Kentucky"), ("LA", "Louisiana"), ("ME", "Maine"), ("MD", "Maryland"),
    ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"), ("MS", "Mississippi"),
    ("MO", "Missouri"), ("MT", "Montana"), ("NE", "Nebraska"), ("NV", "Nevada"),
    ("NH", "New Hampshire"), ("NJ", "New Jersey"), ("NM", "New Mexico"), ("NY", "New York"),
    ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"), ("OK", "Oklahoma"),
    ("OR", "Oregon"), ("PA", "Pennsylvania"), ("RI", "Rhode Island"), ("SC", "South Carolina"),
    ("SD", "South Dakota"), ("TN", "Tennessee"), ("TX", "Texas"), ("UT", "Utah"),
    ("VT", "Vermont"), ("VA", "Virginia"), ("WA", "Washington"), ("WV", "West Virginia"),
    ("WI", "Wisconsin"), ("WY", "Wyoming"),
]


class ConfigError(Exception):
    """A crawler config problem (the TS ConfigError)."""


# ---- small helpers ----------------------------------------------------------------------
def clip(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else f"{text[:limit]}… [{len(text) - limit} more chars]"


def parse_json(text: str | None) -> Any:
    """JSON.parse or None (the TS `undefined`) when empty / not JSON."""
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError, RecursionError):
        return None


def site_domain(host: str) -> str:
    h = re.sub(r"^www\.", "", host.lower())
    parts = h.split(".")
    if len(parts) > 2 and len(parts[-2]) <= 3 and len(parts[-1]) <= 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def host_of(u: str) -> str:
    p = try_url(u)
    return p.hostname.lower() if p else ""


def resolve_url(href: str, base: str) -> str:
    p = try_url(href, base)
    return p.href if p else href


def _html_unescape(s: str) -> str:
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&#39;", "'").replace("&#x27;", "'"))


def _is_obj(v: Any) -> bool:
    """`v && typeof v === 'object' && !Array.isArray(v)`."""
    return isinstance(v, dict)


# ---- JSONPath subset: $ .key ['key'] [n] [*] .* [a:b] ..key ------------------------------
_TOKEN = re.compile(
    r"\.\.([A-Za-z_$][\w$-]*)|\.([A-Za-z_$][\w$-]*)|\[\s*'([^']*)'\s*\]|\[\s*\"([^\"]*)\"\s*\]"
    r"|\[\s*(\*|-?\d+)\s*\]|\.\*|\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]",
    re.ASCII,
)


def _descend(node: Any) -> Iterator[Any]:
    yield node
    kids = node if isinstance(node, list) else list(node.values()) if isinstance(node, dict) else []
    for k in kids:
        yield from _descend(k)


def _slice_bound(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return 0


def jsonpath(data: Any, path: str) -> list:
    p = path.strip()
    if not p.startswith("$"):
        p = f"$.{p}"
    nodes: list = [data]
    pos = 1
    while pos < len(p):
        m = _TOKEN.match(p, pos)
        if not m:
            raise ValueError(
                f"Unsupported JSONPath syntax at {json.dumps(p[pos:], ensure_ascii=False)} "
                f"in {json.dumps(p, ensure_ascii=False)}"
            )
        pos = m.end()
        whole = m.group(0)
        recursive, key, q1, q2, idx, lo, hi = m.groups()
        if lo is not None or hi is not None:
            a, b = _slice_bound(lo), _slice_bound(hi)
            nodes = [x for n in nodes if isinstance(n, list) for x in n[a:b]]
        elif recursive:
            nodes = [d[recursive] for n in nodes for d in _descend(n)
                     if isinstance(d, dict) and recursive in d]
        elif key is not None or q1 is not None or q2 is not None:
            k = key if key is not None else q1 if q1 is not None else q2
            nodes = [n[k] for n in nodes if isinstance(n, dict) and k in n]
        elif idx == "*" or whole == ".*":
            nodes = [x for n in nodes
                     for x in (n if isinstance(n, list) else
                               list(n.values()) if isinstance(n, dict) else [])]
        else:
            i = int(idx)
            nodes = [n[i] for n in nodes if isinstance(n, list) and -len(n) <= i < len(n)]
    return nodes


# ---- templates --------------------------------------------------------------------------
_VAR = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
_WHOLE_VAR = re.compile(r"^\{([A-Za-z_][A-Za-z0-9_]*)\}\Z")


def render_template(value: Any, vars: dict[str, Any]) -> Any:
    if isinstance(value, str):
        whole = _WHOLE_VAR.match(value)
        if whole and whole.group(1) in vars:
            return vars[whole.group(1)]
        return _VAR.sub(lambda m: js_str(vars[m.group(1)]) if m.group(1) in vars else m.group(0),
                        value)
    if isinstance(value, list):
        return [render_template(v, vars) for v in value]
    if isinstance(value, dict):
        return {k: render_template(v, vars) for k, v in value.items()}
    return value


def unresolved(value: Any) -> list[str]:
    s = value if isinstance(value, str) else json_stringify(value if value is not None else "")
    return sorted({m.group(1) for m in _VAR.finditer(s)})


# ---- extractors -------------------------------------------------------------------------
def _load(html: str) -> BeautifulSoup:
    return BeautifulSoup(html or "", "html.parser", multi_valued_attributes=None)


_ATTR_SUFFIX = re.compile(r"::attr\(([^)]+)\)\s*$")
_TEXT_SUFFIX = re.compile(r"::text\s*$")


def css_values(html: str, css: str) -> list[str]:
    """parsel-style CSS: "a.card::attr(href)", "h1::text"; a plain selector gives each HTML."""
    attr_m = _ATTR_SUFFIX.search(css)
    want_text = bool(_TEXT_SUFFIX.search(css))
    sel = _TEXT_SUFFIX.sub("", _ATTR_SUFFIX.sub("", css)).strip() or "*"
    soup = _load(html)
    out: list[str] = []
    for el in soup.select(sel):
        if attr_m:
            v = el.get(attr_m.group(1).strip())
            if v is not None:
                out.append(v if isinstance(v, str) else " ".join(v))
        elif want_text:
            out.append(el.get_text())
        else:
            out.append(str(el))
    return out


def embedded_json(html: str, css: str | None = None, regex: str | None = None) -> Any:
    if regex:
        m = js_re(regex, "s").search(html)
        return parse_json(group1_or_0(m)) if m else None
    vals = css_values(html, css or "script#__NEXT_DATA__::text")
    return parse_json(vals[0] if vals else None)


def _looks_json(t: str | None) -> bool:
    s = (t or "").lstrip()
    return s.startswith(("{", "["))


_HAS_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)
_RELATIVE = re.compile(r"^(/|\./|\.\./|\?)")


def extract(spec: dict | None, text: str | None, base_url: str | None = None,
            headers: dict[str, str] | None = None) -> list[str]:
    if spec is None:
        raise TypeError("Cannot read properties of undefined (reading 'source')")
    source = spec.get("source") if spec.get("source") is not None else "html"
    values: list = []
    if source == "html":
        if spec.get("xpath"):
            raise ConfigError("xpath extractors are not supported here; use css")
        if spec.get("css") and not _looks_json(text):
            values = css_values(text or "", spec["css"])
    elif source in ("json", "embedded_json"):
        data = (parse_json(text) if source == "json"
                else embedded_json(text or "", spec.get("embedded_css"),
                                   spec.get("embedded_regex")))
        values = jsonpath(data, spec["path"]) if data is not None and spec.get("path") else []
    elif source == "header":
        want = js_str(spec.get("name") if spec.get("name") is not None else "").lower()
        values = [v for k, v in (headers or {}).items() if k.lower() == want]
    out: list[str] = []
    for v in values:
        if v is None or isinstance(v, (dict, list)):
            continue
        s = js_str(v).strip()
        if spec.get("regex"):
            m = js_re(spec["regex"]).search(s)
            if not m:
                continue
            s = group1_or_0(m)
        if not s:
            continue
        if spec.get("url_template"):
            s = str(spec["url_template"]).replace("{value}", s, 1)
        if base_url and not _HAS_SCHEME.search(s) and (_RELATIVE.search(s) or "/" in s):
            s = resolve_url(s, base_url)
        out.append(s)
    return out


# ---- summaries shown to the AI ------------------------------------------------------------
def trim_json(obj: Any, max_str: int = 120, max_list: int = 2, depth: int = 7) -> Any:
    if depth <= 0:
        return "…"
    if isinstance(obj, list):
        items = [trim_json(v, max_str, max_list, depth - 1) for v in obj[:max_list]]
        return [*items, f"… {len(obj) - max_list} more"] if len(obj) > max_list else items
    if isinstance(obj, dict):
        return {k: trim_json(v, max_str, max_list, depth - 1) for k, v in obj.items()}
    if isinstance(obj, str) and len(obj) > max_str:
        return f"{obj[:max_str]}…"
    return obj


_IDENT = re.compile(r"^[A-Za-z_$][\w$]*\Z", re.ASCII)


def _walk_json(data: Any, path: str = "$") -> Iterator[tuple[str, Any]]:
    yield path, data
    if isinstance(data, list):
        for i, v in enumerate(data):
            yield from _walk_json(v, f"{path}[{i}]")
    elif isinstance(data, dict):
        for k, v in data.items():
            yield from _walk_json(v, path + (f".{k}" if _IDENT.match(k) else f"['{k}']"))


def find_lists(data: Any, min_len: int = 3, limit: int = 6) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()
    parents: dict[str, dict] = {}
    steps = 0
    for path, node in _walk_json(data):
        steps += 1
        if steps > 50_000:
            break
        if isinstance(node, dict):
            parents[path] = node
        if not (isinstance(node, list) and len(node) >= min_len
                and all(isinstance(i, dict) for i in node[:5])):
            continue
        gpath = re.sub(r"\[\d+\]", "[*]", path)
        if gpath in seen:
            continue
        seen.add(gpath)
        parent_path = path[: path.rfind(".")] if "." in path else "$"
        parent = parents.get(parent_path, {})
        counters = dict([(k, v) for k, v in parent.items() if is_num(v)][:10])
        found.append({
            "path": f"{gpath}[*]", "length": len(node), "item_keys": list(node[0].keys())[:25],
            "sample_item": trim_json(node[0], 90, 2, 4), "numeric_siblings": counters,
        })
    found.sort(key=lambda f: -f["length"])
    return found[:limit]


_PAGE_SEG = re.compile(r"^(pg|page)-\d+\Z", re.IGNORECASE)


def url_pattern(url: str) -> str:
    u = try_url(url)
    if not u:
        return url
    segs = [re.sub(r"\d+", "{n}", seg) if _PAGE_SEG.match(seg) else
            "{id}" if _ID_SEGMENT.match(seg) else seg for seg in u.pathname.split("/")]
    q_keys = list(dict.fromkeys(f"{kv.split('=')[0]}=" for kv in u.search[1:].split("&") if kv))
    q = "&".join(sorted(q_keys))
    return f"{u.host}{'/'.join(segs)}{'?' + q if q else ''}"


_WINDOW_STATE = re.compile(
    r"window\.(__[A-Za-z0-9_]+__)\s*=\s*(\{.*?\})\s*;?\s*</script>", re.DOTALL
)
_SKIP_HREF = re.compile(r"^(#|javascript:|mailto:|tel:)", re.IGNORECASE)
_PAGE_TEXT = re.compile(r"^(\d{1,4}|next|›|»|>)\Z", re.IGNORECASE)
_PAGE_LABEL = re.compile(r"page|next", re.IGNORECASE)
_PAGE_HREF = re.compile(
    r"(?:^|[/_-])(?:pg|page)[-/]\d+|[?&](?:page|pg|p|offset|start|from|skip|cursor)=", re.IGNORECASE
)


def _el_name(e: Any) -> str:
    if isinstance(e, BeautifulSoup):
        return "body"
    tag = (e.name or "").lower()
    tid = e.get("data-testid")
    if tid:
        return f'{tag}[data-testid="{tid}"]'
    cls = next((c for c in re.split(r"\s+", str(e.get("class") or "")) if c), "")
    return tag + (f".{cls}" if cls else "")


def _text(el: Any) -> str:
    return el.get_text() if isinstance(el, Tag) else ""


def summarize_html(html: str, page_url: str) -> dict[str, Any]:
    # Fix (v2 CPU, 2026-10-09): a page summary reads at most the first 1 MB.
    soup = _load(html[:1_000_000] if len(html) > 1_000_000 else html)
    site = site_domain(host_of(page_url))
    blobs: list[dict] = []
    for el in soup.select('script[type="application/json"], script#__NEXT_DATA__'):
        if len(blobs) >= 6:
            break
        data = parse_json(el.get_text())
        if data is not None:
            eid = el.get("id")
            blobs.append({
                "embedded_css": f"script#{eid}::text" if eid
                else 'script[type="application/json"]::text',
                "top_keys": list(data.keys())[:15] if isinstance(data, dict)
                else ("object" if isinstance(data, list) else type(data).__name__),
                "lists": find_lists(data),
            })
    for m in _WINDOW_STATE.finditer(html[:1_000_000]):
        if len(blobs) >= 6:
            break
        data = parse_json(m.group(2))
        if data is not None:
            blobs.append({
                "embedded_regex": f"window\\.{m.group(1)}\\s*=\\s*(\\{{.*?\\}})\\s*;?\\s*</script>",
                "lists": find_lists(data),
            })
    patterns: dict[str, dict] = {}
    pagination: list[dict] = []
    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        if not href or _SKIP_HREF.search(href):
            continue
        abs_url = resolve_url(href, page_url)
        if not host_of(abs_url).endswith(site):
            continue
        text = re.sub(r"\s+", " ", a.get_text()).strip()[:50]
        pat = url_pattern(abs_url)
        entry = patterns.setdefault(pat, {"pattern": pat, "count": 0, "examples": [], "css": {}})
        entry["count"] += 1
        if len(entry["examples"]) < 2:
            entry["examples"].append(abs_url)
        parent = a.parent
        hint = f"{_el_name(parent)} > {_el_name(a)}" if parent is not None else _el_name(a)
        entry["css"][hint] = entry["css"].get(hint, 0) + 1
        label = a.get("aria-label") or ""
        is_paging = (re.search(r"\bnext\b", a.get("rel") or "") or _PAGE_TEXT.match(text)
                     or _PAGE_LABEL.search(label) or _PAGE_HREF.search(abs_url))
        if is_paging and len(pagination) < 8:
            pagination.append({"href": abs_url, "text": text or label})
    top = sorted(patterns.values(), key=lambda e: -e["count"])[:10]
    title_el = soup.select_one("title")
    return {
        "title": (title_el.get_text() if title_el else "").strip()[:120],
        "embedded_json": blobs,
        "link_patterns": [{
            "pattern": e["pattern"], "count": e["count"], "examples": e["examples"],
            "css_hints": [h for h, _ in sorted(e["css"].items(), key=lambda x: -x[1])[:1]],
        } for e in top],
        "pagination_links": pagination,
    }


def summarize_body(url: str, content_type: str | None, text: str | None) -> dict[str, Any]:
    ctype = (content_type or "").lower()
    text = text or ""
    stripped = text.lstrip()
    if "json" in ctype or _looks_json(stripped):
        data = parse_json(text)
        if data is not None:
            return {"kind": "json", "lists": find_lists(data),
                    "shape": clip(json_stringify(trim_json(data, 120, 1, 6)), 2000)}
    if ("xml" in ctype or stripped.startswith("<?xml") or "<urlset" in stripped[:500]
            or "<sitemapindex" in stripped[:500]):
        locs = [m.group(1) for m in LOC_RE.finditer(text)]
        return {"kind": "xml", "loc_count": len(locs), "first_locs": locs[:8]}
    if "html" in ctype or "<html" in stripped[:1000].lower():
        return {"kind": "html", **summarize_html(text, url)}
    return {"kind": "text", "excerpt": clip(text, 1200)}


# ---- config -----------------------------------------------------------------------------
def normalize_config(config: Any) -> tuple[dict, list[str]]:
    """Returns (cfg, problems) — the TS `{ cfg, problems }`."""
    cfg = dict(config or {})
    cfg["sources"] = cfg["sources"] if isinstance(cfg.get("sources"), list) else []
    problems: list[str] = [] if js_truthy(cfg.get("domain")) else ["domain is missing"]
    regexes: list[tuple[str, Any]] = [("profile_url_pattern", cfg.get("profile_url_pattern"))]
    names: set[str] = set()
    need = {"listing": ["listing", "pagination", "items"], "autocomplete": ["request", "items"],
            "link_crawl": ["start_urls"]}
    for i, src in enumerate(cfg["sources"]):
        s = src if isinstance(src, dict) else {}
        label = s.get("name") if js_truthy(s.get("name")) else f"#{i + 1}"
        label = js_str(label)
        if label in names:
            problems.append(f"duplicate source name '{label}'")
        names.add(label)
        stype = s.get("type")
        if stype not in SOURCE_TYPES:
            problems.append(f"source {label}: unknown type '{_u(stype)}' "
                            f"(use one of {', '.join(SOURCE_TYPES)})")
            continue
        for k in need.get(stype, []):
            if not js_truthy(s.get(k)) and s.get(k) != 0:
                problems.append(f"source {label} ({stype}): '{k}' is required")
        for k in ("url_filter", "follow", "include"):
            regexes.append((f"source {label}: {k}", s.get(k)))
    for label, rx in regexes:
        if js_truthy(rx):
            try:
                js_re(rx)
            except re.error as e:
                problems.append(f"{label} is not a valid regex: {str(e)[:120]}")
    if not cfg["sources"]:
        problems.append("no sources defined")
    return cfg, problems


# ---- seeds ------------------------------------------------------------------------------
SeedExtractor = Callable[[dict, dict], list[str]]


def _product(chars: str, depth: int) -> list[str]:
    out = [""]
    for _ in range(max(0, depth)):
        out = [p + c for p in out for c in chars]
    return out


def _pad(s: str, width: Any) -> str:
    w = js_number(width)
    return s.rjust(int(w), "0") if math.isfinite(w) and w > 0 else s


def seed_values(spec: dict | None,
                extractor: Callable[[dict], list[str]] | None = None) -> list[str]:
    stype = (spec or {}).get("type")
    if stype == "list":
        values = [js_str(v) for v in (spec.get("values") or [])]
    elif stype == "range":
        values = []
        step = js_number(spec.get("step") if spec.get("step") is not None else 1) or 1
        if math.isnan(step):
            step = 1
        n = js_number(spec.get("start"))
        end = js_number(spec.get("end"))
        width = spec.get("width") if spec.get("width") is not None else 0
        while n <= end and len(values) < 200_000:
            values.append(_pad(js_str(as_num(n)), width))
            n += step
    elif stype == "alphabet":
        depth = js_number(spec.get("depth") if spec.get("depth") is not None else 1)
        values = _product(spec.get("chars") or "abcdefghijklmnopqrstuvwxyz",
                          int(depth) if math.isfinite(depth) else 0)
    elif stype == "us_states":
        fmt = spec.get("format") if spec.get("format") is not None else "abbr"
        values = []
        for a, n in US_STATES:
            forms = {"abbr": a, "abbr_lower": a.lower(), "name": n,
                     "slug": n.lower().replace(" ", "-"),
                     "slug_underscore": n.lower().replace(" ", "_")}
            values.append(forms.get(fmt, a) if isinstance(fmt, str) else a)
    elif stype == "extract":
        if extractor is None:
            raise ConfigError("extract seeds need a fetcher")
        got = list(dict.fromkeys(extractor(spec)))
        values = got[: int(js_number(spec["limit"]))] if js_truthy(spec.get("limit")) else got
    else:
        raise ConfigError(f"unknown seed type '{_u(stype)}'")
    if js_truthy((spec or {}).get("pad")):
        values = [_pad(v, spec["pad"]) for v in values]
    return values


def seed_combinations(seeds: dict | None, extractor: SeedExtractor | None,
                      max_seeds: int | None = None) -> list[dict[str, str]]:
    combos: list[dict[str, str]] = [{}]
    for name, spec in (seeds or {}).items():
        is_extract = isinstance(spec, dict) and spec.get("type") == "extract"
        if is_extract:
            if not combos:
                raise TypeError("Cannot use 'in' operator to search in undefined")
            req = spec.get("request") if spec.get("request") is not None else {}
            dependent = any(v in combos[0] for v in unresolved(req))
        else:
            dependent = False
        if dependent:
            if max_seeds:
                combos = combos[:max_seeds]
            nxt: list[dict[str, str]] = []
            for c in combos:
                vals = seed_values(spec, (lambda s, c=c: extractor(s, c)) if extractor else None)
                for v in vals:
                    nxt.append({**c, name: v})
                if max_seeds and len(nxt) >= max_seeds:
                    break
            combos = nxt
        else:
            vals = seed_values(spec, (lambda s: extractor(s, {})) if extractor else None)
            combos = [{**c, name: v} for c in combos for v in vals]
            if len(combos) > 500_000:
                combos = combos[:500_000]
    return combos[:max_seeds] if max_seeds else combos


def adaptive_children(seeds: dict | None, combo: dict[str, str],
                      items_found: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for name, spec in (seeds or {}).items():
        if (isinstance(spec, dict) and spec.get("type") == "alphabet"
                and js_truthy(spec.get("expand_at"))):
            value = combo.get(name, "")
            max_depth = js_number(spec.get("max_depth") if spec.get("max_depth") is not None else 3)
            if items_found >= js_number(spec["expand_at"]) and len(value) < max_depth:
                for c in spec.get("chars") or "abcdefghijklmnopqrstuvwxyz":
                    out.append({**combo, name: value + c})
    return out


# ---- engine -----------------------------------------------------------------------------
def _expired(limits: dict) -> bool:
    return limits.get("deadline") is not None and now_ms() >= limits["deadline"]


class SourceStats:
    def __init__(self, name: Any, type: Any) -> None:
        self.name, self.type = name, type
        self.requests = self.found = self.fresh = self.rejected = 0
        self.tasks_done = self.tasks_total = self.blocked = 0
        self.seconds = 0.0
        self.samples: list[str] = []
        self.rejected_samples: list[str] = []
        self.errors: list[str] = []
        self.log: list[str] = []
        self.notes: list[str] = []
        self.stop_reasons: dict[str, int] = {}
        self._lock = threading.Lock()

    def stop(self, reason: str) -> None:
        with self._lock:
            self.stop_reasons[reason] = self.stop_reasons.get(reason, 0) + 1

    def summary(self) -> dict[str, Any]:
        stops = sorted(self.stop_reasons.items(), key=lambda kv: -kv[1])[:6]
        return {
            "source": self.name, "type": self.type, "requests": self.requests,
            "profile_urls_found": self.found, "new_unique": self.fresh,
            "rejected_by_profile_pattern": self.rejected, "tasks_done": self.tasks_done,
            "tasks_total": self.tasks_total, "stop_reasons": dict(stops),
            "blocked_requests": self.blocked, "errors": self.errors[:4],
            "sample_urls": self.samples[:8], "rejected_samples": self.rejected_samples[:4],
            "seconds": as_num(math.floor(self.seconds * 10 + 0.5) / 10),
            "notes": self.notes[:4], "request_log_tail": self.log[-5:],
        }


class Collector:
    def __init__(self, config: dict) -> None:
        pat = config.get("profile_url_pattern")
        self.pattern: re.Pattern | None = js_re(pat) if js_truthy(pat) else None
        self.strip_query = js_truthy(config.get("strip_query"))
        self.seen = OrderedSet()
        self._lock = threading.Lock()

    def normalize(self, url: str) -> str:
        u = try_url(_html_unescape(url.strip()))
        if not u:
            return url.strip()
        u.hash = ""
        if self.strip_query:
            u.search = ""
        return u.href

    def add(self, urls: list[str], stats: SourceStats) -> list[str]:
        fresh: list[str] = []
        with self._lock:
            for raw in urls:
                url = self.normalize(raw)
                if self.pattern and not self.pattern.search(url):
                    stats.rejected += 1
                    if len(stats.rejected_samples) < 8:
                        stats.rejected_samples.append(url)
                    continue
                stats.found += 1
                if url not in self.seen:
                    self.seen.add(url)
                    fresh.append(url)
                    if len(stats.samples) < 12:
                        stats.samples.append(url)
            stats.fresh += len(fresh)
        return fresh


class _Ctx:
    def __init__(self, cfg: dict, fetch: EngineFetch, timeout_ms: float) -> None:
        self.cfg, self.fetch, self.timeout_ms = cfg, fetch, timeout_ms


def _source_headers(cfg: dict, src: dict) -> dict[str, str]:
    return {**(cfg.get("headers") or {}), **(src.get("headers") or {})}


def _render_flag(cfg: dict, src: dict) -> bool:
    return js_truthy(src["render"] if "render" in src else cfg.get("render"))


def _send_request(ctx: _Ctx, src: dict, request: Any, vars: dict[str, Any],
                  headers: dict[str, str], stats: SourceStats, url_override: Any = None,
                  max_bytes: int | None = None) -> tuple[str, dict]:
    req = render_template(request if request is not None else {}, vars)
    if not isinstance(req, dict):
        req = {}
    url = render_template(url_override, vars) if js_truthy(url_override) else req.get("url")
    missing = unresolved([url, req.get("params"), req.get("json"), req.get("headers"),
                          req.get("data"), req.get("body")])
    if missing:
        raise ConfigError(f"unfilled placeholders {json_stringify(missing)} in request {_u(url)}")
    if isinstance(req.get("params"), dict):
        u = JsUrl(url)
        for k, v in req["params"].items():
            u.set_param(str(k), js_str(v))
        url = u.href
    method = "POST" if js_str(req.get("method") or "GET").upper() == "POST" else "GET"
    hdrs: dict[str, str] = {**headers, **(req.get("headers") or {})}

    def has_type() -> bool:
        return any(k.lower() == "content-type" for k in hdrs)

    body: str | None = None
    if method == "POST":
        if req.get("json") is not None:
            body = json_stringify(req["json"])
            if not has_type():
                hdrs["content-type"] = "application/json"
        elif req.get("data") is not None:
            data = req["data"]
            body = data if isinstance(data, str) else url_search_params(data)
            if not has_type():
                hdrs["content-type"] = "application/x-www-form-urlencoded"
        elif req.get("body") is not None:
            body = js_str(req["body"])
    resp = ctx.fetch({"method": method, "url": url, "headers": hdrs, "body": body,
                      "render": _render_flag(ctx.cfg, src), "maxBytes": max_bytes,
                      "timeoutMs": ctx.timeout_ms})
    stats.requests += 1
    shown = resp.get("status") or resp.get("error")
    stats.log.append(f"{method} {url[:160]} -> {_u(shown)} "
                     f"({(resp.get('ms') or 0) / 1000:.1f}s)")
    if resp.get("blocked"):
        stats.blocked += 1
    return url, resp


def _pool(initial: list, worker: Callable[[Any], list], limits: dict, stats: SourceStats,
          max_tasks: int | None, key: Callable[[Any], str], depth_first: bool = False) -> None:
    """Bounded worker pool over a growing task queue (the TS `pool`)."""
    queue: deque = deque(initial)
    queued = {key(t) for t in initial}
    stats.tasks_total = len(queue)
    workers = max(1, int(limits.get("workers") or 1))
    errors_in_row = 0
    stopped = False
    running: dict[Future, Any] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        while True:
            if not stopped:
                if _expired(limits) and queue:
                    stats.stop("time limit")
                    queue.clear()
                while (queue and len(running) < workers
                       and (max_tasks is None or stats.tasks_done + len(running) < max_tasks)):
                    task = queue.popleft()
                    fut = ex.submit(contextvars.copy_context().run, worker, task)
                    running[fut] = task
            if not running:
                return
            done, _ = wait(list(running), return_when=FIRST_COMPLETED)
            for fut in done:
                task = running.pop(fut)
                try:
                    children = fut.result() or []
                    errors_in_row = 0
                except Exception as e:  # noqa: BLE001 - a task error is recorded, never raised
                    errors_in_row += 1
                    stats.errors.append(f"{key(task)[:80]}: {error_message(e)}"[:250])
                    children = []
                stats.tasks_done += 1
                fresh = [c for c in children if key(c) not in queued]
                for c in fresh:
                    queued.add(key(c))
                if depth_first:
                    queue.extendleft(reversed(fresh))
                else:
                    queue.extend(fresh)
                stats.tasks_total += len(fresh)
                if errors_in_row >= 25:
                    stats.stop(f"stopped after {errors_in_row} consecutive errors")
                    stopped = True


def _paginate(ctx: _Ctx, src: dict, vars: dict[str, Any], headers: dict[str, str],
              limits: dict, stats: SourceStats,
              on_page: Callable[[list[str]], bool | str]) -> dict[str, Any]:
    pag = src.get("pagination") or {}
    listing = src.get("listing") or {}
    limit = limits.get("maxPages")
    if limit is None:
        limit = pag.get("max_pages") if pag.get("max_pages") is not None else 1000
    limit_n = js_number(limit)
    seen: set[str] = set()
    total: int | None = None
    cursor = ""
    next_url: str | None = None
    count = 0
    start = num_or(pag.get("start"), 1)
    step = num_or(pag.get("step"), 1)
    i = 0
    while i < limit_n:
        if _expired(limits):
            return {"items": count, "reason": "time limit"}
        value = as_num(start + i * step)
        vars.update({"page": value, "offset": value, "page_number": i + 1, "cursor": cursor})
        if i == 0 and js_truthy(listing.get("first_page_url")):
            override = listing["first_page_url"]
        elif pag.get("type") == "next_link" and i > 0:
            override = next_url
        else:
            override = None
        _, resp = _send_request(ctx, src, listing.get("request"), vars, headers, stats, override)
        if resp.get("error") and not resp.get("status"):
            return {"items": count, "reason": f"request failed: {str(resp['error'])[:80]}"}
        if resp.get("blocked"):
            return {"items": count, "reason": "blocked"}
        status = resp.get("status") or 0
        if status >= 400:
            return {"items": count, "reason": f"HTTP {status} on page {i + 1}"}
        items = extract(src.get("items"), resp.get("text"), resp.get("url"))
        fresh = [u for u in dict.fromkeys(items) if u not in seen]
        seen.update(fresh)
        count += len(items)
        verdict = on_page(items)
        if verdict is False or isinstance(verdict, str):
            reason = verdict if isinstance(verdict, str) else (
                f"no globally new URLs for {_u(pag.get('global_stop_pages'))} pages")
            return {"items": count, "reason": reason}
        if not items:
            return {"items": count, "reason": f"page {i + 1} returned no items"}
        if not fresh:
            return {"items": count, "reason": f"page {i + 1} repeated earlier items"}
        if js_truthy(pag.get("total_items")) and total is None:
            found = extract(pag["total_items"], resp.get("text"))
            total = (math.floor(float(found[0]))
                     if found and re.match(r"^\d+(\.\d+)?\Z", found[0]) else None)
        if total is not None and len(seen) >= total:
            return {"items": count, "reason": f"reached total of {total} items"}
        if pag.get("type") == "none":
            return {"items": count, "reason": "single page listing"}
        if pag.get("type") == "cursor":
            found = extract(pag["cursor"], resp.get("text")) if js_truthy(pag.get("cursor")) else []
            if not found:
                return {"items": count, "reason": "no next cursor"}
            cursor = found[0]
        if pag.get("type") == "next_link":
            found = (extract(pag["next_link"], resp.get("text"), resp.get("url"))
                     if js_truthy(pag.get("next_link")) else [])
            if not found:
                return {"items": count, "reason": "no next link"}
            next_url = found[0]
        i += 1
    return {"items": count, "reason": f"max pages ({js_str(as_num(limit_n))}) reached"}


def _inputs(src: dict, start_url: str) -> dict[str, str]:
    vars_: dict[str, str] = {"start_url": start_url}
    for name, pattern in (src.get("inputs") or {}).items():
        m = js_re(pattern).search(start_url)
        if not m:
            raise ConfigError(
                f"input '{name}': regex {js_str(pattern)} does not match start URL {start_url}"
            )
        vars_[name] = group1_or_0(m)
    return vars_


def _start_url(cfg: dict, src: dict) -> str:
    return src.get("start_url") or cfg.get("start_url") or f"https://{cfg.get('domain')}/"


def _run_listing(ctx: _Ctx, src: dict, collector: Collector, stats: SourceStats,
                 limits: dict) -> None:
    cfg = ctx.cfg
    base_vars = _inputs(src, _start_url(cfg, src))
    headers = _source_headers(cfg, src)
    seeds = src.get("seeds") or {}
    stop_after = num_or((src.get("pagination") or {}).get("global_stop_pages"), 0)

    def scrape(spec: dict, combo: dict) -> list[str]:
        if _expired(limits):
            return []
        _, resp = _send_request(ctx, src, spec.get("request"), {**base_vars, **combo}, headers,
                                stats)
        ext = spec.get("extractor") if spec.get("extractor") is not None else {}
        return extract(ext, resp.get("text"), resp.get("url"))

    try:
        combos = seed_combinations(seeds, scrape, limits.get("maxSeeds"))
    except Exception as e:  # noqa: BLE001
        stats.errors.append(f"seed generation failed: {error_message(e)}"[:250])
        return

    def work(combo: dict) -> list:
        stale = 0
        label = ", ".join(f"{k}={v}" for k, v in combo.items())

        def on_page(items: list[str]) -> bool | str:
            nonlocal stale
            fresh = collector.add(items, stats)
            stale = 0 if fresh else stale + 1
            if _expired(limits):
                return "time limit"
            return not (stop_after and items and stale >= stop_after)

        res = _paginate(ctx, src, {**base_vars, **combo}, headers, limits, stats, on_page)
        if res["reason"].startswith("request failed") or res["reason"] == "blocked":
            stats.errors.append(f"{label or 'listing'}: {res['reason']}"[:250])
        stats.stop(re.sub(r"\d+", "N", res["reason"]))
        return adaptive_children(seeds, combo, res["items"])

    _pool(combos, work, limits, stats, limits.get("maxSeeds"), json_stringify)


def _max_tasks(limits: dict, src: dict, src_key: str, default: int) -> int:
    if limits.get("maxRequests") is not None:
        return limits["maxRequests"]
    v = src.get(src_key)
    return int(js_number(v)) if v is not None else default


def _run_sitemap(ctx: _Ctx, src: dict, collector: Collector, stats: SourceStats,
                 limits: dict) -> None:
    cfg = ctx.cfg
    roots: list[str] = list(src.get("sitemaps") or [])
    if not roots:
        base = JsUrl(cfg.get("start_url") or f"https://www.{cfg.get('domain')}/").origin
        robots = ctx.fetch({"method": "GET", "url": f"{base}/robots.txt",
                            "timeoutMs": ctx.timeout_ms})
        stats.requests += 1
        roots = ([m.group(1) for m in re.finditer(r"^\s*sitemap:\s*(\S+)", robots.get("text") or "",
                                                   re.IGNORECASE | re.MULTILINE)]
                 if robots.get("status") == 200 else [])
        if not roots:
            roots = [f"{base}/sitemap.xml"]
    include = js_re(src["include"]) if js_truthy(src.get("include")) else None
    url_filter = js_re(src["url_filter"]) if js_truthy(src.get("url_filter")) else None

    def work(sm: str) -> list:
        resp = ctx.fetch({"method": "GET", "url": sm, "headers": _source_headers(cfg, src),
                          "maxBytes": limits.get("sitemapBytes"), "timeoutMs": ctx.timeout_ms})
        stats.requests += 1
        status = resp.get("status") or 0
        if status >= 400 or (not status and resp.get("error")):
            stats.stop(f"HTTP {status}" if status else "request failed")
            return []
        text = resp.get("text") or ""
        locs = [_html_unescape(m.group(1)) for m in LOC_RE.finditer(text)]
        if re.search(r"<sitemapindex", text[:2000], re.IGNORECASE):
            stats.stop("sitemap index")
            return [u for u in locs if not include or include.search(u)]
        if resp.get("truncated"):
            stats.notes.append(
                f"{sm}: sampled first {math.floor(len(text) / 1024 + 0.5)} KB ({len(locs)} URLs)"
            )
        collector.add([u for u in locs if not url_filter or url_filter.search(u)], stats)
        stats.stop("url set")
        return []

    _pool(roots, work, limits, stats, _max_tasks(limits, src, "max_sitemaps", 5000),
          lambda s: s)


def _run_autocomplete(ctx: _Ctx, src: dict, collector: Collector, stats: SourceStats,
                      limits: dict) -> None:
    chars: str = src.get("chars") or "abcdefghijklmnopqrstuvwxyz"
    threshold = num_or(src.get("expand_threshold"), 0)
    max_depth = num_or(src.get("max_depth"), 3)

    def work(prefix: str) -> list:
        _, resp = _send_request(ctx, src, src.get("request"), {"prefix": prefix, "query": prefix},
                                _source_headers(ctx.cfg, src), stats)
        values = extract(src.get("items"), resp.get("text"), resp.get("url"))
        collector.add(values, stats)
        if threshold and len(values) >= threshold and len(prefix) < max_depth:
            return [prefix + c for c in chars]
        return []

    start = src.get("start_prefixes")
    _pool(list(start) if start is not None else list(chars), work, limits, stats,
          _max_tasks(limits, src, "max_requests", 20000), lambda s: s)


def page_links(html: str | None, base: str) -> list[str]:
    if _looks_json(html):
        return []
    out: list[str] = []
    for a in _load(html or "").select("a[href]"):
        h = a.get("href") or ""
        if h and not _SKIP_HREF.search(h):
            out.append(resolve_url(h, base))
    return out


def _run_link_crawl(ctx: _Ctx, src: dict, collector: Collector, stats: SourceStats,
                    limits: dict) -> None:
    follow = js_re(src["follow"]) if js_truthy(src.get("follow")) else None
    max_depth = num_or(src.get("max_depth"), 3)
    suffix = re.sub(r"^www\.", "", js_str(ctx.cfg.get("domain") or ""))

    def work(t: tuple[str, int]) -> list:
        url, depth = t
        resp = ctx.fetch({"method": "GET", "url": url, "headers": _source_headers(ctx.cfg, src),
                          "render": _render_flag(ctx.cfg, src), "timeoutMs": ctx.timeout_ms})
        stats.requests += 1
        if resp.get("blocked"):
            stats.blocked += 1
        status = resp.get("status") or 0
        if status >= 400 or not status:
            stats.stop(f"HTTP {status}" if status else "request failed")
            return []
        text, rurl = resp.get("text"), resp.get("url")
        values = (extract(src["items"], text, rurl) if js_truthy(src.get("items"))
                  else page_links(text, rurl))
        collector.add(values, stats)
        if depth >= max_depth or not follow:
            return []
        return [(link.split("#")[0], depth + 1) for link in page_links(text, rurl)
                if host_of(link).endswith(suffix) and follow.search(link)]

    _pool([(u, 0) for u in (src.get("start_urls") or [])], work, limits, stats,
          _max_tasks(limits, src, "max_pages", 5000), lambda t: t[0])


_RUNNERS: dict[str, Callable[[_Ctx, dict, Collector, SourceStats, dict], None]] = {
    "listing": _run_listing, "sitemap": _run_sitemap, "autocomplete": _run_autocomplete,
    "link_crawl": _run_link_crawl,
}


def run_config(config: dict, collector: Collector, limits: dict, fetch: EngineFetch,
               request_timeout_ms: float = 45_000) -> list[SourceStats]:
    """Runs every source of a config with the limits; returns per-source stats."""
    cfg, problems = normalize_config(config)
    if problems:
        raise ConfigError("; ".join(problems))
    out: list[SourceStats] = []
    for src in cfg["sources"]:
        stats = SourceStats(src.get("name"), src.get("type"))
        started = now_ms()
        try:
            _RUNNERS[src["type"]](_Ctx(cfg, fetch, request_timeout_ms), src, collector, stats,
                                  limits)
        except Exception as e:  # noqa: BLE001
            stats.errors.append(error_message(e)[:250])
        stats.seconds = (now_ms() - started) / 1000
        out.append(stats)
    return out


# ---- G3 (harvest any list route, 2026-10-13): one list unit at a time ----------------------
def run_list_unit(config: dict, unit: dict, collector: Collector, fetch: EngineFetch,
                  opts: dict) -> dict[str, Any]:
    """One resumable list unit. opts: pagesPerUnit, deadline (epoch ms), timeoutMs?.

    Returns {"stats": SourceStats, "next": [ListUnit], "reason": str}.
    """
    cfg, problems = normalize_config(config)
    if problems:
        raise ConfigError("; ".join(problems))
    s = int(js_number(unit.get("s")) if is_num(unit.get("s")) else 0)
    sources = cfg["sources"]
    src = sources[s] if -len(sources) <= s < len(sources) else None
    if not src:
        raise ConfigError(
            f"list unit refers to source #{js_str(unit.get('s'))}, which the contract does not have"
        )
    stats = SourceStats(src.get("name"), src.get("type"))
    timeout = opts.get("timeoutMs") if opts.get("timeoutMs") is not None else 45_000
    ctx = _Ctx(cfg, fetch, timeout)
    limits: dict[str, Any] = {"workers": 1, "deadline": opts.get("deadline")}
    headers = _source_headers(cfg, src)
    nxt: list[dict] = []
    us = unit.get("s")
    stype = src.get("type")
    if stype == "sitemap":
        return {"stats": stats, "next": nxt,
                "reason": "sitemap sources are seeded as sitemap queue rows"}

    if stype == "listing":
        base_vars = _inputs(src, _start_url(cfg, src))
        seeds = src.get("seeds") or {}
        pag = src.get("pagination") or {}
        first_page = as_num(num_or(pag.get("start"), 1))
        step = num_or(pag.get("step"), 1)
        if unit.get("k") == "root":
            if not seeds:
                nxt.append({"s": us, "k": "combo", "c": {}, "p": first_page})
                return {"stats": stats, "next": nxt,
                        "reason": "no seeds: one list from the first page"}

            def scrape(spec: dict, combo: dict) -> list[str]:
                if _expired(limits):
                    return []
                _, resp = _send_request(ctx, src, spec.get("request"), {**base_vars, **combo},
                                        headers, stats)
                ext = spec.get("extractor") if spec.get("extractor") is not None else {}
                return extract(ext, resp.get("text"), resp.get("url"))

            combos = seed_combinations(seeds, scrape)
            for c in combos:
                nxt.append({"s": us, "k": "combo", "c": c, "p": first_page})
            return {"stats": stats, "next": nxt, "reason": f"{len(combos)} seed combinations"}
        combo = unit.get("c") or {}
        page_start = as_num(num_or(unit.get("p"), first_page))
        ptype = pag.get("type") if pag.get("type") is not None else "page"
        resumable = ptype in ("page", "offset")
        listing = dict(src.get("listing") or {})
        if page_start != first_page:
            listing.pop("first_page_url", None)
        unit_src = {**src, "listing": listing, "pagination": {**pag, "start": page_start}}
        unit_limits = {**limits, "maxPages": opts.get("pagesPerUnit") if resumable else None}

        def on_page(items: list[str]) -> bool | str:
            collector.add(items, stats)
            return "time limit" if _expired(limits) else True

        res = _paginate(ctx, unit_src, {**base_vars, **combo}, headers, unit_limits, stats, on_page)
        pages_done = stats.requests
        max_pages = num_or(pag.get("max_pages"), math.inf)
        used_so_far = (page_start - first_page) / step + pages_done
        if (resumable and pages_done > 0
                and (res["reason"].startswith("max pages") or res["reason"] == "time limit")
                and used_so_far < max_pages):
            nxt.append({"s": us, "k": "combo", "c": combo,
                        "p": as_num(page_start + pages_done * step)})
        if page_start == first_page:
            for c in adaptive_children(seeds, combo, res["items"]):
                nxt.append({"s": us, "k": "combo", "c": c, "p": first_page})
        return {"stats": stats, "next": nxt, "reason": res["reason"]}

    if stype == "link_crawl":
        if unit.get("k") == "root":
            for u in src.get("start_urls") or []:
                nxt.append({"s": us, "k": "url", "u": u, "d": 0})
            return {"stats": stats, "next": nxt, "reason": "start pages"}
        follow = js_re(src["follow"]) if js_truthy(src.get("follow")) else None
        max_depth = num_or(src.get("max_depth"), 3)
        suffix = re.sub(r"^www\.", "", js_str(cfg.get("domain") or ""))
        resp = fetch({"method": "GET", "url": js_str(unit.get("u")) if unit.get("u") is not None
                      else "undefined", "headers": headers, "render": _render_flag(cfg, src),
                      "timeoutMs": ctx.timeout_ms})
        stats.requests += 1
        if resp.get("blocked"):
            stats.blocked += 1
        status = resp.get("status") or 0
        if status >= 400 or not status:
            return {"stats": stats, "next": nxt,
                    "reason": f"HTTP {status}" if status else "request failed"}
        text, rurl = resp.get("text"), resp.get("url")
        collector.add(extract(src["items"], text, rurl) if js_truthy(src.get("items"))
                      else page_links(text, rurl), stats)
        depth = num_or(unit.get("d"), 0)
        if follow and depth < max_depth:
            for link in page_links(text, rurl):
                if host_of(link).endswith(suffix) and follow.search(link):
                    nxt.append({"s": us, "k": "url", "u": link.split("#")[0],
                                "d": as_num(depth + 1)})
        return {"stats": stats, "next": nxt, "reason": "page read"}

    if stype == "autocomplete":
        chars: str = src.get("chars") or "abcdefghijklmnopqrstuvwxyz"
        if unit.get("k") == "root":
            start = src.get("start_prefixes")
            for x in (list(start) if start is not None else list(chars)):
                nxt.append({"s": us, "k": "prefix", "x": x})
            return {"stats": stats, "next": nxt, "reason": "start prefixes"}
        prefix = js_str(unit.get("x") if unit.get("x") is not None else "")
        _, resp = _send_request(ctx, src, src.get("request"), {"prefix": prefix, "query": prefix},
                                headers, stats)
        values = extract(src.get("items"), resp.get("text"), resp.get("url"))
        collector.add(values, stats)
        threshold = num_or(src.get("expand_threshold"), 0)
        if threshold and len(values) >= threshold and len(prefix) < num_or(src.get("max_depth"), 3):
            for c in chars:
                nxt.append({"s": us, "k": "prefix", "x": prefix + c})
        return {"stats": stats, "next": nxt, "reason": f"{len(values)} values"}
    return {"stats": stats, "next": nxt, "reason": f"unsupported source type {js_str(stype)}"}


def nfkd_strip_marks(v: str) -> str:
    """`v.normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')`."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", v) if not 0x300 <= ord(ch) <= 0x36F)
