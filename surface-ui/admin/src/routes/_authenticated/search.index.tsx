import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Eye, MousePointerClick, Percent, Users } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { InstrumentNote } from "@v3/ui/components/website/bits";
import { num, pct } from "@v3/ui/lib/console-surfaces";
import { catLabel, loadSearchOverview, type VolumeRow } from "@v3/admin/lib/search-console";

export const Route = createFileRoute("/_authenticated/search/")({
  head: () => ({
    meta: [
      { title: "Search Overview — Growth engine cockpit" },
      {
        name: "description",
        content:
          "Live page views, unique visitors, claim-CTA views, claims and claim rate for the public growth engine, broken out by category and zip.",
      },
      { property: "og:title", content: "Search Overview — Growth engine cockpit" },
      { property: "og:description", content: "The page-view meter sponsored pricing is based on." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchOverview,
});

function SearchOverview() {
  const { data, isLoading } = useQuery({ queryKey: ["search-overview"], queryFn: loadSearchOverview });
  const t = data?.totals;
  const labels = data?.labels ?? new Map<string, string>();
  const volume = data?.volume ?? [];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Search · Overview"
        title="Growth engine cockpit"
        description="Public demand as measured on our own pages. This meter is the basis every sponsored and volume-priced customer is charged on."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Page views"
          value={num(t?.page_views ?? null)}
          hint={t?.days ? `${num(t.days)} rollup rows` : undefined}
          icon={<Eye className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile
          label="Unique visitors"
          value={num(t?.unique_visitors ?? null)}
          icon={<Users className="h-4 w-4" />}
          tone="purple"
          loading={isLoading}
        />
        <StatTile
          label="Claim-CTA views"
          value={num(t?.claim_cta_views ?? null)}
          icon={<MousePointerClick className="h-4 w-4" />}
          tone="yellow"
          loading={isLoading}
        />
        <StatTile
          label="Claims"
          value={num(t?.claims ?? null)}
          icon={<BadgeCheck className="h-4 w-4" />}
          tone="green"
          loading={isLoading}
        />
        <StatTile
          label="Claim rate"
          value={t?.claim_rate == null ? "—" : pct(t.claim_rate, 1)}
          hint="Claims ÷ claim-CTA views"
          icon={<Percent className="h-4 w-4" />}
          tone="blue"
          loading={isLoading}
        />
      </div>

      <Panel
        className="mt-6"
        title="Volume by category × zip"
        description="Ranked by page views — the meter future sponsored customers get priced on."
        bodyClassName="px-3 py-2"
      >
        <DataTable<VolumeRow>
          columns={[
            {
              key: "cat",
              header: "Category",
              cell: (r) => <span className="font-medium text-ink">{catLabel(labels, r.gcid)}</span>,
            },
            { key: "zip", header: "Zip", cell: (r) => r.geo_value ?? "—" },
            { key: "pv", header: "Page views", align: "right", cell: (r) => num(r.page_views) },
            { key: "uv", header: "Unique", align: "right", cell: (r) => num(r.unique_visitors) },
            { key: "cta", header: "Claim-CTA views", align: "right", cell: (r) => num(r.claim_cta_views) },
            { key: "cl", header: "Claims", align: "right", cell: (r) => num(r.claims) },
            {
              key: "rate",
              header: "Claim rate",
              align: "right",
              cell: (r) => (
                <span className="font-semibold text-ink">
                  {r.claim_rate == null ? "—" : pct(r.claim_rate, 1)}
                </span>
              ),
            },
          ]}
          rows={volume}
          getRowKey={(r) => r.key}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Eye className="h-4 w-4" />}
              title="No page-view rollups yet"
              description="Instrument to activate — the meter fills as the public pages report traffic."
            />
          }
        />
      </Panel>

      <div className="mt-4">
        <InstrumentNote>
          Rows come straight from the page-view rollup. Categories or zips without a rollup row do not appear —
          nothing here is estimated.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
