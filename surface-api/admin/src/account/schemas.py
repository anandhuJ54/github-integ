"""Request/response models of the admin `account` resource (moved out of its router modules)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")  # the allow-list: any other column is refused

    def sent(self) -> dict[str, Any]:
        """Only the keys the page sent (PostgREST wrote exactly the JSON body's keys)."""
        return self.model_dump(exclude_unset=True)


class AdminAccountsNames(_Body):
    # one per root organization of at most 1000 organizations (the reads in router.py are capped)
    names: list[str] = Field(max_length=1000)


class AdminAccountsEntitlement(_Body):
    state: str
    tokens_included: int | None = None  # sent only when the page passes tokens


class AdminAccountsLoginAs(_Body):
    node_type: Literal["organization", "professional"]
    node_id: str
    node_name: str
    account_id: str
