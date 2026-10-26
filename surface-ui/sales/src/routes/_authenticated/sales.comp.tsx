import { growthHubStyles } from "@v3/sales/components/sales/growth-hub-styles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Coins } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Label } from "@v3/shared/components/ui/label";
import { Switch } from "@v3/shared/components/ui/switch";
import { MARGIN_SKIN, pctFmt } from "@v3/sales/utils/margin";
import { loadComp, saveCompRate, type CompDeal, type RepComp } from "@v3/sales/utils/comp";
import { SELLER_ROLES, type SellerRole } from "@v3/sales/utils/sales";

export const Route = createFileRoute("/_authenticated/sales/comp")({
  head: () => ({
    meta: [
      { title: "Compensation — Experience.com Console" },
      {
        name: "description",
        content:
          "Commission on net margin: plans by seller role, earned commission per deal, and below-floor deals that pay zero.",
      },
      { property: "og:title", content: "Compensation — Experience.com Console" },
      {
        property: "og:description",
        content: "Net-margin commission plans, earned commission and blocked below-floor deals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompPage,
});

const cf = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function CompPage() {
  const qc = useQueryClient();
  const [includeDemo, setIncludeDemo] = useState(true);
  const comp = useQuery({
    queryKey: ["comp", includeDemo],
    queryFn: () => loadComp({ includeDemo }),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});

  const saveRate = useMutation({
    mutationFn: ({ id, pct }: { id: string; pct: number }) => saveCompRate(id, pct),
    onSuccess: () => {
      toast.success("Commission rate updated");
      void qc.invalidateQueries({ queryKey: ["comp"] });
      void qc.invalidateQueries({ queryKey: ["comp-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = comp.data?.totals;
  const deals = (comp.data?.reps ?? []).flatMap((r) => r.deals.map((d) => ({ ...d, rep: r })));

  return (
    <PageBody className="growth-comp"><style>{growthHubStyles(".growth-comp") + COMP_CSS}</style>
      <PageHeader
        eyebrow="Customers · Sales"
        title="Compensation"
        description="Commissions pay on NET margin, never on gross. A deal priced below the price-book floor margin pays $0 until it is approved — the same rule the CPQ enforces."
        actions={
          <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--color-ink-2)]">
            <Switch checked={includeDemo} onCheckedChange={setIncludeDemo} />
            Include demo data
          </label>
        }
      />

      <div className="gh-stats mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Commissionable net"
          tone="green"
          loading={comp.isLoading}
          value={cf.format(totals?.net ?? 0)}
          hint="Net margin on won deals"
        />
        <StatTile
          label="Earned commission"
          tone="blue"
          icon={<Coins className="h-4 w-4" />}
          loading={comp.isLoading}
          value={cf.format(totals?.commission ?? 0)}
        />
        <StatTile
          label="Blocked deals"
          tone="yellow"
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={comp.isLoading}
          value={totals?.blockedDeals ?? 0}
          hint="Below floor — pays $0"
        />
        <StatTile
          label="Net in blocked deals"
          tone="red"
          loading={comp.isLoading}
          value={cf.format(totals?.blockedNet ?? 0)}
        />
      </div>

      <div className="grid gap-6">
        <Panel
          title="Plans"
          description="One active plan per seller role. Basis is locked to net margin."
          bodyClassName="px-3 py-2"
        >
          <DataTable
            loading={comp.isLoading}
            rows={comp.data?.plans ?? []}
            getRowKey={(r) => r.id}
            empty={<EmptyState title="No comp plans" compact />}
            columns={[
              { key: "n", header: "Plan", cell: (r) => <span className="font-medium">{r.name}</span> },
              {
                key: "r",
                header: "Role",
                cell: (r) => SELLER_ROLES[r.role as SellerRole]?.label ?? r.role,
              },
              { key: "b", header: "Basis", cell: (r) => r.basis },
              {
                key: "rate",
                header: "Rate of net",
                align: "right",
                cell: (r) => (
                  <div className="flex items-center justify-end gap-2">
                    <Input
                      className="h-8 w-20 text-right font-mono"
                      defaultValue={(Number(r.rate_pct) * 100).toFixed(1)}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                    />
                    <span className="text-xs text-[color:var(--color-ink-2)]">%</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draft[r.id] == null || saveRate.isPending}
                      onClick={() =>
                        saveRate.mutate({ id: r.id, pct: Number(draft[r.id] ?? 0) / 100 })
                      }
                    >
                      Save
                    </Button>
                  </div>
                ),
              },
              { key: "a", header: "Active", cell: (r) => (r.active ? "Yes" : "No") },
            ]}
          />
        </Panel>

        <Panel title="Earnings by seller" description="Commission tracks the quota board." bodyClassName="px-3 py-2">
          <DataTable<RepComp>
            loading={comp.isLoading}
            rows={comp.data?.reps ?? []}
            getRowKey={(r) => r.rep.id}
            empty={<EmptyState title="No sellers with won deals yet" compact />}
            columns={[
              {
                key: "n",
                header: "Seller",
                cell: (r) => (
                  <Link
                    to="/sales/sellers/$repId"
                    params={{ repId: r.rep.id }}
                    className="font-medium hover:underline"
                  >
                    {r.rep.name}
                  </Link>
                ),
              },
              { key: "r", header: "Role", cell: (r) => r.rep.role },
              {
                key: "rate",
                header: "Rate",
                align: "right",
                cell: (r) => `${(r.ratePct * 100).toFixed(1)}%`,
              },
              { key: "s", header: "Sale", align: "right", cell: (r) => cf.format(r.sale) },
              {
                key: "net",
                header: "Net",
                align: "right",
                cell: (r) => <span className="font-mono">{cf.format(r.net)}</span>,
              },
              {
                key: "c",
                header: "Commission",
                align: "right",
                cell: (r) => (
                  <span className="font-mono font-semibold">{cf.format(r.commission)}</span>
                ),
              },
              {
                key: "b",
                header: "Blocked",
                align: "right",
                cell: (r) =>
                  r.blockedDeals === 0 ? (
                    "—"
                  ) : (
                    <span className={`rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold ${MARGIN_SKIN.red.chip}`}>
                      {r.blockedDeals} · {cf.format(r.blockedNet)} net
                    </span>
                  ),
              },
            ]}
          />
        </Panel>

        <Panel title="Deals" description="Per-deal margin and the commission it pays." bodyClassName="px-3 py-2">
          <DataTable<CompDeal & { rep: RepComp }>
            loading={comp.isLoading}
            rows={deals}
            getRowKey={(r) => r.contract.id}
            empty={<EmptyState title="No won deals yet" compact />}
            columns={[
              {
                key: "n",
                header: "Contract",
                cell: (r) => (
                  <Link
                    to="/sales/contracts/$contractId"
                    params={{ contractId: r.contract.id }}
                    className="font-medium hover:underline"
                  >
                    {r.contract.name}
                  </Link>
                ),
              },
              { key: "a", header: "Account", cell: (r) => r.contract.accountName },
              { key: "s", header: "Seller", cell: (r) => r.rep.rep.name },
              { key: "sale", header: "Sale", align: "right", cell: (r) => cf.format(r.deal.sale) },
              {
                key: "cost",
                header: "Token / pass-thru",
                align: "right",
                cell: (r) => (
                  <span className="font-mono text-xs">
                    {cf.format(r.deal.tokenCost)} / {cf.format(r.deal.passthruCost)}
                  </span>
                ),
              },
              {
                key: "net",
                header: "Net",
                align: "right",
                cell: (r) => <span className="font-mono">{cf.format(r.deal.net)}</span>,
              },
              {
                key: "m",
                header: "Margin",
                align: "right",
                cell: (r) => (
                  <span
                    className={`rounded-[6px] border px-2 py-0.5 font-mono text-[11px] font-semibold ${MARGIN_SKIN[r.deal.state].chip}`}
                  >
                    {pctFmt(r.deal.marginPct)}
                  </span>
                ),
              },
              {
                key: "c",
                header: "Commission",
                align: "right",
                cell: (r) =>
                  r.blocked ? (
                    <span className="text-xs font-semibold text-[#8c1d18]">$0 · below floor</span>
                  ) : (
                    <span className="font-mono font-semibold">{cf.format(r.commission)}</span>
                  ),
              },
              {
                key: "d",
                header: "",
                cell: (r) =>
                  r.isDemo ? (
                    <span className="rounded-[6px] bg-[color:var(--color-surface-3)] px-2 py-0.5 text-[10px] font-semibold uppercase">
                      demo
                    </span>
                  ) : null,
              },
            ]}
          />
        </Panel>

        {(comp.data?.unattributed.length ?? 0) > 0 && (
          <Panel
            title="Unattributed deals"
            description="No seller on the contract, so no commission can be paid. Set 'sold by' on the contract."
            bodyClassName="px-3 py-2"
          >
            <DataTable<CompDeal>
              rows={comp.data?.unattributed ?? []}
              getRowKey={(r) => r.contract.id}
              columns={[
                {
                  key: "n",
                  header: "Contract",
                  cell: (r) => (
                    <Link
                      to="/sales/contracts/$contractId"
                      params={{ contractId: r.contract.id }}
                      className="font-medium hover:underline"
                    >
                      {r.contract.name}
                    </Link>
                  ),
                },
                { key: "a", header: "Account", cell: (r) => r.contract.accountName },
                { key: "net", header: "Net", align: "right", cell: (r) => cf.format(r.deal.net) },
                {
                  key: "m",
                  header: "Margin",
                  align: "right",
                  cell: (r) => pctFmt(r.deal.marginPct),
                },
              ]}
            />
          </Panel>
        )}
      </div>

      <div className="mt-6">
        <Label className="text-[11px] text-[color:var(--color-ink-2)]">
          Rule: line cost = (token % × list) + (pass-through % × sale). Net = sale − cost. Commission =
          rate × net, and $0 whenever the blended margin sits under the price-book floor.
        </Label>
      </div>
    </PageBody>
  );
}

const COMP_CSS = `.growth-comp .gh-stats>div p{letter-spacing:0}.growth-comp .gh-stats>div>p{font-weight:750}.growth-comp .gh-stats>div:nth-child(3){--gh-tone:var(--gh-amber)}.growth-comp .gh-stats>div:nth-child(4){--gh-tone:var(--gh-red)}.growth-comp td .rounded-\\[6px\\]{border-color:var(--gh-line)}.growth-comp section>div{min-width:0}`;
