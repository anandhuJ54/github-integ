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
from pydantic import BaseModel, ConfigDict, Field

from _base.auth import current_user
from _base.db import session as db
from _base.server_fn import optional_user
from surfaces.marketing.queries import nav_menus as nav
from surfaces.marketing.queries import website as q
from surfaces.marketing.queries.website import MultipleRows

router = APIRouter(prefix="/marketing/website", tags=["marketing"])

Ids = Field(max_length=1000)


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


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)

    def row(self, *exclude: str) -> dict[str, Any]:
        """Every column (an insert whose payload always carried them all)."""
        return self.model_dump(exclude=set(exclude))


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

class WebPageNew(_Body):
    title: str
    slug: str
    page_type: str
    updated_by: str | None = None


@router.post("/pages")
def create_page(body: WebPageNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_page, body.row())


class WebPagePatch(_Body):
    """updatePage (editor save), applyPageTemplate, appendSectionTemplate, setPageDesignTag."""
    title: str | None = None
    slug: str | None = None
    seo_title: str | None = None
    seo_desc: str | None = None
    body: Any = None
    design_tag: str | None = None
    updated_by: str | None = None


@router.patch("/pages/{page_id}")
def update_page(page_id: str, body: WebPagePatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_page, page_id, body.sent())


class WebPageBy(_Body):
    updated_by: str | None = None


class WebPageDeletedBy(_Body):
    deleted_by: str | None = None


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


class WebPageTemplateLink(_Body):
    template_id: str | None


@router.put("/pages/{page_id}/template")
def set_page_template(page_id: str, body: WebPageTemplateLink,
                      claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_page_template, page_id, body.template_id)


class WebPageCopy(_Body):
    """duplicatePage: `slug_base` is the page's `slugify(`${slug ?? title}-copy`)`."""
    slug_base: str = Field(max_length=500)
    title: str
    page_type: str
    body: Any = None
    seo_title: str | None = None
    seo_desc: str | None = None
    design_tag: str | None = None  # sent only when the source page had one
    updated_by: str | None = None


@router.post("/pages/duplicate")
def duplicate_page(body: WebPageCopy, claims: dict = Depends(current_user)) -> dict:
    v = body.sent()
    base = v.pop("slug_base")
    for k in ("body", "seo_title", "seo_desc", "updated_by"):  # always in the page's insert
        v.setdefault(k, None)
    return _write_with(claims, q.duplicate_page, base, v)


class WebPageFromTemplate(_Body):
    """createPageFromTemplate: `slug_base` is the page's `slugify(title)`."""
    slug_base: str = Field(max_length=500)
    title: str
    page_type: str
    body: Any = None
    seo_title: str | None = None
    seo_desc: str | None = None
    design_tag: str
    updated_by: str | None = None


@router.post("/pages/from-template")
def page_from_template(body: WebPageFromTemplate, claims: dict = Depends(current_user)) -> dict | None:
    v = body.row()
    base = v.pop("slug_base")
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.page_from_template, conn, base, v)


class WebPageIdsBy(_Body):
    ids: list[str] = Ids
    updated_by: str | None = None


class WebPageIds(_Body):
    ids: list[str] = Ids


class WebPageIdsDeletedBy(_Body):
    ids: list[str] = Ids
    deleted_by: str | None = None


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

class WebTemplateNew(_Body):
    name: str
    template_kind: str
    source_page_id: str | None = None
    source_page_title: str | None = None
    body: Any = None
    page_settings: Any = None
    section_indexes: list[int] = Field(default_factory=list, max_length=10000)
    design_tag: str
    created_by: str
    created_by_label: str | None = None


@router.post("/templates")
def create_template(body: WebTemplateNew, claims: dict = Depends(current_user)) -> dict | None:
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.create_template, conn, body.sent())


class WebTemplateName(_Body):
    name: str


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

class WebFormNew(_Body):
    name: str
    slug: str
    destination: str | None = None
    fields: Any = None


@router.post("/forms")
def create_form(body: WebFormNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_form, body.row())


class WebFormPatch(_Body):
    active: bool | None = None


@router.patch("/forms/{form_id}")
def update_form(form_id: str, body: WebFormPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.forms, form_id, body.sent())


@router.delete("/forms/{form_id}")
def delete_form(form_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.forms, form_id)


# --- leads -----------------------------------------------------------------------------------

class WebLeadStatus(_Body):
    status: str


@router.patch("/leads/{lead_id}/status")
def set_lead_status(lead_id: str, body: WebLeadStatus, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_lead_status, lead_id, body.status)


class WebLeadAssignee(_Body):
    assigned_to: str | None


@router.patch("/leads/{lead_id}/assignee")
def assign_lead(lead_id: str, body: WebLeadAssignee, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.assign_lead, lead_id, body.assigned_to)


# --- trust -----------------------------------------------------------------------------------

class WebTrustNew(_Body):
    category: str
    title: str
    body: str | None = None
    doc_url: str | None = None


@router.post("/trust")
def create_trust_item(body: WebTrustNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_trust_item, body.row())


class WebTrustPatch(_Body):
    category: str | None = None
    title: str | None = None
    body: str | None = None
    doc_url: str | None = None
    sort_order: int | None = None


@router.patch("/trust/{item_id}")
def update_trust_item(item_id: str, body: WebTrustPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_trust_item, item_id, body.sent())


@router.delete("/trust/{item_id}")
def delete_trust_item(item_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.trust, item_id)


# --- consent config --------------------------------------------------------------------------

class WebConsentPatch(_Body):
    banner_enabled: bool | None = None
    banner_title: str | None = None
    banner_message: str | None = None
    analytics_default: bool | None = None
    marketing_default: bool | None = None
    policy_url: str | None = None


@router.patch("/consent")
def save_consent_config(body: WebConsentPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.save_consent_config, body.sent())


# --- alerts ----------------------------------------------------------------------------------

class WebAlertNew(_Body):
    alert_type: str
    message: str


@router.post("/alerts")
def create_alert(body: WebAlertNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_alert, body.row())


class WebAlertPatch(_Body):
    active: bool | None = None


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: str, body: WebAlertPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.alerts, alert_id, body.sent())


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.alerts, alert_id)


# --- ads -------------------------------------------------------------------------------------

class WebAdNew(_Body):
    name: str
    placement: str
    budget: int | float | None = None
    starts_on: str | None = None
    ends_on: str | None = None
    creative: Any = None


@router.post("/ads")
def create_ad(body: WebAdNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_ad, body.row())


class WebAdPatch(_Body):
    status: str | None = None


@router.patch("/ads/{ad_id}")
def update_ad(ad_id: str, body: WebAdPatch, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.ads, ad_id, body.sent())


@router.delete("/ads/{ad_id}")
def delete_ad(ad_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.ads, ad_id)


# --- campaigns -------------------------------------------------------------------------------

class WebCampaignNew(_Body):
    name: str
    cohort: str
    channel: str
    starts_on: str | None = None


@router.post("/campaigns")
def create_campaign(body: WebCampaignNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_campaign, body.row())


class WebCampaignPatch(_Body):
    status: str | None = None
    assigned_profiles: int | None = None


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: WebCampaignPatch,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_row, q.campaigns, campaign_id, body.sent())


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete, q.campaigns, campaign_id)


# --- media -----------------------------------------------------------------------------------

class WebMediaNew(_Body):
    title: str
    media_type: str
    url: str
    gated: bool
    form_slug: str | None = None


@router.post("/media")
def create_media(body: WebMediaNew, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.create_media, body.row())


class WebMediaPatch(_Body):
    gated: bool | None = None


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


class WebNavMenuNew(_Body):
    name: str
    menu_type: str
    items: Any = None
    notes: str | None = None


@router.post("/nav-menus")
def create_nav_menu(body: WebNavMenuNew, claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(nav.create_nav_menu, conn, body.row())


class WebNavMenuPatch(_Body):
    name: str | None = None
    items: Any = None
    notes: str | None = None


@router.patch("/nav-menus/{menu_id}")
def update_nav_menu(menu_id: str, body: WebNavMenuPatch,
                    claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, nav.update_nav_menu, menu_id, body.sent())


class WebNavAssignment(_Body):
    menu_type: str
    site: str | None


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
