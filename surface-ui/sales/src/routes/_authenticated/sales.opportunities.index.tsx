import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Briefcase } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
} from "@v3/shared/components/ui/console-primitives";
import { loadOpportunityList, usd, type OppListRow } from "@v3/sales/utils/opportunity-file";

export const Route = createFileRoute("/_authenticated/sales/opportunities/")({
  head: () => ({
    meta: [
      { title: "Opportunities — Experience.com Console" },
      {
        name: "description",
        content:
          "Every open and closed opportunity in the Growth Hub pipeline, with account, owner, stage and ACV. Each row opens its Opportunity File.",
      },
      { property: "og:title", content: "Opportunities — Experience.com Console" },
      {
        property: "og:description",
        content: "Pipeline opportunities with stage, ACV and owner; each links to its Opportunity File.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpportunitiesIndex,
});

function OpportunitiesIndex() {
  const q = useQuery({ queryKey: ["opportunity-list"], queryFn: loadOpportunityList });
  const stageLabel = (key: string) =>
    q.data?.stages.find((s) => s.key === key)?.label ?? key;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub"
        title="Opportunities"
        description="Every row in the pipeline. Open an opportunity to work its Opportunity File — contacts, notes, tasks, files, activity and the stage gate."
      />
      <Panel
        title="Pipeline"
        description="exp_sales_pipeline, highest ACV first."
        bodyClassName="px-3 py-2"
      >
        <DataTable<OppListRow>
          loading={q.isLoading}
          rows={q.data?.rows ?? []}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<Briefcase className="h-4 w-4" />}
              title="No opportunities yet"
              description="The pipeline table has no rows. Opportunities appear here as deals are created."
              compact
            />
          }
          columns={[
            {
              key: "name",
              header: "Opportunity",
              cell: (r) => (
                <Link
                  to="/sales/opportunities/$oppId"
                  params={{ oppId: r.id }}
                  className="inline-flex items-center gap-1.5 font-medium text-[color:var(--color-g-blue)] hover:underline"
                >
                  {r.name}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              ),
            },
            {
              key: "account",
              header: "Account",
              cell: (r) => r.accountName ?? <span className="text-[color:var(--color-ink-3)]">—</span>,
            },
            {
              key: "owner",
              header: "Owner",
              cell: (r) => r.ownerName ?? <span className="text-[color:var(--color-ink-3)]">—</span>,
            },
            { key: "stage", header: "Stage", cell: (r) => stageLabel(r.stage) },
            {
              key: "prob",
              header: "Prob.",
              align: "right",
              cell: (r) =>
                r.probability == null ? (
                  <span className="text-[color:var(--color-ink-3)]">—</span>
                ) : (
                  `${r.probability}%`
                ),
            },
            {
              key: "value",
              header: "ACV",
              align: "right",
              cell: (r) => <span className="font-mono tabular-nums">{usd(r.value)}</span>,
            },
          ]}
        />
      </Panel>
    </PageBody>
  );
}
