import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { XmpShell } from "@/components/enterprise/xmp-chrome";
import { EmptyState, PageHeader, Panel } from "@/components/console/primitives";
import { loadBrand } from "@/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/multi-post")({
  ssr: false,
  component: MultiPost,
});

function MultiPost() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <PageHeader
        eyebrow="Reputation"
        title="Multi-Post"
        description="Publish one post to every location and professional surface under this brand."
      />
      <Panel title="Publishing destinations">
        <EmptyState
          title="No publishing connectors linked"
          description="Multi-Post activates once location surfaces (Google Business Profile, social) are connected for this brand. Nothing is queued or sent today."
          compact
        />
      </Panel>
    </XmpShell>
  );
}
