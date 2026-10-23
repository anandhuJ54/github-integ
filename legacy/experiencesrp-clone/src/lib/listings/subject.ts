import { isSinglePro, type OfficeMode, type RecordType } from "@/lib/office-mode";

/*
 * Listings subject + NAP source — single-professional office rule (Scott 2026-10-11).
 *
 * LISTINGS (Google Business Profile / Place ID, directories, NAP) always belong to the place.
 * In single_pro mode (exp_office_mode, 0027) the office acts as its professional everywhere
 * else, but every listings read/write and every NAP payload resolves to the LOCATION
 * (organizations row, listings.entity_type = 'organization'). Same rule as the v5 scorer's
 * GBP + Directories lanes in 0027. In every other mode the record lists as itself.
 *
 * Pure: callers load the rows (and the mode via loadOfficeMode) and pass them in.
 */

export type ListingSubject = { entityType: RecordType; entityId: string; reason: "self" | "single_pro_location" };

/** Which record's `listings` rows to read/write for the record asked about. */
export function listingSubject(
  record: { entityType: RecordType; entityId: string },
  mode: OfficeMode | null | undefined,
): ListingSubject {
  if (isSinglePro(mode))
    return { entityType: "organization", entityId: mode.locationId!, reason: "single_pro_location" };
  return { ...record, reason: "self" };
}

/** The NAP-bearing columns of a professionals / organizations row. */
export type NapRow = {
  name?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  website_url?: string | null;
  gbp_place_id?: string | null;
};

export type NapField = "name" | "telephone" | "street" | "city" | "region" | "postalCode" | "country" | "url" | "placeId";
export type NapSource = "location" | "professional" | "self";

export type ListingNap = {
  subject: ListingSubject;
  fields: Partial<Record<NapField, string>>;
  /** Where each filled field came from. */
  source: Partial<Record<NapField, NapSource>>;
};

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function napOf(row: NapRow | null | undefined): Partial<Record<NapField, string>> {
  if (!row) return {};
  const name =
    clean(row.name) ??
    clean(row.display_name) ??
    clean([row.first_name, row.last_name].filter(Boolean).join(" "));
  const out: Partial<Record<NapField, string | null>> = {
    name,
    telephone: clean(row.phone),
    street: clean(row.address_street),
    city: clean(row.address_city),
    region: clean(row.address_state),
    postalCode: clean(row.address_zip),
    country: clean(row.address_country),
    url: clean(row.website_url),
    placeId: clean(row.gbp_place_id),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Partial<Record<NapField, string>>;
}

/**
 * NAP for a listing payload. single_pro: every field comes from the LOCATION row; a field the
 * location lacks falls back to the professional's value (the ETL wrote most single-pro Place IDs
 * onto the professional — 9,546 of 9,899 on 2026-10-11 — and both rows describe one office),
 * reported per field in `source`. The listing NAME is the location's (the GBP business name),
 * never the "Name – Brand" profile title. Other modes: the record's own row, as today.
 */
export function listingNap(a: {
  record: { entityType: RecordType; entityId: string };
  mode: OfficeMode | null | undefined;
  self: NapRow | null;
  location?: NapRow | null;
  professional?: NapRow | null;
}): ListingNap {
  const subject = listingSubject(a.record, a.mode);
  if (subject.reason === "self") {
    const fields = napOf(a.self);
    return {
      subject,
      fields,
      source: Object.fromEntries(Object.keys(fields).map((k) => [k, "self"])) as ListingNap["source"],
    };
  }
  const loc = napOf(a.location);
  const pro = napOf(a.professional);
  const fields: Partial<Record<NapField, string>> = {};
  const source: Partial<Record<NapField, NapSource>> = {};
  for (const k of Object.keys({ ...pro, ...loc }) as NapField[]) {
    if (loc[k]) {
      fields[k] = loc[k];
      source[k] = "location";
    } else if (pro[k] && k !== "name") {
      fields[k] = pro[k];
      source[k] = "professional";
    }
  }
  return { subject, fields, source };
}
