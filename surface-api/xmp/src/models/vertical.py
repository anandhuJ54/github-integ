"""`xmp.verticals`: the business category an account, agent or survey template belongs to.

Columns: `id`, `name`, `status` plus the standard timestamps. The table keeps the name `verticals`
so existing data loads 1:1, although the repository canon says "category" (needs a ruling).

Other Surfaces never import this class; they reference `xmp.verticals.id` through
`surfaces.xmp.exports.VERTICAL_ID_FK`.
"""

from sqlalchemy import Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.models.account import SCHEMA


class Vertical(IdMixin, TimestampMixin, Base):
    __tablename__ = "verticals"
    __table_args__ = ({"schema": SCHEMA},)

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
