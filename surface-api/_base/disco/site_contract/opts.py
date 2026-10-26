"""ApplyOptions: accepted with TS (camelCase) or Python (snake_case) keys."""

from __future__ import annotations

from typing import Any

_ALIASES = {
    "firmSignatures": "firm_signatures",
    "taxSubjects": "tax_subjects",
    "ownPageKey": "own_page_key",
    "actionIds": "action_ids",
    "logoIds": "logo_ids",
}


def norm_opts(opts: dict[str, Any] | None) -> dict[str, Any]:
    """Return a snake_case copy of an ApplyOptions bag (firm_signatures, tax_subjects,
    own_page_key, action_ids, logo_ids, primary)."""
    if not opts:
        return {}
    out: dict[str, Any] = {}
    for k, v in opts.items():
        out[_ALIASES.get(k, k)] = v
    return out


def camel_to_snake(name: str) -> str:
    out = []
    for ch in name:
        if ch.isupper():
            out.append("_" + ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def kwargs_of(args: dict[str, Any] | None, kw: dict[str, Any]) -> dict[str, Any]:
    """Merge a TS-style args object (camelCase keys) with Python keyword arguments."""
    out: dict[str, Any] = {}
    for k, v in (args or {}).items():
        out[camel_to_snake(k)] = v
    for k, v in kw.items():
        out[camel_to_snake(k)] = v
    return out
