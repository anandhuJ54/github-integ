"""Tests for the deterministic sameAs and hasCredential classifiers (cases from the TS rules)."""
from __future__ import annotations

from _base.disco.credential_classifier import (
    CREDENTIAL_AUTHORITY_RULES,
    classify_credential,
)
from _base.disco.sameas_classifier import SAMEAS_PLATFORM_RULES, classify_same_as

URLS = [
    "https://www.linkedin.com/in/jane-doe",
    "https://www.facebook.com/janedoe",
    "https://brokercheck.finra.org/individual/summary/123",
]


def test_rule_counts_match_ts():
    assert len(SAMEAS_PLATFORM_RULES) == 377
    assert len(CREDENTIAL_AUTHORITY_RULES) == 63


def test_sameas_linkedin_company_vs_personal():
    # company slug: only /company/ or /school/ URLs qualify; the /in/ URL is not taken
    assert classify_same_as("linkedin_company_page", URLS) == {
        "recognized": True, "url": None, "platform": "LinkedIn Company Page",
    }
    assert classify_same_as("partner_linkedin_profile", URLS) == {
        "recognized": True, "url": URLS[0], "platform": "LinkedIn Personal Profile",
    }


def test_sameas_found_absent_unrecognised():
    assert classify_same_as("Facebook-URL", URLS)["url"] == URLS[1]
    assert classify_same_as("instagram_profile", URLS) == {
        "recognized": True, "url": None, "platform": "Instagram",
    }
    assert classify_same_as("state_licensing_board", URLS) == {"recognized": False}


def test_sameas_word_boundary_and_case():
    # \bbing\b must not fire inside "plumbing"
    assert classify_same_as("plumbing_directory", ["https://bing.com/x"]) == {"recognized": False}
    assert classify_same_as("bing_places", ["https://www.bing.com/maps"])["url"]
    # url tests are case-sensitive, as in the TS (no /i flag)
    assert classify_same_as("youtube_channel", ["https://YOUTUBE.COM/x"])["url"] is None


def test_credential_dynamic_standard_numbers():
    texts = ["Certified to ASTM F1749", "ISO 9001:2015 certified"]
    assert classify_credential("astm_f1749_product_certification", texts) == {
        "recognized": True, "value": texts[0], "label": "ASTM F1749",
    }
    # a different ASTM number does not match the page's F1749
    assert classify_credential("astm_d6400_compliance", texts)["value"] is None
    assert classify_credential("astm_compliance_certification", texts) == {
        "recognized": True, "value": texts[0], "label": "ASTM (general)",
    }
    assert classify_credential("iso_9001_certification", texts)["label"] == "ISO 9001"
    assert classify_credential("iso_9001_certification", texts)["value"] == texts[1]


def test_credential_finra_series():
    texts = ["FINRA Series 7", "Series 66 license"]
    assert classify_credential("finra_series_65_license", texts) == {
        "recognized": True, "value": None, "label": "FINRA Series 65",
    }
    assert classify_credential("series_66_license", texts)["value"] == "Series 66 license"
    assert classify_credential("finra_brokercheck", texts) == {
        "recognized": True, "value": "FINRA Series 7", "label": "FINRA (general)",
    }


def test_credential_static_rules():
    assert classify_credential("cfp_certification", ["Certified Financial Planner"]) == {
        "recognized": True, "value": "Certified Financial Planner",
        "label": "CFP (Certified Financial Planner)",
    }
    assert classify_credential("chfc_designation", ["CFP"])["value"] is None
    assert classify_credential("abr_designation", ["ABR", "CRS"])["value"] == "ABR"
    # ADA only in accessibility context
    assert classify_credential("ada_board_certification_in_prosthodontics", []) == {
        "recognized": False, "value": None,
    }
    assert classify_credential("ada_compliance_status", ["WCAG 2.1 AA"])["value"] == "WCAG 2.1 AA"
    assert classify_credential("safety_training", ["anything"]) == {
        "recognized": False, "value": None,
    }
