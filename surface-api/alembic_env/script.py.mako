"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Owner: this folder's Surface. Hand-written: SQL through op.execute(...). New tables ENABLE and
FORCE ROW LEVEL SECURITY; no grants to anon or PUBLIC (AGENTS.md §3). Declare `depends_on` for
any table another branch creates. Never edit this file once it has been applied anywhere shared.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
${imports if imports else ""}
revision: str = ${repr(up_revision)}
down_revision: str | Sequence[str] | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
