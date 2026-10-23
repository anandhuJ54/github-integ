import { growthHubStyles } from "@/components/sales/growth-hub-styles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageBody, PageHeader, Panel } from "@/components/console/primitives";
import { OpportunityWorkspace } from "@/components/sales/opportunity-workspace";
import { loadOpportunityFile } from "@/lib/opportunity-file";

export const Route = createFileRoute("/_authenticated/sales/opportunities/$oppId")({
  head: () => ({
    meta: [
      { title: "Opportunity Workspace — Experience.com Growth Hub" },
      { name: "description", content: "Command center for opportunity stages, evidence, activity, buying committee and whitespace." },
      { property: "og:title", content: "Opportunity Workspace — Experience.com Growth Hub" },
      { property: "og:description", content: "Command center for governed opportunity progression and close lifecycle." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OpportunityWorkspaceRoute,
});

function OpportunityWorkspaceRoute() {
  const { oppId } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["opportunity-file", oppId], queryFn: () => loadOpportunityFile(oppId) });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["opportunity-file", oppId] }); };

  if (query.isLoading) return <PageBody className="growth-opportunity"><style>{growthHubStyles(".growth-opportunity")}</style><PageHeader eyebrow="Growth Hub · Opportunity" title="Loading…"/><Panel><div className="h-56 animate-pulse rounded-[8px] bg-[color:var(--color-surface-2)]"/></Panel></PageBody>;
  if (query.error) return <PageBody className="growth-opportunity"><style>{growthHubStyles(".growth-opportunity")}</style><PageHeader eyebrow="Growth Hub · Opportunity" title="Unable to load opportunity"/><EmptyState title="The workspace could not load" description={query.error.message} action={<Button asChild variant="outline"><Link to="/sales/opportunities"><ArrowLeft/>Back to opportunities</Link></Button>}/></PageBody>;
  if (!query.data) return <PageBody className="growth-opportunity"><style>{growthHubStyles(".growth-opportunity")}</style><PageHeader eyebrow="Growth Hub · Opportunity" title="Opportunity not found"/><EmptyState title="No such opportunity" description="This opportunity no longer exists in the pipeline." action={<Button asChild variant="outline"><Link to="/sales/opportunities"><ArrowLeft/>Back to opportunities</Link></Button>}/></PageBody>;

  return <PageBody className="growth-opportunity"><style>{growthHubStyles(".growth-opportunity")}</style><OpportunityWorkspace data={query.data} onRefresh={refresh}/></PageBody>;
}
