"""Server-side compliance gate (§3 + §Compliance).

All AI-generated content, review replies and agent output must pass
`content_compliance_rules` + `exp_category_compliance` server-side before publish.
Real estate: Fair Housing (no steering by protected class; brokerage name in ads;
no sale/price guarantees). Mortgage: RESPA/TILA (no rate guarantees; display NMLS ID).

This is deterministic code, not a model. Missing behaviour returns `not_implemented`,
never faked output.
"""
from __future__ import annotations

from dataclasses import dataclass

from .db import connection


@dataclass(frozen=True)
class ComplianceResult:
    allowed: bool
    violations: list[str]


def check_publishable(text: str, gcid: str) -> ComplianceResult:
    """Run content + category compliance for a gcid. Blocks publish on any violation.

    Delegates the ruleset to the DB (content_compliance_rules, exp_category_compliance)
    so the gate stays authoritative and category-driven, not hard-coded per category.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "select * from exp_category_compliance_check(%s, %s)",  # governed function
            (text, gcid),
        )
        row = cur.fetchone()
    if row is None:
        # No ruleset resolved — fail closed, do not fake an allow.
        return ComplianceResult(allowed=False, violations=["not_implemented:no_ruleset"])
    return ComplianceResult(
        allowed=bool(row["allowed"]),
        violations=list(row.get("violations") or []),
    )
