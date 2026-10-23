"""Tool schemas for the disco AI worker (copied verbatim from `disco-ai-worker.ts`).

Prompts and tool schemas are data: the model sees exactly what the TS sent.
"""
from __future__ import annotations

import importlib

# ---- structured-output contract for discover_companies ----------------------------------------
# DR-3 (2026-09-30): source-oriented discovery.
DISCOVER_SOURCE_TYPES = [
    "brand_site",
    "portal",
    "directory",
    "review_platform",
    "association",
    "license_registry",
]
DISCOVER_BRAND_MAX = 20
DISCOVER_DIRECTORY_MAX = 10
# Up to 30 sources with evidence per call; the default 4096 can truncate.
DISCOVER_MAX_TOKENS = 8192
# Registries are real per-state / per-county sites; cap them per answer.
DISCOVER_REGISTRY_MAX = 3

DISCOVER_TOOL = {
    "name": "return_top_sources",
    "description":
        "Return the leading real US websites that publish many individual profile pages for a "
        "category.",
    "input_schema": {
        "type": "object",
        "properties": {
            "sources": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Official organisation or site name"},
                        "domain": {
                            "type": "string",
                            "description": "Primary official website domain only, e.g. example.com",
                        },
                        "group": {"type": "string", "enum": ["brand_site", "directory"]},
                        "source_type": {"type": "string", "enum": [*DISCOVER_SOURCE_TYPES]},
                        "authority_rank": {
                            "type": "integer", "description": "1 = strongest within its group",
                        },
                        "profiles_hosted_estimate": {
                            "type": "integer",
                            "description":
                                "Approximate number of individual US profile (or location) pages "
                                "the site publishes for this category",
                        },
                        "evidence": {
                            "type": "string",
                            "description":
                                "Why it ranks here (market share, size, brand strength), including "
                                "the page count",
                        },
                        # P0 site mapper (2026-10-05): optional hints the mapper verifies before use.
                        "directory_url": {
                            "type": "string",
                            "description":
                                "Optional. Full URL of the page on this site that lists or searches "
                                "its individual profiles. Leave empty if not sure.",
                        },
                        "profile_url_example": {
                            "type": "string",
                            "description":
                                "Optional. Full URL of one real individual profile page on this "
                                "site. Leave empty if not sure.",
                        },
                    },
                    "required": [
                        "name",
                        "domain",
                        "group",
                        "source_type",
                        "authority_rank",
                        "profiles_hosted_estimate",
                        "evidence",
                    ],
                },
            },
        },
        "required": ["sources"],
    },
}

CONTRACT_TOOL = {
    "name": "return_site_contract",
    "description": "Return a deterministic parser contract for this site.",
    "input_schema": {
        "type": "object",
        "properties": {
            "roster_pattern": {
                "type": "string",
                "description":
                    "A regular expression matched against a URL to decide whether it is a "
                    "roster/listing page "
                    'for this site, e.g. "/agents/[a-z-]+/?$". Must be a valid regex, not a '
                    "plain-English description.",
            },
            "detail_pattern": {
                "type": "string",
                "description":
                    "A regular expression matched against a URL to decide whether it is an entity "
                    "detail page "
                    'for this site (required), e.g. "/agents/[a-z0-9-]+-\\\\d+$". Must be a valid '
                    "regex.",
            },
            "field_floor": {
                "type": "integer",
                "description": "Count of distinct fields the detail page offers",
            },
            "extraction": {
                "type": "object",
                "description":
                    'How to pull entities out of the detail page. Set "list_source" to "jsonld" '
                    "when the page has "
                    'application/ld+json script tags with the entity data; then "json_path" is '
                    "the array of keys "
                    "to walk from the parsed JSON-LD root to the entity object (or list of entity "
                    "objects), "
                    'and "field_map" maps our field names to the keys on each entity object in '
                    "that JSON-LD, "
                    'e.g. { "list_source": "jsonld", "json_path": ["mainEntity","itemListElement"], '
                    '"field_map": { "name": "name", "phone": "telephone" } }. '
                    'If the page has no JSON-LD entity list, set "list_source" to "none" and leave '
                    "json_path/field_map empty "
                    "-- the page will be queued for per-page extraction instead.",
                "properties": {
                    "list_source": {"type": "string", "enum": ["jsonld", "none"]},
                    "json_path": {"type": "array", "items": {"type": "string"}},
                    "field_map": {"type": "object", "additionalProperties": {"type": "string"}},
                },
                "required": ["list_source"],
            },
        },
        "required": ["roster_pattern", "detail_pattern", "field_floor", "extraction"],
    },
}

METHOD_TOOL = {
    "name": "return_render_mode",
    "description": "Judge whether the raw HTML already contains entity data.",
    "input_schema": {
        "type": "object",
        "properties": {
            "method": {"type": "string", "enum": ["server_crawl", "needs_js_api"]},
            "evidence": {"type": "string", "description": "Short reason"},
        },
        "required": ["method", "evidence"],
    },
}

ROSTER_LINK_TOOL = {
    "name": "pick_roster_link",
    "description":
        "Pick which link, if any, leads to a directory/roster of this category's professionals "
        "or locations.",
    "input_schema": {
        "type": "object",
        "properties": {
            "found": {"type": "boolean"},
            "index": {
                "type": "integer",
                "description": "Index into the numbered link list; omit if found=false",
            },
            "reason": {"type": "string"},
        },
        "required": ["found"],
    },
}

ENTITY_PAGE_TOOL = {
    "name": "return_entity_page",
    "description":
        "Judge whether a page describes ONE identifiable person, professional, or business "
        "(vs a directory/search-form/marketing page).",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_entity_page": {"type": "boolean"},
            "reason": {"type": "string", "description": "Short reason"},
            "entity_kind": {
                "type": "string",
                "enum": ["person", "business"],
                "description":
                    "Only when is_entity_page=true: whether the page describes one person or one "
                    "business/office",
            },
            "fits_category": {
                "type": "boolean",
                "description":
                    "True only if the page's subject belongs to the given category as defined "
                    "(e.g. a client-facing practitioner or office of that category), not a person "
                    "or business in some other role",
            },
        },
        "required": ["is_entity_page", "reason"],
    },
}

# Fix (pattern coverage, 2026-10-05): one small corrective call that only returns a pattern.
PATTERN_TOOL = {
    "name": "return_detail_pattern",
    "description":
        "Return a corrected detail_pattern regular expression for profile (detail) page URLs.",
    "input_schema": {
        "type": "object",
        "properties": {
            "detail_pattern": {
                "type": "string", "description": "Regular expression matched against a full URL",
            },
            "reason": {"type": "string", "description": "Short reason"},
        },
        "required": ["detail_pattern"],
    },
}

NO_PROFILES_TOOL = {
    "name": "return_profile_availability",
    "description":
        "Say whether this website hosts individual profile pages (one per person or office) for "
        "professionals in the category, and if not, where they live.",
    "input_schema": {
        "type": "object",
        "properties": {
            "hosts_profiles": {"type": "string", "enum": ["yes", "no", "unsure"]},
            "where_profiles_live": {
                "type": "string",
                "description":
                    "Short, e.g. \"advisors' own websites\", \"firm search tool that loads "
                    'results via JavaScript", "not publicly listed"',
            },
            "note": {"type": "string"},
            "profiles_url": {
                "type": "string",
                "description":
                    "If individual profiles, or the directory/search that lists them, live at a "
                    "URL on this same company site root (ANY subdomain, e.g. advisor.<root> or "
                    "locations.<root>), give that full URL. Omit if they are on a different "
                    "company's domain or not public.",
            },
        },
        "required": ["hosts_profiles"],
    },
}

# P0 (2026-10-05): one call per map when discovery left no hint for the source.
SOURCE_HINTS_TOOL = {
    "name": "return_profile_urls",
    "description":
        "Give the URL of the page on this website that lists or searches its individual "
        "profiles, and one real profile page URL, if known.",
    "input_schema": {
        "type": "object",
        "properties": {
            "directory_url": {
                "type": "string", "description": "Full URL on this website, or empty if not known",
            },
            "profile_url_example": {
                "type": "string",
                "description":
                    "Full URL of one real profile page on this website, or empty if not known",
            },
        },
        "required": [],
    },
}

LOCATOR_TOOL = {
    "name": "return_locator_rules",
    "description":
        "Return CSS / label extraction rules for the requested field ids, plus labelled facts on "
        "the page that no id covers.",
    "input_schema": {
        "type": "object",
        "properties": {
            "rules": {
                "type": "array",
                "maxItems": 120,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Field id, e.g. person.job_title"},
                        "strategy": {"type": "string", "enum": ["css", "label"]},
                        "css": {"type": "string"},
                        "label": {"type": "string"},
                        "attr": {
                            "type": "string",
                            "enum": ["content", "href", "src", "data-href", "action"],
                        },
                        "multi": {"type": "boolean"},
                        "part": {
                            "type": "string",
                            "enum": ["latitude", "longitude"],
                            "description": "Geo ids only: which coordinate this rule reads.",
                        },
                        "split_commas": {
                            "type": "boolean",
                            "description":
                                "List ids only: true when one element holds several entries "
                                "separated by commas and each part is a complete entry on its own "
                                '(e.g. "Annuities, 529 Plans"); false when parts depend on each '
                                'other (e.g. "Series 7, 63, 65").',
                        },
                        "item_fields": {
                            "type": "object",
                            "description":
                                "person.awards / person.education only, when each entry is a block "
                                "with parts: css of each part relative to the block matched by css "
                                "(keys: title, year, issuer, description, url for awards; school, "
                                "degree, year for education).",
                            "additionalProperties": {"type": "string"},
                        },
                    },
                    "required": ["id", "strategy"],
                },
            },
            "taxonomy_roles": {
                "type": "array",
                "maxItems": 60,
                "description":
                    "Only category keys whose subject differs from the default, plus at most one "
                    "own_page_url key.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Category key id, e.g. tax.<slug>"},
                        "role": {
                            "type": "string", "enum": ["person", "branch", "firm", "own_page_url"],
                        },
                    },
                    "required": ["id", "role"],
                },
            },
            "unkeyed": {
                "type": "array",
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "sample": {"type": "string"},
                        "key": {"type": "string", "description": "snake_case key for this fact"},
                        "match": {
                            "type": "string",
                            "enum": ["existing_extra", "taxonomy", "static", "new"],
                        },
                        "strategy": {"type": "string", "enum": ["css", "label"]},
                        "css": {
                            "type": "string",
                            "description":
                                "Required when strategy is css: a selector that returns this fact "
                                "on every detail page.",
                        },
                        "attr": {
                            "type": "string",
                            "enum": ["content", "href", "src", "data-href", "action"],
                        },
                        "multi": {"type": "boolean"},
                        "split_commas": {
                            "type": "boolean",
                            "description":
                                "true when one element lists several entries separated by commas "
                                "and each part is a complete entry",
                        },
                    },
                    "required": ["label", "sample", "strategy"],
                },
            },
        },
        "required": ["rules", "unkeyed"],
    },
}


def match_extra_tool() -> dict:
    """C14c: extra key matching on real example values (enums from the site-contract keys)."""
    sc = importlib.import_module("_base.disco.site_contract")
    value_types = [*sc.EXTRA_VALUE_TYPES, None]
    subjects = [*sc.EXTRA_SUBJECTS, None]
    return {
        "name": "return_extra_key_matches",
        "description":
            "For each new extra, the existing key holding the same kind of information, or null.",
        "input_schema": {
            "type": "object",
            "properties": {
                "matches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string", "description": "The new extra key"},
                            "match": {
                                "type": ["string", "null"],
                                "description": "Existing key with the same meaning, or null",
                            },
                            "static_id": {
                                "type": ["string", "null"],
                                "description":
                                    "Open static id holding exactly this information, or null",
                            },
                            "reason": {"type": "string", "description": "One short sentence"},
                            "new_key": {
                                "type": ["string", "null"],
                                "description":
                                    "Only when match is null and the key is already in the "
                                    "existing list: a different descriptive snake_case name (no "
                                    "numbers added)",
                            },
                            "definition": {
                                "type": ["string", "null"],
                                "description":
                                    "Only when match is null: one generic sentence saying what "
                                    "the value means (not tied to this site)",
                            },
                            "value_type": {
                                "type": ["string", "null"],
                                "enum": value_types,
                                "description": "Only when match is null: the format of the value",
                            },
                            "subject": {
                                "type": ["string", "null"],
                                "enum": subjects,
                                "description": "Only when match is null: whose fact it is",
                            },
                        },
                        "required": ["key", "match", "reason"],
                    },
                },
            },
            "required": ["matches"],
        },
    }
