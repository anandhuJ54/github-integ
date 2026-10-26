"""The two pure helpers the runner takes from lib/nora-sandbox.ts (telemetry estimate)."""
from __future__ import annotations

from typing import Any

TRACE_LEVELS = ("plan", "read", "check", "call", "warn", "error")


def model_label(tier: str | None) -> str:
    """Normalized model label from a skill's model_tier."""
    t = (tier or "").lower()
    for m in ("deterministic", "haiku", "sonnet", "opus"):
        if m in t:
            return m
    return t or "deterministic"


def estimate_telemetry(skill: dict[str, Any] | None = None) -> dict:
    """Estimate — 400 + 120/read + 200/tool; 0 for deterministic."""
    s = skill or {}
    model = model_label(s.get("model_tier"))
    tokens = (
        0
        if model == "deterministic"
        else 400 + 120 * len(s.get("reads_state") or []) + 200 * len(s.get("tools_used") or [])
    )
    return {
        "model": model,
        "input_tokens": tokens,
        "output_tokens": None,
        "ms": None,
        "estimated": True,
    }
