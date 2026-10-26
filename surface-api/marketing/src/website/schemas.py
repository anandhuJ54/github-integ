"""Request models for the marketing /website CMS endpoints (moved from `website/router.py`).

Each request model allow-lists the columns the page sends; patches write only the keys sent.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

Ids = Field(max_length=1000)


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)

    def row(self, *exclude: str) -> dict[str, Any]:
        """Every column (an insert whose payload always carried them all)."""
        return self.model_dump(exclude=set(exclude))


class WebPageNew(_Body):
    title: str
    slug: str
    page_type: str
    updated_by: str | None = None


class WebPagePatch(_Body):
    """updatePage (editor save), applyPageTemplate, appendSectionTemplate, setPageDesignTag."""
    title: str | None = None
    slug: str | None = None
    seo_title: str | None = None
    seo_desc: str | None = None
    body: Any = None
    design_tag: str | None = None
    updated_by: str | None = None


class WebPageBy(_Body):
    updated_by: str | None = None


class WebPageDeletedBy(_Body):
    deleted_by: str | None = None


class WebPageTemplateLink(_Body):
    template_id: str | None


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


class WebPageIdsBy(_Body):
    ids: list[str] = Ids
    updated_by: str | None = None


class WebPageIds(_Body):
    ids: list[str] = Ids


class WebPageIdsDeletedBy(_Body):
    ids: list[str] = Ids
    deleted_by: str | None = None


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


class WebTemplateName(_Body):
    name: str


class WebFormNew(_Body):
    name: str
    slug: str
    destination: str | None = None
    fields: Any = None


class WebFormPatch(_Body):
    active: bool | None = None


class WebLeadStatus(_Body):
    status: str


class WebLeadAssignee(_Body):
    assigned_to: str | None


class WebTrustNew(_Body):
    category: str
    title: str
    body: str | None = None
    doc_url: str | None = None


class WebTrustPatch(_Body):
    category: str | None = None
    title: str | None = None
    body: str | None = None
    doc_url: str | None = None
    sort_order: int | None = None


class WebConsentPatch(_Body):
    banner_enabled: bool | None = None
    banner_title: str | None = None
    banner_message: str | None = None
    analytics_default: bool | None = None
    marketing_default: bool | None = None
    policy_url: str | None = None


class WebAlertNew(_Body):
    alert_type: str
    message: str


class WebAlertPatch(_Body):
    active: bool | None = None


class WebAdNew(_Body):
    name: str
    placement: str
    budget: int | float | None = None
    starts_on: str | None = None
    ends_on: str | None = None
    creative: Any = None


class WebAdPatch(_Body):
    status: str | None = None


class WebCampaignNew(_Body):
    name: str
    cohort: str
    channel: str
    starts_on: str | None = None


class WebCampaignPatch(_Body):
    status: str | None = None
    assigned_profiles: int | None = None


class WebMediaNew(_Body):
    title: str
    media_type: str
    url: str
    gated: bool
    form_slug: str | None = None


class WebMediaPatch(_Body):
    gated: bool | None = None


class WebNavMenuNew(_Body):
    name: str
    menu_type: str
    items: Any = None
    notes: str | None = None


class WebNavMenuPatch(_Body):
    name: str | None = None
    items: Any = None
    notes: str | None = None


class WebNavAssignment(_Body):
    menu_type: str
    site: str | None
