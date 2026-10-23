import { growthHubStyles } from "@/components/sales/growth-hub-styles";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import {
  ConsoleTabs,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
} from "@/components/console/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { loadPriceBook, saveCreditConfig, savePrice } from "@/lib/sales";
import { creditCostBasis, loadPricingContext, type CreditProduct } from "@/lib/cpq-depth";
import { loadCatalog } from "@/lib/cpq-catalog";
import { AssumptionsAdmin, ProductsAdmin, VolumeSchedule } from "@/components/sales/catalog-admin";

export const Route = createFileRoute("/_authenticated/sales/price-book")({
  head: () => ({
    meta: [
      { title: "Price book — Experience.com Console" },
      {
        name: "description",
        content:
          "List and contract pricing for every Experience.com product, by professional and location scope.",
      },
      { property: "og:title", content: "Price book — Experience.com Console" },
      { property: "og:description", content: "List and contract pricing per product and scope." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PriceBookPage,
});

type Row = Awaited<ReturnType<typeof loadPriceBook>>[number];

function PriceBookPage() {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ["price-book"], queryFn: loadPriceBook });
  useQuery({ queryKey: ["cpq-catalog"], queryFn: loadCatalog });
  const [draft, setDraft] = useState<Record<string, { list?: string; contract?: string; credit?: string }>>({});

  const save = useMutation({
    mutationFn: async (row: Row) => {
      const d = draft[row.id] ?? {};
      await savePrice(row.id, {
        list_price: d.list != null && d.list !== "" ? Number(d.list) : row.list_price,
        contract_price: d.contract != null && d.contract !== "" ? Number(d.contract) : row.contract_price,
        ...(d.credit != null ? { credit_cost_per_unit: d.credit === "" ? null : Number(d.credit) } : {}),
      });
    },
    onSuccess: () => {
      toast.success("Price updated");
      void qc.invalidateQueries({ queryKey: ["price-book"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageBody className="cpq-admin"><style>{growthHubStyles(".cpq-admin")}</style>
      <PageHeader
        eyebrow="Customers · Sales"
        title="Price book"
        description="The single catalog and assumptions admin. Products, prices, the volume schedule and pricing assumptions all write to exp_products, exp_price_book and exp_pricing_config, which the quote builder reads at runtime."
      />

      <ConsoleTabs
        tabs={[
          { value: "products", label: "Products", content: <ProductsAdmin /> },
          { value: "prices", label: "Prices", content: (
      <Panel bodyClassName="px-3 py-2">
        <DataTable<Row>
          loading={rows.isLoading}
          rows={rows.data ?? []}
          getRowKey={(r) => r.id}
          empty={<EmptyState icon={<Tag className="h-4 w-4" />} title="Price book is empty" compact />}
          columns={[
            { key: "p", header: "Product", cell: (r) => <span className="font-medium">{r.productName}</span> },
            {
              key: "s",
              header: "Scope",
              cell: (r) => (
                <span className="gh-status capitalize">
                  {r.scope ?? "—"}
                </span>
              ),
            },
            { key: "b", header: "Billing", cell: (r) => r.billing_type ?? "—" },
            { key: "u", header: "Unit", cell: (r) => r.unit ?? "—" },
            {
              key: "l",
              header: "List",
              align: "right",
              cell: (r) => (
                <Input
                  className="h-8 w-28 text-right font-mono"
                  defaultValue={r.list_price ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [r.id]: { ...d[r.id], list: e.target.value } }))
                  }
                />
              ),
            },
            {
              key: "c",
              header: "Contract",
              align: "right",
              cell: (r) => (
                <Input
                  className="h-8 w-28 text-right font-mono"
                  defaultValue={r.contract_price ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [r.id]: { ...d[r.id], contract: e.target.value } }))
                  }
                />
              ),
            },
            {
              key: "cc",
              header: "Cost / credit",
              align: "right",
              cell: (r) =>
                r.billing_type === "token" ? (
                  <Input
                    className="h-8 w-24 text-right font-mono"
                    defaultValue={r.credit_cost_per_unit ?? ""}
                    placeholder={String(creditCostBasis() || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.id]: { ...d[r.id], credit: e.target.value } }))}
                  />
                ) : (
                  "—"
                ),
            },
            {
              key: "a",
              header: "",
              align: "right",
              cell: (r) => (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!draft[r.id] || save.isPending}
                  onClick={() => save.mutate(r)}
                >
                  Save
                </Button>
              ),
            },
          ]}
        />
      </Panel>
          ) },
          { value: "credits", label: "Credit consumption", content: <CreditConfig /> },
          { value: "tiers", label: "Volume tiers", content: <VolumeSchedule /> },
          { value: "assumptions", label: "Assumptions", content: <AssumptionsAdmin /> },
        ]}
      />
    </PageBody>
  );
}

function CreditConfig() {
  const qc = useQueryClient();
  const ctx = useQuery({ queryKey: ["cpq-pricing-context"], queryFn: loadPricingContext });
  const [draft, setDraft] = useState<Record<string, { on?: boolean; pro?: string; loc?: string }>>({});
  const num = (v: string | undefined, fallback: number | null) => (v === undefined ? fallback : v.trim() === "" ? null : Number(v));
  const save = useMutation({
    mutationFn: async (p: CreditProduct) => {
      const d = draft[p.product_key] ?? {};
      await saveCreditConfig(p.product_key, {
        consumes_llm_credits: d.on ?? !!p.consumes_llm_credits,
        est_credits_per_professional: num(d.pro, p.est_credits_per_professional),
        est_credits_per_location: num(d.loc, p.est_credits_per_location),
      });
    },
    onSuccess: (_d, p) => {
      toast.success("Credit config saved");
      setDraft((d) => { const n = { ...d }; delete n[p.product_key]; return n; });
      void qc.invalidateQueries({ queryKey: ["cpq-pricing-context"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel
      title="Credit consumption"
      description="Which products burn LLM credits and the estimated monthly credits per professional / location. Leave blank where unknown — quotes then show “Set credit estimates to project top-up”."
      bodyClassName="px-3 py-2"
    >
      <DataTable<CreditProduct>
        loading={ctx.isLoading}
        rows={ctx.data?.products ?? []}
        getRowKey={(r) => r.product_key}
        empty={<EmptyState icon={<Tag className="h-4 w-4" />} title="No products" compact />}
        columns={[
          { key: "p", header: "Product", cell: (r) => <span className="font-medium">{r.name ?? r.product_key}</span> },
          { key: "b", header: "Billing", cell: (r) => r.billing_type ?? "—" },
          {
            key: "c",
            header: "Consumes credits",
            cell: (r) => (
              <Checkbox
                checked={draft[r.product_key]?.on ?? !!r.consumes_llm_credits}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, [r.product_key]: { ...d[r.product_key], on: v === true } }))}
              />
            ),
          },
          {
            key: "pro",
            header: "Credits / professional / mo",
            align: "right",
            cell: (r) => (
              <Input className="h-8 w-28 text-right font-mono" defaultValue={r.est_credits_per_professional ?? ""} placeholder="unknown"
                onChange={(e) => setDraft((d) => ({ ...d, [r.product_key]: { ...d[r.product_key], pro: e.target.value } }))} />
            ),
          },
          {
            key: "loc",
            header: "Credits / location / mo",
            align: "right",
            cell: (r) => (
              <Input className="h-8 w-28 text-right font-mono" defaultValue={r.est_credits_per_location ?? ""} placeholder="unknown"
                onChange={(e) => setDraft((d) => ({ ...d, [r.product_key]: { ...d[r.product_key], loc: e.target.value } }))} />
            ),
          },
          {
            key: "a",
            header: "",
            align: "right",
            cell: (r) => (
              <Button size="sm" variant="outline" disabled={!draft[r.product_key] || save.isPending} onClick={() => save.mutate(r)}>Save</Button>
            ),
          },
        ]}
      />
    </Panel>
  );
}
