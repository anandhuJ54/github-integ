import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, FlaskConical, Gauge, Trophy } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
      <FlaskConical className="h-3 w-3" /> demo
    </span>
  );
}
import { TerritoryChip } from "@v3/ui/components/sales/territory-chip";
import { loadEventsFor, loadProfessional, loadScore } from "@v3/sales/lib/sales-nav";

export const Route = createFileRoute("/_authenticated/sales/professionals/$proId")({
  head: () => ({
    meta: [
      { title: "Professional dashboard — Experience.com Console" },
      { name: "description", content: "Analytics, ownership, activity and real Search Rank Score for one professional." },
      { property: "og:title", content: "Professional dashboard — Experience.com Console" },
      { property: "og:description", content: "One professional's real score, claim state and activity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfessionalDashboard,
});

const nf = new Intl.NumberFormat("en-US");

function ProfessionalDashboard() {
  const { proId } = Route.useParams();
  const pro = useQuery({ queryKey: ["sn-pro", proId], queryFn: () => loadProfessional(proId) });
  const score = useQuery({ queryKey: ["sn-score", proId], queryFn: () => loadScore(proId) });
  const events = useQuery({
    queryKey: ["sn-pro-events", proId],
    queryFn: () => loadEventsFor({ subjectId: proId }),
  });

  const gaps = (score.data?.gaps ?? null) as Record<string, unknown> | null;
  const gapRows = gaps
    ? Object.entries(gaps).map(([k, v]) => ({ id: k, key: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) }))
    : [];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Professional"
        title={(pro.data?.display_name as string) ?? "Professional"}
        description={
          (pro.data?.headline as string) ||
          [pro.data?.job_title, pro.data?.address_city, pro.data?.address_state].filter(Boolean).join(" · ") ||
          "Professional record."
        }
        actions={
          <div className="flex items-center gap-2">
            {pro.data?.is_demo ? <DemoBadge /> : null}
            <TerritoryChip territoryId={(pro.data?.territory_id) as string | null} />
            {pro.data?.primary_org_id ? (
              <Link
                to="/sales/locations/$orgId"
                params={{ orgId: pro.data.primary_org_id as string }}
                className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
              >
                Owning location
              </Link>
            ) : null}
            {pro.data?.slug ? (
              <>
                <Link
                  to="/p/$slug"
                  params={{ slug: pro.data.slug as string }}
                  className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
                >
                  Public profile
                </Link>
                <Link
                  to="/p/$slug/graph"
                  params={{ slug: pro.data.slug as string }}
                  className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
                >
                  View Graph
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Search Rank Score"
          tone={score.data ? "green" : "neutral"}
          icon={<Gauge className="h-4 w-4" />}
          loading={score.isLoading}
          value={score.data ? `${nf.format(score.data.total_score ?? 0)}/${nf.format(score.data.max_possible ?? 850)}` : "—"}
          hint={score.data ? "search_rank_scores" : "Not scored yet"}
        />
        <StatTile
          label="Local rank"
          tone="blue"
          icon={<Trophy className="h-4 w-4" />}
          loading={score.isLoading}
          value={
            score.data?.local_rank
              ? `#${score.data.local_rank}${score.data.local_rank_of ? ` of ${nf.format(score.data.local_rank_of)}` : ""}`
              : "—"
          }
          hint={score.data?.local_rank ? "From the score row" : "No ranked market yet"}
        />
        <StatTile
          label="Claim state"
          tone={pro.data?.claimed ? "green" : "yellow"}
          icon={<BadgeCheck className="h-4 w-4" />}
          loading={pro.isLoading}
          value={pro.data?.claimed ? "Claimed" : "Unclaimed"}
          hint={pro.data?.claimed_at ? `since ${(pro.data.claimed_at as string).slice(0, 10)}` : "no claim recorded"}
        />
        <StatTile label="Category" tone="purple" value={(pro.data?.gcid as string) ?? "—"} hint="gcid on the record" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Score gaps" description="From search_rank_scores.gaps — no gaps synthesised." bodyClassName="px-3 py-2">
          <DataTable
            loading={score.isLoading}
            rows={gapRows}
            getRowKey={(r) => r.id}
            empty={<EmptyState title="No score row yet" description="This profile has not been scored." compact />}
            columns={[
              { key: "k", header: "Lane", cell: (r) => r.key },
              { key: "v", header: "Gap", align: "right", cell: (r) => r.value },
            ]}
          />
        </Panel>

        <Panel title="Activity" description="exp_activity_events for this person." bodyClassName="px-3 py-2">
          <DataTable
            loading={events.isLoading}
            rows={events.data ?? []}
            getRowKey={(r) => r.id as string}
            empty={<EmptyState title="No recent activity" compact />}
            columns={[
              { key: "type", header: "Event", cell: (r) => (r.event_type as string) ?? "—" },
              {
                key: "when",
                header: "When",
                cell: (r) => (r.occurred_at ? (r.occurred_at as string).slice(0, 10) : "—"),
              },
              { key: "demo", header: "", cell: (r) => (r.is_demo ? <DemoBadge /> : null) },
            ]}
          />
        </Panel>
      </div>
    </PageBody>
  );
}
