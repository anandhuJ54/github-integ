// ─────────────────────────────────────────────────────────────────────────────
// OFFICE MODE — single-professional office rule (Scott, 2026-10-11;
// docs/SRP_Foundation_Plain.md §3).
//
// In every category that supports both professionals and locations, an office
// with EXACTLY ONE active professional is handled as that professional
// (identity, claim, NORA interview, licence key, public profile, title
// "Name – Brand") while LISTINGS (GBP / Place ID, directories, NAP) map to the
// location.
//
// The rule is decided in ONE place: the DB function exp_office_mode
// (drizzle/migrations/0027_single_pro_office.sql). This module only carries its
// result type, a parser, and a loader — it does NOT re-implement the decision.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from "@v3/state/api/server-fn";

export type OfficeModeKind =
  | "single_pro"
  | "multi_pro"
  | "location_only"
  | "professional_only"
  | "not_found";

/** exp_office_mode(p_entity_type, p_entity_id) result. */
export type OfficeMode = {
  mode: OfficeModeKind;
  professionalId: string | null;
  locationId: string | null;
  proCount: number;
  gcid: string | null;
  supportsSingleProOffice: boolean;
  reason: string | null;
};

/** Record vocabulary used by listings / search_rank_scores / the scorer. */
export type RecordType = "professional" | "organization";

const KINDS: readonly OfficeModeKind[] = [
  "single_pro",
  "multi_pro",
  "location_only",
  "professional_only",
  "not_found",
];

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Parse the jsonb the DB function returns; anything malformed → null. */
export function parseOfficeMode(raw: unknown): OfficeMode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mode = r.mode as OfficeModeKind;
  if (!KINDS.includes(mode)) return null;
  return {
    mode,
    professionalId: str(r.professional_id),
    locationId: str(r.location_id),
    proCount: Number(r.pro_count ?? 0) || 0,
    gcid: str(r.gcid),
    supportsSingleProOffice: r.supports_single_pro_office === true,
    reason: str(r.reason),
  };
}

export const isSinglePro = (m: OfficeMode | null | undefined): m is OfficeMode =>
  !!m && m.mode === "single_pro" && !!m.professionalId && !!m.locationId;

/**
 * Call exp_office_mode (through FastAPI's read-only RPC allow-list). Returns null when the
 * function is not deployed yet (0027 unapplied) or errors — callers then keep today's behaviour
 * (the record as itself).
 */
export async function loadOfficeMode(entityType: RecordType, entityId: string): Promise<OfficeMode | null> {
  try {
    const data = await api.post<unknown>("/srp/rpc/exp_office_mode", {
      args: { p_entity_type: entityType, p_entity_id: entityId },
    });
    return parseOfficeMode(data);
  } catch {
    return null;
  }
}
