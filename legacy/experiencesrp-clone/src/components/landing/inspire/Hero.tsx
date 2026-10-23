import { useEffect, useState } from "react";
import { Search, Star } from "lucide-react";
import { CoBrandLockup } from "./CoBrandLockup";
import { useInspireCopy } from "./copy";
import {
  BingMark,
  ClaudeMark,
  GeminiMark,
  GoogleMark,
  OpenAiMark,
  PerplexityMark,
} from "./SearchMarks";

const QUERIES = [
  "real estate agent near me",
  "best realtor in Atlanta",
  "who should I hire to sell my home",
  "top rated listing agent",
];

function RotatingQuery() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % QUERIES.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      key={i}
      className="min-w-0 flex-1 truncate text-sm text-ink/70 animate-in fade-in slide-in-from-bottom-1 duration-500"
    >
      {QUERIES[i]}
    </span>
  );
}

function SearchMock() {
  return (
    <div className="relative mx-auto w-full max-w-[23rem] px-5 pb-7 pt-20 sm:px-7 sm:pb-9 sm:pt-24">
      <span className="hero-float absolute left-0 top-24 z-20 grid h-10 w-10 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <OpenAiMark className="h-5 w-5" />
      </span>
      <span className="hero-float-delay absolute -left-1 bottom-20 z-20 grid h-10 w-10 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <BingMark className="h-5 w-5" />
      </span>
      <span className="hero-float absolute -right-1 bottom-12 z-20 grid h-10 w-10 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <GeminiMark className="h-5 w-5" />
      </span>
      <span className="absolute left-10 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <ClaudeMark className="h-5 w-5" />
      </span>
      <span className="absolute right-0 top-1/2 z-20 grid h-10 w-10 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border">
        <PerplexityMark className="h-5 w-5" />
      </span>

      <div className="relative z-10 overflow-hidden rounded-[2rem] border border-border bg-card shadow-2xl transition-transform duration-700 hover:-rotate-1">
        <div className="bg-charcoal px-6 pb-11 pt-6">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-primary-foreground/60">
              Search result
            </span>
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-card shadow-md ring-1 ring-border">
                <GoogleMark className="h-4 w-4" />
              </span>
              <span className="h-2 w-2 rounded-full bg-brand-green" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-5 font-insp-display text-xl font-semibold text-primary-foreground">
            Trusted expertise, surfaced.
          </p>
        </div>

        <div className="px-6 pb-6 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-insp-display text-xl font-bold text-ink">Maria Grace</p>
              <p className="mt-1 text-xs font-medium text-ink/55">Real Estate Agent</p>
            </div>
            <span className="rounded-full bg-product-surface px-3 py-1 text-[0.65rem] font-bold text-brand-blue">
              Verified
            </span>
          </div>
          <div className="mt-4 flex items-center gap-1.5">
            <span className="text-sm font-bold text-ink">4.8</span>
            <span className="flex" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="h-4 w-4 fill-brand-amber text-brand-amber" />
              ))}
            </span>
            <span className="text-xs text-ink/50">(463 reviews)</span>
          </div>
          <div className="mt-5 space-y-2" aria-hidden="true">
            <span className="block h-2 w-full rounded-full bg-product-surface" />
            <span className="block h-2 w-10/12 rounded-full bg-product-surface" />
            <span className="block h-2 w-7/12 rounded-full bg-product-surface" />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 z-30 mx-auto flex max-w-[19rem] items-center gap-3 rounded-2xl border border-border/70 bg-card/90 p-2.5 shadow-xl backdrop-blur-md">
        <Search className="ml-1 h-4 w-4 shrink-0 text-brand-blue" aria-hidden="true" />
        <RotatingQuery />
        <span className="rounded-xl bg-charcoal px-3 py-2 text-[0.65rem] font-bold text-primary-foreground">
          Ask AI
        </span>
      </div>

      <div className="absolute bottom-0 left-0 z-30 max-w-[11.5rem] -rotate-3 rounded-2xl border border-border/70 bg-card/90 p-3.5 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brand-green" aria-hidden="true" />
          <span className="text-[0.58rem] font-bold uppercase tracking-[0.12em] text-ink/50">
            AI recommendation
          </span>
        </div>
        <p className="mt-1.5 text-[0.7rem] font-semibold leading-snug text-ink">
          Highly rated for your market based on 463 reviews.
        </p>
      </div>
    </div>
  );
}

export function Hero() {
  const copy = useInspireCopy();
  return (
    <section className="relative overflow-hidden bg-background py-9 sm:py-11">
      <div className="product-wash absolute inset-y-0 right-0 w-3/5" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-8 sm:px-12">
        <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-8">
          <div className="font-insp-product">
            <CoBrandLockup />
            <p className="mt-7 max-w-md text-xs font-bold uppercase tracking-[0.14em] text-[#262626] sm:text-sm">
              {copy.kicker}
            </p>
            <h1 className="mt-4 font-insp-display text-[2.85rem] font-bold leading-[1.05] text-ink sm:text-[3.6rem]">
              {copy.headline}{" "}
              <span className="text-ai-gradient inline-block whitespace-nowrap pr-1.5 italic sm:pr-1">
                {copy.headlineAccent}
              </span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-ink/60">
              {copy.body}{" "}
              <span className="font-bold text-ink">{copy.bodyEmphasis}</span>
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-lg py-2">
            <SearchMock />
          </div>
        </div>
      </div>
    </section>
  );
}
