"""Server function from legacy `lib/site-indexing.functions.ts`: the public read.

`getSiteIndexing` is public and returns only the boolean (every page load reads it from
app/src/root.tsx). The super-admin write `setSiteIndexing` moved to the admin Surface
(/admin/fn/setSiteIndexing, surface audit 2026-10-25).
"""
from __future__ import annotations

from surfaces.search import site_indexing

from _base.server_fn import FnCall, fn_router

router = fn_router("search")


@router.post("/getSiteIndexing")
def get_site_indexing(call: FnCall) -> dict:
    return {"enabled": site_indexing.load_site_indexing_enabled()}
