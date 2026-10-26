import { Suspense, lazy, useMemo, useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { Maximize2, Minimize2 } from "lucide-react";
import type { OsmPin } from "@v3/shared/public/components/osm-map";
import { locationLine, profilePath, type SearchDoc } from "@v3/shared/public/utils/search";
import { cn } from "@v3/shared/components/utils/utils";

// Leaflet touches window at import time, so it only loads in the browser.
const OsmMap = lazy(() => import("@v3/shared/public/components/osm-map"));

export type MapPin = SearchDoc & { categoryLabel: string | null; coord_approx?: boolean };

const PIN_COLORS = [
  "#b45309",
  "#0f766e",
  "#1d4ed8",
  "#9333ea",
  "#be123c",
  "#4d7c0f",
  "#0369a1",
  "#c2410c",
] as const;

function typeKey(pin: MapPin) {
  return pin.categoryLabel ?? pin.gcid ?? pin.entity_type;
}

/**
 * Coordinate map for the detected city: pins coloured by business type, with
 * pan, zoom, a per-pin detail popover and a full-page expand mode.
 */
export function CityMap({
  pins,
  city,
  expanded = false,
  onToggleExpand,
}: {
  pins: MapPin[];
  city: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const types = useMemo(() => {
    const list: string[] = [];
    for (const pin of pins) {
      const key = typeKey(pin);
      if (!list.includes(key)) list.push(key);
    }
    return list;
  }, [pins]);

  const mapPins = useMemo<OsmPin[]>(
    () =>
      pins
        .filter((pin) => pin.lat !== null && pin.lng !== null)
        .map((pin) => ({
          id: pin.id,
          lat: pin.lat as number,
          lng: pin.lng as number,
          name: pin.name,
          subtitle: [pin.categoryLabel, locationLine(pin)].filter(Boolean).join(" · ") || null,
          href: profilePath(pin),
          color: PIN_COLORS[types.indexOf(typeKey(pin)) % PIN_COLORS.length] as string,
          approximate: pin.coord_approx === true,
        })),
    [pins, types],
  );

  if (!mapPins.length) return null;

  const active = pins.find((pin) => pin.id === selected) ?? null;
  const approximate = mapPins.filter((pin) => pin.approximate).length;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm",
        expanded && "shadow-md",
      )}
      aria-label={`Map of profiles in ${city || "your area"}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="font-editorial text-lg font-semibold text-slate-950">
          Map search{city ? ` · ${city}` : ""}
        </h2>
        {onToggleExpand ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {expanded ? "Close map" : "Expand map"}
          </button>
        ) : null}
      </header>

      <div className={cn("relative w-full", expanded ? "h-[70vh]" : "h-[300px]")}>
        <ClientOnly fallback={<div className="h-full w-full bg-stone-100" />}>
          <Suspense fallback={<div className="h-full w-full bg-stone-100" />}>
            <OsmMap
              pins={mapPins}
              selected={selected}
              onSelect={setSelected}
              className="h-full w-full"
            />
          </Suspense>
        </ClientOnly>
        <div className="pointer-events-none absolute bottom-2 left-3 z-[500] rounded-md bg-white/90 px-2.5 py-1 text-[11px] text-slate-600">
          {mapPins.length} mapped {mapPins.length === 1 ? "profile" : "profiles"}
          {approximate ? ` · ${approximate} approximate` : ""}
        </div>
      </div>

      {active ? (
        <div className="border-t border-stone-200 p-3">
          <Link to={profilePath(active)} className="text-sm font-semibold text-amber-800 hover:underline">
            {active.name}
          </Link>
          <p className="mt-0.5 text-xs text-slate-500">
            {[active.categoryLabel, locationLine(active)].filter(Boolean).join(" · ")}
          </p>
          {active.rating !== null ? (
            <p className="mt-0.5 text-xs text-slate-500">
              {Number(active.rating).toFixed(2)}
              {active.review_count ? ` · ${active.review_count.toLocaleString()} reviews` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {types.length > 1 ? (
        <div className="flex flex-wrap gap-2 border-t border-stone-200 px-4 py-3">
          {types.slice(0, 6).map((type, index) => (
            <span key={type} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <span
                style={{ background: PIN_COLORS[index % PIN_COLORS.length] }}
                className="h-2.5 w-2.5 rounded-[50%]"
              />
              {type}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
