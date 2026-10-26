import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { XmpShell, CoverageBar } from "@v3/xmp/components/enterprise/xmp-chrome";
import { Panel, DataTable, EmptyState, type Column } from "@v3/ui/components/console/primitives";
import { loadBrand, loadOverview, loadStateRollup, type StateRow } from "@v3/xmp/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/reporting")({
  ssr: false,
  component: Reporting,
});

const pct = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : "—";

function Reporting() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;

  const overviewQ = useQuery({
    queryKey: ["xmp-overview", brandId],
    queryFn: () => loadOverview(brandId!),
    enabled: !!brandId,
  });
  const statesQ = useQuery({
    queryKey: ["xmp-states", brandId],
    queryFn: () => loadStateRollup(brandId!, 200),
    enabled: !!brandId,
  });

  const o = overviewQ.data;

  const cols: Column<StateRow>[] = [
    { key: "state", header: "State", cell: (r) => <span className="font-medium text-ink">{r.state}</span> },
    { key: "offices", header: "Locations", align: "right", cell: (r) => r.offices.toLocaleString() },
    { key: "pros", header: "Professionals", align: "right", cell: (r) => r.pros.toLocaleString() },
    {
      key: "claimed",
      header: "Claimed",
      align: "right",
      cell: (r) => `${r.claimed.toLocaleString()} · ${pct(r.claimed, r.pros)}`,
    },
    {
      key: "bio",
      header: "Bio",
      align: "right",
      cell: (r) => `${r.with_bio.toLocaleString()} · ${pct(r.with_bio, r.pros)}`,
    },
    {
      key: "photo",
      header: "Photo",
      align: "right",
      cell: (r) => `${r.with_photo.toLocaleString()} · ${pct(r.with_photo, r.pros)}`,
    },
    {
      key: "reviews",
      header: "Reviews",
      align: "right",
      cell: (r) => (r.reviews > 0 ? r.reviews.toLocaleString() : "—"),
    },
  ];

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <div className="space-y-6">
        <Panel
          title="Brand roll-up"
          description="Coverage across every location and professional under this brand. Percentages are computed from live rows only."
        >
          {o ? (
            <div className="grid gap-4 md:grid-cols-2">
              <CoverageBar label="Claimed professionals" part={o.pros_claimed} whole={o.pros} />
              <CoverageBar label="Bio captured" part={o.pros_bio} whole={o.pros} />
              <CoverageBar label="Photo captured" part={o.pros_photo} whole={o.pros} />
              <CoverageBar label="Products / services captured" part={o.pros_products} whole={o.pros} />
              <CoverageBar label="Google place ID linked" part={o.pros_place_id} whole={o.pros} />
              <CoverageBar label="Scored professionals" part={o.pros_scored} whole={o.pros} />
            </div>
          ) : (
            <div className="h-28 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
          )}
          {o && o.reviews_pro === 0 ? (
            <p className="mt-5 rounded-xl bg-[color:var(--color-surface-2)] px-4 py-3 text-xs text-[color:var(--color-ink-2)]">
              Review coverage: no reviews are attached to this brand's professionals yet — instrument review
              sync to activate review-coverage reporting.
            </p>
          ) : null}
        </Panel>

        <Panel
          title="By-state breakdown"
          description="Every state with at least one location under this brand."
          bodyClassName="px-3 py-2"
        >
          <DataTable
            columns={cols}
            rows={statesQ.data ?? []}
            getRowKey={(r) => r.state}
            loading={statesQ.isLoading}
            empty={<EmptyState compact title="No locations on file" />}
          />
        </Panel>
      </div>
    </XmpShell>
  );
}
