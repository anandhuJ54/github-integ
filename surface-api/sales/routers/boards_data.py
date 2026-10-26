"""sales boards (S4) — replaces the direct supabase-js calls in surface-ui/sales/src/lib/
seller-desk.ts, seller-board.ts, sales-board.ts and sales-story.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser.
Reads return each loader's rows raw (one request per loader); the browser keeps every status
rule, pacing, attainment and money rollup. Writes are the browser's statements: each request
model allow-lists the columns the page sends, and only the keys sent are written; the referral
request's callback time is the server's clock + 2 days.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import Field

from _base.auth import current_user
from sales.queries import boards as q
from sales.routers.cpq_data import _Body, _read_with, _write_with

router = APIRouter(prefix="/sales/boards", tags=["sales"])


# --- seller desk -----------------------------------------------------------------------------

@router.get("/desk/{rep_id}")
def load_desk(rep_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadSellerDesk's rows: `{ rep, territories, bookTotal, bookClaimed, events, demos,
    revenue, quarters }` (a failed count is null), or null when there is no such rep."""
    return _read_with(claims, q.load_desk, rep_id)


class SalesDeskNewProfiles(_Body):
    territory_ids: list[str] = Field(min_length=1, max_length=1000)
    days: int = Field(ge=0, le=3660)


@router.post("/desk/new-profiles")
def count_new_profiles(body: SalesDeskNewProfiles, claims: dict = Depends(current_user)) -> dict:
    """countNewProfiles: `{ count }` of the territories' professionals created in the last `days`
    days (server clock; null when the count failed). A read; POST so a long id list fits."""
    return _read_with(claims, q.count_new_profiles, body.territory_ids, body.days)


# --- seller board / story --------------------------------------------------------------------

@router.get("/seller-board")
def load_seller_board(claims: dict = Depends(current_user)) -> dict:
    """loadSellerBoard's rows: `{ reps, quotas, pipeline }`."""
    return _read_with(claims, q.load_seller_board)


@router.get("/roster")
def load_roster(claims: dict = Depends(current_user)) -> dict:
    """loadRoster's rows: `{ reps, metrics, quotas, stats }`."""
    return _read_with(claims, q.load_roster)


@router.get("/category-story")
def load_category_story(claims: dict = Depends(current_user)) -> dict:
    """loadCategoryStory's rows: `{ stats, metrics, reps }`."""
    return _read_with(claims, q.load_category_story)


# --- sales board -----------------------------------------------------------------------------

@router.get("/board")
def load_board(claims: dict = Depends(current_user)) -> dict:
    """loadBoardData's rows: `{ reps, events, revenue, demos, notes, quotas, metrics,
    territories, groups, adoption, orgs }` (events: the newest 1000 claim events)."""
    return _read_with(claims, q.load_board)


class SalesBoardNoteNew(_Body):
    """addNote's row."""
    seller_id: str | None = None
    subject_label: str | None = None
    subject_type: str | None = None
    body: str | None = None
    callback_priority: bool | None = None
    callback_at: str | None = None  # Postgres parses the timestamp text, as through PostgREST
    created_by: str | None = None


@router.post("/notes")
def add_note(body: SalesBoardNoteNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.add_note, body.sent())


class SalesBoardReferralNew(_Body):
    """requestReferral's note (subject_type, callback_priority and callback_at set by the
    server)."""
    seller_id: str | None = None
    subject_label: str | None = None
    body: str | None = None
    created_by: str | None = None


@router.post("/referral-requests")
def request_referral(body: SalesBoardReferralNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.request_referral, body.sent())


class SalesBoardNotePatch(_Body):
    callback_priority: bool


@router.patch("/notes/{note_id}")
def set_callback_priority(note_id: str, body: SalesBoardNotePatch,
                          claims: dict = Depends(current_user)) -> dict:
    """setCallbackPriority."""
    return _write_with(claims, q.set_callback_priority, note_id, body.callback_priority)
