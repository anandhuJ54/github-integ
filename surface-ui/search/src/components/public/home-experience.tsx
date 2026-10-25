import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Car, Coffee, Home, MoreHorizontal, PawPrint, SearchX, Sparkles, Stethoscope, Trees, Utensils, Waves, Wrench } from "lucide-react";
import { Button } from "@v3/ui/components/ui/button";
import { useArea } from "@v3/ui/components/public/area-picker";
import { HomeHero } from "@v3/ui/components/public/home-hero";
import { MapPanel, ResultCard } from "@v3/ui/components/search/serp-parts";
import { CuratedCollections } from "@v3/srp/components/search/consumer-search-experience";
import type { HomeData } from "@v3/ui/lib/home.functions";
import { DEFAULT_QUERY, runSearch, type SearchDoc } from "@v3/ui/lib/search";
import { getSearchPresentation, type SearchPresentationData } from "@v3/ui/lib/search-presentation.functions";

const EMPTY_PRESENTATION: SearchPresentationData = { facetGroups: [], enrichments: {} };

const TRUST_POINTS = [
  "Verified professionals",
  "In-depth profiles",
  "Real customer reviews",
  "AI-powered insights",
  "Local expertise",
  "Helpful content & guides",
] as const;

const SHORTCUTS = [
  { label: "Restaurants", match: ["Restaurant"], icon: Utensils },
  { label: "Coffee near me", match: ["Coffee shop", "Cafe"], icon: Coffee },
  { label: "Plumbers", match: ["Plumber"], icon: Wrench },
  { label: "Dentists", match: ["Dentist"], icon: Stethoscope },
  { label: "Auto repair", match: ["Auto repair shop"], icon: Car },
  { label: "Things to do", match: ["Tourist attraction", "Park"], icon: Trees },
  { label: "Realtors", match: ["Real estate agent"], icon: Home },
  { label: "Veterinarians", match: ["Veterinarian"], icon: PawPrint },
  { label: "Spas", match: ["Spa"], icon: Waves },
] as const;

const NATURAL_EXAMPLES = [
  "best fish and chips near me",
  "pediatric dentist open Saturday",
  "realtor who speaks Mandarin",
  "board-certified dermatologist near me",
] as const;

export function HomeExperience({ data }: { data: HomeData }) {
  const navigate = useNavigate();
  const { area, setArea, ready } = useArea(data.detectedLocation);
  const [results, setResults] = useState<SearchDoc[]>(data.results);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [example, setExample] = useState(0);
  const [presentation, setPresentation] = useState<SearchPresentationData>(EMPTY_PRESENTATION);
  const categoryMap = useMemo(
    () => new Map(data.categories.map((category) => [category.gcid, category.label])),
    [data.categories],
  );

  useEffect(() => {
    if (!ready || area === (data.detectedLocation ?? "")) {
      setResults(data.results);
      return;
    }
    let alive = true;
    void runSearch({ ...DEFAULT_QUERY, loc: area, sort: "rating" }).then((response) => {
      if (alive) setResults(response.results.slice(0, 8));
    });
    return () => {
      alive = false;
    };
  }, [ready, area, data.detectedLocation, data.results]);

  useEffect(() => {
    const gcid = results.find((result) => result.gcid)?.gcid ?? null;
    void getSearchPresentation({ data: { gcid, results: results.slice(0, 8) } })
      .then(setPresentation)
      .catch(() => setPresentation(EMPTY_PRESENTATION));
  }, [results]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setExample((current) => (current + 1) % NATURAL_EXAMPLES.length),
      2500,
    );
    return () => window.clearInterval(timer);
  }, []);

  const shortcutCategories = SHORTCUTS.flatMap((shortcut) => {
    const category = shortcut.match
      .map((label) => data.shortcutCategories.find((item) => item.label.toLowerCase() === label.toLowerCase()))
      .find(Boolean);
    return category ? [{ ...shortcut, category }] : [];
  });

  const go = (next: { q: string; loc: string; gcid?: string }) =>
    navigate({ to: "/find", search: { ...DEFAULT_QUERY, ...next } });
  return (
    <div className="consumer-search bg-[#fbfaf7] text-slate-950">
      <HomeHero
        area={area}
        onAreaChange={setArea}
        onSubmit={go}
        authorityCount={data.authorityCount}
      />

      <section className="border-b border-stone-200 bg-white px-5 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1320px] gap-2 overflow-x-auto pb-1" aria-label="Category shortcuts">
          {shortcutCategories.map(({ label, icon: Icon, category }) => (
            <button key={category.gcid} type="button" onClick={() => go({ q: label, loc: area, gcid: category.gcid })} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-amber-400 hover:bg-amber-50">
              <Icon className="h-4 w-4 text-amber-700" aria-hidden="true" /> {label}
            </button>
          ))}
          <Button asChild variant="outline" className="shrink-0 border-stone-200"><Link to="/find" search={DEFAULT_QUERY}><MoreHorizontal /> More</Link></Button>
        </div>
      </section>

      <section className="bg-[#fbfaf7] px-5 pt-5 sm:px-6">
        <button type="button" onClick={() => go({ q: NATURAL_EXAMPLES[example] ?? "", loc: area })} className="mx-auto flex w-full max-w-[1320px] items-center gap-3 rounded-lg bg-slate-950 px-5 py-4 text-left text-white shadow-sm hover:bg-slate-900">
          <Sparkles className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
          <span className="min-w-0"><span className="block text-xs font-bold uppercase text-amber-300">Try searching naturally</span><span className="mt-0.5 block truncate font-editorial text-lg">“{NATURAL_EXAMPLES[example]}”</span></span>
        </button>
      </section>

      <CuratedCollections categories={data.categories} area={area} />

      <main className="mx-auto max-w-[1320px] px-5 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-editorial text-2xl font-semibold sm:text-3xl">
              Top results near {area || "you"}
            </h2>
            <p className="mt-1 text-sm text-stone-500">A preview of live ranked profiles</p>
          </div>
          <Button asChild variant="outline" className="border-amber-400"><Link to="/find" search={{ ...DEFAULT_QUERY, loc: area }}>See all results</Link></Button>
        </div>

        {results.length ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
            <div className={view === "map" ? "hidden lg:block" : "space-y-2.5"}>
              {results.slice(0, 4).map((doc, index) => (
                <ResultCard compact key={doc.id} doc={doc} rank={index + 1} topMatch={index === 0} categoryLabel={doc.gcid ? categoryMap.get(doc.gcid) : undefined} enrichment={presentation.enrichments[doc.id]} highlighted={selected === doc.id} onHover={setSelected} />
              ))}
            </div>
            <div className={view === "list" ? "hidden self-start lg:block" : "self-start"}>
              <MapPanel compact results={results.slice(0, 4)} selected={selected} onSelect={setSelected} />
            </div>
            <div className="flex rounded-md border border-stone-200 bg-white p-1 lg:hidden">
              {(["list", "map"] as const).map((item) => <Button key={item} variant={view === item ? "default" : "ghost"} size="sm" onClick={() => setView(item)} className={view === item ? "bg-slate-950 text-white hover:bg-slate-800" : ""}>{item === "list" ? "List" : "Map"}</Button>)}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 p-12 text-center"><SearchX className="mx-auto h-6 w-6 text-amber-700" /><p className="mt-3 font-medium">No indexed results are available for this area yet.</p></div>
        )}


        <section className="mt-14 border-t border-stone-200 pt-12">
          <div className="flex items-end justify-between gap-4"><h2 className="font-editorial text-3xl font-semibold">Explore by what matters to you</h2><Link to="/find" search={DEFAULT_QUERY} className="text-sm font-semibold text-amber-800">Browse everything →</Link></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.categories.slice(0, 12).map((category) => <Link key={category.gcid} to="/find" search={{ ...DEFAULT_QUERY, gcid: category.gcid, q: category.label, loc: area }} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-amber-400"><span className="font-semibold">{category.label}</span><span className="mt-1 block text-sm text-stone-500">{category.count.toLocaleString()} profiles</span></Link>)}</div>
        </section>

        <section className="mt-14 border-t border-stone-200 pt-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST_POINTS.map((point) => (
              <div key={point} className="rounded-lg border border-stone-200 bg-white px-4 py-3">
                <span className="text-sm font-semibold text-slate-800">{point}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}