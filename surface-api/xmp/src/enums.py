"""Enumerations of the XMP tables. Columns stay plain integers so existing data loads as-is.

Increment surface-spec/campaigns/campaigns-xmp-tables.
"""
from __future__ import annotations

from enum import IntEnum

# `tiers.parent` of the root (company / HQ) tier of an account.
ROOT_TIER_PARENT = 0


class RecordStatus(IntEnum):
    """`status` of accounts, tiers, tier_agents, users and account_users.

    Only the values whose meaning is known.
    """

    DESTROYED = -2  # set on a tier when it is destroyed
    DEACTIVATED = -1  # deactivating an account sets -1 on its tiers and agents
    ACTIVE = 1  # active; a membership (`account_users`) counts only when active


class TierCategory(IntEnum):
    # The default tier categories; `tier_categories` itself has no owner yet.
    HQ = 1
    REGION = 2
    BRANCH = 3


class ProfileType(IntEnum):
    # `tier_agents.profile_type`
    UNCLAIMED_USER = 1
    CLAIMED_USER = 2
    PROCLAIMED_USER = 3
    ENTERPRISE_USER = 4
