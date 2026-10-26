"""Server function from legacy `lib/site-indexing.functions.ts`: the public read.

`getSiteIndexing` is public and returns only the boolean (every page load reads it from
shell/root.tsx). The super-admin write `setSiteIndexing` moved to the admin Surface
(/admin/fn/setSiteIndexing, surface audit 2026-10-25).
"""
from __future__ import annotations

from _base.server_fn import FnCall, fn_router
from surfaces.search import internal as site_indexing

router = fn_router("search")


@router.post("/getSiteIndexing")
def get_site_indexing(call: FnCall) -> dict:
    return {"enabled": site_indexing.load_site_indexing_enabled()}
