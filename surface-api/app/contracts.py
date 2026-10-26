"""Write a Surface's published API shapes to contracts/<surface>/openapi.json.

    uv run python -m app.contracts nora-os

Takes the app's OpenAPI and keeps the Surface's own endpoints (`/<surface>/...`, server
functions under `/<api_surface>/fn/` excluded) plus the schemas they reference. The React
client and other Surfaces read the shapes from there. Rerun when an endpoint changes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def _refs(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            out.add(ref.rsplit("/", 1)[1])
        for v in node.values():
            _refs(v, out)
    elif isinstance(node, list):
        for v in node:
            _refs(v, out)


def surface_openapi(spec: dict, surface: str) -> dict:
    prefix = f"/{surface}/"
    paths = {
        p: ops for p, ops in spec["paths"].items() if p.startswith(prefix) and "/fn/" not in p
    }
    schemas = spec.get("components", {}).get("schemas", {})
    keep: set[str] = set()
    _refs(paths, keep)
    while True:  # follow nested refs to a fixed point
        more: set[str] = set()
        _refs([schemas[n] for n in keep], more)
        if more <= keep:
            break
        keep |= more
    return {
        "openapi": spec["openapi"],
        "info": {"title": f"{surface} API", "version": "1"},
        "paths": dict(sorted(paths.items())),
        "components": {"schemas": {n: schemas[n] for n in sorted(keep)}},
    }


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m app.contracts <surface>", file=sys.stderr)
        return 2
    from app import app

    surface = argv[0]
    out = CONTRACTS / surface / "openapi.json"
    out.write_text(json.dumps(surface_openapi(app.openapi(), surface), indent=2) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
