"""JavaScript-semantics helpers for the site-contract port.

The TypeScript original relies on JS behaviour that Python does not share: WHATWG ``URL``
parsing, ``String(x)`` / ``Number(x)`` coercion, ``JSON.stringify`` output, JS truthiness and
``\\p{..}`` regex classes. These helpers reproduce the parts the library depends on.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote_to_bytes

# JS String.prototype.trim() whitespace (WhiteSpace + LineTerminator).
JS_WS = (
    "\t\n\v\f\r             "
    "     　﻿"
)


def trim(s: str) -> str:
    return s.strip(JS_WS)


def is_num(x: Any) -> bool:
    """``typeof x === 'number'`` (bools excluded)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def is_str_or_num(x: Any) -> bool:
    return isinstance(x, str) or is_num(x)


def is_obj(x: Any) -> bool:
    """``x && typeof x === 'object'`` (arrays included)."""
    return isinstance(x, (dict, list))


def truthy(x: Any) -> bool:
    """JS truthiness: empty arrays/objects are truthy, NaN is falsy."""
    if x is None or x is False:
        return False
    if isinstance(x, (dict, list, tuple, set)):
        return True
    if isinstance(x, float) and math.isnan(x):
        return False
    return bool(x)


def num_str(n: float) -> str:
    """``String(number)`` for the common cases."""
    if isinstance(n, bool):
        return "true" if n else "false"
    if isinstance(n, int):
        return str(n)
    if math.isnan(n):
        return "NaN"
    if math.isinf(n):
        return "Infinity" if n > 0 else "-Infinity"
    if n == int(n) and abs(n) < 1e21:
        return str(int(n))
    r = repr(n)
    if "e" in r:
        mant, exp = r.split("e")
        sign = "-" if exp.startswith("-") else "+"
        return f"{mant}e{sign}{exp.lstrip('+-').lstrip('0') or '0'}"
    return r


def js_str(x: Any) -> str:
    """``String(x)``."""
    if x is None:
        return "null"
    if isinstance(x, str):
        return x
    if isinstance(x, bool) or is_num(x):
        return num_str(x)
    if isinstance(x, list):
        return ",".join("" if v is None else js_str(v) for v in x)
    if isinstance(x, dict):
        return "[object Object]"
    return str(x)


_NUM_RE = re.compile(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$")


def js_number(x: Any) -> float:
    """``Number(x)``; ``None`` is treated as ``undefined`` (NaN)."""
    if x is None:
        return math.nan
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    if is_num(x):
        return float(x)
    if isinstance(x, list):
        if not x:
            return 0.0
        if len(x) == 1:
            return js_number("" if x[0] is None else js_str(x[0]))
        return math.nan
    if isinstance(x, dict):
        return math.nan
    s = trim(str(x))
    if s == "":
        return 0.0
    if _NUM_RE.match(s):
        return float(s)
    if re.match(r"^0[xX][0-9a-fA-F]+$", s):
        return float(int(s, 16))
    if s in ("Infinity", "+Infinity"):
        return math.inf
    if s == "-Infinity":
        return -math.inf
    return math.nan


def is_finite(n: Any) -> bool:
    return is_num(n) and math.isfinite(n)


def is_integer(n: Any) -> bool:
    return is_finite(n) and float(n) == int(n)


def as_num(n: float) -> int | float:
    """Integral floats back to int (so JSON / str output matches JS)."""
    if isinstance(n, float) and math.isfinite(n) and n == int(n):
        return int(n)
    return n


def parse_float_prefix(s: str) -> float:
    """``parseFloat(s)``."""
    m = re.match(r"^[\s]*([+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?))", s or "")
    return float(m.group(1)) if m else math.nan


def js_round(n: float) -> int:
    return math.floor(n + 0.5)


def _jsonable(v: Any) -> Any:
    if isinstance(v, float):
        if not math.isfinite(v):
            return None
        return as_num(v)
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def json_stringify(v: Any) -> str:
    """``JSON.stringify(v)`` (compact, non-ASCII kept)."""
    return json.dumps(_jsonable(v), separators=(",", ":"), ensure_ascii=False)


def utc_year() -> int:
    return datetime.now(UTC).year


def iso_now() -> str:
    """``new Date().toISOString()``."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(UTC).microsecond // 1000:03d}Z"
    )


# ---------------------------------------------------------------------------
# Unicode classes (JS \p{L}, \p{N}, \p{P}, \p{S})
# ---------------------------------------------------------------------------
def is_letter_or_number(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("L", "N")


def is_punct_or_symbol(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("P", "S")


def is_punct(ch: str) -> bool:
    return unicodedata.category(ch)[0] == "P"


def replace_non_ln(s: str, repl: str, keep_space: bool = False) -> str:
    """``s.replace(/[^\\p{L}\\p{N}(\\s)]+/gu, repl)``."""
    out: list[str] = []
    in_run = False
    for ch in s:
        keep = is_letter_or_number(ch) or (keep_space and (ch.isspace() or ch in JS_WS))
        if keep:
            out.append(ch)
            in_run = False
        elif not in_run:
            out.append(repl)
            in_run = True
    return "".join(out)


def decode_uri_component(s: str) -> str:
    """``decodeURIComponent`` (raises ValueError on malformed input, like URIError)."""
    if re.search(r"%(?![0-9A-Fa-f]{2})", s):
        raise ValueError("URI malformed")
    return unquote_to_bytes(s).decode("utf-8")


# ---------------------------------------------------------------------------
# WHATWG-like URL
# ---------------------------------------------------------------------------
SPECIAL_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443", "ftp": "21", "file": ""}
_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.\-]*):")
_PATH_ENC = set(' "#<>?`{}')
_QUERY_ENC = set(" \"#<>'")
_FRAG_ENC = set(' "<>`')


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


def _form_encode(s: str) -> str:
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


def _form_decode(s: str) -> str:
    return unquote_to_bytes(s.replace("+", " ")).decode("utf-8", "replace")


class JsURL:
    """Small WHATWG ``URL`` work-alike (http/https resolution, normalisation, searchParams)."""

    def __init__(self, url: str, base: str | None = None) -> None:
        s = str(url).strip("\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\v\f\r\x0e\x0f"
                            "\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f ")
        s = re.sub(r"[\t\n\r]", "", s)
        # Like WHATWG: a given base is parsed first, and an invalid base (including "") throws.
        b = None if base is None else (base if isinstance(base, JsURL) else JsURL(base))
        m = _SCHEME_RE.match(s)
        if m:
            self._parse_absolute(s, m.group(1).lower())
            return
        if b is None or not b.special:
            raise ValueError("Invalid URL")
        self._resolve(s, b)

    # -- parsing ------------------------------------------------------------
    def _parse_absolute(self, s: str, scheme: str) -> None:
        self.scheme = scheme
        rest = s[len(scheme) + 1:]
        if scheme not in SPECIAL_PORTS:
            self.special = False
            self.username = self.password = self.hostname = self.port = ""
            hash_i = rest.find("#")
            frag = None
            if hash_i >= 0:
                frag, rest = rest[hash_i + 1:], rest[:hash_i]
            q_i = rest.find("?")
            query = None
            if q_i >= 0:
                query, rest = rest[q_i + 1:], rest[:q_i]
            self._opaque = rest
            self._path = rest
            self._query = query
            self._fragment = frag
            return
        self.special = True
        rest = rest.replace("\\", "/")
        if not rest.startswith("//"):
            # "http:example.com" — treat the rest as authority (WHATWG special authority).
            rest = "//" + rest.lstrip("/")
        self._parse_authority_and_rest(rest[2:].lstrip("/"))

    def _parse_authority_and_rest(self, s: str) -> None:
        end = len(s)
        for ch in "/?#":
            i = s.find(ch)
            if 0 <= i < end:
                end = i
        auth, tail = s[:end], s[end:]
        self._set_authority(auth)
        self._set_tail(tail)

    def _set_authority(self, auth: str) -> None:
        self.username = self.password = ""
        if "@" in auth:
            userinfo, auth = auth.rsplit("@", 1)
            if ":" in userinfo:
                self.username, self.password = userinfo.split(":", 1)
            else:
                self.username = userinfo
        port = ""
        if auth.startswith("["):
            close = auth.find("]")
            host = auth[: close + 1]
            rest = auth[close + 1:]
            if rest.startswith(":"):
                port = rest[1:]
        elif ":" in auth:
            host, port = auth.rsplit(":", 1)
        else:
            host = auth
        try:
            host = unquote_to_bytes(host).decode("utf-8")
        except UnicodeDecodeError as e:
            raise ValueError("Invalid URL") from e
        host = host.lower()
        if self.scheme != "file" and not host:
            raise ValueError("Invalid URL")
        if re.search(r"[\x00\t\n\r #/:<>?@\[\\\]^|%]", host.strip("[]")) and not (
                host.startswith("[") and host.endswith("]")):
            raise ValueError("Invalid URL")
        if any(ord(c) > 0x7F for c in host):
            try:
                host = host.encode("idna").decode("ascii")
            except UnicodeError as e:
                raise ValueError("Invalid URL") from e
        if port:
            if not port.isdigit():
                raise ValueError("Invalid URL")
            port = str(int(port))
            if int(port) > 65535:
                raise ValueError("Invalid URL")
        if port == SPECIAL_PORTS.get(self.scheme):
            port = ""
        self.hostname = host
        self.port = port

    def _set_tail(self, tail: str) -> None:
        frag = None
        h = tail.find("#")
        if h >= 0:
            frag, tail = tail[h + 1:], tail[:h]
        query = None
        q = tail.find("?")
        if q >= 0:
            query, tail = tail[q + 1:], tail[:q]
        self._path = _pct(_remove_dots(tail or "/"), _PATH_ENC)
        self._query = None if query is None else _pct(query, _QUERY_ENC)
        self._fragment = None if frag is None else _pct(frag, _FRAG_ENC)

    def _resolve(self, s: str, b: JsURL) -> None:
        self.scheme = b.scheme
        self.special = True
        s = s.replace("\\", "/")
        if s.startswith("//"):
            self._parse_authority_and_rest(s[2:].lstrip("/"))
            return
        self.username, self.password = b.username, b.password
        self.hostname, self.port = b.hostname, b.port
        if s == "":
            self._path, self._query, self._fragment = b._path, b._query, None
            return
        if s.startswith("#"):
            self._path, self._query = b._path, b._query
            self._fragment = _pct(s[1:], _FRAG_ENC)
            return
        if s.startswith("?"):
            self._path = b._path
            self._set_query_frag(s[1:])
            return
        if s.startswith("/"):
            self._set_tail(s)
            return
        base_dir = b._path[: b._path.rfind("/") + 1] if "/" in b._path else "/"
        self._set_tail(base_dir + s)

    def _set_query_frag(self, s: str) -> None:
        frag = None
        h = s.find("#")
        if h >= 0:
            frag, s = s[h + 1:], s[:h]
        self._query = _pct(s, _QUERY_ENC)
        self._fragment = None if frag is None else _pct(frag, _FRAG_ENC)

    # -- accessors -----------------------------------------------------------
    @property
    def protocol(self) -> str:
        return self.scheme + ":"

    @protocol.setter
    def protocol(self, value: str) -> None:
        new = value.rstrip(":").lower()
        if self.special and new in SPECIAL_PORTS and new != "file":
            self.scheme = new
            if self.port == SPECIAL_PORTS.get(new):
                self.port = ""

    @property
    def host(self) -> str:
        return self.hostname + (":" + self.port if self.port else "")

    @property
    def pathname(self) -> str:
        return self._path

    @property
    def search(self) -> str:
        return "?" + self._query if self._query else ""

    @property
    def hash(self) -> str:
        return "#" + self._fragment if self._fragment else ""

    @hash.setter
    def hash(self, value: str) -> None:
        v = value.removeprefix("#")
        self._fragment = _pct(v, _FRAG_ENC) if v else None

    @property
    def origin(self) -> str:
        return f"{self.scheme}://{self.host}" if self.special else "null"

    @property
    def href(self) -> str:
        if not self.special:
            out = f"{self.scheme}:{self._opaque}"
        else:
            cred = ""
            if self.username or self.password:
                cred = self.username + (":" + self.password if self.password else "") + "@"
            out = f"{self.scheme}://{cred}{self.host}{self._path}"
        if self._query is not None:
            out += "?" + self._query
        if self._fragment is not None:
            out += "#" + self._fragment
        return out

    def __str__(self) -> str:
        return self.href

    # -- searchParams --------------------------------------------------------
    def search_params(self) -> list[tuple[str, str]]:
        if not self._query:
            return []
        out: list[tuple[str, str]] = []
        for part in self._query.split("&"):
            if not part:
                continue
            k, _, v = part.partition("=")
            out.append((_form_decode(k), _form_decode(v)))
        return out

    def search_param(self, name: str) -> str | None:
        for k, v in self.search_params():
            if k == name:
                return v
        return None

    def delete_search_param(self, name: str) -> None:
        kept = [(k, v) for k, v in self.search_params() if k != name]
        ser = "&".join(f"{_form_encode(k)}={_form_encode(v)}" for k, v in kept)
        self._query = ser if ser else None


def try_url(url: Any, base: Any = None) -> JsURL | None:
    try:
        return JsURL(str(url), None if base is None else str(base))
    except (ValueError, UnicodeError):
        return None
