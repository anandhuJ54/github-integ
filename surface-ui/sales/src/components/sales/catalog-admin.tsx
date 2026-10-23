import { growthHubStyles } from "@v3/sales/components/sales/growth-hub-styles";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Tag } from "lucide-react";
import { DataTable, EmptyState, Panel } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@v3/ui/components/ui/dialog";
import {
  LANES,
  LANE_PLACEMENT,
  addAdminProduct,
  listAdminProducts,
  listPricingConfig,
  savePricingConfigValue,
  saveVolumeTiers,
  updateAdminProduct,
  type AdminLane,
  type AdminProduct,
  type ProductPatch,
  type VolumeTier,
} from "@v3/sales/lib/catalog-admin";

/** Every engine query that reads the catalog; invalidated after any admin save. */
function useInvalidateEngine() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["catalog-admin-products", "catalog-admin-config", "cpq-catalog", "cpq-pricing-context", "price-book"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

const selectCls = "h-9 w-full rounded-[8px] border border-input bg-background px-2 text-sm";
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/* ─────────── Products ─────────── */

const emptyPatch = (): ProductPatch => ({
  name: "", description: "", lane: "product", price_monthly: null, price_monthly_location: null, price_unit: "month",
  billing_type: "subscription", creditable: false, discountable: true, passthrough: false, min_charge: null, package_includes: [], active: true,
});

export function ProductsAdmin() {
  const q = useQuery({ queryKey: ["catalog-admin-products"], queryFn: listAdminProducts });
  const [filter, setFilter] = useState<"all" | "active" | "retired">("all");
  const [lane, setLane] = useState<string>("all");
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const rows = (q.data ?? []).filter(
    (r) => (filter === "all" || (filter === "active" ? r.active !== false : r.active === false)) && (lane === "all" || r.lane === lane),
  );
  return (
    <div className="space-y-4">
      <Panel title="Lanes decide placement" description="The quote builder and invoice read lane from this table. Add a product and pick a lane — it appears in that section automatically.">
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {LANES.map((l) => (
            <li key={l}><span className="font-mono font-semibold">{l}</span> → {LANE_PLACEMENT[l]}</li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Products"
        description="Every row in exp_products. product_key is frozen."
        actions={<Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />Add product</Button>}
        bodyClassName="px-3 py-2"
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="Status filter" className={selectCls + " w-36"} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="retired">Retired (inactive)</option>
          </select>
          <select aria-label="Lane filter" className={selectCls + " w-36"} value={lane} onChange={(e) => setLane(e.target.value)}>
            <option value="all">All lanes</option>{LANES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="self-center text-xs text-muted-foreground">{rows.length} of {q.data?.length ?? 0}</span>
        </div>
        <DataTable<AdminProduct>
          loading={q.isLoading}
          rows={rows}
          getRowKey={(r) => r.product_key}
          empty={<EmptyState icon={<Tag className="h-4 w-4" />} title="No products match" compact />}
          columns={[
            { key: "n", header: "Product", cell: (r) => <div><p className="font-medium">{r.name ?? r.product_key}</p><p className="font-mono text-[11px] text-muted-foreground">{r.product_key}</p></div> },
            { key: "l", header: "Lane", cell: (r) => <span className="font-mono text-xs">{r.lane ?? "—"}</span> },
            { key: "pp", header: "Pro / mo", align: "right", cell: (r) => r.price_monthly ?? "—" },
            { key: "pl", header: "Loc / mo", align: "right", cell: (r) => r.price_monthly_location ?? "—" },
            { key: "f", header: "Flags", cell: (r) => <span className="text-xs">{[r.creditable && "creditable", r.discountable && "discountable", r.passthrough && "passthrough"].filter(Boolean).join(" · ") || "—"}</span> },
            { key: "m", header: "Min", align: "right", cell: (r) => r.min_charge ?? "—" },
            { key: "i", header: "Includes", cell: (r) => <span className="text-xs">{r.package_includes?.length ? r.package_includes.length : "—"}</span> },
            { key: "a", header: "Status", cell: (r) => <span className="gh-status" data-status={r.active === false ? "neutral" : "active"}>{r.active === false ? "Retired" : "Active"}</span> },
            { key: "e", header: "", align: "right", cell: (r) => <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button> },
          ]}
        />
      </Panel>
      <ProductDialog editing={editing} all={q.data ?? []} onClose={() => setEditing(null)} />
    </div>
  );
}

function ProductDialog({ editing, all, onClose }: { editing: AdminProduct | "new" | null; all: AdminProduct[]; onClose: () => void }) {
  const invalidate = useInvalidateEngine();
  const isNew = editing === "new";
  const [key, setKey] = useState("");
  const [p, setP] = useState<ProductPatch>(emptyPatch());
  useEffect(() => {
    if (!editing) return;
    if (editing === "new") { setKey(""); setP(emptyPatch()); return; }
    const { product_key: _k, sort: _s, ...rest } = editing;
    setP({ ...rest, package_includes: rest.package_includes ?? [] });
  }, [editing]);
  const save = useMutation({
    mutationFn: () => (isNew ? addAdminProduct(key, p) : updateAdminProduct((editing as AdminProduct).product_key, p)),
    onSuccess: () => { toast.success(isNew ? "Product added" : "Product saved"); invalidate(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = <K extends keyof ProductPatch>(k: K, v: ProductPatch[K]) => setP((d) => ({ ...d, [k]: v }));
  const selfKey = isNew ? key : (editing as AdminProduct | null)?.product_key;
  const includes = p.package_includes ?? [];
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cpq-catalog-dialog max-h-[90vh] max-w-2xl overflow-y-auto"><style>{growthHubStyles(".cpq-catalog-dialog")}</style>
        <DialogHeader><DialogTitle>{isNew ? "Add product" : `Edit ${selfKey}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product key (frozen after create)">
            <Input value={isNew ? key : selfKey ?? ""} disabled={!isNew} onChange={(e) => setKey(e.target.value)} placeholder="e.g. review_insights" className="font-mono" />
          </Field>
          <Field label="Name"><Input value={p.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Lane" className="sm:col-span-2">
            <select className={selectCls} value={p.lane ?? "product"} onChange={(e) => set("lane", e.target.value)}>
              {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Appears in: {LANE_PLACEMENT[(p.lane ?? "product") as AdminLane] ?? "—"}</p>
          </Field>
          <Field label="Description (used in the Entitlements Addendum)" className="sm:col-span-2">
            <Textarea rows={3} value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Price / month — professional"><Input type="number" value={p.price_monthly ?? ""} onChange={(e) => set("price_monthly", numOrNull(e.target.value))} /></Field>
          <Field label="Price / month — location"><Input type="number" value={p.price_monthly_location ?? ""} onChange={(e) => set("price_monthly_location", numOrNull(e.target.value))} /></Field>
          <Field label="Price unit"><Input value={p.price_unit ?? ""} onChange={(e) => set("price_unit", e.target.value || null)} /></Field>
          <Field label="Billing type"><Input value={p.billing_type ?? ""} onChange={(e) => set("billing_type", e.target.value || null)} /></Field>
          <Field label="Minimum charge ($)"><Input type="number" value={p.min_charge ?? ""} onChange={(e) => set("min_charge", numOrNull(e.target.value))} /></Field>
          <div className="flex flex-wrap items-end gap-4 pb-1">
            {(["creditable", "discountable", "passthrough", "active"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm"><Checkbox checked={!!p[f]} onCheckedChange={(v) => set(f, v === true)} />{f}</label>
            ))}
          </div>
          <Field label="Package includes (billed $0 inside this product)" className="sm:col-span-2">
            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-[8px] border p-2 sm:grid-cols-2">
              {all.filter((o) => o.product_key !== selfKey).map((o) => (
                <label key={o.product_key} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={includes.includes(o.product_key)}
                    onCheckedChange={(v) => set("package_includes", v === true ? [...includes, o.product_key] : includes.filter((k) => k !== o.product_key))}
                  />
                  {o.name ?? o.product_key} <span className="font-mono text-muted-foreground">{o.product_key}</span>
                </label>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending || (isNew && !key.trim())} onClick={() => save.mutate()}>{isNew ? "Add product" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={"space-y-1 " + (className ?? "")}><Label className="text-xs">{label}</Label>{children}</div>;
}

/* ─────────── Volume schedule (exp_pricing_config.volume_tiers) ─────────── */

export function VolumeSchedule() {
  const invalidate = useInvalidateEngine();
  const q = useQuery({ queryKey: ["catalog-admin-config"], queryFn: listPricingConfig });
  const row = q.data?.find((r) => r.key === "volume_tiers");
  const [tiers, setTiers] = useState<{ min: string; pct: string }[]>([]);
  useEffect(() => {
    const raw = Array.isArray(row?.value_json) ? (row!.value_json as VolumeTier[]) : [];
    setTiers([...raw].sort((a, b) => a.min - b.min).map((t) => ({ min: String(t.min), pct: String(t.pct) })));
  }, [row?.value_json]);
  const save = useMutation({
    mutationFn: () => saveVolumeTiers(tiers.map((t) => ({ min: Number(t.min), pct: Number(t.pct) }))),
    onSuccess: () => { toast.success("Volume schedule saved"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel
      title="Volume discount schedule"
      description="The one volume schedule the quote engine uses: combined units (professionals + locations) → percent off. Stored in exp_pricing_config.volume_tiers."
      actions={<Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save schedule</Button>}
    >
      {q.isLoading ? <div className="h-32 animate-pulse rounded-[8px] bg-muted" /> : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] font-bold uppercase text-muted-foreground"><span>Min units</span><span>Discount %</span><span /></div>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input type="number" value={t.min} onChange={(e) => setTiers((d) => d.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />
              <Input type="number" value={t.pct} onChange={(e) => setTiers((d) => d.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
              <Button variant="outline" size="sm" onClick={() => setTiers((d) => d.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setTiers((d) => [...d, { min: "", pct: "" }])}><Plus className="mr-1 h-4 w-4" />Add tier</Button>
        </div>
      )}
    </Panel>
  );
}

/* ─────────── Assumptions (exp_pricing_config scalar rows) ─────────── */

const ASSUMPTION_KEYS = [
  "llm_cost_basis", "credit_price", "platform_fee_rate_1", "platform_fee_rate_2", "platform_fee_band",
  "platform_fee_cap", "discount_floor_seller", "discount_floor_manager", "credit_floor_pct",
];

export function AssumptionsAdmin() {
  const invalidate = useInvalidateEngine();
  const q = useQuery({ queryKey: ["catalog-admin-config"], queryFn: listPricingConfig });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: number }) => savePricingConfigValue(key, value),
    onSuccess: (r) => {
      toast.success(`${r.key} saved: ${r.value}`);
      setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = ASSUMPTION_KEYS.map((k) => q.data?.find((r) => r.key === k)).filter(Boolean) as NonNullable<typeof q.data>[number][];
  return (
    <Panel title="Pricing assumptions" description="Global values every quote reads at runtime from exp_pricing_config. Saving updates the engine immediately — no deploy." bodyClassName="px-3 py-2">
      <DataTable
        loading={q.isLoading}
        rows={rows}
        getRowKey={(r) => r.key}
        empty={<EmptyState icon={<Tag className="h-4 w-4" />} title="No assumptions" compact />}
        columns={[
          { key: "l", header: "Assumption", cell: (r) => <div><p className="font-medium">{r.label ?? r.key}</p><p className="font-mono text-[11px] text-muted-foreground">{r.key}</p></div> },
          { key: "u", header: "Unit", cell: (r) => <span className="font-mono text-xs">{r.unit ?? "—"}</span> },
          {
            key: "v", header: "Value", align: "right",
            cell: (r) => (
              <Input aria-label={r.key} type="number" step="any" className="ml-auto h-8 w-32 text-right font-mono"
                value={draft[r.key] ?? (r.value ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} />
            ),
          },
          { key: "t", header: "Updated", cell: (r) => <span className="text-xs text-muted-foreground">{r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}</span> },
          {
            key: "a", header: "", align: "right",
            cell: (r) => (
              <Button size="sm" variant="outline" disabled={draft[r.key] == null || draft[r.key].trim() === "" || save.isPending}
                onClick={() => save.mutate({ key: r.key, value: Number(draft[r.key]) })}>Save</Button>
            ),
          },
        ]}
      />
    </Panel>
  );
}
