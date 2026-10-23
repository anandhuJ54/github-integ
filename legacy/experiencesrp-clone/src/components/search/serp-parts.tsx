import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { BadgeCheck, ChevronDown, Heart, MapPin, Search, ShieldQuestion, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityAvatar, ScoreRing } from "@/components/public/visual";
import { AreaPicker } from "@/components/public/area-picker";
import { Button } from "@/components/ui/button";
import { CardActions } from "@/components/public/card-actions";
import { CompareToggle, SaveButton } from "@/components/public/visitor-lists";
import { toListedDoc } from "@/lib/visitor-lists";
import type { CardAction } from "@/lib/engagement.functions";
import type { FacetGroup, SearchEnrichment } from "@/lib/search-presentation.functions";
import {
  KIND_LABEL,
  clusters,
  locationLine,
  profilePath,
  suggest,
  type Facets,
  type SearchDoc,
  type SearchKind,
  type Suggestion,
} from "@/lib/search";

/* ------------------------------- search box ------------------------------- */

export function SearchBox({
  q,
  loc,
  onSubmit,
  autoFocus = false,
}: {
  q: string;
  loc: string;
  onSubmit: (next: { q: string; loc: string }) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(q);
  const [place, setPlace] = useState(loc);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setText(q), [q]);
  useEffect(() => setPlace(loc), [loc]);

  // Debounced typeahead against the live search index.
  useEffect(() => {
    const term = text.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const rows = await suggest(term);
      if (alive) setItems(rows);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  return (
    <div ref={box} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSubmit({ q: text, loc: place });
        }}
        className="relative flex min-h-16 items-center rounded-lg bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,.7)] ring-1 ring-stone-200"
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-6 w-6 -translate-y-1/2 text-stone-400" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search people, offices, brands"
            aria-label="Search"
            autoFocus={autoFocus}
            className="h-13 w-full bg-transparent pl-12 pr-10 text-base text-slate-950 outline-none placeholder:text-stone-400 sm:text-lg"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                setItems([]);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-stone-500 hover:bg-stone-100"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="mx-1 hidden h-8 w-px bg-stone-200 sm:block" />
        <AreaPicker
          inline
          area={place}
          onChange={(next) => {
            setPlace(next);
            onSubmit({ q: text, loc: next });
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Search"
          className="h-12 w-12 shrink-0 rounded-[50%] bg-amber-500 text-slate-950 shadow hover:bg-amber-400"
        >
          <Search className="h-5 w-5" />
        </Button>
      </form>

      {open && items.length > 0 ? (
        <ul className="absolute left-0 right-0 top-[70px] z-30 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          {items.map((s) => (
            <li key={s.id} className="border-b border-[color:var(--color-hairline)] last:border-0">
              <Link
                to={profilePath(s)}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--color-surface-2)]"
              >
                <EntityAvatar name={s.name} src={s.photo_url} kind={s.entity_type} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-xs text-[color:var(--color-ink-3)]">
                    {[s.title, [s.city, s.state].filter(Boolean).join(", ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <KindBadge kind={s.entity_type} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function KindBadge({ kind }: { kind: SearchKind }) {
  const tone =
    kind === "professional"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : kind === "location"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-stone-300 bg-stone-100 text-stone-700";
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        tone,
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

/* --------------------------------- cards --------------------------------- */

function RatingBit({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating === null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[color:var(--color-ink-2)]">
      <Star className="h-3.5 w-3.5 text-[#fbbc04]" fill="#fbbc04" />
      <span className="font-semibold tabular-nums">{Number(rating).toFixed(2)}</span>
      {count ? (
        <span className="text-[color:var(--color-ink-3)]">({count.toLocaleString()})</span>
      ) : null}
    </span>
  );
}

function ClaimPrompt({ doc }: { doc: SearchDoc }) {
  if (doc.claimed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <BadgeCheck className="h-3.5 w-3.5" /> Claimed
      </span>
    );
  }
  const to =
    doc.entity_type === "professional"
      ? `/claim/${doc.slug ?? ""}`
      : `/auth?claim=${encodeURIComponent(doc.slug ?? "")}&type=${
          doc.entity_type === "brand" ? "company" : "office"
        }`;
  return (
    <a
      href={to}
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100"
    >
      <ShieldQuestion className="h-3.5 w-3.5" /> Claim this profile ▲
    </a>
  );
}

export function ResultCard({
  doc,
  categoryLabel,
  highlighted,
  onHover,
  rank,
  topMatch = false,
  enrichment,
  compact = false,
  actions,
  showCompare = true,
}: {
  doc: SearchDoc;
  categoryLabel?: string;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
  rank?: number;
  topMatch?: boolean;
  enrichment?: SearchEnrichment;
  compact?: boolean;
  actions?: CardAction;
  showCompare?: boolean;
}) {
  const listed = toListedDoc(doc, categoryLabel ?? null);
  return (
    <article
      id={`card-${doc.id}`}
      onMouseEnter={() => onHover?.(doc.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-white transition-all",
        compact ? "p-3" : "p-4 sm:p-5",
        highlighted
          ? "border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.14)]"
          : "border-[color:var(--color-hairline)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(32,33,36,0.5)]",
      )}
    >
      <div className="flex gap-3 sm:gap-4">
        {rank ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-950 text-xs font-bold text-white">{rank}</span> : null}
        <EntityAvatar name={doc.name} src={doc.photo_url} kind={doc.entity_type} size={compact ? 44 : 56} />

        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  to={profilePath(doc)}
                  className="truncate text-base font-semibold text-slate-950 transition-colors hover:text-amber-800 sm:text-lg"
                >
                  {doc.name}
                </Link>
                <KindBadge kind={doc.entity_type} />
                {topMatch ? <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">Top Match</span> : null}
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-[color:var(--color-ink-2)] sm:truncate">
                {[doc.title, categoryLabel].filter(Boolean).join(" · ") || categoryLabel || ""}
              </p>
              {doc.city ? (
                <p className="mt-1 flex items-center gap-1 text-sm text-[color:var(--color-ink-3)]">
                  <MapPin className="h-3.5 w-3.5 shrink-0" /> {locationLine(doc)}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-center">
              <ScoreRing score={doc.rank_score} size={44} stroke={4} showMax={false} />
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-ink-3)]">
                Rank
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <RatingBit rating={doc.rating} count={doc.review_count} />
            {doc.completeness_pct !== null ? (
              <span className="text-xs text-[color:var(--color-ink-3)]">
                {doc.completeness_pct}% complete
              </span>
            ) : null}
            <ClaimPrompt doc={doc} />
          </div>
           {!compact && enrichment?.tags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{enrichment.tags.map((tag) => <span key={tag} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-slate-600">{tag}</span>)}</div> : null}
           {!compact && enrichment?.reviewQuote ? <blockquote className="mt-3 border-l-2 border-amber-400 pl-3 text-sm italic leading-6 text-slate-600">“{enrichment.reviewQuote}”</blockquote> : null}
          {!compact ? <CardActions actions={actions} name={doc.name} className="mt-3" /> : null}
          <div className={cn("flex flex-wrap items-center justify-between gap-2", compact ? "mt-2" : "mt-4")}>
            <div className="flex items-center gap-1.5">
              <SaveButton doc={listed} />
              {showCompare && !compact ? <CompareToggle doc={listed} /> : null}
            </div>
            <Button asChild size="sm" className="bg-slate-950 text-white hover:bg-slate-800"><Link to={profilePath(doc)}>View Details</Link></Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/* --------------------------------- facets --------------------------------- */

export function FacetRail({
  facets,
  active,
  onChange,
  projectedGroups = [],
}: {
  facets: Facets;
  active: { gcid: string; loc: string; rating: number; claimed: "any" | "yes" | "no" };
  onChange: (patch: Partial<{ gcid: string; loc: string; rating: number; claimed: "any" | "yes" | "no" }>) => void;
  projectedGroups?: FacetGroup[];
}) {
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <details
      open
      className="group border-b border-[color:var(--color-hairline)] py-3 first:pt-0 last:border-0 last:pb-0"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-ink-3)] marker:content-none hover:text-ink">
        {title}
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-1">{children}</div>
    </details>
  );
  const Row = ({
    label,
    count,
    on,
    onClick,
  }: {
    label: string;
    count?: number;
    on: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
        on
          ? "bg-amber-50 font-semibold text-amber-900"
          : "text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)]",
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 tabular-nums text-xs text-[color:var(--color-ink-3)]">
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <Group title="Category">
        <Row label="All categories" on={!active.gcid} onClick={() => onChange({ gcid: "" })} />
        {facets.categories.map((c) => (
          <Row
            key={c.gcid}
            label={c.label}
            count={c.count}
            on={active.gcid === c.gcid}
            onClick={() => onChange({ gcid: active.gcid === c.gcid ? "" : c.gcid })}
          />
        ))}
        {facets.categories.length === 0 ? (
          <p className="px-3 text-sm text-[color:var(--color-ink-3)]">No categories in range.</p>
        ) : null}
      </Group>
      {projectedGroups.map((group) => (
        <Group key={group.name} title={group.name}>
          {group.facets.slice(0, 6).map((facet) => (
            <div key={facet.attributeId} className="rounded-md px-3 py-2 text-sm text-slate-600">
              <span className="block font-medium text-slate-700">{facet.label}</span>
              {facet.options.length ? <span className="mt-1 block text-xs leading-5 text-stone-500">{facet.options.slice(0, 4).join(" · ")}</span> : <span className="mt-1 block text-xs text-stone-400">Availability is still being indexed</span>}
            </div>
          ))}
        </Group>
      ))}

      <Group title="Location">
        <Row label="Anywhere" on={!active.loc} onClick={() => onChange({ loc: "" })} />
        {facets.cities.map((c) => (
          <Row
            key={`${c.city}-${c.state}`}
            label={[c.city, c.state].filter(Boolean).join(", ")}
            count={c.count}
            on={active.loc.toLowerCase() === c.city.toLowerCase()}
            onClick={() =>
              onChange({ loc: active.loc.toLowerCase() === c.city.toLowerCase() ? "" : c.city })
            }
          />
        ))}
      </Group>

      <Group title="Rating">
        <Row label="Any rating" on={active.rating === 0} onClick={() => onChange({ rating: 0 })} />
        <Row
          label="4.5 and up"
          count={facets.ratings.r45}
          on={active.rating === 4.5}
          onClick={() => onChange({ rating: active.rating === 4.5 ? 0 : 4.5 })}
        />
        <Row
          label="4.0 and up"
          count={facets.ratings.r40}
          on={active.rating === 4}
          onClick={() => onChange({ rating: active.rating === 4 ? 0 : 4 })}
        />
        <Row
          label="3.0 and up"
          count={facets.ratings.r30}
          on={active.rating === 3}
          onClick={() => onChange({ rating: active.rating === 3 ? 0 : 3 })}
        />
      </Group>

      <Group title="Ownership">
        <Row label="Everyone" on={active.claimed === "any"} onClick={() => onChange({ claimed: "any" })} />
        <Row
          label="Claimed"
          count={facets.claimed.yes}
          on={active.claimed === "yes"}
          onClick={() => onChange({ claimed: "yes" })}
        />
        <Row
          label="Unclaimed"
          count={facets.claimed.no}
          on={active.claimed === "no"}
          onClick={() => onChange({ claimed: "no" })}
        />
      </Group>
    </div>
  );
}

/* ----------------------------------- map ---------------------------------- */

// Leaflet + OpenStreetMap tiles: keyless, so it renders without any setup.
const OsmMap = lazy(() => import("@/components/public/osm-map"));

export function MapPanel({
  results,
  selected,
  onSelect,
  compact = false,
}: {
  results: SearchDoc[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  compact?: boolean;
}) {
  const pts = results.filter((r) => r.lat !== null && r.lng !== null);
  const mapPins = useMemo(
    () =>
      pts.map((p, i) => ({
        id: p.id,
        lat: p.lat as number,
        lng: p.lng as number,
        name: p.name,
        subtitle: locationLine(p) || null,
        href: profilePath(p),
        color: "#f59e0b",
        label: String(results.findIndex((row) => row.id === p.id) + 1 || i + 1),
        approximate: (p as SearchDoc & { coord_approx?: boolean }).coord_approx === true,
      })),
    [pts, results],
  );

  if (pts.length === 0) {
    const groups = clusters(results);
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-sm text-[color:var(--color-ink-2)]">
          None of these results carry coordinates yet, so they are grouped by ZIP and city instead.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <li
              key={g.key}
              className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 text-sm"
            >
              <span className="truncate text-[color:var(--color-ink-2)]">{g.label}</span>
              <span className="tabular-nums text-xs text-[color:var(--color-ink-3)]">{g.count}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const approximate = mapPins.filter((pin) => pin.approximate).length;

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className={cn("relative w-full", compact ? "h-[330px]" : "h-[420px]")}>
        <ClientOnly fallback={<div className="h-full w-full bg-stone-100" />}>
          <Suspense fallback={<div className="h-full w-full bg-stone-100" />}>
            <OsmMap
              pins={mapPins}
              selected={selected}
              onSelect={(id) => {
                onSelect(id);
                if (id) {
                  document
                    .getElementById(`card-${id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              className="h-full w-full"
            />
          </Suspense>
        </ClientOnly>
        <div className="pointer-events-none absolute bottom-2 left-3 z-[500] rounded-md bg-white/90 px-3 py-1 text-[11px] text-[color:var(--color-ink-3)]">
          {pts.length} of {results.length} results mapped
          {approximate ? ` · ${approximate} approximate` : ""}
        </div>
      </div>
      {selected ? (
        <div className="border-t border-slate-200 p-3">
          {(() => {
            const p = pts.find((x) => x.id === selected);
            if (!p) return null;
            return (
              <Link
                to={profilePath(p)}
                className="text-sm font-semibold text-amber-800"
              >
                {p.name} — {locationLine(p)}
              </Link>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
