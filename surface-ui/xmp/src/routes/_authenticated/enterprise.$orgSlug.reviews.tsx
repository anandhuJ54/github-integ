import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { EmptyState, PageHeader, Panel } from "@v3/ui/components/console/primitives";
import { loadBrand, loadTopReviews } from "@v3/xmp/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/reviews")({
  ssr: false,
  component: EnterpriseReviews,
});

function EnterpriseReviews() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;

  const reviewsQ = useQuery({
    queryKey: ["xmp-reviews-leaders", brandId],
    queryFn: () => loadTopReviews(brandId!, 25),
    enabled: !!brandId,
  });

  const rows = reviewsQ.data ?? [];

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <PageHeader
        eyebrow="Reputation"
        title="Reviews"
        description="Every review attached to this brand's professionals and locations, scoped to your organization."
      />
      <Panel title="Review volume by professional" bodyClassName="p-4">
        {reviewsQ.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No reviews on file"
            description="Review ingestion is not wired for this brand yet — instrument to activate."
            compact
          />
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate font-medium text-ink">
                  {r.display_name ?? "Unnamed professional"}
                </span>

                <span className="tabular-nums text-[color:var(--color-ink-2)]">
                  {r.review_count?.toLocaleString() ?? "—"} reviews
                  {r.avg_rating != null ? ` · ${r.avg_rating.toFixed(2)}★` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </XmpShell>
  );
}
