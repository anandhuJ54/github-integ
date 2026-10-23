"""Server function from legacy `lib/search-presentation.functions.ts`."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from _base.core.server_fn import FnCall, bad_input, fn_router
from search.presentation import load_search_presentation

router = fn_router("search")


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True)


class SearchDocIn(_Strict):
    id: str
    entity_type: Literal["professional", "location", "brand"]
    entity_id: str
    slug: str | None
    gcid: str | None
    name: str
    title: str | None
    city: str | None
    state: str | None
    zip: str | None
    lat: float | None
    lng: float | None
    rating: float | None
    review_count: float | None
    claimed: bool | None
    rank_score: float | None
    completeness_pct: float | None
    photo_url: str | None


class PresentationInput(_Strict):
    gcid: str | None = Field(max_length=160)
    results: list[SearchDocIn] = Field(max_length=20)


@router.post("/getSearchPresentation")
def get_search_presentation(call: FnCall) -> dict:
    try:
        data = PresentationInput.model_validate(call.data)
    except ValidationError as exc:
        detail = "; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'data'}: {e['msg']}" for e in exc.errors()
        )
        raise bad_input(detail) from exc
    return load_search_presentation(data.gcid, [d.model_dump() for d in data.results])
