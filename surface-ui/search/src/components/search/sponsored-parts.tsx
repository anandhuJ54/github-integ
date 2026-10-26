import { Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, Megaphone } from "lucide-react";
import { EntityAvatar, ScoreBadge } from "@v3/shared/public/components/visual";
import type { AdUnit, SponsoredSlot } from "@v3/search/utils/monetization";
import { profilePath, type SearchKind } from "@v3/shared/public/utils/search";


function SponsoredTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-800">
      Sponsored
    </span>
  );
}

/** Renders like a normal result card, plus the Sponsored label. */
export function SponsoredCard({ slot }: { slot: SponsoredSlot }) {
  const name = slot.doc_name || slot.advertiser_name || "Advertiser";
  const place = [slot.doc_city, slot.doc_state].filter(Boolean).join(", ");
  const linkable = !!slot.doc_slug && !!slot.doc_entity_type;

  return (
    <article className="relative overflow-hidden rounded-lg border border-amber-200 bg-white p-4 pl-5 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-amber-400 sm:p-5 sm:pl-6">
      <div className="flex gap-4">
        <EntityAvatar
          name={name}
          src={slot.doc_photo_url}
          kind={slot.doc_entity_type === "professional" ? "professional" : "location"}
          size={56}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {linkable ? (
              <Link
                to={profilePath({
                  entity_type: slot.doc_entity_type as SearchKind,
                  slug: slot.doc_slug,
                })}
                className="truncate text-base font-semibold text-ink hover:text-amber-800 sm:text-lg"
              >
                {name}
              </Link>
            ) : (
              <span className="truncate text-base font-semibold text-ink sm:text-lg">{name}</span>
            )}
            <SponsoredTag />
          </div>
          {slot.doc_title ? (
            <p className="mt-0.5 truncate text-sm text-[color:var(--color-ink-2)]">
              {slot.doc_title}
            </p>
          ) : null}
          {place ? (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-[color:var(--color-ink-3)]">
              <MapPin className="h-3.5 w-3.5" /> {place}
              {slot.doc_zip ? ` ${slot.doc_zip}` : ""}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--color-ink-3)]">
            {slot.doc_rank_score !== null ? <ScoreBadge score={slot.doc_rank_score} /> : null}
            {slot.doc_rating !== null ? (
              <span>
                {Number(slot.doc_rating).toFixed(1)}★
                {slot.doc_review_count ? ` · ${slot.doc_review_count.toLocaleString()} reviews` : ""}
              </span>
            ) : null}
            {slot.doc_claimed ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <BadgeCheck className="h-3.5 w-3.5" /> Claimed
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Optional native unit placed lower in the result list. */
export function NativeAdUnit({ unit }: { unit: AdUnit }) {
  const c = unit.creative ?? {};
  if (!c.headline && !c.body) return null;
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[50%] bg-slate-100">
          <Megaphone className="h-4 w-4 text-[color:var(--color-ink-2)]" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-ink">{c.headline}</p>
            <SponsoredTag />
          </div>
          {c.body ? (
            <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">{c.body}</p>
          ) : null}
          {c.cta ? (
            <a
              href={c.href ?? "/auth"}
              className="mt-3 inline-flex h-10 items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              {c.cta}
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
