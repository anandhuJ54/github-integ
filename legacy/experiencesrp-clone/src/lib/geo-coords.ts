import type { SearchDoc } from "@/lib/search";

/**
 * Coordinate fallback for map pins.
 *
 * Precise geo exists for only a small subset of entities today, so any doc
 * without lat/lng borrows the centroid of its city from the `exp_us_cities`
 * reference table (the same reference the nearby-cities lookup uses). Those
 * pins are flagged `coord_approx` so the UI can label them as approximate.
 */
export type MappedDoc<T extends SearchDoc = SearchDoc> = T & { coord_approx?: boolean };

type CityRow = { city: string; state_abbr: string; lat: number; lng: number };

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => PromiseLike<{ data: CityRow[] | null }>;
    };
  };
};

const key = (city: string | null, state: string | null) =>
  `${(city ?? "").trim().toLowerCase()}|${(state ?? "").trim().toUpperCase()}`;

/** Adds an approximate city-centroid coordinate to every doc that lacks one. */
export async function withCoordinates<T extends SearchDoc>(
  client: MinimalClient,
  docs: T[],
): Promise<MappedDoc<T>[]> {
  const missing = docs.filter((doc) => doc.lat === null || doc.lng === null);
  if (missing.length === 0) return docs as MappedDoc<T>[];

  const cities = Array.from(
    new Set(
      missing
        .filter((doc) => doc.city && doc.state)
        .map((doc) => (doc.city as string).trim())
        .filter(Boolean),
    ),
  ).slice(0, 200);
  if (cities.length === 0) return docs as MappedDoc<T>[];

  const { data } = await client
    .from("exp_us_cities")
    .select("city, state_abbr, lat, lng")
    .in("city", cities);

  const centroids = new Map<string, { lat: number; lng: number }>();
  for (const row of data ?? []) {
    centroids.set(key(row.city, row.state_abbr), { lat: Number(row.lat), lng: Number(row.lng) });
  }
  if (centroids.size === 0) return docs as MappedDoc<T>[];

  // City centroids collapse every entity in a city onto one point, so spread
  // approximate pins deterministically (~1km) to keep them individually clickable.
  const jitter = (seed: string, salt: number) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) h = ((h ^ seed.charCodeAt(i)) * 16777619) >>> 0;
    return (((h >>> (salt * 8)) & 0xff) / 255 - 0.5) * 0.02;
  };

  return docs.map((doc) => {
    if (doc.lat !== null && doc.lng !== null) return doc as MappedDoc<T>;
    const hit = centroids.get(key(doc.city, doc.state));
    if (!hit) return doc as MappedDoc<T>;
    return {
      ...doc,
      lat: hit.lat + jitter(doc.id, 0),
      lng: hit.lng + jitter(doc.id, 1),
      coord_approx: true,
    } as MappedDoc<T>;
  });
}
