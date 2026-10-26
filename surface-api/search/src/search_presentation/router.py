"""Server function from legacy `lib/search-presentation.functions.ts`."""
from __future__ import annotations

from pydantic import ValidationError

from _base.server_fn import FnCall, bad_input, fn_router
from surfaces.search.search_presentation.presentation import load_search_presentation
from surfaces.search.search_presentation.schemas import PresentationInput

router = fn_router("search")


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
