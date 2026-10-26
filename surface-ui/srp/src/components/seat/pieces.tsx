/**
 * Shared presentational pieces for the inner role-shells (location /
 * professional). Read-only by design — a seat never publishes or deletes.
 */
import { Lock } from "lucide-react";
import { EmptyState, Panel } from "@v3/shared/components/ui/console-primitives";
import { DemoChip, PersonAvatar } from "@v3/shared/components/ui/entity-avatar";
import { Badge } from "@v3/shared/components/ui/badge";
import type { SeatRating, SeatReview, SeatScore } from "@v3/srp/utils/seat";

export function ReadOnlyRow({ isDemo, children }: { isDemo?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="secondary"
        className="border-0 bg-[color:var(--color-g-yellow-soft)] text-[#b06000]"
      >
        <Lock className="mr-1 h-3 w-3" /> Read-only seat · no send, save, publish or delete
      </Badge>
      {isDemo ? <DemoChip /> : null}
      {children}
    </div>
  );
}

export function ScoreCard({
  score,
  fallbackScore,
  title = "Search Rank Score",
}: {
  score: SeatScore | null;
  fallbackScore?: number | null;
  title?: string;
}) {
  const total = score?.total_score ?? fallbackScore ?? null;
  const max = score?.max_possible ?? 850;
  const pct = total != null && max ? Math.min(100, Math.round((total / max) * 100)) : null;

  const components: [string, number | null | undefined][] = [
    ["Profile", score?.score_profile],
    ["Reviews", score?.score_reviews],
    ["Listings", score?.score_listings],
    ["Content", score?.score_content],
    ["Connections", score?.score_connections],
    ["Web analytics", score?.score_web_analytics],
  ];

  return (
    <Panel title={title} description={score?.calculated_at ? `Scored ${new Date(score.calculated_at).toLocaleDateString()}` : "Not yet scored by the engine."}>
      {total == null ? (
        <EmptyState
          compact
          title="No score on file"
          description="The scoring engine has not produced a row for this entity yet."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <span className="text-[40px] font-semibold leading-none tracking-tight text-ink">
              {total}
            </span>
            <span className="pb-1 text-sm text-[color:var(--color-ink-3)]">/ {max}</span>
            {pct != null ? (
              <span className="ml-auto text-xs font-semibold text-[color:var(--color-g-blue)]">
                {pct}% of possible
              </span>
            ) : null}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
            <div
              className="h-full rounded-full bg-[color:var(--color-g-blue)]"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          {score ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              {components.map(([label, v]) => (
                <div
                  key={label}
                  className="rounded-xl border border-[color:var(--color-hairline)] px-3 py-2"
                >
                  <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
                    {label}
                  </dt>
                  <dd className="text-sm font-semibold text-ink">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {score?.next_milestone != null ? (
            <p className="text-xs text-[color:var(--color-ink-2)]">
              Next milestone {score.next_milestone}
              {score.next_milestone_gap != null ? ` · ${score.next_milestone_gap} points away` : ""}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function RatingSummary({ ratings, title = "Rating" }: { ratings: SeatRating[]; title?: string }) {
  const totalReviews = ratings.reduce((s, r) => s + (r.review_count ?? 0), 0);
  const weighted =
    totalReviews > 0
      ? ratings.reduce((s, r) => s + (r.rating_value ?? 0) * (r.review_count ?? 0), 0) / totalReviews
      : null;

  return (
    <Panel title={title} description="From aggregate_ratings — no estimates.">
      {ratings.length === 0 ? (
        <EmptyState
          compact
          title="No rating aggregate"
          description="Connect a review source to activate."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <span className="text-[32px] font-semibold leading-none text-ink">
              {weighted != null ? weighted.toFixed(2) : "—"}
            </span>
            <span className="pb-1 text-sm text-[color:var(--color-ink-3)]">
              {totalReviews.toLocaleString()} reviews
            </span>
          </div>
          <ul className="space-y-1.5">
            {ratings.map((r, i) => (
              <li key={`${r.source}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate font-medium text-ink">{r.source ?? "source"}</span>
                <span className="text-[color:var(--color-ink-2)]">
                  {r.rating_value != null ? `${r.rating_value.toFixed(2)}★` : "—"}
                </span>
                <span className="ml-auto text-[color:var(--color-ink-3)]">
                  {(r.review_count ?? 0).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function ReviewList({
  reviews,
  title = "Recent reviews",
  description,
}: {
  reviews: SeatReview[];
  title?: string;
  description?: string;
}) {
  return (
    <Panel title={title} description={description}>
      {reviews.length === 0 ? (
        <EmptyState
          compact
          title="No reviews on file"
          description="Instrument review sync to activate this feed."
        />
      ) : (
        <ul className="divide-y divide-[color:var(--color-hairline)]">
          {reviews.map((r) => (
            <li key={r.id} className="flex gap-3 py-3">
              <PersonAvatar name={r.reviewer_name} photoUrl={r.reviewer_photo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink">{r.reviewer_name ?? "Anonymous"}</span>
                  {r.rating != null ? (
                    <span className="text-[color:var(--color-ink-2)]">{r.rating}★</span>
                  ) : null}
                  {r.source ? (
                    <Badge
                      variant="secondary"
                      className="border-0 bg-[color:var(--color-surface-3)] text-[10px]"
                    >
                      {r.source}
                    </Badge>
                  ) : null}
                  {r.review_date ? (
                    <span className="text-[11px] text-[color:var(--color-ink-3)]">
                      {new Date(r.review_date).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                {r.title ? <p className="text-sm font-medium text-ink">{r.title}</p> : null}
                {r.body ? (
                  <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-ink-2)]">
                    {r.body}
                  </p>
                ) : null}
                {r.reply_body ? (
                  <p className="mt-2 rounded-xl bg-[color:var(--color-surface-2)] px-3 py-2 text-xs text-[color:var(--color-ink-2)]">
                    Reply: {r.reply_body}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function CoverageBars({
  rows,
  total,
}: {
  rows: [string, number][];
  total: number;
}) {
  return (
    <ul className="space-y-3">
      {rows.map(([label, n]) => {
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <li key={label}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">{label}</span>
              <span className="text-[color:var(--color-ink-3)]">
                {n.toLocaleString()} / {total.toLocaleString()} · {pct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
              <div
                className="h-full rounded-full bg-[color:var(--color-g-blue)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SeatLoading() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-[20px] bg-[color:var(--color-surface-2)]" />
      ))}
    </div>
  );
}
