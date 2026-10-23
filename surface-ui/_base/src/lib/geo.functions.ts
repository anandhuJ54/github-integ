// Client shim: the server implementation moved to FastAPI (surface-api/srp).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

export type DetectedArea = {
  city: string;
  region: string | null;
  label: string;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
} | null;

export type NearbyArea = { label: string; count: number };

export const getDetectedArea = serverFn<{ label: string; city: string; region: string | null }>("srp", "getDetectedArea");
export const getNearbyAreas = serverFn<NearbyArea[]>("srp", "getNearbyAreas");
export const resolveAreaFromCoords = serverFn<{ label: string }>("srp", "resolveAreaFromCoords");
