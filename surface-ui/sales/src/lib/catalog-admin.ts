/** Catalog + assumptions admin: reads/writes exp_products and exp_pricing_config only. */
import { supabase } from "@v3/ui/integrations/supabase/client";

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

const COLS =
  "product_key,name,description,lane,price_monthly,price_monthly_location,price_unit,billing_type,creditable,discountable,passthrough,min_charge,package_includes,active,sort";

export async function listAdminProducts(): Promise<AdminProduct[]> {
  const { data, error } = await supabase.from("exp_products").select(COLS).order("sort", { ascending: true });
  if (error) throw error;
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
  const { data, error } = await supabase.from("exp_products").update(toRow(patch, productKey)).eq("product_key", productKey).select("product_key");
  if (error) throw error;
  if (!data?.length) throw new Error("No row updated (check permissions).");
}

export async function addAdminProduct(productKey: string, patch: ProductPatch) {
  const key = productKey.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error("Product key must be lowercase letters, digits and underscores.");
  const { error } = await supabase.from("exp_products").insert({ product_key: key, ...toRow(patch, key) });
  if (error) throw error;
}

export type ConfigEntry = { key: string; value: number | null; value_json: unknown; label: string | null; unit: string | null; updated_at: string | null };

export async function listPricingConfig(): Promise<ConfigEntry[]> {
  const { data, error } = await supabase.from("exp_pricing_config").select("key,value,value_json,label,unit,updated_at").order("key");
  if (error) throw error;
  return (data ?? []) as ConfigEntry[];
}

export async function savePricingConfigValue(key: string, value: number) {
  const { data, error } = await supabase
    .from("exp_pricing_config")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select("key,value");
  if (error) throw error;
  if (!data?.length) throw new Error("No row updated (check permissions).");
  return data[0];
}

export type VolumeTier = { min: number; pct: number };
export async function saveVolumeTiers(tiers: VolumeTier[]) {
  const clean = tiers
    .filter((t) => Number.isFinite(t.min) && Number.isFinite(t.pct))
    .sort((a, b) => b.min - a.min);
  const { data, error } = await supabase
    .from("exp_pricing_config")
    .update({ value_json: clean, updated_at: new Date().toISOString() })
    .eq("key", "volume_tiers")
    .select("key");
  if (error) throw error;
  if (!data?.length) throw new Error("No row updated (check permissions).");
}
