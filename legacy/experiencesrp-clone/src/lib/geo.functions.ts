import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type DetectedArea = {
  city: string;
  region: string | null;
  label: string;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
} | null;

/**
 * Coarse IP/edge city for the visitor, city level only. Coordinates stay on the
 * server for distance sorting; the client only ever receives the city label.
 */
export const getDetectedArea = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ label: string; city: string; region: string | null }> => {
    const { detectAreaFromRequest } = await import("@/lib/geo.server");
    const detected = await detectAreaFromRequest();
    return {
      label: detected?.label ?? "",
      city: detected?.city ?? "",
      region: detected?.region ?? null,
    };
  },
);

export type NearbyArea = { label: string; count: number };

function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Anchor coordinates for a "nearby" lookup.
 *
 * The detected place is often unincorporated (e.g. "Camino Tassajara, CA") and
 * therefore absent from the city reference, so the visitor's coarse IP
 * coordinates are the primary anchor — never a name lookup. A city the visitor
 * chose themselves is anchored on that city's centroid instead.
 */
async function anchorFor(
  db: { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> },
  sb: ReturnType<typeof publicClient>,
  city: string,
  region: string | null,
) {
  const { detectAreaFromRequest } = await import("@/lib/geo.server");
  const detected = await detectAreaFromRequest().catch(() => null);
  const sameArea =
    !city || (detected?.city ?? "").trim().toLowerCase() === city.trim().toLowerCase();

  if (sameArea && detected?.latitude != null && detected?.longitude != null) {
    return { lat: detected.latitude, lng: detected.longitude, city, region };
  }

  if (city) {
    const anyDb = sb as unknown as { from: (t: string) => { select: (c: string) => any } };
    const res = await Promise.resolve(
      anyDb
        .from("exp_us_cities")
        .select("lat, lng, state_abbr")
        .ilike("city", city)
        .order("population", { ascending: false })
        .limit(5),
    ).catch(() => ({ data: [] }));
    const rows = (res.data ?? []) as { lat: number; lng: number; state_abbr: string }[];
    const row =
      rows.find((r) => !region || r.state_abbr?.toUpperCase() === region.toUpperCase()) ?? rows[0];
    if (row) return { lat: Number(row.lat), lng: Number(row.lng), city, region };
  }

  if (detected?.latitude != null && detected?.longitude != null) {
    return { lat: detected.latitude, lng: detected.longitude, city, region };
  }
  void db;
  return { lat: null as number | null, lng: null as number | null, city, region };
}

/** Nearest cities that actually carry inventory, by haversine distance. */
export async function nearbyFor(city: string, region: string | null, limit: number) {
  const sb = publicClient();
  const db = sb as unknown as { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> };
  const anchor = await anchorFor(db, sb, city, region);
  const res = await Promise.resolve(
    db.rpc("nearby_cities", {
      p_lat: anchor.lat,
      p_lng: anchor.lng,
      p_limit: limit,
      p_city: city || null,
      p_state: region || null,
    }),
  ).catch(() => ({ data: null }));
  return ((res.data as { label: string; profile_count: number }[] | null) ?? []).map((row) => ({
    label: String(row.label),
    count: Number(row.profile_count ?? 0),
  }));
}

/** "Nearby" chips for the choose-area popover. */
export const getNearbyAreas = createServerFn({ method: "GET" })
  .inputValidator(
    (input: { region?: string | null; city?: string | null } | undefined) => input ?? {},
  )
  .handler(async ({ data }): Promise<NearbyArea[]> =>
    nearbyFor((data.city ?? "").trim(), (data.region ?? "").trim() || null, 6),
  );

/**
 * Opt-in precise location: coordinates are resolved to the nearest city with
 * inventory on the server and only that city label is returned, so no
 * coordinate ever reaches the UI.
 */
export const resolveAreaFromCoords = createServerFn({ method: "POST" })
  .inputValidator((input: { lat: number; lng: number }) => ({
    lat: Number(input.lat),
    lng: Number(input.lng),
  }))
  .handler(async ({ data }): Promise<{ label: string }> => {
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return { label: "" };
    const sb = publicClient();
    const db = sb as unknown as { rpc: (fn: string, args?: unknown) => Promise<{ data: unknown }> };
    const res = await Promise.resolve(
      db.rpc("nearby_cities", { p_lat: data.lat, p_lng: data.lng, p_limit: 1 }),
    ).catch(() => ({ data: null }));
    const rows = (res.data as { label: string }[] | null) ?? [];
    return { label: rows[0]?.label ? String(rows[0].label) : "" };
  });
