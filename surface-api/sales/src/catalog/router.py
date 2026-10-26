"""sales catalog & pricing (S1) — replaces the direct supabase-js calls in surface-ui/sales
catalog-admin, cpq-catalog, cpq-depth, comp and the money part of @v3/ui console-surfaces.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
writes are the browser's own statements: each request model allow-lists the columns the page
sends, and only the keys sent are written (as PostgREST did). Numeric money fields are `Decimal`,
never float, so a price is stored with the digits the page sent.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.catalog import services as q
from surfaces.sales.catalog.schemas import (
    SalesCatalogCompRate,
    SalesCatalogConfigValue,
    SalesCatalogProductNew,
    SalesCatalogProductPatch,
    SalesCatalogVolumeTiers,
)

router = APIRouter(prefix="/sales/catalog", tags=["sales"])

def _guard(fn, *args):
    try:
        return fn(*args)
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


def _write(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


# --- catalog admin (catalog-admin.ts) --------------------------------------------------------

@router.get("/admin/products")
def admin_products(claims: dict = Depends(current_user)) -> list:
    """listAdminProducts."""
    return _read(claims, q.admin_products)


@router.post("/admin/products")
def add_admin_product(body: SalesCatalogProductNew, claims: dict = Depends(current_user)) -> dict:
    return _write(claims, q.add_admin_product, body.sent())


@router.patch("/admin/products/{product_key}")
def update_admin_product(product_key: str, body: SalesCatalogProductPatch,
                         claims: dict = Depends(current_user)) -> list:
    """The updated rows' product_key (`.select("product_key")`); [] when none was updated."""
    return _write(claims, q.update_admin_product, product_key, body.sent())


@router.get("/admin/pricing-config")
def pricing_config(claims: dict = Depends(current_user)) -> list:
    """listPricingConfig."""
    return _read(claims, q.pricing_config)


@router.put("/admin/pricing-config/volume-tiers")
def save_volume_tiers(body: SalesCatalogVolumeTiers, claims: dict = Depends(current_user)) -> list:
    """saveVolumeTiers: the `volume_tiers` row's key (`.select("key")`); [] when none updated."""
    tiers = [t.model_dump() for t in body.tiers]
    return _write(claims, q.save_volume_tiers, tiers)


@router.patch("/admin/pricing-config/{key}")
def save_pricing_config_value(key: str, body: SalesCatalogConfigValue,
                              claims: dict = Depends(current_user)) -> list:
    """savePricingConfigValue: the updated rows' `key,value`; [] when none was updated."""
    return _write(claims, q.save_pricing_config_value, key, body.value)


# --- quote builder / price book (cpq-catalog.ts, cpq-depth.ts) -------------------------------

@router.get("/cpq")
def cpq_catalog(claims: dict = Depends(current_user)) -> dict:
    """loadCatalog's rows: `{ products, book, config }` (one round trip)."""
    return _read(claims, q.cpq_catalog)


@router.get("/pricing-context")
def pricing_context(claims: dict = Depends(current_user)) -> dict:
    """loadPricingContext's rows: `{ book, products }` (one round trip)."""
    return _read(claims, q.pricing_context)


# --- commission plans (comp.ts) --------------------------------------------------------------

@router.get("/comp-plans")
def comp_plans(claims: dict = Depends(current_user)) -> list:
    """loadCompPlans."""
    return _read(claims, q.comp_plan_rows)


@router.patch("/comp-plans/{plan_id}")
def save_comp_rate(plan_id: str, body: SalesCatalogCompRate,
                   claims: dict = Depends(current_user)) -> dict:
    return _write(claims, q.save_comp_rate, plan_id, body.rate_pct)


# --- console product catalog + billing (@v3/ui console-surfaces.ts) --------------------------

@router.get("/product-catalog")
def product_catalog(claims: dict = Depends(current_user)) -> dict:
    """loadProductCatalog's rows: `{ products, price_book }` (one round trip)."""
    return _read(claims, q.product_catalog)


@router.get("/billing")
def billing(claims: dict = Depends(current_user)) -> dict:
    """loadBilling's rows: `{ contracts, entitlements, products }` (one round trip)."""
    return _read(claims, q.billing)
