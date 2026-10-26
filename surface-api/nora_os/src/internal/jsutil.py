"""Small JavaScript-semantics helpers so ported logic matches the TS byte for byte."""
from __future__ import annotations

import datetime as _dt
import math
import re
from typing import Any

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def js_round(x: float) -> float:
    """`Math.round`: halves round toward +Infinity (Python's round() is banker's)."""
    return float(math.floor(x + 0.5))


def date_ms(value: Any) -> float | None:
    """`new Date(value).getTime()` for ISO strings; None stands for NaN (invalid date).

    Date-only strings are UTC (as in JS); naive date-times are treated as UTC too (the
    servers run in UTC, where JS's local-time reading is the same).
    """
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        d = value if value.tzinfo else value.replace(tzinfo=_dt.UTC)
        return d.timestamp() * 1000
    s = str(value).strip()
    if not s:
        return None
    try:
        if _DATE_ONLY.match(s):
            d = _dt.datetime.fromisoformat(f"{s}T00:00:00+00:00")
        else:
            d = _dt.datetime.fromisoformat(s)
            if d.tzinfo is None:
                d = d.replace(tzinfo=_dt.UTC)
    except ValueError:
        return None
    return d.timestamp() * 1000


def now_ms() -> float:
    return _dt.datetime.now(_dt.UTC).timestamp() * 1000


def iso_now() -> str:
    """`new Date().toISOString()` (millisecond precision, `Z`)."""
    return iso(_dt.datetime.now(_dt.UTC))


def iso(d: _dt.datetime) -> str:
    """`Date.prototype.toISOString`."""
    d = d.astimezone(_dt.UTC)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def js_numbers(v: Any) -> Any:
    """JSON numbers as JS prints them: integral floats lose their `.0`."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else v
    if isinstance(v, dict):
        return {k: js_numbers(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [js_numbers(x) for x in v]
    return v


def js_number(v: Any) -> float:
    """`Number(v)` for the values the TS fed it (None → 0, '' → 0, junk → NaN)."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return math.nan


def message(exc: BaseException) -> str:
    """`e instanceof Error ? e.message : String(e)`."""
    return str(exc)


def nz(*values: Any) -> Any:
    """`a ?? b ?? c`: the first value that is not None (null/undefined)."""
    for v in values:
        if v is not None:
            return v
    return None
