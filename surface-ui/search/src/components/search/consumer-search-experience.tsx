import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Coffee,
  HeartPulse,
  Home,
  MoreHorizontal,
  PawPrint,
  Search,
  Sparkles,
  Stethoscope,
  Utensils,
  Wrench,
} from "lucide-react";
import heroCity from "@v3/shared/public/assets/home/city-skyline-hero.jpg";
import { BrandIcon } from "@v3/shared/components/icons/logo";
import { Button } from "@v3/shared/components/ui/button";
import { SearchBox } from "@v3/shared/public/components/serp-parts";
import { DEFAULT_QUERY } from "@v3/shared/public/utils/search";
import type { HomeCategory } from "@v3/shared/public/utils/home.functions";

const ICONS = [Utensils, Coffee, Wrench, Stethoscope, Building2, Home, PawPrint, HeartPulse];
const NATURAL_EXAMPLES = [
  "best sushi near me",
  "family friendly hotels nearby",
  "top rated pediatricians near me",
];

export function ConsumerSearchHero({
  query,
  area,
  categories,
  onAreaChange,
  onSubmit,
  autoFocus = false,
}: {
  query: string;
  area: string;
  categories: HomeCategory[];
  onAreaChange: (area: string) => void;
  onSubmit: (next: { q: string; loc: string; gcid?: string }) => void;
  autoFocus?: boolean;
}) {
  const [example, setExample] = useState(0);
  const shortcuts = categories.slice(0, 9);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const interval = window.setInterval(
      () => setExample((current) => (current + 1) % NATURAL_EXAMPLES.length),
      2500,
    );
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="relative isolate overflow-hidden border-b border-amber-950/30">
      <img
        src={heroCity}
        alt="City skyline at dusk"
        width={1920}
        height={1088}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,11,24,.97)_0%,rgba(8,16,31,.91)_52%,rgba(20,15,11,.55)_100%)]" />
      <div className="relative mx-auto max-w-[1320px] px-5 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="max-w-4xl">
          <h1 className="font-editorial text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            Find the best <span className="text-amber-400">{query.trim() || "local expert"}</span> near you.
          </h1>
          <p className="mt-4 text-base text-stone-200 sm:text-lg">
            Real people. Real reviews. Real expertise. Better answers.
          </p>
          <div className="mt-8 max-w-4xl">
            <SearchBox
              q={query}
              loc={area}
              autoFocus={autoFocus}
              onSubmit={({ q, loc }) => {
                onAreaChange(loc);
                onSubmit({ q, loc });
              }}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2" aria-label="Popular searches">
            {shortcuts.map((category, index) => {
              const Icon = ICONS[index % ICONS.length] ?? Search;
              return (
                <button
                  key={category.gcid}
                  type="button"
                  onClick={() => onSubmit({ q: category.label, loc: area, gcid: category.gcid })}
                  className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-slate-950/70 px-3 py-2 text-sm font-medium text-white transition hover:border-amber-400/70 hover:bg-slate-900"
                >
                  <Icon className="h-4 w-4 text-amber-400" /> {category.label}
                </button>
              );
            })}
            <Link
              to="/find"
              search={DEFAULT_QUERY}
              className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-slate-950/70 px-3 py-2 text-sm font-medium text-white hover:border-amber-400/70"
            >
              <MoreHorizontal className="h-4 w-4 text-amber-400" /> More
            </Link>
          </div>

          <div className="mt-7 flex max-w-3xl items-start gap-3 rounded-lg border border-white/15 bg-slate-950/80 p-4 text-white shadow-lg backdrop-blur-sm">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-semibold">Try searching naturally</p>
              <button
                type="button"
                onClick={() => onSubmit({ q: NATURAL_EXAMPLES[example] ?? "", loc: area })}
                className="mt-1 text-left font-editorial text-lg text-stone-200 hover:text-amber-300"
              >
                “{NATURAL_EXAMPLES[example]}”
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const COLLECTION_IMAGES = [
  "/search/collection-restaurants.jpg",
  "/search/collection-fitness.jpg",
  "/search/collection-home-services.jpg",
  "/search/collection-weekend.jpg",
  "/search/collection-city.jpg",
];

export function CuratedCollections({
  categories,
  area,
}: {
  categories: HomeCategory[];
  area: string;
}) {
  const labels = [
    itemsLabel(categories[0]?.label, "Great", "Near You"),
    itemsLabel(categories[1]?.label ?? categories[0]?.label, "Top", area ? `in ${area.split(",")[0]}` : "Nearby"),
    "Trusted home services",
    "Things to do this weekend",
    area ? `Explore ${area.split(",")[0]}` : "Explore nearby",
  ];
  const items = categories.slice(0, 5);
  if (!items.length) return null;
  return (
    <section className="border-b border-stone-200 bg-[#fbfaf7] px-5 py-9 sm:px-6">
      <div className="mx-auto max-w-[1320px]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((category, index) => (
            <Link
              key={category.gcid}
              to="/find"
              search={{ ...DEFAULT_QUERY, q: category.label, gcid: category.gcid, loc: area }}
              className="group relative min-h-44 overflow-hidden rounded-lg bg-slate-950"
            >
              <img
                src={COLLECTION_IMAGES[index]}
                alt=""
                loading="lazy"
                width={1024}
                height={768}
                className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-105 group-hover:opacity-80"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 text-sm font-semibold text-white">
                {labels[index]} <ArrowRight className="h-4 w-4 shrink-0 text-amber-400" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function itemsLabel(category: string | undefined, prefix: string, suffix: string) {
  return category ? `${prefix} ${category} ${suffix}` : `${prefix} choices ${suffix}`;
}

export function RelatedSearches({
  category,
  area,
  labels,
}: {
  category?: HomeCategory;
  area: string;
  labels: string[];
}) {
  const searches = [category?.label, ...labels].filter((value): value is string => Boolean(value)).slice(0, 8);
  if (!searches.length) return null;
  return (
    <section className="border-t border-stone-200 pt-7">
      <h2 className="font-editorial text-2xl font-semibold text-slate-950">Related searches</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {searches.map((label) => (
          <Link
            key={label}
            to="/find"
            search={{ ...DEFAULT_QUERY, q: label, gcid: category?.gcid ?? "", loc: area }}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-amber-500"
          >
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AiAssistantCard() {
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const quick = ["Compare top options", "Show me photos", "Find places with outdoor seating"];

  const submit = async () => {
    if (question.trim().length < 2) return;
    setLoading(true);
    try {
      const response = await fetch("/api/search-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      setMessage(data.message ?? data.error ?? "AI answers coming soon");
    } catch {
      setMessage("AI answers coming soon");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg bg-slate-950 p-6 text-white sm:p-8">
      <div className="flex items-start gap-3">
        <BrandIcon size={30} />
        <div>
          <h2 className="font-editorial text-3xl font-semibold">Ask anything. Better answers.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
            Find the best, compare options, and get personalized recommendations with AI.
          </p>
        </div>
      </div>
      <form
        className="mt-6 flex gap-2 rounded-lg bg-white p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What's the most family friendly fish and chips near me?"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-950 outline-none"
        />
        <Button type="submit" disabled={loading} className="bg-amber-500 text-slate-950 hover:bg-amber-400">
          {loading ? "Checking…" : "Ask"}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {quick.map((label) => (
          <button key={label} type="button" onClick={() => setQuestion(label)} className="rounded-md border border-white/20 px-3 py-2 text-xs text-stone-200 hover:border-amber-400">
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5 rounded-md border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200" role="status">
        {message ?? "AI answers coming soon"}
      </div>
    </section>
  );
}