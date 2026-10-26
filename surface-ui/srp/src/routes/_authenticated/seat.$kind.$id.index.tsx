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
import { nextMoves, ringSummary, rosterCoverage, seatProName } from "@v3/srp/utils/seat";
import { useLocationSeat, useProfessionalSeat, useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/")({
  component: SeatOverview,
});

function SeatOverview() {
  const { isPro } = useSeatParams();
  return isPro ? <ProfessionalOverview /> : <LocationOverview />;
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

/* ───────────────────────── PROFESSIONAL overview ───────────────────────── */

function ProfessionalOverview() {
  const { id, base } = useSeatParams();
  const q = useProfessionalSeat(id);
  const seat = q.data;

  if (q.isLoading) return <SeatLoading />;
  if (!seat) return <EmptyState title="Professional not found" description="This record no longer exists." />;

  const moves = nextMoves(seat);
  const rings = ringSummary(seat.nodes);
  const name = seatProName(seat.pro);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My workspace"
        title={name}
        description={seat.pro.job_title ?? seat.pro.headline ?? undefined}
        actions={
          seat.pro.slug ? (
            <a
              href={`/p/${seat.pro.slug}`}
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
        {seat.office ? (
          <span className="inline-flex items-center gap-2 text-xs text-[color:var(--color-ink-2)]">
            <BrandAvatar name={seat.office.name} logoUrl={seat.brand?.logo_url ?? seat.office.logo_url} size="xs" />
            {seat.office.name}
            {seat.brand ? ` · ${seat.brand.name}` : ""}
          </span>
        ) : null}
      </ReadOnlyRow>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <ScoreCard score={seat.score} fallbackScore={seat.pro.search_rank_score} />

        <Panel
          title="Nora · next moves"
          description="See → say → act. Every move below is a measured gap, not a suggestion."
          actions={
            <Link to={`${base}/nora` as never} className="text-xs font-semibold text-[color:var(--color-g-blue)]">
              Open Nora
            </Link>
          }
        >
          {moves.length === 0 ? (
            <EmptyState compact title="No gaps detected" description="Nothing measurable is missing right now." />
          ) : (
            <ol className="space-y-2">
              {moves.map((m, i) => (
                <li
                  key={`${m.title}-${i}`}
                  className="flex items-start gap-3 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[10px] font-bold text-[color:var(--color-g-blue)]">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{m.title}</span>
                    <span className="block text-xs text-[color:var(--color-ink-2)]">{m.detail}</span>
                  </span>
                  <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                    {m.points != null ? `+${m.points} pts` : m.ring}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Expertise graph"
          description={`${seat.nodes.length} active node${seat.nodes.length === 1 ? "" : "s"} across ${rings.length} ring${rings.length === 1 ? "" : "s"}.`}
          actions={
            <Link to={`${base}/graph` as never} className="text-xs font-semibold text-[color:var(--color-g-blue)]">
              Open graph
            </Link>
          }
        >
          {rings.length === 0 ? (
            <EmptyState compact title="No captured nodes" description="Hydration has not reached this profile." />
          ) : (
            <ul className="space-y-1.5">
              {rings.map((r) => (
                <li key={r.ring} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate font-medium text-ink">{r.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--color-g-blue)]"
                      style={{ width: `${Math.min(100, r.count * 8)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-[color:var(--color-ink-3)]">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <RatingSummary ratings={seat.ratings} title="My rating" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="My listings" description="Directory rows attached to me only.">
          {seat.listings.length === 0 ? (
            <EmptyState compact title="No listings yet" description="Listing sync is not wired for this profile." />
          ) : (
            <ul className="divide-y divide-[color:var(--color-hairline)]">
              {seat.listings.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {l.directory_name ?? l.directory_key ?? "Directory"}
                  </span>
                  <Badge variant="secondary" className="border-0 bg-[color:var(--color-surface-3)] text-[10px]">
                    {l.status ?? "unknown"}
                  </Badge>
                  {l.has_drift ? (
                    <Badge variant="secondary" className="border-0 bg-[color:var(--color-g-red-soft)] text-[10px] text-[#c5221f]">
                      drift
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My profile fields" description="What the graph can see today.">
          <ul className="space-y-2 text-sm">
            {(
              [
                ["Photo", Boolean(seat.pro.photo_url)],
                ["Bio", Boolean(seat.pro.bio)],
                ["Title", Boolean(seat.pro.job_title || seat.pro.headline)],
                ["Email", Boolean(seat.pro.email)],
                ["Phone", Boolean(seat.pro.phone)],
                ["Claimed", Boolean(seat.pro.claimed)],
              ] as [string, boolean][]
            ).map(([label, ok]) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={
                    ok
                      ? "h-2 w-2 rounded-full bg-[#1e8e3e]"
                      : "h-2 w-2 rounded-full bg-[color:var(--color-surface-3)] ring-1 ring-[color:var(--color-hairline)]"
                  }
                />
                <span className="text-ink">{label}</span>
                <span className="ml-auto text-xs text-[color:var(--color-ink-3)]">
                  {ok ? "on file" : "missing"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ReviewList reviews={seat.reviews} title="My reviews" description="Scoped to me only." />
    </div>
  );
}
