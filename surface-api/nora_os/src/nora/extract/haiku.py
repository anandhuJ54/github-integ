"""Haiku extraction call (port of lib/nora/extract/haiku.server.ts; model tier: haiku).

One structured-output request per page asking ONLY for the brief's unfilled collection keys,
each with its cardinality, expected count and vocabulary. The caller (index.py) still verifies
every item against the page text; this prompt only asks for honesty. Raw HTTP to the Messages
API, as the TS did (no SDK), with the same model, headers and body.
"""
from __future__ import annotations

import json
import os
from collections.abc import Callable
from typing import Any

import httpx

EXTRACT_MODEL = "claude-haiku-5-5"
# Page text sent to the model; longer pages are cut and the cut is reported.
MAX_PAGE_CHARS = 200_000


def _nullable(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "detail": _nullable("string"),
        "price": _nullable("string"),
        "section": _nullable("string"),
        "vocabulary_term": _nullable("string"),
        "evidence": {"type": "string"},
    },
    "required": ["name", "detail", "price", "section", "vocabulary_term", "evidence"],
    "additionalProperties": False,
}


def output_schema(collections: list[dict]) -> dict:
    return {
        "type": "object",
        "properties": {
            "collections": {
                "type": "object",
                "properties": {c["key"]: {"type": "array", "items": ITEM_SCHEMA} for c in collections},
                "required": [c["key"] for c in collections],
                "additionalProperties": False,
            }
        },
        "required": ["collections"],
        "additionalProperties": False,
    }


SIZE = {
    "one": "exactly one value",
    "few": "a short list",
    "many": "a long list — list every item on the page",
}


def build_prompt(args: dict) -> dict:
    """{system, user, truncated} for one page. `args` = {page, categoryName, collections}."""
    system = "\n".join(
        [
            (f"You read one web page belonging to a {args['categoryName']} and list the facts it "
            "states for the requested collections."),
            ("Only report items that are literally written on the page. Do not infer, complete or "
            "add anything."),
            ("For every item, `evidence` must be a short verbatim quote (under 200 characters) "
            "copied from the page that contains the item's name."),
            "`price`, `section` and `detail` must also be copied from the page, or null.",
            ("When a collection lists vocabulary, set `vocabulary_term` to the one term that names "
            "the same thing, or null when none does."),
            "Return an empty array for a collection the page does not mention.",
        ]
    )
    specs = []
    for c in args["collections"]:
        lines = [
            (f'- {c["key"]} ("{c["label"]}"): cardinality {c["cardinality"]} '
            f'({SIZE.get(c["cardinality"])}; typically {c["expected"]["min"]}–{c["expected"]["max"]})')
        ]
        if c["vocabulary"]:
            lines.append(f"  vocabulary: {' | '.join(c['vocabulary'])}")
        specs.append("\n".join(lines))
    spec = "\n".join(specs)
    page = args["page"]
    text = "\n".join(
        f"## {b['text']}" if b["kind"] in ("heading", "title") else b["text"] for b in page["text"]
    )
    truncated = len(text) > MAX_PAGE_CHARS
    if truncated:
        text = text[:MAX_PAGE_CHARS]
    user = f"Collections to fill:\n{spec}\n\nPage: {page['source_url']}\n<page>\n{text}\n</page>"
    return {"system": system, "user": user, "truncated": truncated}


def haiku_extractor(
    *, api_key: str | None = None, post: Callable[..., Any] | None = None
) -> Callable[[dict], dict]:
    """Haiku-backed LlmExtractFn. `post` (httpx.post-compatible) is injectable for tests."""
    key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    do_post = post or httpx.post

    def run(args: dict) -> dict:
        if not args["collections"]:
            return {}
        p = build_prompt(args)
        res = do_post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            content=json.dumps(
                {
                    "model": EXTRACT_MODEL,
                    "max_tokens": 16000,
                    "system": p["system"],
                    "messages": [{"role": "user", "content": p["user"]}],
                    "output_config": {
                        "effort": "low",
                        "format": {"type": "json_schema", "schema": output_schema(args["collections"])},
                    },
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            # fetch() had no client timeout; the runner's 15 s capability timeout bounds it.
            timeout=None,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"anthropic {res.status_code}: {res.text[:400]}")
        msg = res.json()
        if msg.get("stop_reason") == "refusal":
            raise RuntimeError("extraction model declined the page")
        if msg.get("stop_reason") == "max_tokens":
            raise RuntimeError("extraction output hit max_tokens")
        text = "".join(
            (b.get("text") or "") if b.get("type") == "text" else "" for b in (msg.get("content") or [])
        )
        parsed = json.loads(text)
        return parsed.get("collections") or {}

    return run
