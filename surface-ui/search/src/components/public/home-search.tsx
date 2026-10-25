import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AreaPicker } from "@v3/ui/components/public/area-picker";
import { DEFAULT_QUERY } from "@v3/ui/lib/search";

const INTENT_EXAMPLES = [
  "best fish and chips near me",
  "pediatric dentist open Saturday",
  "realtor who speaks Mandarin",
  "roofer highly rated for storm damage",
  "board-certified dermatologist near me",
] as const;

/**
 * The single open search field for the home page.
 * A real GET <form action="/find"> (crawlable) that also navigates client-side.
 * Location is a coarse detected area label — never an empty required field.
 */
export function HomeSearch({
  area,
  onAreaChange,
  align = "left",
}: {
  area: string;
  onAreaChange: (next: string) => void;
  align?: "left" | "center";
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);

  useEffect(() => {
    if (query || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const interval = window.setInterval(() => {
      setExampleIndex((current) => (current + 1) % INTENT_EXAMPLES.length);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [query]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate({
      to: "/find",
      search: { ...DEFAULT_QUERY, q: query.trim(), loc: area },
    });
  };

  return (
    <form method="get" action="/find" onSubmit={submit} className="w-full">
      <div className="flex min-h-16 items-center gap-2 rounded-lg bg-white p-2 shadow-[0_28px_70px_-22px_rgba(4,12,28,0.9)] ring-1 ring-white/50">
        <Search className="ml-3 h-7 w-7 shrink-0 text-slate-400" aria-hidden="true" />
        <label htmlFor="home-search" className="sr-only">
          Search people, offices and brands
        </label>
        <input
          id="home-search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={INTENT_EXAMPLES[exampleIndex]}
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-slate-900 outline-none placeholder:text-slate-400 sm:text-lg"
        />
        <input type="hidden" name="loc" value={area} />
        <button
          type="submit"
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-amber-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 sm:px-8 sm:text-base"
        >
          Search
        </button>
      </div>

      <div
        className={`mt-3 flex flex-wrap items-center gap-2 ${align === "center" ? "justify-center" : "justify-start"}`}
      >
        <AreaPicker area={area} onChange={onAreaChange} tone="dark" />
      </div>
    </form>
  );
}
