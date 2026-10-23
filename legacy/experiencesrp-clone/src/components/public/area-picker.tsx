import { useCallback, useEffect, useState } from "react";
import { ChevronDown, LocateFixed, MapPin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getNearbyAreas, resolveAreaFromCoords, type NearbyArea } from "@/lib/geo.functions";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "exp:area";

/**
 * Coarse area state, Google-style: the server's IP/edge city is the default,
 * a visitor's own choice is remembered in localStorage, and precise
 * geolocation is only ever requested from inside the picker.
 */
export function useArea(detected: string | null) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && saved.trim()) setChosen(saved.trim());
    } catch {
      /* storage unavailable — fall back to the detected area */
    }
    setReady(true);
  }, []);

  const setArea = useCallback((next: string) => {
    const value = next.trim();
    setChosen(value || null);
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, value);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { area: chosen ?? detected ?? "", chosen, detected: detected ?? "", setArea, ready };
}

export function AreaPicker({
  area,
  onChange,
  tone = "light",
  inline = false,
  className,
  triggerId,
}: {
  area: string;
  onChange: (next: string) => void;
  tone?: "light" | "dark";
  inline?: boolean;
  className?: string;
  triggerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [nearby, setNearby] = useState<NearbyArea[]>([]);
  const [locating, setLocating] = useState(false);

  const [city = "", region = ""] = area.split(",").map((part) => part.trim());

  useEffect(() => {
    if (!open || nearby.length) return;
    let alive = true;
    void getNearbyAreas({ data: { city, region } })
      .then((rows) => {
        if (alive) setNearby(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, nearby.length, city, region]);

  const pick = (value: string) => {
    onChange(value);
    setOpen(false);
  };

  /**
   * Opt-in only. Coordinates are sent once to the server, which returns the
   * nearest city label — no coordinate is ever displayed or stored.
   */
  const usePrecise = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void resolveAreaFromCoords({
          data: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        })
          .then((res) => {
            if (res.label) pick(res.label);
          })
          .catch(() => undefined)
          .finally(() => setLocating(false));
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  };

  const dark = tone === "dark";

  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs", className)}>
      {!inline ? (
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-semibold",
            dark
              ? "border-white/20 bg-slate-950/70 text-white"
              : "border-stone-200 bg-white text-slate-700",
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-[50%] bg-blue-500" aria-hidden="true" />
          <span className="truncate">{area || "Area not detected"}</span>
        </span>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            className={cn(
              "inline-flex min-w-0 items-center gap-1 rounded-md font-medium",
              inline
                ? "h-11 max-w-[170px] px-3 text-sm text-slate-700 hover:bg-stone-100"
                : "px-1.5 py-0.5 underline-offset-2 hover:underline",
              !inline && (dark ? "text-amber-300" : "text-blue-700"),
            )}
          >
            {inline ? <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            {inline ? <span className="truncate">{area || "Choose area"}</span> : "Choose area"}
            {inline ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 rounded-lg p-4 text-left">
          <p className="text-sm font-semibold text-slate-900">Choose an area</p>
          <p className="mt-1 text-xs text-slate-500">
            We use your approximate location to show local results — city level only, never
            stored, and precise location is only used if you choose it.
          </p>

          {nearby.length ? (
            <>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Nearby
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {nearby.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => pick(item.label)}
                    className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (manual.trim()) pick(manual);
            }}
          >
            <input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Enter a city or ZIP"
              aria-label="Enter a city or ZIP"
              className="h-9 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="h-9 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Update
            </button>
          </form>

          <button
            type="button"
            onClick={usePrecise}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-600 hover:bg-stone-100"
          >
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
            {locating ? "Locating…" : "Use precise location"}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
