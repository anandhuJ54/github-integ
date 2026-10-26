/** Catalog + assumptions admin: reads/writes exp_products and exp_pricing_config only.
 *  Through FastAPI (sales: /sales/catalog/admin/*), as the signed-in user. */
import { api } from "@v3/ui/lib/server-fn";

const ADMIN = "/sales/catalog/admin";
const seg = (v: string) => encodeURIComponent(v);

export const LANES = ["base", "included", "product", "enterprise", "passthrough", "retired"] as const;
export type AdminLane = (typeof LANES)[number];

/** Where each lane surfaces in the quote builder and invoice (the builder reads lane from exp_products). */
export const LANE_PLACEMENT: Record<AdminLane, string> = {
  base: "Package selector · invoice “Subscription”",
  included: "Included skills ($0) · invoice “Included Platform Skills”",
  product: "Products (billable) · invoice “Products”",
  enterprise: "Enterprise SKUs · invoice “Enterprise”",
  passthrough: "Pass-through (no discount) · invoice pass-through",
  retired: "Hidden from builder and invoice",
};

export type AdminProduct = {
  product_key: string;
  name: string | null;
  description: string | null;
  lane: string | null;
  price_monthly: number | null;
  price_monthly_location: number | null;
  price_unit: string | null;
  billing_type: string | null;
  creditable: boolean | null;
  discountable: boolean | null;
  passthrough: boolean | null;
  min_charge: number | null;
  package_includes: string[] | null;
  active: boolean | null;
  sort: number | null;
};
export type ProductPatch = Omit<AdminProduct, "product_key" | "sort">;

export async function listAdminProducts(): Promise<AdminProduct[]> {
  const data = await api.get<AdminProduct[]>(`${ADMIN}/products`);
  return (data ?? []).map((r) => ({
    ...(r as unknown as AdminProduct),
    package_includes: Array.isArray(r.package_includes) ? (r.package_includes as string[]) : [],
  }));
}

/** Required text columns (name, billing_type, price_unit) never receive null. */
const toRow = (p: ProductPatch, key: string) => ({
  ...p,
  name: p.name || key,
  billing_type: p.billing_type || "subscription",
  price_unit: p.price_unit || "month",
  description: p.description ?? undefined,
  lane: p.lane ?? undefined,
});

/** product_key is frozen: it is the match key and is never part of the patch. */
export async function updateAdminProduct(productKey: string, patch: ProductPatch) {
  const data = await api.patch<{ product_key: string }[]>(`${ADMIN}/products/${seg(productKey)}`, toRow(patch, productKey));
  if (!data?.length) throw new Error("No row updated (check permissions).");
}

export async function addAdminProduct(productKey: string, patch: ProductPatch) {
  const key = productKey.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("Product key must be lowercase letters, digits and underscores.");
  await api.post(`${ADMIN}/products`, { product_key: key, ...toRow(patch, key) });
}

export type ConfigEntry = { key: string; value: number | null; value_json: unknown; label: string | null; unit: string | null; updated_at: string | null };

export async function listPricingConfig(): Promise<ConfigEntry[]> {
  return (await api.get<ConfigEntry[]>(`${ADMIN}/pricing-config`)) ?? [];
}

export async function savePricingConfigValue(key: string, value: number) {
  // updated_at is stamped by the server's clock
  const data = await api.patch<{ key: string; value: number | null }[]>(`${ADMIN}/pricing-config/${seg(key)}`, { value });
  if (!data?.length) throw new Error("No row updated (check permissions).");
  return data[0];
}

export type VolumeTier = { min: number; pct: number };
export async function saveVolumeTiers(tiers: VolumeTier[]) {
  const clean = tiers
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.pct))
    .sort((a, b) => b.min - a.min);
  // written to the volume_tiers row's value_json; updated_at is stamped by the server's clock
  const data = await api.put<{ key: string }[]>(`${ADMIN}/pricing-config/volume-tiers`, { tiers: clean });
  if (!data?.length) throw new Error("No row updated (check permissions).");
}
