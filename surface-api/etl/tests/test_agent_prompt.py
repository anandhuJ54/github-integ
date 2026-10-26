"""Tests for surfaces.etl.disco.agent_prompt (texts must equal what the TS module produced)."""
from __future__ import annotations

from surfaces.etl.disco import agent_prompt as p


def test_system_prompt_escapes_match_js_template_literal():
    # TS template `www\\\\.example` evaluates to `www\\.example` (two backslashes).
    assert '"^https://www\\\\.example\\\\.com/agent/[^/?#]+$"' in p.SYSTEM_PROMPT
    assert "window.__STATE__\\\\s*=\\\\s*(\\\\{.*?\\\\});" in p.SYSTEM_PROMPT
    assert p.SYSTEM_PROMPT.startswith("You are a web research agent.")
    assert p.SYSTEM_PROMPT.endswith("Expected totals and full-run requests; Caveats.")
    assert "\n\nFast plan (follow it):\n1. Turn 1" in p.SYSTEM_PROMPT


def test_tools_shape():
    names = [t["name"] for t in p.TOOLS]
    assert names[0] == "sitemap_probe" and names[-1] == "give_up" and len(names) == 17
    by = {t["name"]: t for t in p.TOOLS}
    assert by["inspect"]["input_schema"] == {
        "type": "object",
        "properties": {"ref": {"type": "string"}, "css": {"type": "string"},
                       "jsonpath": {"type": "string"}, "embedded_css": {"type": "string"},
                       "regex": {"type": "string"}, "search": {"type": "string"},
                       "limit": {"type": "integer"}},
        "required": ["ref"],
    }
    assert by["browser_snapshot"]["input_schema"]["properties"] == {}
    assert "network_detail cN shows" not in by["network_log"]["description"]
    assert by["browser_open"]["description"].startswith("Navigate the browser tab")
    assert "Free - does not fetch anything." in by["inspect"]["description"]
    assert "test_source" in p.PARALLEL_TOOLS and "submit_config" not in p.PARALLEL_TOOLS
    assert p.HEAVY_TOOLS == {"test_source", "coverage_check", "submit_config", "search_scripts"}
