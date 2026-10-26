"""GET /srp/claim-profile/{slug} — the claim page's profile + license label."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.srp.claim_profile.schemas import ClaimProfile
from surfaces.srp.claim_profile.services import MultipleRows, claim_profile

router = APIRouter(prefix="/srp", tags=["srp"])


@router.get("/claim-profile/{slug}", response_model=ClaimProfile)
def get_claim_profile(slug: str, claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        try:
            found = claim_profile(conn, slug)
        except MultipleRows as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return found
