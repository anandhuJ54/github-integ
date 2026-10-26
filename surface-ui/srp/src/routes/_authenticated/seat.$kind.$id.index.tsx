import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, MapPin, Phone, Users } from "lucide-react";
import { EmptyState, PageHeader, Panel, StatTile } from "@v3/shared/components/ui/console-primitives";
import {
  CoverageBars,
  RatingSummary,
  ReadOnlyRow,
  ReviewList,
  ScoreCard,
  SeatLoading,
} from "@v3/srp/components/seat/pieces";
import { BrandAvatar, PersonAvatar } from "@v3/shared/components/ui/entity-avatar";
import { Badge } from "@v3/shared/components/ui/badge";
import { rosterCoverage, seatProName } from "@v3/srp/utils/seat";
import { HomeDay1Screen } from "@v3/srp/components/happyflow/screens/home-day1";
import { HomeDay7Screen } from "@v3/srp/components/happyflow/screens/home-day7";
import { validateOverviewSearch } from "@v3/srp/utils/overview-search";
import { useLocationSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/")({
  // Professional seats show the Happyflow NORA home (demo data): day 1, or ?day=7 (&events=1) / ?day=24.
  validateSearch: validateOverviewSearch,
  component: SeatOverview,
});

function SeatOverview() {
  const { isPro } = useSeatParams();
  const { day, events } = Route.useSearch();
  if (!isPro) return <LocationOverview />;
  if (day === 7 || day === 24) return <HomeDay7Screen key={day} day={day} events={!!events} />;
  return <HomeDay1Screen />;
}

/* ─────────────────────────── LOCATION overview ─────────────────────────── */

function LocationOverview() {
  const { id, base } = useSeatParams();
  const q = useLocationSeat(id);
  const seat = q.data;

  if (q.isLoading) return <SeatLoading />;
  if (!seat) return <EmptyState title="Location not found" description="This record no longer exists." />;

  const cov = rosterCoverage(seat.pros);
  const proReviewCount = seat.proRatings.reduce((s, r) => s + (r.review_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Location workspace"
        title={seat.office.name}
        description={
          [seat.office.address_street, seat.office.address_city, seat.office.address_state, seat.office.address_zip]
            .filter(Boolean)
            .join(", ") || undefined
        }
        actions={
          seat.office.slug ? (
            <a
              href={`/o/${seat.office.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-g-blue)]"
            >
              Public profile <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null
        }
      />

      <ReadOnlyRow isDemo={seat.isDemo}>
        {seat.brand ? (
          <span className="inline-flex items-center gap-2 text-xs text-[color:var(--color-ink-2)]">
            <BrandAvatar name={seat.brand.name} logoUrl={seat.brand.logo_url} size="xs" />
            {seat.brand.name}
          </span>
        ) : null}
      </ReadOnlyRow>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Professionals"
          value={cov.total.toLocaleString()}
          hint={`${cov.claimed.toLocaleString()} claimed`}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Roster scored"
          value={cov.scored.toLocaleString()}
          hint={cov.total ? `${Math.round((cov.scored / cov.total) * 100)}% of roster` : "—"}
          tone="purple"
        />
        <StatTile
          label="Location score"
          value={seat.office.search_rank_score ?? "—"}
          hint={seat.office.search_rank_score == null ? "Not scored yet" : "search_rank_score"}
          tone="green"
        />
        <StatTile
          label="Roster reviews"
          value={proReviewCount.toLocaleString()}
          hint={proReviewCount === 0 ? "Instrument review sync to activate" : "aggregate_ratings"}
          tone="yellow"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ScoreCard score={seat.score} fallbackScore={seat.office.search_rank_score} title="Search Rank roll-up" />
        <Panel title="Profile completeness" description="Measured across this location's roster only.">
          {cov.total === 0 ? (
            <EmptyState compact title="No professionals attached" />
          ) : (
            <CoverageBars
              total={cov.total}
              rows={[
                ["Claimed", cov.claimed],
                ["Photo", cov.photo],
                ["Bio", cov.bio],
                ["Title / headline", cov.title],
                ["Contact on file", cov.contact],
                ["Scored", cov.scored],
              ]}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RatingSummary ratings={seat.ratings} title="Location rating" />
        <Panel title="Location details">
          <ul className="space-y-2 text-sm text-[color:var(--color-ink-2)]">
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[color:var(--color-ink-3)]" />
              {[seat.office.address_city, seat.office.address_state].filter(Boolean).join(", ") || "—"}
            </li>
            <li className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-[color:var(--color-ink-3)]" />
              {seat.office.phone ?? "No phone captured"}
            </li>
            <li className="text-xs text-[color:var(--color-ink-3)]">
              GBP {seat.office.gbp_place_id ? "place id on file" : "place id missing"} ·{" "}
              {seat.office.claimed ? "claimed" : "unclaimed"} · {seat.office.gcid ?? "no gcid"}
            </li>
          </ul>
        </Panel>
      </div>

      <Panel
        title="Roster"
        description={`${cov.total} professional${cov.total === 1 ? "" : "s"} at this location.`}
        actions={
          <Link
            to={`${base}/team` as never}
            className="text-xs font-semibold text-[color:var(--color-g-blue)]"
          >
            Open Team
          </Link>
        }
      >
        {cov.total === 0 ? (
          <EmptyState compact title="No professionals attached" />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {seat.pros.slice(0, 12).map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2">
                <PersonAvatar name={seatProName(p)} photoUrl={p.photo_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/seat/$kind/$id"
                    params={{ kind: "professional", id: p.id }}
                    className="block truncate text-sm font-medium text-[color:var(--color-g-blue)]"
                  >
                    {seatProName(p)}
                  </Link>
                  <span className="block truncate text-[11px] text-[color:var(--color-ink-3)]">
                    {p.job_title ?? p.headline ?? "—"}
                  </span>
                </div>
                <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                  {p.search_rank_score ?? "unscored"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ReviewList reviews={seat.reviews} description="This location and its professionals only." />
    </div>
  );
}
