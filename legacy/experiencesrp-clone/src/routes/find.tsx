import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { List, Map as MapIcon, SearchX, SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SiteHeader, SiteFooter } from "@/components/public/site-chrome";
import { ResultsSkeleton } from "@/components/public/visual";
import {
  FacetRail,
  MapPanel,
  ResultCard,
} from "@/components/search/serp-parts";
import { NativeAdUnit, SponsoredCard } from "@/components/search/sponsored-parts";
import {
  loadAdUnits,
  loadSponsoredSlots,
  sponsoredKey,
  usePageViewPing,
} from "@/lib/monetization";
import {
  DEFAULT_QUERY,
  EMPTY_FACETS,
  PAGE_SIZE,
  SORT_OPTIONS,
  runSearch,
  type SearchQuery,
} from "@/lib/search";
import { cn } from "@/lib/utils";
import { loadFeaturedArticle } from "@/lib/voce";
import { getDetectedArea } from "@/lib/geo.functions";
import { useArea } from "@/components/public/area-picker";
import { FeaturedArticleUnit } from "@/components/voce/featured-article";
import {
  AiAssistantCard,
  ConsumerSearchHero,
  CuratedCollections,
  RelatedSearches,
} from "@/components/search/consumer-search-experience";

const SORTS = SORT_OPTIONS.map((s) => s.value) as string[];

function parseSearch(raw: Record<string, unknown>): SearchQuery {
  // Numeric-looking params (a zip in ?loc=) arrive parsed as numbers; keep them as text.
  const str = (v: unknown, d = "") =>
    typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : d;
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(str(v));
    return Number.isFinite(n) ? n : 0;
  };
  const claimed = str(raw.claimed, "any");
  const sort = str(raw.sort, "relevance");
  const view = str(raw.view, "list");
  return {
    q: str(raw.q),
    gcid: str(raw.gcid),
    loc: str(raw.loc),
    rating: [3, 4, 4.5].includes(num(raw.rating)) ? num(raw.rating) : 0,
    claimed: claimed === "yes" || claimed === "no" ? claimed : "any",
    sort: (SORTS.includes(sort) ? sort : "relevance") as SearchQuery["sort"],
    page: Math.max(1, Math.min(500, Math.round(num(raw.page) || 1))),
    view: view === "map" ? "map" : "list",
  };
}

export const Route = createFileRoute("/find")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const key = sponsoredKey(deps.gcid, deps.loc);
    const [base, sponsored, serpAds, featured, detected] = await Promise.all([
      runSearch(deps),
      loadSponsoredSlots(deps.gcid, deps.loc),
      deps.gcid ? loadAdUnits("serp", deps.gcid, key?.zip ?? null) : Promise.resolve([]),
      loadFeaturedArticle(deps.q, deps.gcid || null),
      getDetectedArea(),
    ]);
    const { loadSearchPresentation } = await import("@/lib/search-presentation.server");
    const presentation = await loadSearchPresentation(deps.gcid || null, base.results);
    return {
      ...base,
      sponsored,
      serpAds,
      featured,
      zip: key?.zip ?? null,
      detected: detected?.label || null,
      presentation,
    };
  },
  head: () => ({
    meta: [
      { title: "Search professionals, offices and brands | Experience.com" },
      {
        name: "description",
        content:
          "Search verified professionals, local offices and brands by category, city and rating. Every profile carries a Search Rank Score.",
      },
      { property: "og:title", content: "Search professionals and businesses" },
      {
        property: "og:description",
        content:
          "Find professionals, offices and brands by category and location, ranked by Search Rank Score.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Show skeletons only while the router is actually loading a new query.
  const pending = useRouterState({ select: (s) => s.isLoading });

  const facets = data?.facets ?? EMPTY_FACETS;
  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const sponsored = data?.sponsored ?? [];
  const nativeAd = (data?.serpAds ?? [])[0] ?? null;
  const featuredArticle = data?.featured ?? null;
  const presentation = data?.presentation ?? { facetGroups: [], enrichments: {} };

  // Coarse area, Google-style: remembered choice first, then the IP-detected
  // city. Precise location is only ever requested from inside the picker.
  const { area, setArea, ready } = useArea(data?.detected ?? null);
  useEffect(() => {
    if (!ready) return;
    if (!search.loc && area) patch({ loc: area });
    else if (search.loc && search.loc !== area) setArea(search.loc);
  }, [ready, area, search.loc]);

  // Category+zip page view meter; claim prompts show on every unclaimed result.
  usePageViewPing({
    gcid: search.gcid || null,
    zip: data?.zip ?? null,
    claimCta: results.some((r) => !r.claimed),
  });

  const labelFor = useMemo(() => {
    const m = new Map(facets.categories.map((c) => [c.gcid, c.label]));
    return (gcid: string | null) => (gcid ? (m.get(gcid) ?? undefined) : undefined);
  }, [facets.categories]);

  const patch = (next: Partial<SearchQuery>) =>
    navigate({
      search: (prev) => ({ ...prev, ...next, page: next.page ?? 1 }),
      resetScroll: false,
    });

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (search.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, search.page * PAGE_SIZE);

  const rail = (
    <FacetRail
      facets={facets}
      active={{
        gcid: search.gcid,
        loc: search.loc,
        rating: search.rating,
        claimed: search.claimed,
      }}
      projectedGroups={presentation.facetGroups}
      onChange={(p) => {
        patch(p);
        setFiltersOpen(false);
      }}
    />
  );

  return (
    <div className="consumer-search min-h-screen bg-[color:var(--color-surface-2)]">
      <SiteHeader />

      <ConsumerSearchHero
        query={search.q}
        area={area}
        categories={facets.categories}
        onAreaChange={setArea}
        onSubmit={({ q, loc, gcid }) => patch({ q, loc, gcid: gcid ?? search.gcid })}
      />
      <CuratedCollections categories={facets.categories} area={area} />

      <main className="mx-auto max-w-[1320px] px-4 py-9 sm:px-6">
        <div className="mb-6">
          <h2 className="font-editorial text-3xl font-semibold text-slate-950">
            Best {search.q || labelFor(search.gcid) || "matches"} near {search.loc || "you"}
          </h2>
          <p className="mt-2 text-sm text-stone-500">{total.toLocaleString()} results</p>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[color:var(--color-ink-2)]">
            {total === 0
              ? "No matching profiles"
              : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} profiles`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 bg-white px-4 text-sm font-medium text-slate-700 lg:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto p-4">
                {rail}
              </SheetContent>
            </Sheet>

            <select
              value={search.sort}
              onChange={(e) => patch({ sort: e.target.value as SearchQuery["sort"] })}
              aria-label="Sort results"
              className="h-10 rounded-md border border-stone-200 bg-white px-4 text-sm text-slate-700"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <div className="inline-flex h-10 items-center rounded-md border border-stone-200 bg-white p-1">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ view: v, page: search.page })}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium capitalize",
                    search.view === v
                      ? "bg-amber-500 text-slate-950"
                      : "text-[color:var(--color-ink-2)]",
                  )}
                >
                  {v === "list" ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data?.error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Search is temporarily unavailable: {data.error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_minmax(340px,.8fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-4">{rail}</div>
          </aside>

          <div className={cn("min-w-0 space-y-4", search.view === "map" && "hidden lg:block")}>

            {sponsored.map((slot) => (
              <SponsoredCard key={slot.slot_id} slot={slot} />
            ))}

            {featuredArticle ? <FeaturedArticleUnit article={featuredArticle} /> : null}

            {pending ? (
              <ResultsSkeleton rows={5} />
            ) : results.length === 0 ? (
              <div className="rounded-3xl border border-[color:var(--color-hairline)] bg-white px-6 py-14 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-[50%] bg-stone-100">
                  <SearchX className="h-6 w-6 text-[color:var(--color-ink-3)]" />
                </span>
                <p className="mt-4 text-lg font-semibold tracking-tight text-ink">
                  No profiles match this search
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-[color:var(--color-ink-2)]">
                  Try a broader term, clear a filter, or search a nearby city.
                </p>
              </div>
            ) : (
              results.map((doc, i) => (
                <div key={doc.id} className="space-y-4">
                  <ResultCard
                    doc={doc}
                    categoryLabel={labelFor(doc.gcid)}
                    highlighted={selected === doc.id}
                    onHover={search.view === "map" ? setSelected : undefined}
                    rank={(search.page - 1) * PAGE_SIZE + i + 1}
                    topMatch={search.page === 1 && i === 0}
                    enrichment={presentation.enrichments[doc.id]}
                  />
                  {nativeAd && i === Math.min(4, results.length - 1) ? (
                    <NativeAdUnit unit={nativeAd} />
                  ) : null}
                </div>
              ))
            )}

            {total > PAGE_SIZE ? (
              <nav className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  disabled={search.page <= 1}
                  onClick={() => patch({ page: search.page - 1 })}
                  className="h-11 rounded-md border border-stone-200 bg-white px-5 text-sm font-medium text-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm text-[color:var(--color-ink-3)]">
                  Page {search.page} of {lastPage.toLocaleString()}
                </span>
                <button
                  type="button"
                  disabled={search.page >= lastPage}
                  onClick={() => patch({ page: search.page + 1 })}
                  className="h-11 rounded-md border border-stone-200 bg-white px-5 text-sm font-medium text-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </nav>
            ) : null}
          </div>
          <aside className={cn("self-start lg:sticky lg:top-20", search.view === "list" && "hidden lg:block")}>
            {results.length ? <MapPanel results={results} selected={selected} onSelect={setSelected} /> : null}
            {results.length ? <button type="button" onClick={() => patch({ loc: search.loc, view: "map", page: search.page })} className="mt-3 h-10 w-full rounded-md border border-amber-400 bg-white text-sm font-semibold text-slate-800">Search this area</button> : null}
          </aside>
        </div>
        <div className="mt-10">
          <RelatedSearches category={facets.categories.find((category) => category.gcid === search.gcid)} area={search.loc} labels={presentation.facetGroups.flatMap((group) => group.facets.map((facet) => facet.label))} />
        </div>
        <div className="mt-10"><AiAssistantCard /></div>
      </main>

      <SiteFooter />
    </div>
  );
}

export default SearchPage;
