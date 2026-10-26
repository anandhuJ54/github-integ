import { growthHubStyles } from "@v3/sales/components/sales/growth-hub-styles";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { DataTable, EmptyState, PageBody, PageHeader, Panel } from "@v3/shared/components/ui/console-primitives";
import { Button } from "@v3/shared/components/ui/button";
import { listQuotes, newQuoteId, type QuoteRow } from "@v3/sales/utils/sales-cpq";

export const Route = createFileRoute("/_authenticated/sales/quotes/")({
  head: () => ({
    meta: [
      { title: "Quotes — Experience.com Growth Hub" },
      { name: "description", content: "CPQ quotes: configure entitlements, price and hand off to contracts." },
      { property: "og:title", content: "Quotes — Experience.com Growth Hub" },
      { property: "og:description", content: "Configure, price and quote Experience.com entitlements." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotesPage,
});

const cf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function QuotesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["cpq-quotes"], queryFn: listQuotes });
  return (
    <PageBody className="cpq-quotes"><style>{growthHubStyles(".cpq-quotes")}</style>
      <PageHeader
        eyebrow="Growth Hub · CPQ"
        title="Quotes"
        description="Every saved quote. Open one to continue configuring entitlements."
        actions={
          <Button onClick={() => navigate({ to: "/sales/quotes/$quoteId", params: { quoteId: newQuoteId() } })}>
            <Plus className="mr-1.5 h-4 w-4" /> New quote
          </Button>
        }
      />
      <Panel bodyClassName="px-3 py-2">
        <DataTable<QuoteRow>
          loading={q.isLoading}
          rows={q.data ?? []}
          getRowKey={(r) => r.id}
          onRowClick={(r) => r.name && navigate({ to: "/sales/quotes/$quoteId", params: { quoteId: r.name } })}
          empty={<EmptyState icon={<FileText className="h-4 w-4" />} title="No quotes yet" description="Start a new quote to configure entitlements." compact />}
          columns={[
            {
              key: "n",
              header: "Quote",
              cell: (r) =>
                r.name ? (
                  <Link to="/sales/quotes/$quoteId" params={{ quoteId: r.name }} className="font-medium text-[color:var(--color-g-blue)]">
                    {r.name}
                  </Link>
                ) : (
                  "—"
                ),
            },
            { key: "s", header: "Status", cell: (r) => <span className="gh-status capitalize" data-status={r.status ?? "neutral"}>{(r.status ?? "—").replace(/_/g, " ")}</span> },
            {
              key: "a",
              header: "Estimated ARR",
              align: "right",
              cell: (r) => {
                const v = (r.summary as { estimatedArr?: number } | null)?.estimatedArr;
                return v != null ? cf.format(v) : "—";
              },
            },
            { key: "u", header: "Updated", align: "right", cell: (r) => (r.updated_at ? new Date(r.updated_at).toLocaleString() : "—") },
          ]}
        />
      </Panel>
    </PageBody>
  );
}
