"""sales accounts (S2) — port of the supabase-js calls in surface-ui/sales/src/lib/accounts.ts:
the account hierarchy (organizations, professionals), their contracts (exp_contracts), the
"discovered" counts (exp_entity), entitlements (exp_products, exp_entitlements) and the
login-as audit row (audit_log).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape and the 1000-row cap: the browser's `.limit(5000)` on organizations (38k rows)
and professionals (116k) was cut to 1000 by PostgREST and still is (follow-up 1j). Those reads
have no ORDER BY, so which 1000 rows come back is up to Postgres, for both. Reads whose error the
browser ignored (the contracts, every exact count) are tolerant; the others are not.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from _base.core.sql import fetch_many
from _base.schema import tables as T
from sales.queries.cpq import cols, execute

orgs = T.t_organizations
pros = T.t_professionals
contracts = T.t_exp_contracts
entity = T.t_exp_entity
products = T.t_exp_products
entitlements = T.t_exp_entitlements
audit = T.t_audit_log

ORG_COLS = ("id,name,slug,entity_type,parent_org_id,hierarchy_depth,is_active,claimed,"
            "search_rank_score,address_city,address_state")
PRO_COLS = "id,display_name,first_name,last_name,slug,primary_org_id,claimed,search_rank_score,job_title"
LIST_CONTRACT_COLS = "account_id,org_id,status,mrr"
TREE_CONTRACT_COLS = "id,name,account_id,org_id,status,mrr,token_package,start_date"
ENTITLEMENT_COLS = "id,product_key,state,tokens_included,source,granted_at"


def _rows(conn: psycopg.Connection, contract_cols: str) -> dict[str, list[dict[str, Any]]]:
    """The three reads of loadAccounts / loadAccount: organizations and professionals (both
    threw; `.limit(5000)` cut to the 1000 cap; no ORDER BY), then the contracts (error ignored:
    `data ?? []`; no ORDER BY)."""
    out = fetch_many(conn, {
        "orgs": select(*cols(orgs, ORG_COLS)).limit(5000),
        "pros": select(*cols(pros, PRO_COLS)).limit(5000),
    })
    out.update(fetch_many(conn, {"contracts": select(*cols(contracts, contract_cols))},
                          tolerant=True))
    return out


def list_rows(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadAccounts' reads."""
    return _rows(conn, LIST_CONTRACT_COLS)


def tree_rows(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadAccount's reads."""
    return _rows(conn, TREE_CONTRACT_COLS)


def discovered_count_stmt(name: str) -> Any:
    """select("*", { count: "exact", head: true }).ilike("display_name", `%${name}%`).
    PostgREST reads `*` in a like pattern as `%`; `%` and `_` in a name stay wildcards, as they
    were."""
    pattern = f"%{name}%".replace("*", "%")
    return select(func.count().label("n")).select_from(entity).where(entity.c.display_name.ilike(pattern))


def discovered_counts(conn: psycopg.Connection, names: list[str]) -> list[int | None]:
    """One exact count per name, in order; a failed count (e.g. the statement timeout) is null,
    as `count ?? null` made it. loadAccounts sent these in one Promise.all, loadAccount sends one."""
    if not names:
        return []
    got = fetch_many(conn, {str(i): discovered_count_stmt(n) for i, n in enumerate(names)},
                     tolerant=True)
    return [got[str(i)][0]["n"] if got[str(i)] else None for i in range(len(names))]


def entitlements_bundle(conn: psycopg.Connection, account_id: str) -> dict[str, list[dict[str, Any]]]:
    """loadEntitlements' two reads (both threw): the active products, `select("*")
    .eq("active", true).order("sort")`, and the organization's entitlements."""
    return fetch_many(conn, {
        "products": select(products).where(products.c.active.is_(True))
        .order_by(products.c.sort.asc()),
        "entitlements": select(*cols(entitlements, ENTITLEMENT_COLS))
        .where(entitlements.c.subject_type == "organization",
               entitlements.c.subject_id == account_id),
    })


def set_entitlement(conn: psycopg.Connection, account_id: str, product_key: str,
                    patch: dict[str, Any]) -> None:
    """setEntitlement: upsert({subject_type: "organization", subject_id, product_key, state,
    source: "console", [tokens_included]}, { onConflict: "subject_type,subject_id,product_key" })
    — PostgREST's `ON CONFLICT (…) DO UPDATE SET <each sent column> = EXCLUDED.<column>`."""
    row = {"subject_type": "organization", "subject_id": account_id, "product_key": product_key,
           "state": patch["state"], "source": "console"}
    if "tokens_included" in patch:  # `...(tokens != null ? { tokens_included } : {})`
        row["tokens_included"] = patch["tokens_included"]
    key = ["subject_type", "subject_id", "product_key"]
    stmt = pg_insert(entitlements).inline().values(**row)  # no RETURNING (no .select())
    execute(conn, stmt.on_conflict_do_update(
        index_elements=[entitlements.c[k] for k in key],
        set_={k: stmt.excluded[k] for k in row if k not in key}))


def record_login_as(conn: psycopg.Connection, actor_email: str | None, node_type: str,
                    node_id: str, node_name: str, account_id: str) -> None:
    """recordLoginAs: insert({action: "login_as", entity_type, entity_id, field_changes}).
    `actor_email` is the signed-in user's (from the verified token), as the page passed it."""
    execute(conn, audit.insert().inline().values(
        action="login_as", entity_type=node_type, entity_id=node_id,
        field_changes=Jsonb({"actor_email": actor_email, "target_name": node_name,
                             "account_id": account_id})))
