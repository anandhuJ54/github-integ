"""Registry of every Surface package. Adding a Surface is a PR to this file (shared core).

A Surface name is its folder and its import name (`surfaces.<name>`, the folder `<name>/src`):
lowercase letters and underscores only (`nora_os`, never `nora-os`).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

NAME_PATTERN = r"[a-z_]+"

SURFACES: tuple[str, ...] = (
    "sales",
    "marketing",
    "search",
    "srp",
    "xmp",
    "campaigns",
    "etl",
    "graph",
    "nora_os",
    "skills",
    "conversion_agents",
    "admin",
    "ops",
    "integrations",
    "reports",
)
