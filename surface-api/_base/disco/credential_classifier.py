"""hasCredential classifier (port of `credential-name-classifier.ts`, Batch 1 + Batch 2, 2026-09-24).

Given a registry node_slug/node_name mapped to JSON-LD `hasCredential` and the credential texts
found on a page, decide deterministically whether this field is recognised and, if so, which
literal page text carries it (never a boolean). Numbered-standard bodies (ASTM, ANSI, ISO) and
FINRA Series take the specific number from the slug and match that number only; a slug naming
the body without a number falls back to a generic mention of the body. No network calls, no
database.

Patterns are the TS regex literals verbatim; slug tests are case-sensitive (the slug is
lowercased first), name tests are case-insensitive (`/i`). re.ASCII keeps JavaScript's ASCII
`\\b` semantics.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

_I = re.IGNORECASE | re.ASCII


@dataclass(frozen=True)
class CredentialAuthorityRule:
    """slug_test: against the slug text (spaces for _/-); name_test: against each page text."""

    label: str
    slug_test: re.Pattern[str]
    name_test: re.Pattern[str]


@dataclass(frozen=True)
class DynamicStandardRule:
    """A numbered-standard body: one rule covers every number the body issues."""

    body_test: re.Pattern[str]
    extract_code: Callable[[str], str | None]
    build_name_test: Callable[[str], re.Pattern[str]]
    label: Callable[[str], str]
    generic_name_test: re.Pattern[str]
    generic_label: str


def _rule(label: str, slug: str, name: str) -> CredentialAuthorityRule:
    return CredentialAuthorityRule(label, re.compile(slug, re.ASCII), re.compile(name, _I))


def _extract(pattern: str) -> Callable[[str], str | None]:
    rx = re.compile(pattern, re.ASCII)

    def extract(s: str) -> str | None:
        m = rx.search(s)
        return m.group(1) if m else None

    return extract


def _name_test(prefix: str) -> Callable[[str], re.Pattern[str]]:
    # The code is inserted unescaped, as the TS did (`new RegExp(`astm[\\s-]*${code}\\b`, 'i')`).
    return lambda code: re.compile(prefix + r"[\s-]*" + code + r"\b", _I)


# ---- dynamic numbered-standard bodies (ASTM, ANSI, ISO, FINRA Series) ----
DYNAMIC_STANDARD_RULES: list[DynamicStandardRule] = [
    DynamicStandardRule(
        body_test=re.compile(r"\bastm\b", re.ASCII),
        extract_code=_extract(r"astm[_-]+([a-z]?\d+(?:-\d+)?)"),
        build_name_test=_name_test("astm"),
        label=lambda code: f"ASTM {code.upper()}",
        generic_name_test=re.compile(r"\bastm\b", _I),
        generic_label="ASTM (general)",
    ),
    DynamicStandardRule(
        body_test=re.compile(r"\bansi\b", re.ASCII),
        extract_code=_extract(r"ansi[_-]+([a-z]?\d+(?:\.\d+)?)"),
        build_name_test=_name_test("ansi"),
        label=lambda code: f"ANSI {code.upper()}",
        generic_name_test=re.compile(r"\bansi\b", _I),
        generic_label="ANSI (general)",
    ),
    DynamicStandardRule(
        body_test=re.compile(r"\biso\b", re.ASCII),
        extract_code=_extract(r"iso[_-]+(\d{4,6})"),
        build_name_test=_name_test("iso"),
        label=lambda code: f"ISO {code}",
        generic_name_test=re.compile(r"\biso\b", _I),
        generic_label="ISO certification (general)",
    ),
    # Batch 2: FINRA Series exams -- the slug names the series number.
    DynamicStandardRule(
        body_test=re.compile(r"\bseries\b|\bfinra\b", re.ASCII),
        extract_code=_extract(r"series[\s_-]?(\d{1,3})(?!\d)"),
        build_name_test=_name_test("series"),
        label=lambda code: f"FINRA Series {code}",
        generic_name_test=re.compile(r"\bfinra\b", _I),
        generic_label="FINRA (general)",
    ),
]

# ---- static authority-level rules (freq >= 8 tier + Batch 2 picks) ----
CREDENTIAL_AUTHORITY_RULES: list[CredentialAuthorityRule] = [
    # --- federal / regulatory agencies ---
    _rule('OSHA', r"\bosha\b", r"\bosha\b"),
    _rule('EPA', r"\bepa\b", r"\bepa\b|environmental protection agency"),
    _rule('USDA', r"\busda\b", r"\busda\b|u\.?s\.? department of agriculture"),
    _rule('FDA', r"\bfda\b", r"\bfda\b|food and drug administration"),
    _rule('CPSC', r"\bcpsc\b", r"\bcpsc\b|consumer product safety commission"),
    _rule('FTC', r"\bftc\b", r"\bftc\b|federal trade commission"),
    _rule('IRS 501(c)(3) tax-exempt status', r"501c3|501\(c\)\(3\)|irs.*determination.*letter|tax.?exempt.*status", r"501\s*\(?c\)?\s*\(?3\)?|tax-?exempt status|irs determination letter"),
    _rule('ADA (accessibility compliance)', r"\bada\b.*(accessib|compliance|title.?(ii|iii)|transition.?plan|compliant)|(accessib|compliance).*\bada\b", r"\bada\b|americans with disabilities act|wcag|accessib(le|ility)"),
    _rule('DOT (Department of Transportation)', r"\bdot\b", r"\bdot\b|department of transportation"),
    _rule('Commercial Driver’s License (CDL)', r"\bcdl\b|commercial.?driver", r"\bcdl\b|commercial driver.?s license"),
    # --- food safety ---
    _rule('ServSafe', r"servsafe", r"servsafe"),
    _rule('HACCP', r"haccp", r"haccp"),
    _rule('Halal certification', r"halal", r"halal"),
    _rule('Kosher certification', r"kosher", r"kosher"),
    _rule('Food handler card', r"food.?handler", r"food handler"),
    _rule('Alcohol server training (TIPS)', r"\btips\b.*(alcohol|server)|alcohol.?server.?(training|certification)", r"\btips\b|alcohol server (training|certification)|servsafe alcohol"),
    _rule('Liquor license', r"liquor.?license|alcohol.?beverage.?license|\babc.?license\b", r"liquor license|alcohol beverage (control|license)"),
    # --- health / medical / first aid ---
    _rule('CPR / First Aid (Red Cross / AHA)', r"\bcpr\b|first.?aid", r"\bcpr\b|first aid|american red cross|american heart association|\baha\b"),
    # --- automotive ---
    _rule('ASE certification', r"\base\b", r"\base\b.{0,20}certif|ase.?certified|automotive service excellence"),
    _rule('AAA Approved Auto Repair', r"\baaa\b.?approved", r"aaa approved auto repair"),
    _rule('Apple Independent Repair Provider', r"apple.?independent.?repair", r"apple independent repair|apple authorized service"),
    # --- fitness ---
    _rule('NASM certification', r"\bnasm\b", r"\bnasm\b|national academy of sports medicine"),
    _rule('AFAA certification', r"\bafaa\b", r"\bafaa\b"),
    # --- professional licenses / bodies ---
    _rule('Notary public commission', r"\bnotary\b", r"notary public"),
    _rule('Cosmetology license', r"cosmetolog(y|ist)", r"cosmetology license"),
    _rule('Veterinary license', r"veterinar(y|ian).?licens", r"veterinary license"),
    _rule('Pesticide applicator license', r"pesticide", r"pesticide applicator license"),
    _rule('State bar / attorney license', r"\bstate.?bar\b|bar.?association", r"state bar|bar association"),
    _rule('CPA (Certified Public Accountant)', r"\bcpa\b", r"\bcpa\b|certified public accountant"),
    # --- real estate (NAR designations) ---
    _rule('NAR ABR Designation', r"\babr\b", r"\babr\b|accredited buyer.?s representative"),
    _rule('NAR CRS Designation', r"\bcrs\b", r"\bcrs\b|certified residential specialist"),
    _rule('NAR GRI Designation', r"\bgri\b", r"\bgri\b|graduate realtor institute"),
    _rule('NAR SRS Designation', r"\bsrs\b", r"\bsrs\b|seller representative specialist"),
    _rule('NAR SRES Designation', r"\bsres\b", r"\bsres\b|seniors real estate specialist"),
    _rule('NAR MRP Certification', r"\bmrp\b", r"\bmrp\b|military relocation professional"),
    _rule('NAR e-PRO Certification', r"e.?pro\b", r"e-?pro\b"),
    # --- insurance / bonding (generic business compliance) ---
    _rule('General liability insurance', r"general.?liability", r"general liability( insurance)?"),
    _rule('Workers’ compensation insurance', r"workers.?comp|workman.?s.?comp", r"workers.? comp(ensation)?|workman.?s comp"),
    _rule('Surety bond', r"surety.?bond|\bbonded\b", r"surety bond|licensed and bonded"),
    _rule('Background check', r"background.?check", r"background check"),
    # --- better business / accreditation ---
    _rule('BBB accreditation', r"\bbbb\b", r"\bbbb\b|better business bureau"),
    # --- Batch 2: financial-advisor credentials (added explicitly, see header) ---
    _rule('CFP (Certified Financial Planner)', r"\bcfp\b", r"\bcfp\b|certified financial planner"),
    _rule('CFA (Chartered Financial Analyst)', r"\bcfa\b", r"\bcfa\b|chartered financial analyst"),
    _rule('ChFC (Chartered Financial Consultant)', r"\bchfc\b", r"\bchfc\b|chartered financial consultant"),
    _rule('CLU (Chartered Life Underwriter)', r"\bclu\b", r"\bclu\b|chartered life underwriter"),
    _rule('AIF (Accredited Investment Fiduciary)', r"\baif\b", r"\baif\b|accredited investment fiduciary"),
    _rule('FLMI (Fellow, Life Management Institute)', r"\bflmi\b", r"\bflmi\b|fellow,? life management institute"),
    _rule('REBC (Registered Employee Benefits Consultant)', r"\brebc\b", r"\brebc\b|registered employee benefits consultant"),
    _rule('RHU (Registered Health Underwriter)', r"\brhu\b", r"\brhu\b|registered health underwriter"),
    _rule('RICP (Retirement Income Certified Professional)', r"\bricp\b", r"\bricp\b|retirement income certified professional"),
    _rule('SEC RIA registration', r"\bria\b|sec.?ria|registered investment adviser", r"\bria\b|registered investment adviser|sec registration"),
    # --- Batch 2: curated freq 3-7 picks (real estate / property / security) ---
    _rule('NAR membership', r"\bnar\b", r"\bnar\b|national association of realtors"),
    _rule('ALTA (American Land Title Association)', r"\balta\b", r"\balta\b|american land title association"),
    _rule('AAMVA', r"\baamva\b", r"\baamva\b"),
    _rule('IREM (Institute of Real Estate Management)', r"\birem\b", r"\birem\b|institute of real estate management"),
    _rule('BOMA (Building Owners and Managers Association)', r"\bboma\b", r"\bboma\b|building owners and managers association"),
    _rule('NARPM (National Association of Residential Property Managers)', r"\bnarpm\b", r"\bnarpm\b"),
    _rule('ICSC (International Council of Shopping Centers)', r"\bicsc\b", r"\bicsc\b"),
    _rule('ASID (American Society of Interior Designers)', r"\basid\b", r"\basid\b"),
    _rule('CISSP', r"\bcissp\b", r"\bcissp\b"),
    _rule('CompTIA Security+', r"security\+|comptia", r"security\+|comptia security"),
    _rule('CISA (security)', r"\bcisa\b", r"\bcisa\b"),
    _rule('AKC (American Kennel Club)', r"\bakc\b", r"\bakc\b|american kennel club"),
]


def classify_credential(node_slug_or_name: str, candidate_texts: list[str]) -> dict:
    """Classify one hasCredential field against the page's credential texts.

    Returns ``{"recognized": False, "value": None}`` (unknown: use the LLM fallback),
    ``{"recognized": True, "value": None, "label": label}`` (known, confidently absent) or
    ``{"recognized": True, "value": text, "label": label}`` (found; the literal page text).
    """
    raw_slug = node_slug_or_name.lower()
    haystack = re.sub(r"[_-]+", " ", raw_slug)

    for dyn in DYNAMIC_STANDARD_RULES:
        if dyn.body_test.search(haystack):
            code = dyn.extract_code(raw_slug)
            name_test = dyn.build_name_test(code) if code else dyn.generic_name_test
            label = dyn.label(code) if code else dyn.generic_label
            match = next((t for t in candidate_texts if name_test.search(t)), None)
            return {"recognized": True, "value": match, "label": label}

    for rule in CREDENTIAL_AUTHORITY_RULES:
        if rule.slug_test.search(haystack):
            match = next((t for t in candidate_texts if rule.name_test.search(t)), None)
            return {"recognized": True, "value": match, "label": rule.label}

    return {"recognized": False, "value": None}
