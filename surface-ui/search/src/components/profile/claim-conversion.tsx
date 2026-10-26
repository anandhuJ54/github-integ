import { useEffect, useState } from "react";
import { Megaphone, ShieldQuestion } from "lucide-react";
import { loadAdUnits, pickVariant, type AdUnit } from "@v3/search/utils/monetization";
import type { ProfileBundle } from "@v3/search/utils/profile-render";

/** Loads the live unclaimed-profile ad units for this page's category + state. */
export function useUnclaimedAdUnits(b: ProfileBundle) {
  const [units, setUnits] = useState<AdUnit[]>([]);
  const gcid = b.gcid;
  const geo = b.identity.state;
  const claimed = b.identity.claimed;
  useEffect(() => {
    if (claimed) {
      setUnits([]);
      return;
    }
    let alive = true;
    void loadAdUnits("unclaimed-profile", gcid, geo).then((rows) => {
      if (alive) setUnits(rows);
    });
    return () => {
      alive = false;
    };
  }, [claimed, gcid, geo]);
  return units;
}

function claimHref(b: ProfileBundle) {
  if (b.kind === "p") return `/claim/${b.identity.slug}`;
  return `/auth?claim=${encodeURIComponent(b.identity.slug)}&type=${
    b.kind === "c" ? "company" : "office"
  }`;
}

/** The strongest CTA on an unclaimed page — creative comes from exp_web_ads. */
export function ClaimConversionUnit({ b, units }: { b: ProfileBundle; units: AdUnit[] }) {
  const unit = pickVariant(units, "claim");
  const c = unit?.creative;
  if (!c) return null;
  return (
    <section aria-labelledby="claim-unit" className="mx-auto max-w-6xl px-5 sm:px-6">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div className="min-w-0">
          <p
            id="claim-unit"
            className="flex items-center gap-2 text-lg font-semibold text-amber-900 sm:text-xl"
          >
            <ShieldQuestion className="h-5 w-5 shrink-0" />
            {c.headline ?? "Is this you?"}
          </p>
          {c.body ? <p className="mt-1.5 text-sm text-amber-900/80">{c.body}</p> : null}
        </div>
        <a
          href={c.href ?? claimHref(b)}
          className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full bg-amber-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-amber-700 sm:mt-0 sm:w-auto"
        >
          {c.cta ?? "Claim this profile"}
        </a>
      </div>
    </section>
  );
}

/** Secondary unit: competitors buying visibility on an unclaimed page. */
export function AdvertiseHereUnit({ units }: { units: AdUnit[] }) {
  const unit = pickVariant(units, "advertise");
  const c = unit?.creative;
  if (!c) return null;
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
          <Megaphone className="h-4 w-4 text-[color:var(--color-ink-2)]" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-ink">{c.headline ?? "Advertise here"}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-3)]">
              Sponsored
            </span>
          </div>
          {c.body ? (
            <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">{c.body}</p>
          ) : null}
          {c.cta ? (
            <a
              href={c.href ?? "/auth"}
              className="mt-3 inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-[color:var(--color-ink-2)] hover:border-[color:var(--color-g-blue)]"
            >
              {c.cta}
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
