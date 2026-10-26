import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ticket } from "lucide-react";
import { DataTable, EmptyState, PageBody, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { createPromo, listPromos, redemptionCounts, setPromoActive, type Promo } from "@v3/sales/lib/sales-cpq";
import { loadRepNames } from "@v3/sales/lib/teams";

export const Route = createFileRoute("/_authenticated/sales/promos")({
  head: () => ({
    meta: [
      { title: "Promo codes — Experience.com Growth Hub" },
      { name: "description", content: "Create, list and deactivate CPQ promo codes; see redemptions and seller attribution." },
      { property: "og:title", content: "Promo codes — Experience.com Growth Hub" },
      { property: "og:description", content: "Manage promo codes and their redemptions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PromosPage,
});

const blank = {
  code: "",
  applies_to_products: "",
  discount_kind: "percent",
  amount: "",
  pricing_type: "introductory",
  duration_months: "",
  starts_at: "",
  expires_at: "",
  scope_type: "deal",
  applies_to_scope: "",
  seller_id: "",
};
const sel = "h-8 rounded-[8px] border border-input bg-background px-2 text-sm";

function PromosPage() {
  const qc = useQueryClient();
  const promos = useQuery({ queryKey: ["cpq-promos"], queryFn: listPromos });
  const counts = useQuery({ queryKey: ["cpq-promo-redemptions"], queryFn: redemptionCounts });
  const reps = useQuery({
    queryKey: ["cpq-reps"],
    queryFn: loadRepNames,
  });
  const repName = (id: string | null) => reps.data?.find((r) => r.id === id)?.name ?? null;
  const [d, setD] = useState(blank);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["cpq-promos"] });
  const create = useMutation({
    mutationFn: () =>
      createPromo({
        code: d.code.trim().toUpperCase(),
        applies_to_products: d.applies_to_products ? d.applies_to_products.split(",").map((s) => s.trim()).filter(Boolean) : null,
        discount_kind: d.discount_kind,
        amount: d.amount === "" ? null : Number(d.amount),
        discount_pct: d.discount_kind === "percent" && d.amount !== "" ? Number(d.amount) : null,
        pricing_type: d.pricing_type,
        duration_months: d.duration_months === "" ? null : Number(d.duration_months),
        starts_at: d.starts_at || null,
        expires_at: d.expires_at || null,
        scope_type: d.scope_type,
        applies_to_scope: d.applies_to_scope || null,
        seller_id: d.seller_id || null,
      }),
    onSuccess: () => {
      toast.success("Promo created");
      setD(blank);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (x: { id: string; active: boolean }) => setPromoActive(x.id, x.active),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const inp = (k: keyof typeof blank, label: string, type = "text", w = "w-28") => (
    <label className="text-xs">
      {label}
      <Input type={type} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={`h-8 ${w}`} />
    </label>
  );

  return (
    <PageBody>
      <PageHeader eyebrow="Growth Hub · CPQ" title="Promo codes" description="Codes apply to a quote from the entitlements summary. Redemptions and seller attribution are shown per code." />
      <Panel title="New promo" className="mb-6">
        <div className="flex flex-wrap items-end gap-2">
          {inp("code", "Code")}
          {inp("applies_to_products", "Products (comma keys, blank = all)", "text", "w-56")}
          <label className="text-xs">Kind<div><select className={sel} value={d.discount_kind} onChange={(e) => setD({ ...d, discount_kind: e.target.value })}><option value="percent">percent</option><option value="fixed_price">fixed_price</option></select></div></label>
          {inp("amount", d.discount_kind === "percent" ? "Percent" : "Fixed price", "number", "w-24")}
          <label className="text-xs">Pricing<div><select className={sel} value={d.pricing_type} onChange={(e) => setD({ ...d, pricing_type: e.target.value })}><option value="introductory">introductory</option><option value="fixed">fixed</option></select></div></label>
          {inp("duration_months", "Months", "number", "w-20")}
          {inp("starts_at", "Starts", "date", "w-36")}
          {inp("expires_at", "Expires", "date", "w-36")}
          <label className="text-xs">Scope<div><select className={sel} value={d.scope_type} onChange={(e) => setD({ ...d, scope_type: e.target.value })}><option value="deal">deal</option><option value="seller_attribution">seller_attribution</option></select></div></label>
          {inp("applies_to_scope", "Scope value")}
          <label className="text-xs">Seller<div><select className={sel} value={d.seller_id} onChange={(e) => setD({ ...d, seller_id: e.target.value })}><option value="">—</option>{(reps.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div></label>
          <Button size="sm" disabled={!d.code.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
        </div>
      </Panel>
      <Panel bodyClassName="px-3 py-2">
        <DataTable<Promo>
          loading={promos.isLoading}
          rows={promos.data ?? []}
          getRowKey={(r) => r.id}
          empty={<EmptyState icon={<Ticket className="h-4 w-4" />} title="No promo codes yet" compact />}
          columns={[
            { key: "c", header: "Code", cell: (r) => <span className="font-mono font-medium">{r.code ?? "—"}</span> },
            {
              key: "k",
              header: "Offer",
              cell: (r) => {
                const amt = r.amount ?? r.discount_pct;
                return amt == null ? "—" : r.discount_kind === "fixed_price" ? `Fixed $${Number(amt).toLocaleString()}` : `${amt}% off`;
              },
            },
            { key: "p", header: "Products", cell: (r) => (r.applies_to_products?.length ? r.applies_to_products.join(", ") : "All") },
            { key: "t", header: "Pricing", cell: (r) => [r.pricing_type, r.duration_months ? `${r.duration_months} mo` : null].filter(Boolean).join(" · ") || "—" },
            { key: "w", header: "Window", cell: (r) => `${r.starts_at?.slice(0, 10) ?? "—"} → ${r.expires_at?.slice(0, 10) ?? "—"}` },
            {
              key: "s",
              header: "Attribution",
              cell: (r) =>
                r.seller_id ? (
                  <Link to="/sales/sellers/$repId" params={{ repId: r.seller_id }} className="text-[color:var(--color-g-blue)]">{repName(r.seller_id) ?? "Seller"}</Link>
                ) : (
                  r.scope_type ?? "—"
                ),
            },
            { key: "r", header: "Redemptions", align: "right", cell: (r) => (r.code ? counts.data?.[r.code] ?? 0 : 0) },
            {
              key: "a",
              header: "",
              align: "right",
              cell: (r) => (
                <Button size="sm" variant={r.active ? "outline" : "ghost"} onClick={() => toggle.mutate({ id: r.id, active: !r.active })}>
                  {r.active ? "Deactivate" : "Reactivate"}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
    </PageBody>
  );
}
