# Commercial catalog audit — findings + Keep / Extend / Retire map (read-only)

No code or database changes were made. These findings come from reading the code. Database row values (e.g. nora at $69/$99) are as you stated; I did not query them.

## 1. Surface inventory

| Path | File | Purpose | State |
|---|---|---|---|
| /sales/quotes | sales.quotes.index.tsx | Quote list | Live (Growth Hub > CPQ) |
| /sales/quotes/$quoteId | sales.quotes.$quoteId.tsx | The only quote builder (Customer > Entitlements > Pricing > Terms > Approval > Preview) | Live |
| /sales/price-book | sales.price-book.tsx | Edits exp_price_book list/contract/credit cost, exp_products credit config, exp_price_tiers | Live |
| /sales/volume-pricing | sales.volume-pricing.tsx | Redirect to price book | Dead (redirect only) |
| /sales/pricing | sales.pricing.tsx | "Discount signals" analysis (sales-story) | Live, read-only |
| /sales/promos | sales.promos.tsx | Promo codes | Live |
| /sales/contracts, /$contractId | sales.contracts.*.tsx | Contract list/detail: lines, approval, signatures, renewals, provisioning | Live |
| /sales/opportunities/$oppId | opportunity workspace | Whitespace/ARR from exp_price_book + exp_products; Create Quote handoff | Live |
| /products | _authenticated/products.tsx | Catalog viewer (exp_products + exp_price_book via console-surfaces) | Live in console sidebar, read-only |
| /billing | billing.tsx | Contracts/entitlements ARR view; product names from exp_products | Live (console, outside Growth Hub) |
| /accounts/$accountId | accounts.$accountId.tsx | Reads active exp_products for owned/available | Live |
| /product/$slug, /platform/$slug, /nora, /listings, /reviews… | public routes | CMS marketing pages (exp_web_pages); product names are CMS text | Live, not catalog-linked |
| CMS "pricing" section | website/section-schema.ts | Legacy hand-typed price table section | Legacy, still selectable |
| Profile renderer / expertise schema | profile-render.ts, expertise-schema.ts | Use "VOCE" as an article source/publisher label; no package names or prices | Live, not catalog-linked |

## 2. Hardcoded names, prices, packages, assumptions

- `src/lib/cpq-catalog.ts` `CATALOG`: the whole package model. NORA Engage $59/$99, NORA Amplify $89/$195 and their include lists; add-ons Listings $388/$828, VOCE $120/user, Sponsored $59/zip/mo, Conversion Agents $828/$1188; enterprise platform fee $60/user, credits 4000/6000/100, VOCE Enterprise First $20,000 minimum, $5,000 campaign/benchmark/integration, $150/hr dev. This **conflicts with the base `nora` at $69/$99**.
- `src/lib/cpq-pricing.ts`: reads CATALOG directly. Also a literal `59` fallback, and `$20,000` in a warning string.
- `src/lib/sales-cpq.ts`: line labels from CATALOG (e.g. "VOCE Engage users (billable)"). It maps `nora` to `packageId="engage"`.
- `src/lib/cpq-depth.ts`: `DEFAULT_CREDIT_COST=0.01` (should be `credit_price`), `ADDL_CAMPAIGN_RATE=1200`, `ENTERPRISE_MIN_QTY=10`, `VOCE_VARIANTS` labels, `EnterpriseProduct = nora|listings|voce`.
- `src/lib/margin.ts` `TARGET_BUFFER=0.1`. Seller/manager discount limits come from `exp_price_book.discount_tiers`, not from `discount_floor_seller/manager`.
- `src/lib/sales.ts` `TIER_BANDS`, `CAPACITY`: sizing, not price.
- `src/lib/territory-admin.ts` 700K vs `territories.ts` 500K: sizing, inconsistent.
- `src/lib/monetization.ts` `SPONSORED_CAP=3`.
- `sales.quotes.$quoteId.tsx`: renders package cards from CATALOG.
- Not read anywhere yet: `exp_pricing_config`, or the new `lane / creditable / discountable / passthrough / min_charge` columns. Platform fee rate/band/cap and `llm_cost_basis` have no code consumer.

## 3. Duplicates / overlaps

- **Two sources of truth for price:** CATALOG (used by the builder math) vs `exp_price_book` / `exp_price_tiers` (price book, whitespace, tier overrides). One quote mixes both.
- **Two catalog views:** /products and the price book's Prices tab.
- **Builder vs contract detail:** the builder's Continue writes contract lines; the contract page shows lines and handles approval/activation. Pricing is edited in one place only (the builder).
- **Discount logic in two places:** /sales/pricing (signals) and the price book's discount_tiers/volume tiers. Neither uses the configured floors.
- **Revenue views:** /billing and contract detail both show ARR.
- **Package pricing:** the CMS legacy pricing section can display prices that are not in the catalog.

## 4. NORA Engage / Amplify today

They exist only as code constants in `CATALOG.packages`, as the quote's `packageId` ("engage"|"amplify"). They are not in the database. Amplify "includes" Listings and VOCE by code rule (`includedAddOnQuantities`). The base `nora` product ($69/$99 in the database) is not used by the builder's bundle math, which uses $59/$99 or $89/$195. The opportunity workspace's whitespace view prices from `exp_price_book`, so a deal's potential ARR and its quote total can disagree.

## 5. Keep / Extend / Retire

| Surface | Action | Target |
|---|---|---|
| sales.price-book.tsx | EXTEND | The single catalog admin: Products tab (name, description, lane, creditable, discountable, passthrough, min_charge, active) + Prices + Volume tiers + an **Assumptions** tab editing exp_pricing_config |
| products.tsx (/products) | RETIRE → redirect to price book | Removes the duplicate catalog view |
| sales.volume-pricing.tsx | RETIRE (delete redirect, or keep as alias) | — |
| sales.quotes.$quoteId.tsx | EXTEND | The only builder: Select Entitlements from exp_products by lane > price from price book/tiers/config > voluntary write-down checked against floors > provisional entitlements > invoice + entitlements addendum |
| cpq-catalog.ts | RETIRE as source of truth | Replace with a loader from exp_products/price_book/pricing_config. Keep the formulas in cpq-pricing.ts but feed them catalog inputs (pricing math numbers move to data, so this needs your sign-off) |
| cpq-depth.ts / margin.ts constants | EXTEND | Read credit_price, discount floors, credit_floor_pct and volume tiers from config |
| sales.quotes.index, promos, contracts.* | KEEP | Contract detail stays read/approve/sign/renew only, with no price editing |
| sales.pricing.tsx (Discount signals) | KEEP | Read-only; point thresholds at config floors |
| opportunity workspace whitespace | KEEP | Already catalog-read; switch to lane-aware filtering |
| billing.tsx, accounts.$accountId | KEEP | Read-only consumers of exp_products names |
| CMS legacy "pricing" section | RETIRE (hide from picker) | Prices only shown from the catalog |
| Public marketing / profile renderer | KEEP | No catalog prices. Only product display names would read from exp_products |

## Decisions needed before a build

1. Packages: should Engage/Amplify be catalog rows (e.g. lane=base bundles), or should "Amplify" be replaced by nora + included products?
2. Whether nora at $69/$99 supersedes the $59/$89 package prices. The pricing engine was previously ported "verbatim, numbers unchanged".
3. Enterprise constants (platform fee $60/user vs fee_rate/band/cap, $20,000 VOCE minimum, $5,000 add-ons, $150/hr): move them all to exp_pricing_config or exp_price_book?
4. Which territory size is canonical: 700K or 500K? This is outside the catalog, but it is an inconsistency.
