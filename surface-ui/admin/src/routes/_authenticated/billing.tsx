import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, TrendingUp, KeyRound, Coins, Info } from "lucide-react";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import {
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  DataTable,
  EmptyState,
  type Column,
} from "@v3/ui/components/console/primitives";
import { money, num } from "@v3/ui/lib/console-surfaces";
import { loadBilling, type ContractRow, type EntitlementRow } from "@v3/admin/lib/console-surfaces";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Billing — Experience.com Console" },
      {
        name: "description",
        content:
          "Contract and entitlement state across the book of business: recurring revenue, deal margin, token commitments and what each account can actually use.",
      },
      { property: "og:title", content: "Billing — Experience.com Console" },
      {
        property: "og:description",
        content: "Contracts, recurring revenue and entitlement state across the book of business.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BillingPage,
});

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red";
}) {
  const tones = {
    neutral: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
    blue: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
    green: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
    amber: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
    red: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function InstrumentNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-[14px] border border-dashed border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-4 py-3">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-3)]" />
      <p className="text-xs leading-relaxed text-[color:var(--color-ink-2)]">{children}</p>
    </div>
  );
}

const STATE_TONE: Record<string, "green" | "amber" | "neutral"> = {
  active: "green",
  entitled_unconfigured: "amber",
  not_entitled: "neutral",
};

function BillingPage() {
  const { data, isLoading } = useQuery({ queryKey: ["billing"], queryFn: loadBilling });
  const s = data?.stats;

  const contractColumns: Column<ContractRow>[] = [
    {
      key: "name",
      header: "Contract",
      cell: (c) => (
        <div className="flex items-center gap-2">
          <Link
            to="/sales/contracts/$contractId"
            params={{ contractId: c.id }}
            className="font-medium text-[color:var(--color-g-blue)] hover:underline"
          >
            {c.name ?? "Untitled contract"}
          </Link>
          {c.is_demo ? <Chip tone="amber">Demo</Chip> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <Chip tone={c.status === "active" ? "green" : "neutral"}>{c.status ?? "—"}</Chip>
      ),
    },
    {
      key: "term",
      header: "Term",
      cell: (c) => (
        <span className="text-xs text-[color:var(--color-ink-2)]">
          {c.start_date ?? "—"} → {c.end_date ?? "open"}
        </span>
      ),
    },
    { key: "mrr", header: "MRR", align: "right", cell: (c) => money(c.mrr) },
    {
      key: "arr",
      header: "ARR",
      align: "right",
      cell: (c) => (c.mrr == null ? "—" : money(Number(c.mrr) * 12)),
    },
    { key: "net", header: "Net", align: "right", cell: (c) => money(c.net) },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      cell: (c) =>
        c.margin_pct == null ? (
          "—"
        ) : (
          <span
            className={cn(
              "font-medium",
              Number(c.margin_pct) < 0.2 ? "text-[#c5221f]" : "text-[#1e8e3e]",
            )}
          >
            {(Number(c.margin_pct) * 100).toFixed(1)}%
          </span>
        ),
    },
    {
      key: "approval",
      header: "Approval",
      cell: (c) =>
        c.approval_state && c.approval_state !== "not_required" ? (
          <Chip tone={c.approval_state === "approved" ? "green" : "amber"}>
            {c.approval_state}
          </Chip>
        ) : (
          <span className="text-xs text-[color:var(--color-ink-3)]">not required</span>
        ),
    },
  ];

  const entColumns: Column<EntitlementRow>[] = [
    {
      key: "product",
      header: "Product",
      cell: (e) => (
        <div>
          <span className="font-medium text-ink">
            {data?.productNames.get(e.product_key ?? "") ?? e.product_key ?? "—"}
          </span>
          <p className="mt-0.5 font-mono text-[11px] text-[color:var(--color-ink-3)]">
            {e.product_key}
          </p>
        </div>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      cell: (e) => (
        <span className="text-xs text-[color:var(--color-ink-2)]">
          {e.subject_type ?? "—"}
          <span className="ml-1 font-mono text-[color:var(--color-ink-3)]">
            {e.subject_id ? `${e.subject_id.slice(0, 8)}…` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      cell: (e) => (
        <Chip tone={STATE_TONE[e.state ?? ""] ?? "neutral"}>{e.state ?? "—"}</Chip>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (e) => (
        <span className="text-xs text-[color:var(--color-ink-2)]">{e.source ?? "—"}</span>
      ),
    },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      cell: (e) => (e.tokens_included ? num(e.tokens_included) : "—"),
    },
    {
      key: "granted",
      header: "Granted",
      cell: (e) => (
        <span className="text-xs text-[color:var(--color-ink-3)]">
          {e.granted_at ? new Date(e.granted_at).toLocaleDateString() : "—"}
        </span>
      ),
    },
  ];

  const hasRealRevenue = s?.realMrr != null;

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Customers"
          title="Billing"
          description="Every contract and every entitlement, read live from exp_contracts and exp_entitlements. Recurring revenue is derived only from active non-demo contracts — demo contracts are excluded from the real totals and labelled separately."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="MRR (real)"
            value={hasRealRevenue ? money(s?.realMrr) : "Instrument"}
            hint={
              hasRealRevenue
                ? `${s?.realActive} active contract${s?.realActive === 1 ? "" : "s"}`
                : "No non-demo active contract yet"
            }
            icon={<TrendingUp className="h-4 w-4" />}
            tone={hasRealRevenue ? "green" : "neutral"}
            loading={isLoading}
          />
          <StatTile
            label="ARR (real)"
            value={hasRealRevenue ? money(s?.realArr) : "Instrument"}
            hint={hasRealRevenue ? "MRR × 12" : "Derives once a real contract is signed"}
            icon={<CreditCard className="h-4 w-4" />}
            tone={hasRealRevenue ? "green" : "neutral"}
            loading={isLoading}
          />
          <StatTile
            label="Entitlements active"
            value={num(s?.entitlementsActive)}
            hint={
              s
                ? `${s.entitlementsTotal} total · ${s.entitlementsUnconfigured} unconfigured`
                : undefined
            }
            icon={<KeyRound className="h-4 w-4" />}
            tone="blue"
            loading={isLoading}
          />
          <StatTile
            label="Tokens committed"
            value={s?.tokensCommitted ? num(s.tokensCommitted) : "—"}
            hint="Sum of tokens_included across entitlements"
            icon={<Coins className="h-4 w-4" />}
            tone="purple"
            loading={isLoading}
          />
        </div>

        <div className="mt-8 space-y-6">
          {!hasRealRevenue && !isLoading ? (
            <InstrumentNote>
              <strong className="font-semibold text-ink">Instrument to activate:</strong> there is
              no active non-demo contract in <code>exp_contracts</code> yet, so MRR and ARR cannot
              be derived. The only contract on file is the demo enterprise deal below
              {s?.demoMrr != null ? ` (${money(s.demoMrr)} MRR, demo)` : ""}. Real revenue appears
              here the moment the first production contract is provisioned through CPQ.
            </InstrumentNote>
          ) : null}

          <Panel
            title="Contracts"
            description="All contracts with recurring revenue, deal net, blended margin and approval state."
            bodyClassName="px-3 py-2"
          >
            <DataTable
              columns={contractColumns}
              rows={data?.contracts ?? []}
              loading={isLoading}
              getRowKey={(c) => c.id}
              empty={
                <EmptyState
                  title="No contracts yet"
                  description="Contracts land here once a quote is closed in the Sales CPQ."
                  compact
                />
              }
            />
          </Panel>

          <Panel
            title="Entitlements"
            description="What each subject can actually use — the exact rows Nora reads at runtime."
            bodyClassName="px-3 py-2"
          >
            <DataTable
              columns={entColumns}
              rows={data?.entitlements ?? []}
              loading={isLoading}
              getRowKey={(e) => e.id}
              empty={
                <EmptyState
                  title="No entitlements granted"
                  description="Provisioning a contract writes entitlement rows here."
                  compact
                />
              }
            />
          </Panel>

          <Panel title="Invoicing & payments">
            <InstrumentNote>
              <strong className="font-semibold text-ink">Instrument to activate:</strong> invoices,
              payment status, dunning and collections are not modelled yet — there is no billing
              provider connected. Contract MRR above is the authoritative recurring figure until a
              payment processor is wired in.
            </InstrumentNote>
          </Panel>
        </div>
      </PageBody>
    </EmpLayout>
  );
}
