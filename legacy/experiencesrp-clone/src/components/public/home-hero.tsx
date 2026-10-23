import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import heroCity from "@/assets/home/city-skyline-hero.jpg";
import { AreaPicker } from "@/components/public/area-picker";
import { cn } from "@/lib/utils";

/**
 * Teaching headline: the first phrase is the stable, crawlable default (it is
 * what SSR renders), the rest are advanced intent examples cycled by JS.
 */
const HEADLINE_PHRASES = [
  "local expert",
  "Spanish-speaking realtor",
  "board-certified dermatologist",
  "plumber open now",
  "mortgage lender for first-time buyers",
  "5-star family dentist",
  "insurance agent who does VA loans",
  "realtor who speaks Mandarin",
] as const;

const PLACEHOLDERS = [
  "best fish and chips near me",
  "pediatric dentist open Saturday",
  "realtor who speaks Mandarin",
  "board-certified dermatologist near me",
] as const;

const INTENT_CHIPS = [
  "Best fish and chips near me",
  "Open now",
  "Speaks Spanish",
  "Highly rated",
  "Great with first-time buyers",
  "Board-certified",
  "Does VA loans",
  "Top 5% near me",
] as const;

function queryLocation(query: string, fallback: string) {
  const match = query.match(/\b(?:in|near)\s+([a-z][a-z .'-]+(?:,\s*[a-z]{2})?)\s*$/i);
  const candidate = match?.[1]?.trim() ?? "";
  return candidate && candidate.toLowerCase() !== "me" ? candidate : fallback;
}

/**
 * Consumer search home hero: one dominant natural-language search box over a
 * warm dusk photo, coarse area chip, intent prompts and the live index count.
 */
export function HomeHero({
  area,
  city,
  onAreaChange,
  onSubmit,
  authorityCount,
}: {
  area: string;
  city?: string;
  onAreaChange: (next: string) => void;
  onSubmit: (next: { q: string; loc: string }) => void;
  authorityCount: number;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const placeholders = city
    ? ([
        `best tacos in ${city}`,
        `realtor who speaks Mandarin in ${city}`,
        `pediatric dentist open Saturday in ${city}`,
        `board-certified dermatologist in ${city}`,
      ] as const)
    : PLACEHOLDERS;

  useEffect(() => {
    if (query || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % placeholders.length),
      2500,
    );
    return () => window.clearInterval(timer);
  }, [query]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setPhraseIndex((current) => (current + 1) % HEADLINE_PHRASES.length),
      2500,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="relative isolate overflow-hidden border-b border-amber-950/30 lg:min-h-[50vh]">
      <img
        src={heroCity}
        alt="City skyline at dusk"
        width={1920}
        height={1088}
        className="absolute inset-0 h-full w-full object-cover brightness-[1.3] saturate-[1.05]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,9,20,.7)_0%,rgba(7,14,28,.38)_55%,rgba(26,17,10,.18)_100%)]" />
      <div className="relative mx-auto flex max-w-[1320px] items-center px-5 py-7 sm:px-6 sm:py-8 lg:min-h-[50vh] lg:py-8">
        <div className="w-full max-w-4xl">
          <h1 className="font-editorial text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
            Find the best{" "}
            {/* Stable crawlable phrase renders on the server; JS only swaps the visible one.
                All phrases share one grid cell, so the width and line height never shift. */}
            <span className="inline-grid align-baseline">
              {HEADLINE_PHRASES.map((phrase, i) => (
                <span
                  key={phrase}
                  aria-hidden={i === phraseIndex ? undefined : "true"}
                  className={cn(
                    "col-start-1 row-start-1 text-amber-300 transition-opacity duration-500",
                    i === phraseIndex ? "opacity-100" : "opacity-0",
                  )}
                >
                  {phrase}
                </span>
              ))}
            </span>{" "}
            near you.
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-200 sm:text-base">
            Real people. Real reviews. Real proof. Ask in plain language — we find the right person
            or place, with the credentials behind it.
          </p>

          <form
            method="get"
            action="/find"
            className="mt-5"
            onSubmit={(event) => {
              event.preventDefault();
              const q = query.trim();
              onSubmit({ q, loc: queryLocation(q, area) });
            }}
          >
            <div className="flex min-h-16 items-center gap-2 rounded-lg bg-white p-2 shadow-[0_28px_70px_-22px_rgba(4,12,28,0.9)] ring-1 ring-white/40">
              <Search className="ml-3 h-6 w-6 shrink-0 text-slate-400" aria-hidden="true" />
              <label htmlFor="home-search" className="sr-only">
                Search professionals, businesses and reviews
              </label>
              <input
                id="home-search"
                name="q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholders[index % placeholders.length]}
                autoComplete="off"
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-slate-900 outline-none placeholder:text-slate-400 sm:text-lg"
              />
              <input type="hidden" name="loc" value={area} />
              <button
                type="submit"
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-amber-500 px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 sm:px-8 sm:text-base"
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-3">
            <AreaPicker
              area={area}
              onChange={onAreaChange}
              tone="dark"
              triggerId="home-area-picker"
              className="text-sm [&>span]:px-3 [&>span]:py-1.5 [&>span]:text-sm"
            />
            <p className="mt-1.5 text-xs text-stone-300">
              We use your approximate location to show local results.
            </p>
          </div>


          <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-300">
              Try asking:
            </span>
            {INTENT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onSubmit({ q: chip, loc: queryLocation(chip, area) })}
                className="shrink-0 rounded-md border border-white/20 bg-slate-950/70 px-2.5 py-1 text-xs font-medium text-white transition hover:border-amber-400/70 hover:bg-slate-900"
              >
                {chip}
              </button>
            ))}
          </div>

          {authorityCount > 0 ? (
            <p className="mt-2.5 text-xs text-stone-200 [text-shadow:0_1px_6px_rgba(3,9,20,0.85)] sm:text-sm">
              Search {authorityCount.toLocaleString()} verified professionals, businesses and
              reviews across America
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
