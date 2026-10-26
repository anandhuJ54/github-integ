"""sales opportunities (S3) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/opportunity-file.ts and the AuditPanel reads in
components/sales/opportunity-automation.tsx.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
opportunity file's reads come back in one response, raw; the browser still joins them and still
computes the logo intelligence (the money math). Writes are the browser's statements, one endpoint
per supabase-js call, in the browser's order (row, activity event, audit_log row); each request
model allow-lists the columns the page sends and only the keys sent are written. Constant columns
are set by the server, `occurred_at` is the server's clock. The stage moves and closes go through
the allow-listed exp_opp_* functions (q.OPP_RPCS), which take no actor parameter.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.queries import opportunity as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.cpq_data import _Body, _guard, _read_with, _write_with

router = APIRouter(prefix="/sales/opportunities", tags=["sales"])

# Static paths first: /{opp_id}/... has two segments, so nothing below collides.


@router.get("/stages")
def list_stages(claims: dict = Depends(current_user)) -> list:
    """loadStages: the rows, by sort (the browser maps them)."""
    return _read_with(claims, q.list_stages)


@router.get("/stage-requirements")
def list_requirements(stage_key: str = Query(...), claims: dict = Depends(current_user)) -> list:
    """loadStageRequirements(stageKey): the rows, by sort (the browser maps them)."""
    return _read_with(claims, q.list_requirements, stage_key)


@router.get("/list-rows")
def list_rows(claims: dict = Depends(current_user)) -> dict:
    """loadOpportunityList's rows besides the stages: `{ opps, accounts, reps }` (the browser
    joins the names)."""
    return _read_with(claims, q.list_rows)


class SalesOppRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesOppRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed exp_opp_* function (q.OPP_RPCS) with the page's arguments. Returns its
    value (the opportunity's uuid)."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)


class SalesOppContactNew(_Body):
    """addContact's exp_contacts row (source_origin "manual" is set by the server)."""
    account_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    job_title: str | None = None


@router.post("/contacts")
def insert_contact(body: SalesOppContactNew, claims: dict = Depends(current_user)) -> dict:
    """addContact, step 1: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_contact, body.sent())


class SalesOppTaskDone(_Body):
    done: bool | None = None


@router.patch("/tasks/{task_id}")
def set_task_done(task_id: str, body: SalesOppTaskDone, claims: dict = Depends(current_user)) -> dict:
    """setTaskDone: update({ done }).eq("id", taskId)."""
    return _write_with(claims, q.set_task_done, task_id, body.sent())


@router.get("/{opp_id}/file")
def load_file(opp_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadOpportunityFile's rows: `{ opp, stages, links, products, notes, tasks, files, events,
    history, account, ownerRep, meetings, brand, claims, contracts, prices, productCatalog, quote,
    people, lines, scores, locations, territoryLinks, seats, teamReps }`, or null when there is
    no such opportunity."""
    return _read_with(claims, q.load_file, opp_id)


@router.get("/{opp_id}/audit-trail")
def audit_trail(opp_id: str, quote_id: str | None = Query(None),
                claims: dict = Depends(current_user)) -> dict:
    """AuditPanel: `{ owners, promos }` (promos only for a quote)."""
    return _read_with(claims, q.audit_trail, opp_id, quote_id)


class SalesOppContactLinkNew(_Body):
    """addContact, step 2: the exp_opportunity_contacts row (opportunity_id from the path,
    source_origin "manual" set by the server)."""
    contact_id: str | None = None
    role: str | None = None
    is_champion: bool | None = None
    is_primary: bool | None = None
    relationship_strength: int | None = None
    last_touch_at: str | None = None  # Postgres parses the timestamp text, as through PostgREST
    champion_detail: Any = None


@router.post("/{opp_id}/contact-links")
def insert_contact_link(opp_id: str, body: SalesOppContactLinkNew,
                        claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_contact_link, opp_id, body.sent())


class SalesOppContactLinkPatch(_Body):
    """updateOpportunityContact's columns."""
    is_champion: bool | None = None
    relationship_strength: int | None = None
    last_touch_at: str | None = None
    champion_detail: Any = None


@router.patch("/{opp_id}/contact-links/{link_id}")
def update_contact_link(opp_id: str, link_id: str, body: SalesOppContactLinkPatch,
                        claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_contact_link, opp_id, link_id, body.sent())


class SalesOppNoteNew(_Body):
    """addOppNote's row (subject_type / subject_id set by the server). seller_id and created_by
    stay fields: the caller sends the opportunity owner's rep id, not the signed-in user."""
    subject_label: str | None = None
    seller_id: str | None = None
    created_by: str | None = None
    body: str | None = None
    pinned: bool | None = None
    mentions: list[str] | None = None


@router.post("/{opp_id}/notes")
def insert_note(opp_id: str, body: SalesOppNoteNew, claims: dict = Depends(current_user)) -> dict:
    """addOppNote: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_note, opp_id, body.sent())


class SalesOppNotePatch(_Body):
    body: str | None = None
    pinned: bool | None = None
    mentions: list[str] | None = None


@router.patch("/{opp_id}/notes/{note_id}")
def update_note(opp_id: str, note_id: str, body: SalesOppNotePatch,
                claims: dict = Depends(current_user)) -> dict:
    """updateOppNote."""
    return _write_with(claims, q.update_note, opp_id, note_id, body.sent())


class SalesOppTaskNew(_Body):
    """addOppTask's row (done false set by the server). owner_id stays a field: the callers send
    the opportunity owner's rep id."""
    account_id: str | None = None
    owner_id: str | None = None
    title: str | None = None
    task_type: str | None = None
    due_at: str | None = None
    priority: str | None = None


@router.post("/{opp_id}/tasks")
def insert_task(opp_id: str, body: SalesOppTaskNew, claims: dict = Depends(current_user)) -> dict:
    """addOppTask: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_task, opp_id, body.sent())


class SalesOppActivityNew(_Body):
    """recordOpportunityActivity's row (subject, source "manual" and occurred_at set by the
    server). actor stays a field: the caller sends the opportunity owner's name (or null)."""
    event_type: str | None = None
    account_id: str | None = None
    actor: str | None = None
    value: Any = None


@router.post("/{opp_id}/activity")
def insert_activity(opp_id: str, body: SalesOppActivityNew,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_activity, opp_id, body.sent())


class SalesOppAuditNew(_Body):
    """auditOpportunityWrite's row (entity_type "opportunity", entity_id from the path)."""
    action: str
    field_changes: Any = None


@router.post("/{opp_id}/audit")
def insert_audit(opp_id: str, body: SalesOppAuditNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_audit, opp_id, body.sent())


class SalesOppDemoNew(_Body):
    """bookOpportunityDemo's row (is_demo false set by the server). seller_id stays a field."""
    seller_id: str | None = None
    booked_at: str | None = None
    objective: str | None = None
    agenda: str | None = None
    attendees: list[str] | None = None


@router.post("/{opp_id}/demos")
def insert_demo(opp_id: str, body: SalesOppDemoNew, claims: dict = Depends(current_user)) -> dict:
    """bookOpportunityDemo: insert(...).select("id").single(). Returns {id}."""
    return _write_with(claims, q.insert_demo, opp_id, body.sent())


class SalesOppDemoDone(_Body):
    """completeOpportunityDemo's columns (attended true set by the server)."""
    outcome: str | None = None
    follow_up: str | None = None
    disposition: str | None = None
    recording_url: str | None = None


@router.post("/{opp_id}/demos/{demo_id}/complete")
def complete_demo(opp_id: str, demo_id: str, body: SalesOppDemoDone,
                  claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.complete_demo, opp_id, demo_id, body.sent())


class SalesOppFileNew(_Body):
    """recordOppFile's row (no storage upload). uploaded_by stays a field (no caller today)."""
    filename: str | None = None
    kind: str | None = None
    size_bytes: int | None = None
    uploaded_by: str | None = None


@router.post("/{opp_id}/files")
def insert_file(opp_id: str, body: SalesOppFileNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.insert_file, opp_id, body.sent())
