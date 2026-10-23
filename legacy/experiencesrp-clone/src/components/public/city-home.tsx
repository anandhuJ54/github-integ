import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, MapPin } from "lucide-react";
import { useArea } from "@/components/public/area-picker";
import { HomeHero } from "@/components/public/home-hero";
import { AskExperience, CityArticles, WhatIsExperience } from "@/components/public/city-aside";
import { CityMap, type MapPin as Pin } from "@/components/public/city-map";
import { CityResults } from "@/components/public/city-results";
import { CompareBar, RecentlyViewed } from "@/components/public/visitor-lists";
import { getCityHome, getCityMapPins, type CityHomeData } from "@/lib/city-home.functions";
import { DEFAULT_QUERY } from "@/lib/search";

const COLLECTION_IMAGES = [
  "/search/collection-restaurants.jpg",
  "/search/collection-fitness.jpg",
  "/search/collection-home-services.jpg",
  "/search/collection-weekend.jpg",
  "/search/collection-city.jpg",
] as const;

type Filters = { gcid: string; rating: number; claimed: "any" | "yes" | "no" };

/**
 * City-scoped consumer home: detected area drives the hero, the local
 * collections, the ranked "everything" list and the right-hand column.
 */
export function CityHome({ initial, authorityCount }: { initial: CityHomeData; authorityCount: number }) {
  const navigate = useNavigate();
  const { area, setArea, ready } = useArea(initial.context.label || null);
  const [data, setData] = useState<CityHomeData>(initial);
  const [pins, setPins] = useState<Pin[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ gcid: "", rating: 0, claimed: "any" });

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setLoading(true);
    void getCityHome({ data: { area, page, ...filters } })
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ready, area, page, filters]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void getCityMapPins({ data: { area, gcid: filters.gcid } })
      .then((next) => {
        if (alive) setPins(next.pins as Pin[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ready, area, filters.gcid]);

  const go = (next: { q: string; loc: string; gcid?: string }) =>
    navigate({ to: "/find", search: { ...DEFAULT_QUERY, sort: "rank", ...next } });

  const detectedLabel = data.context.label || area;
  // Discovery is scoped to the nearest area with inventory when the detected
  // place has none of its own; the location chip still shows the real place.
  const label = data.context.scopeLabel || detectedLabel;
  const scopedElsewhere = label !== detectedLabel && Boolean(detectedLabel);
  const cityOnly = label.split(",")[0] ?? "";

  const collections = data.collections.slice(0, 4);
  const guideCollection = {
    key: "guides",
    title: `Local Guides & Answers for ${cityOnly || "your area"}`,
    q: `guides for ${cityOnly}`,
    gcid: "",
    count: data.guides.length + data.articles.length,
  };
  const cards = [...collections, guideCollection].filter((card) => card.count > 0);

  return (
    <div className="consumer-search bg-[#fbfaf7] text-slate-950">
      <HomeHero
        area={area}
        city={cityOnly}
        onAreaChange={setArea}
        onSubmit={go}
        authorityCount={authorityCount}
      />

      <RecentlyViewed />

      {cards.length ? (
        <section className="border-b border-stone-200 bg-[#fbfaf7] px-5 py-9 sm:px-6">
          <div className="mx-auto max-w-[1320px]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-editorial text-2xl font-semibold sm:text-3xl">
                What&apos;s happening in {label || "your area"}
              </h2>
              <button
                type="button"
                onClick={() => document.getElementById("home-area-picker")?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-amber-400"
              >
                <MapPin className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" /> Change city
              </button>
            </div>
            {scopedElsewhere ? (
              <p className="mt-2 text-sm text-slate-600">
                Nothing listed yet in {detectedLabel} — showing the nearest area with profiles.
              </p>
            ) : null}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {cards.map((card, index) => (
                <Link
                  key={card.key}
                  to="/find"
                  search={{ ...DEFAULT_QUERY, q: card.q, gcid: card.gcid, loc: label, sort: "rank" }}
                  className="group relative min-h-44 overflow-hidden rounded-lg bg-slate-950"
                >
                  <img
                    src={COLLECTION_IMAGES[index % COLLECTION_IMAGES.length]}
                    alt=""
                    loading="lazy"
                    width={1024}
                    height={768}
                    className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-105 group-hover:opacity-80"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 text-sm font-semibold text-white">
                    {card.title} <ArrowRight className="h-4 w-4 shrink-0 text-amber-400" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <main className="mx-auto max-w-[1320px] px-5 py-9 sm:px-6">
        {expanded ? (
          <CityMap
            pins={pins}
            city={cityOnly}
            expanded
            onToggleExpand={() => setExpanded(false)}
          />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <CityResults
              data={data}
              loading={loading}
              filters={filters}
              onFilters={(patch) => {
                setPage(1);
                setFilters((current) => ({ ...current, ...patch }));
              }}
              onPage={(next) => setPage(next)}
              onIntentLabel={(intentLabel) => {
                const match = data.categoryLabels.find((category) =>
                  category.label.toLowerCase().includes(intentLabel.split(" ")[0]!.toLowerCase()),
                );
                setPage(1);
                setFilters((current) => ({ ...current, gcid: match?.gcid ?? "" }));
              }}
            />
            <aside className="space-y-5 self-start lg:sticky lg:top-24">
              <CityMap pins={pins} city={cityOnly} onToggleExpand={() => setExpanded(true)} />
              <AskExperience area={label} />
              <CityArticles area={label} articles={data.articles} />
              <WhatIsExperience />
            </aside>
          </div>
        )}
      </main>

      <CompareBar />
    </div>
  );
}
