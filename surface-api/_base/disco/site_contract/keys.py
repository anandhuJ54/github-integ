"""Staging schema v1 keys, formats, field meanings and id helpers."""

from __future__ import annotations

from typing import Any

# Staging schema v1 (docs/ETL-Staging-Data-Schema.md, sections 3a-3d).
PERSON_KEYS: dict[str, str] = {
    "name": "text", "first_name": "text", "last_name": "text", "job_title": "text",
    "headline": "text", "bio": "text", "photo_url": "url", "cover_photo_url": "url",
    "phone": "phone", "fax": "phone", "email": "email", "website": "url", "profile_url": "url",
    "street": "text", "city": "text", "state": "text", "postal_code": "text",
    "languages": "list", "license_number": "text", "license_type": "text", "license_state": "text",
    "credentials": "list", "services": "list", "specialties": "list", "service_areas": "list",
    "social_links": "list", "year_started": "year", "booking_url": "url", "team": "list",
    "education": "list", "awards": "list", "disclaimer": "text", "gbp_place_id": "text",
    "actions": "list", "videos": "list", "gallery": "list",
    # Fix (work history, 2026-10-12): jobs the person has held, as the page lists them.
    "work_history": "list",
    # 3d helpers (mapper only, never written to staging).
    "address_block": "text", "branch_name": "text", "registration_ids": "list", "licenses": "list",
    "years_experience": "number",
}

LOCATION_KEYS: dict[str, str] = {
    "business_name": "text", "street": "text", "city": "text", "state": "text",
    "postal_code": "text", "latitude": "number", "longitude": "number", "phone": "phone",
    "fax": "phone", "email": "email", "website": "url", "description": "text", "logo_url": "url",
    "photo_url": "url", "hours": "list", "timezone": "text", "social_links": "list",
    "gbp_place_id": "text", "actions": "list", "videos": "list", "gallery": "list",
    # 3d helper.
    "address_block": "text",
}

FIRM_KEYS: dict[str, str] = {
    "firm_name": "text", "legal_name": "text", "website": "url", "logo_url": "url",
    "phone_main": "phone", "fax": "phone", "email": "email", "street": "text", "city": "text",
    "state": "text", "postal_code": "text", "description": "text", "social_links": "list",
    # 3d helper.
    "address_block": "text",
}

#: Section 3d: helper ids used inside the mapper; never written to staging.
HELPER_IDS: set[str] = {
    "person.address_block", "location.address_block", "firm.address_block", "person.branch_name",
    "person.registration_ids", "person.licenses", "person.years_experience",
}

_ADDRESS_FORMATS = {"street": "text", "city": "text", "state": "state", "postal_code": "postal"}


def _static_formats() -> dict[str, str]:
    out: dict[str, str] = {}
    for subject, keys in (("person", PERSON_KEYS), ("location", LOCATION_KEYS), ("firm", FIRM_KEYS)):
        for k, t in keys.items():
            fid = f"{subject}.{k}"
            if fid in HELPER_IDS:
                continue
            out[fid] = _ADDRESS_FORMATS.get(k, t)
    out["person.license_state"] = "state"
    out["person.credentials"] = "credential_list"
    out["person.team"] = "member_list"
    out["location.hours"] = "hours_list"
    out["person.gbp_place_id"] = "place_id"
    out["location.gbp_place_id"] = "place_id"
    out["person.actions"] = "action_list"
    out["person.awards"] = "award_list"
    for sj in ("person", "location"):
        out[f"{sj}.videos"] = "video_list"
        out[f"{sj}.gallery"] = "gallery_list"
    out["person.education"] = "education_list"
    out["location.actions"] = "action_list"
    for s in ("person", "location", "firm"):
        out[f"{s}.social_links"] = "link_list"
    return out


#: Section 4: staging write format of each static key.
STATIC_FORMATS: dict[str, str] = _static_formats()

#: Section 3: one-line meaning per id where the key name alone is ambiguous (locator prompt).
FIELD_MEANINGS: dict[str, str] = {
    "person.name": "full name only, without post-nominals (CFP, CEPA ...)",
    "person.first_name": "only when the page shows it separately",
    "person.last_name": "only when the page shows it separately",
    "person.job_title": "one main title, the first one shown",
    "person.headline": "tagline, when the page has one",
    "person.bio": "the person's own description",
    "person.photo_url": "headshot",
    "person.cover_photo_url": "banner image",
    "person.phone": "the person's line as shown on their page",
    "person.fax": "personal fax (office fax is location.fax)",
    "person.website": "the person's own site, not the firm home page and not this profile page",
    "person.profile_url": "this profile page",
    "person.license_number": "main licence number",
    "person.license_type": "main licence type",
    "person.license_state": "main licence state",
    "person.credentials": "designations, licences, registrations",
    "person.services": "services / products / focus areas, as the site words them",
    "person.specialties": (
        "specialisations / audiences, when the site separates them from services"
    ),
    "person.service_areas": "places served",
    "person.social_links": "personal social profiles",
    "person.year_started": "start year",
    "person.booking_url": "appointment / contact link for this person",
    "person.team": (
        "people on this person's team: their names (with role / licence / photo when shown); "
        "not services, tags or headings"
    ),
    "person.education": "degrees / schools",
    "person.work_history": (
        "jobs the person has held, as the page lists them (title, employer, years); "
        "not services or skills"
    ),
    "person.awards": "awards / recognitions",
    "person.disclaimer": "compliance / disclosure line about this person",
    "person.years_experience": "number of years of experience",
    "location.business_name": "office / branch name",
    "location.website": "office page",
    "location.photo_url": "office photo",
    "location.hours": "opening hours per day",
    "location.timezone": "time zone as shown",
    "location.gbp_place_id": (
        "the office's Google place id, from its Google Maps / Business Profile link (href)"
    ),
    "person.actions": (
        "every call-to-action button / link for this person (get a quote, book, schedule, "
        "contact, call, text, demo …): one css rule selecting all of them, multi:true; "
        "not site navigation"
    ),
    "location.actions": (
        "every call-to-action button / link for this office (get a quote, book, schedule, "
        "contact, call, text …): one css rule selecting all of them, multi:true; "
        "not site navigation"
    ),
    "person.videos": (
        "videos of / by this person embedded or linked on the page (YouTube, Vimeo, Wistia … "
        "iframes, players, links): css selecting each video element, multi:true"
    ),
    "location.videos": (
        "videos of / by this office embedded or linked on the page: css selecting each video "
        "element, multi:true"
    ),
    "person.gallery": (
        "this person's photo gallery images (not the headshot, not logos or icons): css "
        "selecting each gallery image, multi:true"
    ),
    "location.gallery": (
        "this office's photo gallery images (office, team, events; not logos or icons): css "
        "selecting each gallery image, multi:true"
    ),
    "person.gbp_place_id": (
        "the person's own Google Business Profile place id, from a Google Maps / Business "
        "Profile link for this person (href), not the office's"
    ),
    "firm.firm_name": "brand name",
    "firm.legal_name": "registered company name",
    "firm.website": "home page",
    "firm.phone_main": "head-office line",
}

#: Person static keys (section 3a). Kept for disco-ai-worker.
PERSON_IDENTITY_KEYS: list[str] = [k for k in PERSON_KEYS if f"person.{k}" not in HELPER_IDS]

KEYS_BY_SUBJECT: dict[str, dict[str, str]] = {
    "person": PERSON_KEYS, "location": LOCATION_KEYS, "firm": FIRM_KEYS,
}

#: Extra key dictionary (2026-10-22): the staging schema's section-4 formats.
EXTRA_VALUE_TYPES = (
    "text", "phone", "email", "url", "state", "postal", "year", "number", "place_id", "list",
)
EXTRA_SUBJECTS = ("person", "location", "firm")

TAX_PREFIX = "tax."
#: C14: extra field ids are 'extra.<key>'.
EXTRA_PREFIX = "extra."


def is_identity_id(fid: str) -> bool:
    """Staging schema v1: identity ids = every section-3 static key."""
    return fid in STATIC_FORMATS


def field_type(fid: str) -> str | None:
    parts = fid.split(".")
    s = parts[0]
    k = parts[1] if len(parts) > 1 else None
    keys = KEYS_BY_SUBJECT.get(s)
    if keys is None or k is None:
        return None
    return keys.get(k)


def all_field_ids(primary: str) -> list[str]:
    """Every field id relevant to a primary subject (location primaries skip person ids)."""
    subjects = ["person", "location", "firm"] if primary == "person" else ["location", "firm"]
    return [f"{s}.{k}" for s in subjects for k in KEYS_BY_SUBJECT[s]]


def is_tax_id(fid: str | None = None) -> bool:
    return bool(fid) and isinstance(fid, str) and fid.startswith(TAX_PREFIX)


def is_extra_id(fid: str | None = None) -> bool:
    return bool(fid) and isinstance(fid, str) and fid.startswith(EXTRA_PREFIX)


def key_of(fid: str | None = None) -> str:
    """Key from a field id ('person.city' -> 'city'); plain keys pass through."""
    if not fid:
        return ""
    i = fid.find(".")
    return fid[i + 1:] if i >= 0 else fid


def is_derived(loc: Any) -> bool:
    return isinstance(loc, dict) and isinstance(loc.get("derived_from"), str)


def is_classifier(loc: Any) -> bool:
    return isinstance(loc, dict) and loc.get("tier") == "classifier"


def is_alias(loc: Any) -> bool:
    return isinstance(loc, dict) and loc.get("tier") == "alias"


def is_empty_value(v: Any) -> bool:
    return (
        v is None
        or (isinstance(v, str) and v.strip() == "")
        or (isinstance(v, list) and len(v) == 0)
    )


def non_empty(v: Any) -> bool:
    return v is not None and not is_empty_value(v)
