"""ORM classes of the tables this Surface owns, in its own schema `xmp` (AGENTS.md §4).

The XMP models (increment surface-spec/campaigns/campaigns-xmp-tables), on the shared
`_base.db.base.Base`. They match `db/migrations/bee7556b77dd_xmp_tables.py`:
change a class only together with a new migration. Not in the live database until the migration
is applied (a human-approved step, after the O11 ruling). There is no session table:
Supabase sign-in is the auth boundary.

Queries built from these classes run on the caller's psycopg connection (`_base.db.sql`); its
grants decide. Tenant tables (accounts, tiers, tier_agents, users, account_users) are reachable only by
the service role; `verticals` by any signed-in user. Another Surface never imports these classes:
it reads through `exports.py` and points foreign keys at `exports.*_ID_FK`.
"""
from __future__ import annotations

from surfaces.xmp.models.account import SCHEMA, Account
from surfaces.xmp.models.account_user import AccountUser
from surfaces.xmp.models.tier import Tier
from surfaces.xmp.models.tier_agent import TierAgent
from surfaces.xmp.models.user import User
from surfaces.xmp.models.vertical import Vertical

__all__ = ["SCHEMA", "Account", "AccountUser", "Tier", "TierAgent", "User", "Vertical"]
