"""Demand engine /website CMS data — replaces the direct supabase-js calls in
surface-ui/marketing/src/lib/website.ts.

Moved from xmp (/xmp/website/* → /marketing/website/*), surface audit 2026-10-25. Same SQL,
roles and responses.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser (no
/website page renders for signed-out visitors). The one exception is the assigned site
navigation (`GET /nav-menus/assigned`, the live site chrome's read in
surface-ui/_base/src/lib/nav-menus.ts), which runs as `anon` when signed out. The writes are the browser's own statements:
each request model allow-lists the columns the page sends, and patches write only the keys sent
(as PostgREST did). Inserts write the same fixed column set the page always sent.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from _base.db import session as db
from _base.server_fn import optional_user
from surfaces.marketing.website import nav_menus as nav
from surfaces.marketing.website import services as q
from surfaces.marketing.website.schemas import (
    WebAdNew,
    WebAdPatch,
    WebAlertNew,
    WebAlertPatch,
    WebCampaignNew,
    WebCampaignPatch,
    WebConsentPatch,
    WebFormNew,
    WebFormPatch,
    WebLeadAssignee,
    WebLeadStatus,
    WebMediaNew,
    WebMediaPatch,
    WebNavAssignment,
    WebNavMenuNew,
    WebNavMenuPatch,
    WebPageBy,
    WebPageCopy,
    WebPageDeletedBy,
    WebPageFromTemplate,
    WebPageIds,
    WebPageIdsBy,
    WebPageIdsDeletedBy,
    WebPageNew,
    WebPagePatch,
    WebPageTemplateLink,
    WebTemplateName,
    WebTemplateNew,
    WebTrustNew,
    WebTrustPatch,
)
from surfaces.marketing.website.services import MultipleRows

router = APIRouter(prefix="/marketing/website", tags=["marketing"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except MultipleRows as exc:  # PostgREST answered `.single()` on 0 or 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


# --- loaders ---------------------------------------------------------------------------------

@router.get("/pages")
def pages(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_pages)


@router.get("/pages/trash")
def deleted_pages(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_deleted_pages)


@router.get("/templates")
def page_templates(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_templates)


@router.get("/templates/trash")
def deleted_templates(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_deleted_templates)


@router.get("/forms")
def web_forms(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_forms)


@router.get("/leads")
def web_leads(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_leads)


@router.get("/trust")
def trust_items(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_trust)


@router.get("/consent")
def consent(claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.load_consent)


@router.get("/alerts")
def web_alerts(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_alerts)


@router.get("/ads")
def web_ads(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_ads)


@router.get("/campaigns")
def web_campaigns(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_campaigns)


@router.get("/media")
def web_media(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_media)


@router.get("/sellers")
def sellers(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.load_sellers)


# --- CMS pages -------------------------------------------------------------------------------

@router.post("/pages")
def create_page(body: WebPageNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_page, body.row())


@router.patch("/pages/{page_id}")
def update_page(page_id: str, body: WebPagePatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_page, page_id, body.sent())


@router.post("/pages/{page_id}/publish")
def publish_page(page_id: str, body: WebPageBy, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.publish_page, page_id, body.updated_by)


@router.post("/pages/{page_id}/unpublish")
def unpublish_page(page_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.unpublish_page, page_id)


@router.post("/pages/{page_id}/trash")
def trash_page(page_id: str, body: WebPageDeletedBy, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.trash_page, page_id, body.deleted_by)


@router.post("/pages/{page_id}/restore")
def restore_page(page_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.restore_page, page_id)


@router.delete("/pages/{page_id}")
def purge_page(page_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.purge_page, page_id)


@router.put("/pages/{page_id}/template")
def set_page_template(page_id: str, body: WebPageTemplateLink,
                      claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_page_template, page_id, body.template_id)


@router.post("/pages/duplicate")
def duplicate_page(body: WebPageCopy, claims: dict = Depends(current_user)) -> dict:
    v = body.sent()
    base = v.pop("slug_base")
    for k in ("body", "seo_title", "seo_desc", "updated_by"):  # always in the page's insert
        v.setdefault(k, None)
    return _write_with(claims, q.duplicate_page, base, v)


@router.post("/pages/from-template")
def page_from_template(body: WebPageFromTemplate, claims: dict = Depends(current_user)) -> dict | None:
    v = body.row()
    base = v.pop("slug_base")
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.page_from_template, conn, base, v)


@router.post("/pages/bulk-publish")
def bulk_publish(body: WebPageIdsBy, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.bulk_publish, body.ids, body.updated_by)


@router.post("/pages/bulk-unpublish")
def bulk_unpublish(body: WebPageIds, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.bulk_unpublish, body.ids)


@router.post("/pages/bulk-trash")
def bulk_trash(body: WebPageIdsDeletedBy, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.bulk_trash, body.ids, body.deleted_by)


# --- CMS templates ---------------------------------------------------------------------------

@router.post("/templates")
def create_template(body: WebTemplateNew, claims: dict = Depends(current_user)) -> dict | None:
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.create_template, conn, body.sent())


@router.patch("/templates/{template_id}")
def rename_template(template_id: str, body: WebTemplateName,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.rename_template, template_id, body.name)


@router.post("/templates/{template_id}/trash")
def trash_template(template_id: str, body: WebPageDeletedBy,
                   claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.trash_template, template_id, body.deleted_by)


@router.post("/templates/{template_id}/restore")
def restore_template(template_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.restore_template, template_id)


@router.delete("/templates/{template_id}")
def purge_template(template_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.purge_template, template_id)


# --- forms -----------------------------------------------------------------------------------

@router.post("/forms")
def create_form(body: WebFormNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_form, body.row())


@router.patch("/forms/{form_id}")
def update_form(form_id: str, body: WebFormPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.forms, form_id, body.sent())


@router.delete("/forms/{form_id}")
def delete_form(form_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.forms, form_id)


# --- leads -----------------------------------------------------------------------------------

@router.patch("/leads/{lead_id}/status")
def set_lead_status(lead_id: str, body: WebLeadStatus, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_lead_status, lead_id, body.status)


@router.patch("/leads/{lead_id}/assignee")
def assign_lead(lead_id: str, body: WebLeadAssignee, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.assign_lead, lead_id, body.assigned_to)


# --- trust -----------------------------------------------------------------------------------

@router.post("/trust")
def create_trust_item(body: WebTrustNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_trust_item, body.row())


@router.patch("/trust/{item_id}")
def update_trust_item(item_id: str, body: WebTrustPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_trust_item, item_id, body.sent())


@router.delete("/trust/{item_id}")
def delete_trust_item(item_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.trust, item_id)


# --- consent config --------------------------------------------------------------------------

@router.patch("/consent")
def save_consent_config(body: WebConsentPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.save_consent_config, body.sent())


# --- alerts ----------------------------------------------------------------------------------

@router.post("/alerts")
def create_alert(body: WebAlertNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_alert, body.row())


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, body: WebAlertPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.alerts, alert_id, body.sent())


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.alerts, alert_id)


# --- ads -------------------------------------------------------------------------------------

@router.post("/ads")
def create_ad(body: WebAdNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_ad, body.row())


@router.patch("/ads/{ad_id}")
def update_ad(ad_id: str, body: WebAdPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.ads, ad_id, body.sent())


@router.delete("/ads/{ad_id}")
def delete_ad(ad_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.ads, ad_id)


# --- campaigns -------------------------------------------------------------------------------

@router.post("/campaigns")
def create_campaign(body: WebCampaignNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_campaign, body.row())


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: WebCampaignPatch,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.campaigns, campaign_id, body.sent())


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.campaigns, campaign_id)


# --- media -----------------------------------------------------------------------------------

@router.post("/media")
def create_media(body: WebMediaNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_media, body.row())


@router.patch("/media/{media_id}")
def update_media(media_id: str, body: WebMediaPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.media, media_id, body.sent())


@router.delete("/media/{media_id}")
def delete_media(media_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.media, media_id)


# --- navigation menus (surface-ui/_base/src/lib/nav-menus.ts) ---------------------------------

@router.get("/nav-menus")
def nav_menus(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, nav.load_nav_menus)


@router.get("/nav-menus/trash")
def deleted_nav_menus(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, nav.load_deleted_nav_menus)


@router.get("/nav-menus/assigned")
def assigned_nav(site: str = Query("main_site", max_length=200),
                 claims: dict | None = Depends(optional_user)) -> list:
    """The public site chrome's read: `anon` when signed out (the table's public policy shows
    only assigned, live menus), the signed-in user otherwise."""
    role = db.role_connection("anon") if claims is None \
        else db.role_connection("authenticated", claims)
    with role as conn:
        return _guard(nav.load_assigned_nav, conn, site)


@router.get("/nav-menus/{menu_id}")
def nav_menu(menu_id: str, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, nav.get_nav_menu, menu_id)


@router.post("/nav-menus")
def create_nav_menu(body: WebNavMenuNew, claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(nav.create_nav_menu, conn, body.row())


@router.patch("/nav-menus/{menu_id}")
def update_nav_menu(menu_id: str, body: WebNavMenuPatch,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.update_nav_menu, menu_id, body.sent())


@router.put("/nav-menus/{menu_id}/assignment")
def set_nav_assignment(menu_id: str, body: WebNavAssignment,
                       claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.set_assignment, menu_id, body.menu_type, body.site)


@router.post("/nav-menus/{menu_id}/trash")
def trash_nav_menu(menu_id: str, body: WebPageDeletedBy,
                   claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.soft_delete, menu_id, body.deleted_by)


@router.post("/nav-menus/{menu_id}/restore")
def restore_nav_menu(menu_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.restore, menu_id)


@router.delete("/nav-menus/{menu_id}")
def delete_nav_menu(menu_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.hard_delete, menu_id)
