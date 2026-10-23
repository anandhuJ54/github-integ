import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  ChevronDown,
  Home as HomeIcon,
  HeartPulse,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Store,
  Utensils,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultCard } from "@/components/search/serp-parts";
import { ScoreExplainer } from "@/components/public/score-explainer";
import { DEFAULT_QUERY, type Facets } from "@/lib/search";
import type { CityHomeData, CityResult } from "@/lib/city-home.functions";
import { getCardActions, getRelatedSearches, type CardAction } from "@/lib/engagement.functions";
import { cn } from "@/lib/utils";

type Filters = { gcid: string; rating: number; claimed: "any" | "yes" | "no" };

const INTENTS = [
  { label: "Restaurants", q: "best restaurants near me", words: ["restaurant", "pizza", "grill"], icon: Utensils },
  { label: "Home Services", q: "trusted home services near me", words: ["plumb", "roof", "hvac", "electric"], icon: Wrench },
  { label: "Professional Services", q: "top rated professional services near me", words: ["agent", "attorney", "account", "broker"], icon: HomeIcon },
  { label: "Local Shops", q: "local shops near me", words: ["store", "shop", "boutique"], icon: ShoppingBag },
  { label: "Health & Wellness", q: "highly rated health and wellness near me", words: ["dentist", "doctor", "clinic", "spa", "therap"], icon: HeartPulse },
] as const;

/** House ads: same footprint as a result card, one per page of ten. */
function HouseAd({
  variant,
  city,
  onIntent,
}: {
  variant: number;
  city: string;
  onIntent: (gcid: string) => void;
  }) {
  const shell =
    "rounded-lg border border-amber-300 bg-amber-50/70 p-4 shadow-sm";
  const label = (
    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
      From Experience.com
    </span>
  );
  if (variant === 3) {
    return (
      <div className={shell}>
        {label}
        <p className="mt-1 font-editorial text-lg font-semibold text-slate-950">
          Not sure where to start?
        </p>
        <p className="mt-1 text-sm text-stone-600">Pick a path and we&apos;ll retune your results.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTENTS.map((intent) => (
            <button
              key={intent.label}
              type="button"
              onClick={() => onIntent(intent.label)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:border-amber-500"
            >
              <intent.icon className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> {intent.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const copy =
    variant === 0
      ? {
          title: "Find exactly who you're looking for",
          body: "Ask in plain language — we match on expertise, proof and location.",
          cta: "Try a smarter search",
          to: "/find",
        }
      : variant === 1
        ? {
            title: "Write a review",
            body: "Your experience helps your neighbours choose. Add an honest review of a local business and help keep our results real and trusted.",
            cta: "Review a business",
            to: "/find",
          }
        : {
            title: `Own a business in ${city || "your city"}?`,
            body: "Find your profile, claim it free, and grow — customers are already searching.",
            cta: "Find & claim your profile",
            to: "/find",
          };
  return (
    <div className={shell}>
      {label}
      <p className="mt-1 font-editorial text-lg font-semibold text-slate-950">{copy.title}</p>
      <p className="mt-1 text-sm leading-6 text-stone-600">{copy.body}</p>
      <Button asChild className="mt-3 bg-amber-500 text-slate-950 hover:bg-amber-400">
        <Link to={copy.to} search={DEFAULT_QUERY}>
          {copy.cta}
        </Link>
      </Button>
    </div>
  );
}

function SponsoredCard({ doc, index }: { doc: CityResult & { advertiserName: string | null }; index: number }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-1 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="rounded-[6px] bg-slate-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
          Sponsored
        </span>
        {doc.advertiserName ? (
          <span className="truncate text-[11px] text-stone-500">Paid placement · {doc.advertiserName}</span>
        ) : null}
      </div>
      <ResultCard compact doc={doc} rank={index + 1} categoryLabel={doc.categoryLabel ?? undefined} />
    </div>
  );
}

function FilterPanel({
  facets,
  filters,
  onChange,
}: {
  facets: Facets;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-900"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-amber-700" aria-hidden="true" /> Filters
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-4 border-t border-stone-200 px-4 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Category</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChange({ gcid: "" })}
                className={cn(
                  "rounded-[6px] border px-2.5 py-1 text-xs font-medium",
                  filters.gcid ? "border-stone-300 text-slate-700" : "border-amber-500 bg-amber-50 text-amber-900",
                )}
              >
                All
              </button>
              {facets.categories.slice(0, 14).map((category) => (
                <button
                  key={category.gcid}
                  type="button"
                  onClick={() => onChange({ gcid: category.gcid })}
                  className={cn(
                    "rounded-[6px] border px-2.5 py-1 text-xs font-medium",
                    filters.gcid === category.gcid
                      ? "border-amber-500 bg-amber-50 text-amber-900"
                      : "border-stone-300 text-slate-700 hover:border-amber-400",
                  )}
                >
                  {category.label} ({category.count.toLocaleString()})
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Rating</p>
              <div className="mt-2 flex gap-2">
                {[0, 3, 4, 4.5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChange({ rating: value })}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-xs font-medium",
                      filters.rating === value
                        ? "border-amber-500 bg-amber-50 text-amber-900"
                        : "border-stone-300 text-slate-700",
                    )}
                  >
                    {value === 0 ? "Any" : <><Star className="h-3 w-3" /> {value}+</>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Claimed</p>
              <div className="mt-2 flex gap-2">
                {(["any", "yes", "no"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChange({ claimed: value })}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-xs font-medium capitalize",
                      filters.claimed === value
                        ? "border-amber-500 bg-amber-50 text-amber-900"
                        : "border-stone-300 text-slate-700",
                    )}
                  >
                    {value === "yes" ? <BadgeCheck className="h-3 w-3" /> : null}
                    {value === "any" ? "Any" : value === "yes" ? "Claimed" : "Unclaimed"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Everything list for the detected city: sponsored, ranked results, house ad, SEO block. */
export function CityResults({
  data,
  loading,
  filters,
  onFilters,
  onPage,
  onIntentLabel,
}: {
  data: CityHomeData;
  loading: boolean;
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  onPage: (page: number) => void;
  onIntentLabel: (label: string) => void;
}) {
  const city = data.context.scopeCity || data.context.city;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const [adVariant, setAdVariant] = useState<number | null>(null);
  useEffect(() => {
    setAdVariant(Math.floor(Math.random() * 4));
  }, [data.page, filters.gcid]);

  const sponsoredIds = useMemo(() => new Set(data.sponsored.map((row) => row.id)), [data.sponsored]);
  const organic = data.results.filter((row) => !sponsoredIds.has(row.id));

  /* Direct conversion actions, read from the graph for the visible cards. */
  const [actions, setActions] = useState<Record<string, CardAction>>({});
  const entityKey = organic.map((row) => row.entity_id).join(",");
  useEffect(() => {
    const entityIds = entityKey ? entityKey.split(",") : [];
    if (!entityIds.length) return;
    let alive = true;
    void getCardActions({ data: { entityIds } })
      .then((next) => {
        if (alive) setActions(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entityKey]);

  /* "People also searched" — real taxonomy terms for the category in view. */
  const relatedGcid = filters.gcid || data.categoryLabels[0]?.gcid || "";
  const [related, setRelated] = useState<string[]>([]);
  useEffect(() => {
    if (!relatedGcid) {
      setRelated([]);
      return;
    }
    let alive = true;
    void getRelatedSearches({ data: { gcid: relatedGcid } })
      .then((next) => {
        if (alive) setRelated(next.terms);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [relatedGcid]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-editorial text-2xl font-semibold text-slate-950 sm:text-3xl">
            {(data.context.scopeLabel || data.context.label) || "Your area"} — Everything
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {data.total.toLocaleString()} {data.total === 1 ? "profile" : "profiles"} ranked by Search
            Rank Score
          </p>
          <ScoreExplainer className="mt-1" />
        </div>
        <Button asChild variant="outline" className="border-amber-400">
          <Link to="/find" search={{ ...DEFAULT_QUERY, loc: (data.context.scopeLabel || data.context.label), sort: "rank" }}>
            <Search className="h-4 w-4" /> Full search
          </Link>
        </Button>
      </div>

      <div className="mt-4">
        <FilterPanel facets={data.facets} filters={filters} onChange={onFilters} />
      </div>

      <div className={cn("mt-4 space-y-3", loading && "opacity-60")} aria-busy={loading}>
        {data.sponsored.map((doc, index) => (
          <SponsoredCard key={`sp-${doc.id}`} doc={doc} index={index} />
        ))}

        {organic.length ? (
          organic.map((doc, index) => (
            <div key={doc.id} className="space-y-3">
              <ResultCard
                doc={doc}
                rank={(data.page - 1) * data.pageSize + data.sponsored.length + index + 1}
                categoryLabel={doc.categoryLabel ?? undefined}
                actions={actions[doc.entity_id]}
              />
              {index === 4 && adVariant !== null ? (
                <HouseAd
                  variant={adVariant}
                  city={city}
                  onIntent={(label) => onIntentLabel(label)}
                />
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 p-10 text-center">
            <Store className="mx-auto h-6 w-6 text-amber-700" aria-hidden="true" />
            <p className="mt-3 font-medium text-slate-900">
              No indexed profiles match this view yet.
            </p>
            <p className="mt-1 text-sm text-stone-500">Try another area or clear the filters.</p>
          </div>
        )}
      </div>

      {related.length ? (
        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">People also searched</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {related.map((term) => (
              <Link
                key={term}
                to="/find"
                search={{ ...DEFAULT_QUERY, q: term, loc: (data.context.scopeLabel || data.context.label), sort: "rank" }}
                className="rounded-[6px] border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-amber-400 hover:text-amber-800"
              >
                {term}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {pages > 1 ? (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Result pages">
          <Button
            variant="outline"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
            className="border-stone-300"
          >
            Previous
          </Button>
          <span className="text-sm text-stone-500">
            Page {data.page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          <Button
            variant="outline"
            disabled={data.page >= pages}
            onClick={() => onPage(data.page + 1)}
            className="border-stone-300"
          >
            Next
          </Button>
        </nav>
      ) : null}

      <CitySeoBlock data={data} />
    </div>
  );
}

function CitySeoBlock({ data }: { data: CityHomeData }) {
  const city = data.context.scopeCity || data.context.city || "your area";
  const groups: { title: string; items: { label: string; q?: string; gcid?: string; loc?: string }[] }[] = [
    {
      title: `Most searched categories in ${city}`,
      items: data.categoryLabels.slice(0, 10).map((category) => ({
        label: category.label,
        q: category.label,
        gcid: category.gcid,
        loc: (data.context.scopeLabel || data.context.label),
      })),
    },
    {
      title: `Best of ${city}`,
      items: data.categoryLabels.slice(0, 5).map((category) => ({
        label: `Best ${category.label.toLowerCase()} in ${city}`,
        q: `best ${category.label.toLowerCase()} in ${city}`,
        gcid: category.gcid,
        loc: (data.context.scopeLabel || data.context.label),
      })),
    },
    {
      title: `Popular searches in ${city}`,
      items: data.popular.map((label) => ({ label, q: label, loc: (data.context.scopeLabel || data.context.label) })),
    },
    {
      title: "Nearby cities",
      items: data.nearby.map((near) => ({ label: near.label, loc: near.label })),
    },
  ];
  const hasLinks = groups.some((group) => group.items.length);
  if (!hasLinks && !data.guides.length) return null;
  return (
    <section className="mt-10 border-t border-stone-200 pt-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {groups
          .filter((group) => group.items.length)
          .map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {group.items.map((item) => (
                  <li key={`${group.title}-${item.label}`}>
                    <Link
                      to="/find"
                      search={{
                        ...DEFAULT_QUERY,
                        q: item.q ?? "",
                        gcid: item.gcid ?? "",
                        loc: item.loc ?? (data.context.scopeLabel || data.context.label),
                        sort: "rank",
                      }}
                      className="text-sm text-stone-600 hover:text-amber-800"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {data.guides.length ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Local guides &amp; answers</h3>
            <ul className="mt-2 space-y-1.5">
              {data.guides.map((guide) => (
                <li key={guide.id}>
                  <Link to="/guides" className="text-sm text-stone-600 hover:text-amber-800">
                    {guide.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
