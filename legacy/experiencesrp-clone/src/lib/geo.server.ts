import { getRequestHeaders } from "@tanstack/react-start/server";

/**
 * Server-only coarse location detection (city level, like Google).
 * Hosting geo headers first, then a lightweight IP lookup as a fallback.
 * Precise geolocation is never requested here — that is opt-in in the UI.
 */
export type DetectedArea = {
  city: string;
  region: string | null;
  label: string;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
} | null;

/**
 * Privacy: the raw IP is never stored. It is used transiently for one
 * city-level lookup and cached under a non-reversible hash of the IP, so no
 * address and no visitor profile is retained. Precise location is opt-in in
 * the UI, and only the visitor's own chosen area is persisted (client-side).
 */
const ipCache = new Map<string, { at: number; area: DetectedArea }>();

function cacheKey(ip: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < ip.length; i += 1) {
    h1 = ((h1 ^ ip.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + ip.charCodeAt(i) * 31) ^ (h2 << 5)) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}
const TTL_MS = 30 * 60 * 1000;

function areaLabel(city: string, region: string | null) {
  return region ? `${city}, ${region}` : city;
}

async function lookupByIp(ip: string): Promise<DetectedArea> {
  const key = cacheKey(ip);
  const cached = ipCache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.area;
  let area: DetectedArea = null;
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        city?: string;
        region_code?: string;
        region?: string;
        timezone?: string;
        latitude?: number;
        longitude?: number;
      };
      const city = (json.city ?? "").trim();
      const region = (json.region_code ?? json.region ?? "").trim() || null;
      const timezone = (json.timezone ?? "").trim() || null;
      if (city) {
        area = {
          city,
          region,
          label: areaLabel(city, region),
          timezone,
          latitude: Number.isFinite(json.latitude) ? Number(json.latitude) : null,
          longitude: Number.isFinite(json.longitude) ? Number(json.longitude) : null,
        };
      }
    }
  } catch {
    area = null;
  }
  ipCache.set(key, { at: Date.now(), area });
  return area;
}

export async function detectAreaFromRequest(): Promise<DetectedArea> {
  // The runtime hands back either a Headers instance or a plain record
  // depending on the adapter, so read both shapes.
  let raw: unknown;
  try {
    raw = getRequestHeaders();
  } catch {
    return null;
  }
  const get = (k: string): string | undefined => {
    if (!raw) return undefined;
    if (typeof (raw as Headers).get === "function") {
      return (raw as Headers).get(k.toLowerCase()) ?? undefined;
    }
    const record = raw as Record<string, string | undefined>;
    return record[k] ?? record[k.toLowerCase()];
  };
  const headerCity = get("cf-ipcity") ?? get("x-vercel-ip-city") ?? get("x-geo-city");
  const headerRegion =
    get("cf-region-code") ?? get("x-vercel-ip-country-region") ?? get("x-geo-region");
  const headerZone = get("cf-timezone") ?? get("x-vercel-ip-timezone") ?? get("x-geo-timezone");
  const headerLat = get("cf-iplatitude") ?? get("x-vercel-ip-latitude") ?? get("x-geo-latitude");
  const headerLng = get("cf-iplongitude") ?? get("x-vercel-ip-longitude") ?? get("x-geo-longitude");
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) ? n : null;
  };
  if (headerCity) {
    const city = decodeURIComponent(headerCity).trim();
    const region = headerRegion ? decodeURIComponent(headerRegion).trim() || null : null;
    const timezone = headerZone ? decodeURIComponent(headerZone).trim() || null : null;
    if (city) {
      return {
        city,
        region,
        label: areaLabel(city, region),
        timezone,
        latitude: num(headerLat),
        longitude: num(headerLng),
      };
    }
  }

  const fwd = get("x-forwarded-for") ?? get("cf-connecting-ip") ?? get("x-real-ip") ?? "";
  const ip = fwd.split(",")[0]?.trim() ?? "";
  if (
    !ip ||
    ip.startsWith("127.") ||
    ip.startsWith("::1") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.")
  ) {
    return null;
  }
  return lookupByIp(ip);
}
