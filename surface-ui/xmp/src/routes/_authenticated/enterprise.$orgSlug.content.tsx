import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { EmptyState, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { loadBrand } from "@v3/xmp/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/content")({
  ssr: false,
  component: EnterpriseContent,
});

function EnterpriseContent() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <PageHeader
        eyebrow="Reputation"
        title="Content"
        description="Brand-approved content library for locations and professionals. Every asset passes the category compliance filter before publish."
      />
      <Panel title="Content library">
        <EmptyState
          title="No content items yet"
          description="Content generation is gated behind the category compliance rules for this brand's categories. Nothing is drafted or published today."
          compact
        />
      </Panel>
    </XmpShell>
  );
}
