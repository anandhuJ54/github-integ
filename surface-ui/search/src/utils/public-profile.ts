export type RatingRow = {
  source: string;
  rating_value: number | null;
  review_count: number | null;
};

export type ReviewRow = {
  id: string;
  rating: number | null;
  body: string | null;
  title: string | null;
  reviewer_name: string | null;
  review_date: string | null;
  source: string | null;
  reply_body: string | null;
  reply_date: string | null;
  is_verified: boolean | null;
  locations_mentioned: string[] | null;
};

/** Category-driven labels/schema for a profile. Never mortgage-specific by default. */
export type ProfileConfig = {
  gcid: string;
  entity_noun: string;
  service_label: string;
  credential_label: string;
  credential_id_label: string;
  cta_label: string;
  schema_type: string;
  show_prequalify: boolean;
};

export const FALLBACK_PROFILE_CONFIG: ProfileConfig = {
  gcid: "default",
  entity_noun: "Professional",
  service_label: "Services",
  credential_label: "Credentials",
  credential_id_label: "License #",
  cta_label: "Contact",
  schema_type: "Person",
  show_prequalify: false,
};

/**
 * Row for the entity's gcid, else the 'default' row, else a neutral fallback.
 * `rows`: exp_category_profile_config for [gcid, 'default'] (GET /search/profile/*: configRows).
 */
export function profileConfigFrom(
  rows: Partial<ProfileConfig>[],
  gcid: string | null | undefined,
): ProfileConfig {
  const row = (gcid ? rows.find((r) => r.gcid === gcid) : undefined) ?? rows.find((r) => r.gcid === "default");
  if (!row) return FALLBACK_PROFILE_CONFIG;
  return {
    gcid: row.gcid ?? "default",
    entity_noun: row.entity_noun || FALLBACK_PROFILE_CONFIG.entity_noun,
    service_label: row.service_label || FALLBACK_PROFILE_CONFIG.service_label,
    credential_label: row.credential_label || FALLBACK_PROFILE_CONFIG.credential_label,
    credential_id_label: row.credential_id_label || FALLBACK_PROFILE_CONFIG.credential_id_label,
    cta_label: row.cta_label || FALLBACK_PROFILE_CONFIG.cta_label,
    schema_type: row.schema_type || FALLBACK_PROFILE_CONFIG.schema_type,
    show_prequalify: !!row.show_prequalify,
  };
}

/**
 * Services/products for a category, straight from the governed taxonomy.
 * `rows`: exp_taxonomy product_service/specialization terms by priority (taxonomy).
 */
export function categoryServicesFrom(rows: { term: string | null; level: string | null }[]) {
  const terms = (level: string) =>
    rows.filter((r) => r.level === level).map((r) => (r.term ?? "").trim()).filter(Boolean);
  return { services: terms("product_service"), specializations: terms("specialization") };
}

export const SOURCE_LABELS: Record<string, string> = {
  "experience.com": "Experience.com",
  google: "Google",
  zillow: "Zillow",
  facebook: "Facebook",
  yelp: "Yelp",
  lendingtree: "LendingTree",
};

export function sourceLabel(s: string | null | undefined) {
  if (!s) return "—";
  return SOURCE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}
