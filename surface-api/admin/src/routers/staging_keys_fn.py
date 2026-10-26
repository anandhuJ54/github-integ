"""Staging schema v1 static keys for admin forms (port of `lib/staging-keys.functions.ts`).

Read on the server from the site-contract module so the list lives in one place.
"""
from __future__ import annotations

from fastapi import Depends

from _base.auth import current_user
from _base.server_fn import FnCall, fn_router

router = fn_router("admin")


def staging_keys() -> list[dict]:
    # Imported lazily: the shared disco library is ported separately.
    from _base.disco.site_contract import FIELD_MEANINGS, STATIC_FORMATS

    keys = [
        {"id": key, "subject": key.split(".")[0], "format": fmt,
         "meaning": FIELD_MEANINGS.get(key)}
        for key, fmt in STATIC_FORMATS.items()
    ]
    return sorted(keys, key=lambda k: (k["id"].casefold(), k["id"].swapcase()))


@router.post("/getStagingKeys")
def get_staging_keys(call: FnCall, claims: dict = Depends(current_user)) -> list[dict]:
    return staging_keys()
