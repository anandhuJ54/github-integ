"""disco site contract (v3) — Python port of ``-disco-site-contract.ts``.

Universal keys + category taxonomy keys: learn (mapSite) + apply (harvest). Also the ONE
JSON-LD reader used by the disco AI worker. Pure functions: no DB access, no network.

Every TS export is available here under its snake_case name (constants unchanged). Contracts,
field specs, locators, rules and samples are plain dicts with the TS key names; results that
were TS objects are dicts with the TS key names (e.g. ``apply_site_contract(...)["values"]``).
Options bags (ApplyOptions) accept camelCase or snake_case keys (``firm_signatures`` /
``firmSignatures``). Functions that took one ``args`` object accept that dict positionally or
keyword arguments in snake_case.
"""

from __future__ import annotations

from ._dom import parse_call_count
from .apply import (
    ACTION_SEP,
    apply_site_contract,
    collect_all_credential_texts,
    collect_all_same_as_urls,
    decode_action,
    encode_action,
    fill_address_parts,
    video_from_url,
)
from .doc import ParsedDoc, doc_of, parse_document
from .jsonld import (
    ENTITY_TYPE_RE,
    JSONLD_SKIP_KEYS,
    classify_subject,
    collect_embedded_entities,
    collect_json_ld_objects,
    collect_site_entity_names,
    deep_find_key,
    embedded_entity_urls,
    extract_embedded_state,
    extract_json_ld_blocks,
    fnv1a64,
    has_page_specific_entity_json_ld,
    json_ld_signature,
    json_ld_types,
    order_by_page_tie,
    page_entity_evidence,
)
from .keys import (
    EXTRA_PREFIX,
    EXTRA_SUBJECTS,
    EXTRA_VALUE_TYPES,
    FIELD_MEANINGS,
    FIRM_KEYS,
    HELPER_IDS,
    LOCATION_KEYS,
    PERSON_IDENTITY_KEYS,
    PERSON_KEYS,
    STATIC_FORMATS,
    TAX_PREFIX,
    all_field_ids,
    field_type,
    is_alias,
    is_classifier,
    is_derived,
    is_extra_id,
    is_identity_id,
    is_tax_id,
)
from .learn import (
    EXTRA_DROPPED_CAP,
    EXTRA_FIELDS_CAP,
    MUST_HAVE_REQUIRED,
    ORGANIZATION_TYPES,
    add_derived_address_fields,
    apply_extra_fields,
    apply_value_rules,
    build_json_ld_fields,
    choose_extra_container,
    compute_must_have,
    count_distinct_fields,
    extra_key_words,
    extra_sample_agrees,
    extra_sample_items,
    finalize_extra_fields,
    finalize_site_contract,
    firm_signatures_across,
    is_static_extra_key,
    locator_target_ids,
    locator_targets_chrome,
    meaningful_words,
    merge_css_rules,
    must_have_ids,
    normalize_extra_key,
    shares_meaningful_word,
    suppressed_ids,
)
from .staging import (
    action_key,
    action_type,
    apply_address_owner,
    boilerplate_key,
    build_harvest_record,
    build_staging_static,
    count_staging_fields,
    drop_placeholder_phones,
    format_url,
    is_hours_text,
    is_placeholder_phone,
    is_real_bio,
    record_must_have,
    split_post_nominals,
    to_credential,
    to_e164,
    to_place_id,
    to_us_phone10,
)
from .taxonomy import (
    FIRM_BRAND_IDS,
    FIRM_DIAGNOSTICS_CAP,
    add_taxonomy_aliases,
    apply_taxonomy_roles,
    build_firm_profile,
    build_static_routes,
    build_taxonomy_json_ld_fields,
    chrome_html_for_prompt,
    clean_html_for_prompt,
    default_role_of,
    distinctive_words,
    filter_taxonomy_rows,
    firm_locator_ids,
    is_mergeable_id,
    is_route_target,
    mark_kept_fields,
    merge_firm_rules,
    previous_contract_rules,
    resolve_taxonomy_keys,
    static_target_for_key,
    taxonomy_action_ids,
    taxonomy_item_words,
    taxonomy_locator_ids,
    taxonomy_logo_ids,
    taxonomy_prompt_lines,
    taxonomy_role_lines,
    taxonomy_subject_map,
    taxonomy_subjects,
    taxonomy_type,
    taxonomy_types,
)
from .values import (
    derive_address_part,
    is_cut_off_text,
    is_toll_free_number,
    is_value_anchored,
    join_parts,
    looks_not_found,
    normalize_address,
    normalize_geo,
    parse_address,
    parse_office_block,
    strip_trailing_phone,
    strip_trailing_separator,
    validate_value,
)

# Alternative snake_case spellings (JsonLd -> jsonld, SameAs -> sameas, Phone10 -> phone_10).
extract_jsonld_blocks = extract_json_ld_blocks
collect_jsonld_objects = collect_json_ld_objects
jsonld_types = json_ld_types
jsonld_signature = json_ld_signature
has_page_specific_entity_jsonld = has_page_specific_entity_json_ld
build_jsonld_fields = build_json_ld_fields
build_taxonomy_jsonld_fields = build_taxonomy_json_ld_fields
collect_all_sameas_urls = collect_all_same_as_urls
to_us_phone_10 = to_us_phone10

__all__ = [
    "ACTION_SEP", "ENTITY_TYPE_RE", "EXTRA_DROPPED_CAP", "EXTRA_FIELDS_CAP", "EXTRA_PREFIX",
    "EXTRA_SUBJECTS", "EXTRA_VALUE_TYPES", "FIELD_MEANINGS", "FIRM_BRAND_IDS",
    "FIRM_DIAGNOSTICS_CAP", "FIRM_KEYS", "HELPER_IDS", "JSONLD_SKIP_KEYS", "LOCATION_KEYS",
    "MUST_HAVE_REQUIRED", "ORGANIZATION_TYPES", "PERSON_IDENTITY_KEYS", "PERSON_KEYS",
    "STATIC_FORMATS", "TAX_PREFIX", "ParsedDoc",
    "action_key", "action_type", "add_derived_address_fields", "add_taxonomy_aliases",
    "all_field_ids", "apply_address_owner", "apply_extra_fields", "apply_site_contract",
    "apply_taxonomy_roles", "apply_value_rules", "boilerplate_key", "build_firm_profile",
    "build_harvest_record", "build_json_ld_fields", "build_jsonld_fields",
    "build_staging_static", "build_static_routes", "build_taxonomy_json_ld_fields",
    "build_taxonomy_jsonld_fields", "choose_extra_container", "chrome_html_for_prompt",
    "classify_subject", "clean_html_for_prompt", "collect_all_credential_texts",
    "collect_all_same_as_urls", "collect_all_sameas_urls", "collect_embedded_entities",
    "collect_json_ld_objects", "collect_jsonld_objects", "collect_site_entity_names",
    "compute_must_have", "count_distinct_fields", "count_staging_fields", "decode_action",
    "deep_find_key", "default_role_of", "derive_address_part", "distinctive_words", "doc_of",
    "drop_placeholder_phones", "embedded_entity_urls", "encode_action", "extra_key_words",
    "extra_sample_agrees", "extra_sample_items", "extract_embedded_state",
    "extract_json_ld_blocks", "extract_jsonld_blocks", "field_type", "fill_address_parts",
    "filter_taxonomy_rows", "finalize_extra_fields", "finalize_site_contract",
    "firm_locator_ids", "firm_signatures_across", "fnv1a64", "format_url",
    "has_page_specific_entity_json_ld", "has_page_specific_entity_jsonld", "is_alias",
    "is_classifier", "is_cut_off_text", "is_derived", "is_extra_id", "is_hours_text",
    "is_identity_id", "is_mergeable_id", "is_placeholder_phone", "is_real_bio",
    "is_route_target", "is_static_extra_key", "is_tax_id", "is_toll_free_number",
    "is_value_anchored", "join_parts", "json_ld_signature", "json_ld_types", "jsonld_signature",
    "jsonld_types", "locator_target_ids", "locator_targets_chrome", "looks_not_found",
    "mark_kept_fields", "meaningful_words", "merge_css_rules", "merge_firm_rules",
    "must_have_ids", "normalize_address", "normalize_extra_key", "normalize_geo",
    "order_by_page_tie", "page_entity_evidence", "parse_address", "parse_call_count",
    "parse_document", "parse_office_block", "previous_contract_rules", "record_must_have",
    "resolve_taxonomy_keys", "shares_meaningful_word", "split_post_nominals",
    "static_target_for_key", "strip_trailing_phone", "strip_trailing_separator",
    "suppressed_ids", "taxonomy_action_ids", "taxonomy_item_words", "taxonomy_locator_ids",
    "taxonomy_logo_ids", "taxonomy_prompt_lines", "taxonomy_role_lines", "taxonomy_subject_map",
    "taxonomy_subjects", "taxonomy_type", "taxonomy_types", "to_credential", "to_e164",
    "to_place_id", "to_us_phone10", "to_us_phone_10", "validate_value", "video_from_url",
]
