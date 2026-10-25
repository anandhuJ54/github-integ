import { BrandWordmark } from "@v3/ui/components/brand/logo";
import type { ReactNode } from "react";
import { Star, BadgeCheck, ShieldQuestion } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@v3/ui/lib/utils";
import { sourceLabel, type RatingRow, type ReviewRow } from "@v3/search/lib/public-profile";

export function UnclaimedBadge({ claimed }: { claimed: boolean | null | undefined }) {
  if (claimed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
        <BadgeCheck className="h-3.5 w-3.5" /> Claimed profile
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
      <ShieldQuestion className="h-3.5 w-3.5" /> Unclaimed profile
    </span>
  );
}

export function ClaimButton({
  claimed,
  kind,
  slug,
  size = "md",
  label = "Claim this profile",
  className,
}: {
  claimed: boolean | null | undefined;
  kind: "professional" | "office" | "company";
  slug: string | null | undefined;
  size?: "md" | "lg";
  label?: string;
  className?: string;
}) {
  if (claimed) return null;
  const cls = cn(
    "group inline-flex items-center justify-center gap-2 rounded-md bg-amber-500 font-semibold text-slate-950",
    "shadow-[0_10px_24px_-10px_rgba(217,119,6,0.6)] transition-all",
    "hover:-translate-y-0.5 hover:bg-amber-400 hover:shadow-[0_16px_32px_-12px_rgba(217,119,6,0.7)]",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--color-g-blue)]/25",
    size === "lg" ? "h-12 px-7 text-[0.95rem]" : "h-10 px-5 text-sm",
    className,
  );
  const inner = (
    <>
      <BadgeCheck className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} /> {label}
    </>
  );
  if (kind === "professional") {
    return (
      <Link to="/claim/$professional" params={{ professional: slug ?? "" }} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={`/auth?claim=${encodeURIComponent(slug ?? "")}&type=${kind}`} className={cls}>
      {inner}
    </a>
  );
}


export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star
              className="absolute inset-0 text-[color:var(--color-ink-3)]/30"
              style={{ width: size, height: size }}
              strokeWidth={1.5}
            />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star
                className="text-[#fbbc04]"
                style={{ width: size, height: size }}
                fill="#fbbc04"
                strokeWidth={1.5}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function Section({
  id,
  title,
  eyebrow,
  action,
  children,
}: {
  id?: string;
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-[color:var(--color-hairline)] pb-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--color-g-blue)]">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-[color:var(--color-hairline)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty>Nothing published yet.</Empty>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-3.5 py-2 text-sm text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-g-blue)]/40 hover:bg-[color:var(--color-g-blue-soft)] hover:text-[color:var(--color-g-blue)]"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/** Category-neutral offering cards (services, coverage products, loan products). */
export function OfferingGrid({
  items,
  icon,
}: {
  items: string[];
  icon?: ReactNode;
}) {
  if (items.length === 0) return <Empty>Nothing published yet.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => (
        <div
          key={t}
          className="group flex items-start gap-3 rounded-2xl border border-[color:var(--color-hairline)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-[color:var(--color-g-blue)]/40 hover:shadow-[0_14px_30px_-22px_rgba(32,33,36,0.55)]"
        >
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
            {icon ?? <BadgeCheck className="h-4 w-4" />}
          </span>
          <span className="min-w-0 text-sm font-medium leading-snug text-ink">{t}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-[color:var(--color-ink-3)]">
      {children}
    </div>
  );
}

export function RatingSummary({
  overall,
  bySource,
}: {
  overall: RatingRow | null;
  bySource: RatingRow[];
}) {
  if (!overall) return <Empty>No reviews collected yet.</Empty>;
  const total = overall.review_count ?? 0;
  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr] md:items-center">
      <div className="text-center md:text-left">
        <div className="text-5xl font-bold tracking-tight text-ink">
          {Number(overall.rating_value ?? 0).toFixed(2)}
        </div>
        <div className="mt-2">
          <Stars value={Number(overall.rating_value ?? 0)} size={18} />
        </div>
        <div className="mt-2 text-sm text-[color:var(--color-ink-3)]">
          {total.toLocaleString()} reviews across {bySource.length} sources
        </div>
      </div>
      <div className="space-y-3">
        {bySource.map((r) => {
          const share = total > 0 ? ((r.review_count ?? 0) / total) * 100 : 0;
          return (
            <div key={r.source} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-sm text-[color:var(--color-ink-2)]">
                {sourceLabel(r.source)}
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, share)}%`,
                    background:
                      "linear-gradient(90deg,#4285f4,#9b72f2 45%,#fbbc04)",
                  }}
                />
              </div>
              <div className="w-28 shrink-0 text-right text-sm tabular-nums text-[color:var(--color-ink-2)]">
                {Number(r.rating_value ?? 0).toFixed(2)} ·{" "}
                {(r.review_count ?? 0).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReviewCard({ review }: { review: ReviewRow }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={Number(review.rating ?? 0)} />
        <span className="text-sm font-medium text-ink">
          {review.reviewer_name ?? "Verified client"}
        </span>
        <span className="text-xs text-[color:var(--color-ink-3)]">
          {review.review_date
            ? new Date(review.review_date).toLocaleDateString("en-US", { timeZone: "UTC" })
            : ""}
        </span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-[color:var(--color-ink-2)]">
          {sourceLabel(review.source)}
        </span>
      </div>
      {review.body ? (
        <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-ink-2)]">
          {review.body}
        </p>
      ) : null}
      {review.locations_mentioned?.length ? (
        <div className="mt-3 text-xs text-[color:var(--color-ink-3)]">
          {review.locations_mentioned.join(" · ")}
        </div>
      ) : null}
      {review.reply_body ? (
        <div className="mt-4 rounded-xl border-l-2 border-[color:var(--color-g-blue)] bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
            Response
          </div>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-ink-2)]">
            {review.reply_body}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function SocialLinks({
  socials,
}: {
  socials: { title: string | null; url: string | null }[];
}) {
  if (socials.length === 0) return <Empty>No connected profiles.</Empty>;
  return (
    <div className="flex flex-wrap gap-2">
      {socials.map((s, i) =>
        s.url ? (
          <a
            key={`${s.title}-${i}`}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-[color:var(--color-ink-2)] transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
          >
            {s.title}
          </a>
        ) : (
          <span
            key={`${s.title}-${i}`}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-[color:var(--color-ink-3)]"
          >
            {s.title}
          </span>
        ),
      )}
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function PublicFooter({ disclaimer }: { disclaimer?: string | null }) {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-10 text-xs leading-relaxed text-[color:var(--color-ink-3)]">
        {disclaimer ? <p className="mb-3">{disclaimer}</p> : null}
        <BrandWordmark size={20} className="mb-3" />
        <p>Profile data verified and structured by Experience.com Search Rank Platform.</p>
      </div>
    </footer>
  );
}
