import { supabase } from "@v3/ui/integrations/supabase/client";

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

export type NodeRow = {
  node_type: string | null;
  title: string | null;
  url: string | null;
  source_id: string | null;
  verified: boolean | null;
};

export type ProfileAttrs = {
  year_started?: number;
  years_experience?: number;
  timezone?: string;
  nmls_id?: string;
  region?: string | null;
  badges?: string[];
  prequalify_url?: string;
  disclaimer?: string;
  serving_areas?: { city: string; state: string; zips: string[] }[];
};

type OrgRow = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string | null;
  description: string | null;
  logo_url: string | null;
  cover_photo_url: string | null;
  website_url: string | null;
  phone: string | null;
  gcid: string | null;
  entity_type: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  parent_org_id: string | null;
  search_rank_score: number | null;
  claimed: boolean | null;
};

const ORG_COLS =
  "id, name, legal_name, slug, description, logo_url, cover_photo_url, website_url, phone, gcid, entity_type, address_street, address_city, address_state, address_zip, parent_org_id, search_rank_score, claimed";

const PRO_COLS =
  "id, first_name, last_name, display_name, slug, headline, bio, photo_url, cover_photo_url, gcid, job_title, phone, email, website_url, address_city, address_state, address_zip, primary_org_id, primary_license_number, primary_license_state, primary_license_verified, markets_served, zip_codes_served, search_rank_score, local_rank, local_rank_of, claimed";

async function loadRatings(entityType: string, entityId: string) {
  const { data } = await supabase
    .from("aggregate_ratings")
    .select("source, rating_value, review_count")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  const rows = (data ?? []) as RatingRow[];
  const overall = rows.find((r) => r.source === "all") ?? null;
  const bySource = rows
    .filter((r) => r.source !== "all")
    .sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0));
  return { overall, bySource };
}

async function loadNodes(entityType: string, entityId: string) {
  const { data } = await supabase
    .from("graph_nodes")
    .select("node_type, title, url, source_id, verified, extracted_data")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("is_active", true);
  const rows = (data ?? []) as (NodeRow & { extracted_data: unknown })[];
  const pick = (t: string) => rows.filter((r) => r.node_type === t);
  const attrsRow = rows.find((r) => r.node_type === "profile_attributes");
  return {
    products: pick("product_service").map((r) => r.title ?? "").filter(Boolean),
    specialties: pick("specialty").map((r) => r.title ?? "").filter(Boolean),
    socials: pick("social_profile"),
    attrs: (attrsRow?.extracted_data ?? {}) as ProfileAttrs,
  };
}

async function loadMedia(entityType: string, entityId: string) {
  const { data } = await supabase
    .from("media_items")
    .select("id, title, media_type, thumbnail_url, source_url, published_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("is_active", true)
    .limit(12);
  return data ?? [];
}

async function loadArticles(authorType: string, authorId: string) {
  const { data } = await supabase
    .from("content_items")
    .select("id, title, slug, excerpt, cover_image_url, published_at")
    .eq("author_type", authorType)
    .eq("author_id", authorId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(6);
  return data ?? [];
}

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

/** Row for the entity's gcid, else the 'default' row, else a neutral fallback. */
export async function loadProfileConfig(gcid: string | null | undefined): Promise<ProfileConfig> {
  const keys = gcid ? [gcid, "default"] : ["default"];
  const { data } = await supabase
    .from("exp_category_profile_config")
    .select(
      "gcid, entity_noun, service_label, credential_label, credential_id_label, cta_label, schema_type, show_prequalify",
    )
    .in("gcid", keys);
  const rows = (data ?? []) as Partial<ProfileConfig>[];
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

/** Services/products for a category, straight from the governed taxonomy. */
export async function loadCategoryServices(gcid: string | null | undefined) {
  if (!gcid) return { services: [] as string[], specializations: [] as string[] };
  const { data } = await supabase
    .from("exp_taxonomy")
    .select("term, level")
    .eq("gcid", gcid)
    .in("level", ["product_service", "specialization"])
    .order("priority", { ascending: true })
    .limit(40);
  const rows = (data ?? []) as { term: string | null; level: string | null }[];
  const terms = (level: string) =>
    rows.filter((r) => r.level === level).map((r) => (r.term ?? "").trim()).filter(Boolean);
  return { services: terms("product_service"), specializations: terms("specialization") };
}

export async function loadProfessionalProfile(slug: string) {
  const { data: pro } = await supabase
    .from("professionals")
    .select(PRO_COLS)
    .eq("slug", slug)
    .maybeSingle();
  if (!pro) return null;


  const office = pro.primary_org_id
    ? (
        await supabase
          .from("organizations")
          .select(ORG_COLS)
          .eq("id", pro.primary_org_id)
          .maybeSingle()
      ).data
    : null;
  const company = office?.parent_org_id
    ? (
        await supabase
          .from("organizations")
          .select(ORG_COLS)
          .eq("id", office.parent_org_id)
          .maybeSingle()
      ).data
    : null;

  const [ratings, nodes, reviewsRes, credsRes, media, articles, officeAttrs, config, taxonomy] =
    await Promise.all([
      loadRatings("professional", pro.id),
      loadNodes("professional", pro.id),
      supabase
        .from("reviews")
        .select(
          "id, rating, body, title, reviewer_name, review_date, source, reply_body, reply_date, is_verified, locations_mentioned",
        )
        .eq("entity_type", "professional")
        .eq("entity_id", pro.id)
        .order("review_date", { ascending: false })
        .limit(25),
      supabase
        .from("credentials")
        .select(
          "id, credential_type, name, identifier, issuing_org, issuing_org_url, issuing_state, valid_from, valid_until, verified, verification_url",
        )
        .eq("professional_id", pro.id)
        .eq("is_current", true),
      loadMedia("professional", pro.id),
      loadArticles("professional", pro.id),
      office ? loadNodes("organization", office.id) : Promise.resolve(null),
      loadProfileConfig(pro.gcid as string | null),
      loadCategoryServices(pro.gcid as string | null),
    ]);

  // Taxonomy-by-gcid is the source of truth; graph_nodes rows top up the list.
  const dedupe = (a: string[], b: string[]) => {
    const seen = new Set<string>();
    return [...a, ...b].filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return {
    pro: pro as unknown as Record<string, unknown> & typeof pro,
    office: (office ?? null) as OrgRow | null,
    company: (company ?? null) as OrgRow | null,
    ratings,
    ...nodes,
    config,
    products: dedupe(taxonomy.services, nodes.products),
    specialties: dedupe(taxonomy.specializations, nodes.specialties),
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
    credentials: credsRes.data ?? [],
    media,
    articles,
    region: nodes.attrs.region ?? officeAttrs?.attrs.region ?? null,
  };
}


export async function loadOrgProfile(slug: string) {
  const { data: org } = await supabase
    .from("organizations")
    .select(ORG_COLS)
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return null;

  const parent = org.parent_org_id
    ? (
        await supabase
          .from("organizations")
          .select(ORG_COLS)
          .eq("id", org.parent_org_id)
          .maybeSingle()
      ).data
    : null;

  const [ratings, nodes, childOrgsRes, prosRes, reviewsRes, media, articles] =
    await Promise.all([
      loadRatings("organization", org.id),
      loadNodes("organization", org.id),
      supabase
        .from("organizations")
        .select(ORG_COLS)
        .eq("parent_org_id", org.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("professionals")
        .select(PRO_COLS)
        .eq("primary_org_id", org.id)
        .eq("is_active", true)
        .order("search_rank_score", { ascending: false, nullsFirst: false }),
      supabase
        .from("reviews")
        .select(
          "id, rating, body, title, reviewer_name, review_date, source, reply_body, reply_date, is_verified, locations_mentioned",
        )
        .eq("entity_type", "organization")
        .eq("entity_id", org.id)
        .order("review_date", { ascending: false })
        .limit(25),
      loadMedia("organization", org.id),
      loadArticles("organization", org.id),
    ]);

  return {
    org: org as OrgRow,
    parent: (parent ?? null) as OrgRow | null,
    ratings,
    ...nodes,
    childOrgs: (childOrgsRes.data ?? []) as OrgRow[],
    professionals: prosRes.data ?? [],
    reviews: (reviewsRes.data ?? []) as ReviewRow[],
    media,
    articles,
  };
}

export type ProfessionalProfile = NonNullable<
  Awaited<ReturnType<typeof loadProfessionalProfile>>
>;
export type OrgProfile = NonNullable<Awaited<ReturnType<typeof loadOrgProfile>>>;

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
