import { createFileRoute } from "@tanstack/react-router";
import { EmpLayout } from "@v3/shared/components/ui/emp-layout";
import { PageBody, PageHeader } from "@v3/shared/components/ui/console-primitives";
import { PipelineHealthTab } from "@v3/etl/components/discovery/pipeline-health-tab";

// NORA OS → Run health: discovery jobs, engine counts and the ETL run monitor (the old /nora-os
// Runs tab). The data is etl's (GET /etl/platform/pipeline-health, /etl/run-monitor).
export const Route = createFileRoute("/_authenticated/run-health")({
  head: () => ({
    meta: [
      { title: "Run health — Experience.com Console" },
      {
        name: "description",
        content: "Discovery jobs, the human review queue, engine throughput and the ETL run monitor.",
      },
    ],
  }),
  component: RunHealthPage,
});

function RunHealthPage() {
  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="NORA OS"
          title="Run health"
          description="What NORA is working on right now: discovery jobs, the review queue, engine throughput and ETL runs."
        />
        <PipelineHealthTab />
      </PageBody>
    </EmpLayout>
  );
}
