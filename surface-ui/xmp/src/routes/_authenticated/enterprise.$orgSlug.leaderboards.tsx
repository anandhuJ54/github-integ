import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Layers, Star, Building2 } from "lucide-react";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import { Panel, EmptyState, DataTable, type Column } from "@v3/ui/components/console/primitives";
import { Badge } from "@v3/ui/components/ui/badge";
import {
  loadBrand,
  loadTopProsByScore,
  loadTopOfficesByScore,
  loadTopDepth,
  loadTopReviews,
  proName,
  type ProRow,
  type OfficeRow,
  type DepthRow,
  type ReviewLeaderRow,
} from "@v3/xmp/lib/enterprise-xmp";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/leaderboards")({
  ssr: false,
  component: Leaderboards,
});

function rankBadge(i: number) {
  const tone =
    i === 0
      ? "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]"
      : i < 3
        ? "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
        : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]";
  return (
    <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${tone}`}>
      {i + 1}
    </span>
  );
}

function Leaderboards() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const brandId = brandQ.data?.id;
  const on = { enabled: !!brandId };

  const prosQ = useQuery({ queryKey: ["xmp-lb-pros", brandId], queryFn: () => loadTopProsByScore(brandId!, 20), ...on });
  const officesQ = useQuery({ queryKey: ["xmp-lb-offices", brandId], queryFn: () => loadTopOfficesByScore(brandId!, 20), ...on });
  const depthQ = useQuery({ queryKey: ["xmp-lb-depth", brandId], queryFn: () => loadTopDepth(brandId!, 20), ...on });
  const revQ = useQuery({ queryKey: ["xmp-lb-reviews", brandId], queryFn: () => loadTopReviews(brandId!, 20), ...on });

  const proCols: Column<ProRow>[] = [
    { key: "r", header: "#", width: "48px", cell: (_r) => null },
    {
      key: "name",
      header: "Professional",
      cell: (r) => (
        <Link
          to="/enterprise/$orgSlug/view/$kind/$id"
          params={{ orgSlug, kind: "professional", id: r.id }}
          className="font-medium text-[color:var(--color-g-blue)]"
        >
          {proName(r)}
        </Link>
      ),
    },
    { key: "loc", header: "Location", cell: (r) => [r.address_city, r.address_state].filter(Boolean).join(", ") || "—" },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (r) => <span className="font-semibold tabular-nums">{r.search_rank_score ?? "—"}</span>,
    },
  ];

  const officeCols: Column<OfficeRow>[] = [
    {
      key: "name",
      header: "Location",
      cell: (r) => (
        <Link
          to="/enterprise/$orgSlug/view/$kind/$id"
          params={{ orgSlug, kind: "location", id: r.id }}
          className="font-medium text-[color:var(--color-g-blue)]"
        >
          {r.name}
        </Link>
      ),
    },
    { key: "loc", header: "City", cell: (r) => [r.address_city, r.address_state].filter(Boolean).join(", ") || "—" },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (r) => <span className="font-semibold tabular-nums">{r.search_rank_score ?? "—"}</span>,
    },
  ];

  const depthCols: Column<DepthRow>[] = [
    {
      key: "name",
      header: "Professional",
      cell: (r) => (
        <Link
          to="/enterprise/$orgSlug/view/$kind/$id"
          params={{ orgSlug, kind: "professional", id: r.id }}
          className="font-medium text-[color:var(--color-g-blue)]"
        >
          {r.display_name ?? "Unnamed professional"}
        </Link>
      ),
    },
    { key: "loc", header: "Location", cell: (r) => [r.address_city, r.address_state].filter(Boolean).join(", ") || "—" },
    {
      key: "nodes",
      header: "Captured nodes",
      align: "right",
      cell: (r) => (
        <Badge variant="secondary" className="border-0 bg-[color:var(--color-g-green-soft)] text-[#1e8e3e] tabular-nums">
          {r.node_count}
        </Badge>
      ),
    },
  ];

  const revCols: Column<ReviewLeaderRow>[] = [
    { key: "name", header: "Professional", cell: (r) => r.display_name ?? "Unnamed professional" },
    { key: "count", header: "Reviews", align: "right", cell: (r) => r.review_count.toLocaleString() },
    { key: "avg", header: "Avg rating", align: "right", cell: (r) => (r.avg_rating != null ? r.avg_rating.toFixed(2) : "—") },
  ];

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="Top professionals by search rank score"
          description="Scored professionals only. Empty means scoring has not been run for this brand — no score is inferred."
          actions={<Gauge className="h-4 w-4 text-[color:var(--color-ink-3)]" />}
          bodyClassName="px-3 py-2"
        >
          <DataTable
            columns={proCols.filter((c) => c.key !== "r")}
            rows={prosQ.data ?? []}
            getRowKey={(r) => r.id}
            loading={prosQ.isLoading}
            empty={
              <EmptyState
                compact
                title="No scored professionals yet"
                description="Search Rank scoring has not produced a score for any professional under this brand."
              />
            }
          />
        </Panel>

        <Panel
          title="Top locations by search rank score"
          description="Office-level scores under this brand."
          actions={<Building2 className="h-4 w-4 text-[color:var(--color-ink-3)]" />}
          bodyClassName="px-3 py-2"
        >
          <DataTable
            columns={officeCols}
            rows={officesQ.data ?? []}
            getRowKey={(r) => r.id}
            loading={officesQ.isLoading}
            empty={
              <EmptyState
                compact
                title="No scored locations yet"
                description="No office under this brand carries a positive search rank score."
              />
            }
          />
        </Panel>

        <Panel
          title="Most complete profiles"
          description="Ranked by captured expertise-graph depth (active nodes per professional) — the real measure of hydration."
          actions={<Layers className="h-4 w-4 text-[color:var(--color-ink-3)]" />}
          bodyClassName="px-3 py-2"
        >
          <DataTable
            columns={depthCols}
            rows={depthQ.data ?? []}
            getRowKey={(r) => r.id}
            loading={depthQ.isLoading}
            empty={<EmptyState compact title="No captured nodes yet" />}
          />
        </Panel>

        <Panel
          title="Top professionals by review count"
          description="Live reviews attached to brand professionals."
          actions={<Star className="h-4 w-4 text-[color:var(--color-ink-3)]" />}
          bodyClassName="px-3 py-2"
        >
          <DataTable
            columns={revCols}
            rows={revQ.data ?? []}
            getRowKey={(r) => r.id}
            loading={revQ.isLoading}
            empty={
              <EmptyState
                compact
                title="Review ingestion not wired"
                description="No reviews exist for this brand's professionals yet — instrument review sync to activate this board."
              />
            }
          />
        </Panel>
      </div>
    </XmpShell>
  );
}
