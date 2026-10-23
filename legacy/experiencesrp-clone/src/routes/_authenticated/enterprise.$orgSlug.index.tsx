import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Users,
  BadgeCheck,
  Gauge,
  MapPin,
  Star,
  ArrowRight,
} from "lucide-react";
import { XmpShell, CoverageBar } from "@/components/enterprise/xmp-chrome";
import {
  Panel,
  StatTile,
  EmptyState,
  DataTable,
  type Column,
} from "@/components/console/primitives";
import {
  loadBrand,
  loadOverview,
  loadStateRollup,
  type StateRow,
} from "@/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/")({
  ssr: false,
  component: EnterpriseDashboard,
});

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pctText = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : "—";

function EnterpriseDashboard() {
  const { orgSlug } = Route.useParams();

  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;

  const overviewQ = useQuery({
    queryKey: ["xmp-overview", brandId],
    queryFn: () => loadOverview(brandId!),
    enabled: !!brandId,
  });
  const statesQ = useQuery({
    queryKey: ["xmp-states-top", brandId],
    queryFn: () => loadStateRollup(brandId!, 10),
    enabled: !!brandId,
  });

  const o = overviewQ.data;

  const stateCols: Column<StateRow>[] = [
    { key: "state", header: "State", cell: (r) => <span className="font-medium text-ink">{r.state}</span> },
    { key: "offices", header: "Locations", align: "right", cell: (r) => num(r.offices) },
    { key: "pros", header: "Professionals", align: "right", cell: (r) => num(r.pros) },
    {
      key: "bio",
      header: "Hydrated (bio)",
      align: "right",
      cell: (r) => `${num(r.with_bio)} · ${pctText(r.with_bio, r.pros)}`,
    },
  ];

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      {!brandQ.isLoading && !brandQ.data ? (
        <EmptyState title="Brand not found" description={`No organization matches “${orgSlug}”.`} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Total locations"
              value={num(o?.offices)}
              hint="Offices under this brand"
              icon={<Building2 className="h-4 w-4" />}
              loading={overviewQ.isLoading}
            />
            <StatTile
              label="Total professionals"
              value={num(o?.pros)}
              hint={`Across ${num(o?.offices)} locations`}
              icon={<Users className="h-4 w-4" />}
              tone="purple"
              loading={overviewQ.isLoading}
            />
            <StatTile
              label="Claimed"
              value={o ? pctText(o.pros_claimed, o.pros) : "—"}
              hint={`${num(o?.pros_claimed)} professionals claimed`}
              icon={<BadgeCheck className="h-4 w-4" />}
              tone={o && o.pros_claimed > 0 ? "green" : "yellow"}
              loading={overviewQ.isLoading}
            />
            <StatTile
              label="Avg search rank score"
              value={o?.avg_pro_score != null ? o.avg_pro_score.toFixed(1) : "Not scored yet"}
              hint={
                o?.pros_scored
                  ? `${num(o.pros_scored)} of ${num(o.pros)} scored`
                  : "No professional under this brand has been scored — scoring not yet run"
              }
              icon={<Gauge className="h-4 w-4" />}
              tone={o?.avg_pro_score != null ? "blue" : "neutral"}
              loading={overviewQ.isLoading}
            />
            <StatTile
              label="States covered"
              value={num(o?.states)}
              hint="Distinct location states on file"
              icon={<MapPin className="h-4 w-4" />}
              tone="neutral"
              loading={overviewQ.isLoading}
            />
            <StatTile
              label="Reviews on file"
              value={num(o?.reviews_pro)}
              hint={
                o && o.reviews_pro === 0
                  ? "Review ingestion not wired — instrument to activate"
                  : "Reviews attached to brand professionals"
              }
              icon={<Star className="h-4 w-4" />}
              tone={o && o.reviews_pro > 0 ? "green" : "neutral"}
              loading={overviewQ.isLoading}
            />
          </div>

          <Panel
            title="Profile hydration coverage"
            description="Share of brand professionals with each captured field. Sourced from live profile rows and the ETL expertise graph."
          >
            {o ? (
              <div className="grid gap-4 md:grid-cols-2">
                <CoverageBar label="Bio captured" part={o.pros_bio} whole={o.pros} />
                <CoverageBar label="Photo captured" part={o.pros_photo} whole={o.pros} />
                <CoverageBar label="Products / services captured" part={o.pros_products} whole={o.pros} />
                <CoverageBar label="Google place ID linked" part={o.pros_place_id} whole={o.pros} />
              </div>
            ) : (
              <div className="h-24 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Discoverability funnel"
              description="Where this brand's professionals drop out of search discoverability. Live counts only."
            >
              {o ? (
                <div className="space-y-3">
                  {(
                    [
                      ["Professionals on file", o.pros],
                      ["Hydrated (bio captured)", o.pros_bio],
                      ["Products / services captured", o.pros_products],
                      ["Claimed", o.pros_claimed],
                      ["Scored", o.pros_scored],
                      ["With reviews on file", o.reviews_pro > 0 ? o.reviews_pro : 0],
                    ] as [string, number][]
                  ).map(([label, value]) => (
                    <CoverageBar key={label} label={label} part={value} whole={o.pros} />
                  ))}
                </div>
              ) : (
                <div className="h-32 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
              )}
            </Panel>

            <Panel
              title="Nora · top moves"
              description="Ranked by the largest measured gap across this brand's footprint."
            >
              {o ? (
                <ol className="space-y-3">
                  {[
                    {
                      when: o.pros_bio < o.pros,
                      title: `Hydrate ${num(o.pros - o.pros_bio)} professional profiles`,
                      body: "Profiles without a bio cannot emit meaningful expertise schema, so they never enter the ranked set.",
                    },
                    {
                      when: o.pros_claimed < o.pros,
                      title: `Drive claims on ${num(o.pros - o.pros_claimed)} profiles`,
                      body: "Unclaimed profiles cannot be maintained by the professional and stay static.",
                    },
                    {
                      when: o.pros_scored < o.pros,
                      title: `Score ${num(o.pros - o.pros_scored)} profiles`,
                      body: "Search Rank Score has not been computed for these profiles yet.",
                    },
                    {
                      when: o.reviews_pro === 0,
                      title: "Connect review ingestion",
                      body: "No reviews are on file for this brand — the reviews ring contributes zero today.",
                    },
                    {
                      when: o.pros_place_id < o.pros,
                      title: `Link ${num(o.pros - o.pros_place_id)} Google place IDs`,
                      body: "Place linkage is required before location surfaces can be published to.",
                    },
                  ]
                    .filter((m) => m.when)
                    .slice(0, 4)
                    .map((m, i) => (
                      <li key={m.title} className="flex gap-3">
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[11px] font-bold text-[color:var(--color-g-blue)]">
                          {i + 1}
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-ink">{m.title}</span>
                          <span className="block text-xs text-[color:var(--color-ink-2)]">
                            {m.body}
                          </span>
                        </span>
                      </li>
                    ))}
                </ol>
              ) : (
                <div className="h-32 animate-pulse rounded-xl bg-[color:var(--color-surface-2)]" />
              )}
            </Panel>
          </div>


          <Panel
            title="Top states by location count"
            description="Full breakdown lives in roll-up reporting."
            actions={
              <Link
                to="/enterprise/$orgSlug/reporting"
                params={{ orgSlug }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-g-blue)]"
              >
                All states <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
            bodyClassName="px-3 py-2"
          >
            <DataTable
              columns={stateCols}
              rows={statesQ.data ?? []}
              getRowKey={(r) => r.state}
              loading={statesQ.isLoading}
            />
          </Panel>
        </div>
      )}
    </XmpShell>
  );
}
