import { api, ServerFnError } from "@v3/ui/lib/server-fn";
import {
  categoryServicesFrom,
  FALLBACK_PROFILE_CONFIG,
  profileConfigFrom,
  type ProfileConfig,
  type RatingRow,
  type ReviewRow,
} from "@v3/search/lib/public-profile";
import { articleNode, loadAuthorArticles, type VoceArticle } from "@v3/ui/lib/voce";
import { schemaPhone } from "@v3/ui/lib/us-phone";

export const SITE_ORIGIN = "https://experiencesrp.lovable.app";

/** The three entity lanes the renderer supports. */
export type Lane = "professional" | "location" | "brand";
export type ProfileKind = "p" | "o" | "c";

export type PageTemplate = {
  gcid: string;
  entity_type: Lane;
  sections: string[];
  required_sections: string[];
  completeness_floor: number;
  hero_cta: string | null;
  schema_type: string | null;
  /** 'category' when a gcid-specific row was found, 'default' when we fell back. */
  resolved_from: "category" | "default" | "builtin";
};

const BUILTIN_TEMPLATE: Record<Lane, PageTemplate> = {
  professional: {
    gcid: "default",
    entity_type: "professional",
    sections: [
      "hero",
      "claim_cta",
      "about",
      "specialties",
      "credentials",
      "services",
      "reviews",
      "content",
      "service_areas",
      "contact",
    ],
    required_sections: ["hero", "about", "services", "reviews"],
    completeness_floor: 60,
    hero_cta: "Contact",
    schema_type: "Person",
    resolved_from: "builtin",
  },
  location: {
    gcid: "default",
    entity_type: "location",
    sections: [
      "hero",
      "claim_cta",
      "about",
      "services",
      "hours",
      "staff",
      "reviews",
      "gallery",
      "map",
      "content",
      "contact",
    ],
    required_sections: ["hero", "about", "services", "reviews"],
    completeness_floor: 60,
    hero_cta: "Contact",
    schema_type: "LocalBusiness",
    resolved_from: "builtin",
  },
  brand: {
    gcid: "default",
    entity_type: "brand",
    sections: [
      "hero",
      "claim_cta",
      "about",
      "directory",
      "aggregate_reputation",
      "reviews",
      "content",
      "contact",
    ],
    required_sections: ["hero", "about", "directory"],
    completeness_floor: 55,
    hero_cta: "Contact",
    schema_type: "Organization",
    resolved_from: "builtin",
  },
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

/**
 * Template row for (gcid, lane), falling back to ('default', lane).
 * The fallback is what lets every gcid render.
 * `rows`: exp_category_page_template for [gcid, 'default'] × lane (templateRows).
 */
export function pageTemplateFrom(
  rows: Record<string, unknown>[],
  gcid: string | null | undefined,
  lane: Lane,
): PageTemplate {
  const row =
    (gcid ? rows.find((r) => r.gcid === gcid) : undefined) ??
    rows.find((r) => r.gcid === "default");
  if (!row) return BUILTIN_TEMPLATE[lane];
  const sections = asStringArray(row.sections);
  if (sections.length === 0) return BUILTIN_TEMPLATE[lane];
  return {
    gcid: String(row.gcid ?? "default"),
    entity_type: lane,
    sections,
    required_sections: asStringArray(row.required_sections),
    completeness_floor: Number(row.completeness_floor ?? 0),
    hero_cta: (row.hero_cta as string | null) ?? null,
    schema_type: (row.schema_type as string | null) ?? null,
    resolved_from: row.gcid === gcid ? "category" : "default",
  };
}

/* ------------------------------------------------------------------ *
 * Section payload shapes (all derived from the graph / core tables)  *
 * ------------------------------------------------------------------ */

export type MenuItem = {
  name: string;
  description: string | null;
  price: string | null;
  section: string | null;
  image: string | null;
};
export type HoursRow = { day: string; opens: string | null; closes: string | null };
export type ListingRow = {
  title: string;
  url: string | null;
  price: string | null;
  address: string | null;
  image: string | null;
  detail: string | null;
};
export type GalleryImage = { url: string; title: string | null };
export type PersonRef = {
  id: string;
  name: string;
  slug: string | null;
  photo_url: string | null;
  subtitle: string | null;
};
export type OrgRef = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  subtitle: string | null;
};
export type CredentialRow = {
  id: string;
  name: string | null;
  identifier: string | null;
  issuing_org: string | null;
  issuing_state: string | null;
  verified: boolean | null;
  verification_url: string | null;
};
/** Team members live as graph nodes, never as standalone searchable profiles. */
export type TeamMember = {
  id: string;
  name: string;
  role: string | null;
  license: string | null;
  photo_url: string | null;
};
export type ContentRow = {
  id: string;
  title: string | null;
  slug: string | null;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
};

export type ProofRing = {
  ring_key: string;
  display_name: string;
  sort: number | null;
  color: string | null;
  schema_note: string | null;
};

export type ProofNode = {
  id: string;
  ring_key: string;
  ring_layer: string | null;
  node_type: string;
  title: string | null;
  url: string | null;
  extracted_data: Record<string, unknown> | null;
  source: string;
  verified: boolean | null;
  verified_at: string | null;
};

export type TrustedPartner = {
  id: string;
  partner_name: string;
  relationship_type: string | null;
  status: string | null;
  verified: boolean | null;
};

export type ProfileExpertise = {
  rings: ProofRing[];
  nodes: ProofNode[];
  trustedPartners: TrustedPartner[];
};

export type ProfileBundle = {
  kind: ProfileKind;
  lane: Lane;
  gcid: string | null;
  categoryLabel: string | null;
  template: PageTemplate;
  config: ProfileConfig;
  identity: {
    id: string;
    name: string;
    slug: string;
    headline: string | null;
    jobTitle: string | null;
    photo_url: string | null;
    cover_url: string | null;
    phone: string | null;
    email: string | null;
    website_url: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    latitude: number | null;
    longitude: number | null;
    claimed: boolean;
    score: number | null;
    localRank: number | null;
    localRankOf: number | null;
    licenseNumber: string | null;
    licenseState: string | null;
  };
  about: string | null;
  facts: { label: string; value: string }[];
  specialties: string[];
  services: string[];
  credentials: CredentialRow[];
  menu: MenuItem[];
  hours: HoursRow[];
  /** Free-text hours lines from the graph when no structured day rows exist. */
  hoursNotes: string[];
  timezone: string | null;
  listings: ListingRow[];
  gallery: GalleryImage[];
  staff: PersonRef[];
  /** Graph-backed team members — surfaced only here, never as their own page. */
  team: TeamMember[];
  languages: string[];
  directory: OrgRef[];
  serviceAreas: string[];
  socials: { title: string | null; url: string | null }[];
  reviews: ReviewRow[];
  ratings: { overall: RatingRow | null; bySource: RatingRow[] };
  content: ContentRow[];
  /** VOCE articles authored by this entity (boosted ones serve featured). */
  voce: VoceArticle[];
  parent: OrgRef | null;
  grandparent: OrgRef | null;
  ctaUrl: string | null;
  disclaimer: string | null;
  canonical: string;
  /** Live proof-ring data; currently attached to professional profiles only. */
  expertise?: ProfileExpertise;
};

/** The node types the sections read; the API filters graph_nodes to these (srp/queries/profile.py). */
export const EXTRA_NODE_TYPES = [
  "menu_item",
  "hours",
  "office_hours",
  "gallery_image",
  "listing",
  "service_area",
  "service",
  "product_service",
  "specialty",
  "social_profile",
  "profile_link",
  "profile_attributes",
  // Deep-hydration nodes: for ETL-built entities these carry the identity,
  // contact, credential and team facts the core columns may not have.
  "identity_name",
  "bio",
  "contact_phone",
  "contact_email",
  "website",
  "image_photo",
  "address",
  "geo",
  "office_hours",
  "team_member",
  "language",
  "credential",
];

type RawNode = {
  node_type: string | null;
  title: string | null;
  url: string | null;
  extracted_data: Record<string, unknown> | null;
};

function d(node: RawNode): Record<string, unknown> {
  return (node.extracted_data ?? {}) as Record<string, unknown>;
}
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

/** `rows`: the entity's active graph_nodes of EXTRA_NODE_TYPES (graphNodes). */
function graphSectionsFrom(rows: RawNode[]) {
  const of = (t: string) => rows.filter((r) => r.node_type === t);

  const menu: MenuItem[] = of("menu_item").map((n) => ({
    name: n.title ?? "",
    description: s(d(n).description),
    price: s(d(n).price),
    section: s(d(n).section) ?? s(d(n).menu_section),
    image: s(d(n).image) ?? n.url,
  }));

  const hours: HoursRow[] = of("hours").map((n) => ({
    day: s(d(n).day) ?? n.title ?? "",
    opens: s(d(n).opens),
    closes: s(d(n).closes),
  }));

  const listings: ListingRow[] = of("listing").map((n) => ({
    title: n.title ?? "",
    url: n.url,
    price: s(d(n).price),
    address: s(d(n).address),
    image: s(d(n).image),
    detail: s(d(n).detail) ?? s(d(n).summary),
  }));

  const gallery: GalleryImage[] = of("gallery_image")
    .map((n) => ({ url: (s(d(n).image) ?? n.url ?? "") as string, title: n.title }))
    .filter((g) => !!g.url);

  const serviceAreas = of("service_area")
    .map((n) => n.title ?? "")
    .filter(Boolean);

  const services = [...of("service"), ...of("product_service")]
    .map((n) => n.title ?? "")
    .filter(Boolean);

  const specialties = of("specialty")
    .map((n) => n.title ?? "")
    .filter(Boolean);

  const socials = [...of("social_profile"), ...of("profile_link")].map((n) => ({
    title: s(d(n).platform) ?? n.title,
    url: s(d(n).url) ?? n.url,
  }));

  const attrs = (of("profile_attributes")[0]?.extracted_data ?? {}) as Record<string, unknown>;

  /* ---- deep-hydration facts (only used where core columns are empty) ---- */

  const first = (t: string) => of(t)[0] ?? null;
  const val = (t: string) => {
    const n = first(t);
    if (!n) return null;
    return s(d(n).value) ?? s(d(n).url) ?? n.title;
  };

  const addressNode = first("address");
  const geoNode = first("geo");
  const photoNode = first("image_photo");
  const hoursNode = first("office_hours");

  const hoursNotes = asStringArray(hoursNode ? d(hoursNode).hours : []).filter(Boolean);
  const timezone = hoursNode ? s(d(hoursNode).tz) : null;

  const team: TeamMember[] = of("team_member").map((n, index) => ({
    id: `${n.node_type ?? "team"}-${index}`,
    name: s(d(n).name) ?? n.title ?? "",
    role: s(d(n).role),
    license: s(d(n).license),
    photo_url: s(d(n).photo_url),
  }));

  const languages = of("language")
    .map((n) => s(d(n).language) ?? n.title ?? "")
    .filter(Boolean);

  const graphCredentials: CredentialRow[] = of("credential").map((n, index) => ({
    id: `graph-credential-${index}`,
    name: s(d(n).type) ?? "License",
    identifier: s(d(n).number) ?? n.title,
    issuing_org: s(d(n).issuer),
    issuing_state: s(d(n).state),
    verified: null,
    verification_url: n.url,
  }));

  return {
    menu,
    hours,
    listings,
    gallery,
    serviceAreas,
    services,
    specialties,
    socials,
    attrs,
    hoursNotes,
    timezone,
    team,
    languages,
    graphCredentials,
    identity: {
      name: val("identity_name"),
      bio: val("bio"),
      phone: val("contact_phone"),
      email: val("contact_email"),
      website: val("website"),
      photo_url: photoNode ? (s(d(photoNode).url) ?? photoNode.url) : null,
      street: addressNode ? s(d(addressNode).street) : null,
      city: addressNode ? s(d(addressNode).city) : null,
      state: addressNode ? s(d(addressNode).state) : null,
      zip: addressNode ? (s(d(addressNode).postal_code) ?? s(d(addressNode).zip)) : null,
      latitude: geoNode ? num(d(geoNode).latitude) : null,
      longitude: geoNode ? num(d(geoNode).longitude) : null,
    },
  };
}

function ratingsFrom(rows: RatingRow[]) {
  return {
    overall: rows.find((r) => r.source === "all") ?? null,
    bySource: rows
      .filter((r) => r.source !== "all")
      .sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0)),
  };
}

/** `rows`: the entity's active media_items, 24 at most (media). */
function galleryFrom(rows: Record<string, unknown>[]): GalleryImage[] {
  return rows
    .map((m) => ({
      url: (s(m.thumbnail_url) ?? s(m.source_url) ?? "") as string,
      title: s(m.title),
    }))
    .filter((g) => g.url.startsWith("http"));
}

/** `raw`: proof rings, proof nodes, 'recommends' edges and partner names (expertise). */
function expertiseFrom(raw: RawExpertise): ProfileExpertise {
  const rings = raw.rings as ProofRing[];
  const nodes = raw.nodes as ProofNode[];
  const edges = raw.edges;
  const partnerProfessionals = raw.partnerProfessionals;
  const partnerOrganizations = raw.partnerOrganizations;
  const names = new Map<string, string>();
  for (const row of (partnerProfessionals ?? []) as AnyRow[]) {
    const name =
      (row.display_name as string | null) ??
      [row.first_name, row.last_name].filter(Boolean).join(" ");
    if (name) names.set(String(row.id), name);
  }
  for (const row of (partnerOrganizations ?? []) as AnyRow[]) {
    if (row.name) names.set(String(row.id), String(row.name));
  }

  return {
    rings,
    nodes,
    trustedPartners: edges
      .filter((edge) => !!edge.to_entity_id && names.has(edge.to_entity_id))
      .map((edge) => ({
        id: edge.id,
        partner_name: names.get(edge.to_entity_id ?? "") ?? "",
        relationship_type: edge.relationship_type,
        status: edge.status,
        verified: edge.verified,
      })),
  };
}

/** `row`: gbp_categories display_name / slug for the gcid (category). */
function categoryLabelFrom(row: { display_name?: string | null; slug?: string | null } | null) {
  return row?.display_name ?? row?.slug ?? null;
}

/* ------------------------------------------------------------------ *
 * Rows from GET /search/profile/{p|o|c}/{slug} (surface-api/search/queries/ *
 * profile.py): what each of the old supabase-js queries returned.     *
 * ------------------------------------------------------------------ */

type RawExpertise = {
  rings: AnyRow[];
  nodes: AnyRow[];
  edges: Array<{
    id: string;
    to_entity_type: string | null;
    to_entity_id: string | null;
    relationship_type: string | null;
    status: string | null;
    verified: boolean | null;
  }>;
  partnerProfessionals: AnyRow[];
  partnerOrganizations: AnyRow[];
};

type RawShared = {
  templateRows: AnyRow[];
  configRows: Partial<ProfileConfig>[];
  category: { display_name?: string | null; slug?: string | null } | null;
  graphNodes: RawNode[];
  ratings: RatingRow[];
  reviews: ReviewRow[];
  content: ContentRow[];
  media: AnyRow[];
  taxonomy: { term: string | null; level: string | null }[];
};

type RawProfessional = RawShared & {
  pro: AnyRow;
  office: AnyRow | null;
  company: AnyRow | null;
  credentials: CredentialRow[];
  expertise: RawExpertise;
};

type RawOrg = RawShared & {
  org: AnyRow;
  parent: AnyRow | null;
  children: AnyRow[];
  staff: AnyRow[];
};

/** The profile's rows, or null when no (single) entity has this slug. */
async function loadRaw<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (e) {
    if (e instanceof ServerFnError && e.status === 404) return null;
    throw e;
  }
}

const ORG_COLS =
  "id, name, legal_name, slug, description, logo_url, cover_photo_url, website_url, phone, email, gcid, entity_type, address_street, address_city, address_state, address_zip, latitude, longitude, parent_org_id, search_rank_score, claimed";
const PRO_COLS =
  "id, first_name, last_name, display_name, slug, headline, bio, photo_url, cover_photo_url, gcid, job_title, phone, email, website_url, address_city, address_state, address_zip, primary_org_id, primary_license_number, primary_license_state, markets_served, search_rank_score, local_rank, local_rank_of, claimed";

type AnyRow = Record<string, unknown>;

function orgRef(o: AnyRow | null, subtitle?: string | null): OrgRef | null {
  if (!o) return null;
  return {
    id: String(o.id),
    name: String(o.name ?? ""),
    slug: (o.slug as string | null) ?? null,
    logo_url: (o.logo_url as string | null) ?? null,
    subtitle:
      subtitle ??
      [o.address_city, o.address_state].filter(Boolean).join(", ") ??
      null,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** organizations.entity_type → renderer lane. */
export function orgLane(entityType: string | null | undefined): Lane {
  const t = (entityType ?? "").toLowerCase();
  if (t === "company" || t === "brand" || t === "corporate") return "brand";
  return "location";
}

/* ------------------------------------------------------------------ *
 * Bundle builders                                                     *
 * ------------------------------------------------------------------ */

export async function loadProfessionalBundle(slug: string): Promise<ProfileBundle | null> {
  const raw = await loadRaw<RawProfessional>(`/search/profile/p/${encodeURIComponent(slug)}`);
  if (!raw) return null;
  const p = raw.pro;
  const gcid = (p.gcid as string | null) ?? null;
  const office = raw.office;
  const company = raw.company;

  const template = pageTemplateFrom(raw.templateRows, gcid, "professional");
  const config = profileConfigFrom(raw.configRows, gcid);
  const label = gcid ? categoryLabelFrom(raw.category) : null;
  const graph = graphSectionsFrom(raw.graphNodes);
  const ratings = ratingsFrom(raw.ratings);
  const reviews = raw.reviews;
  const content = raw.content;
  const media = galleryFrom(raw.media);
  const credsRes = { data: raw.credentials };
  const taxonomy = categoryServicesFrom(raw.taxonomy);
  const expertise = expertiseFrom(raw.expertise);

  const attrs = graph.attrs as Record<string, unknown>;
  const name =
    (p.display_name as string) ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    config.entity_noun;

  const areas = new Set<string>([
    ...graph.serviceAreas,
    ...((p.markets_served as string[] | null) ?? []),
  ]);

  // VOCE articles need the resolved display name for the demo author fallback.
  const voce = await loadAuthorArticles(String(p.id), name);


  return {
    kind: "p",
    lane: "professional",
    gcid,
    categoryLabel: label,
    template,
    config,
    identity: {
      id: String(p.id),
      name,
      slug: String(p.slug ?? slug),
      headline: (p.headline as string | null) ?? null,
      jobTitle: (p.job_title as string | null) ?? null,
      photo_url: (p.photo_url as string | null) ?? graph.identity.photo_url,
      cover_url: (p.cover_photo_url as string | null) ?? null,
      phone:
        (p.phone as string | null) ??
        graph.identity.phone ??
        (office?.phone as string | null) ??
        null,
      email: (p.email as string | null) ?? graph.identity.email,
      website_url: (p.website_url as string | null) ?? graph.identity.website,
      street: (office?.address_street as string | null) ?? graph.identity.street,
      city:
        (p.address_city as string | null) ??
        (office?.address_city as string | null) ??
        graph.identity.city,
      state:
        (p.address_state as string | null) ??
        (office?.address_state as string | null) ??
        graph.identity.state,
      zip:
        (p.address_zip as string | null) ??
        (office?.address_zip as string | null) ??
        graph.identity.zip,
      latitude: num(office?.latitude) ?? graph.identity.latitude,
      longitude: num(office?.longitude) ?? graph.identity.longitude,
      claimed: !!p.claimed,
      score: num(p.search_rank_score),
      localRank: num(p.local_rank),
      localRankOf: num(p.local_rank_of),
      licenseNumber: (p.primary_license_number as string | null) ?? null,
      licenseState: (p.primary_license_state as string | null) ?? null,
    },
    about: (p.bio as string | null) ?? graph.identity.bio,
    facts: [
      { label: config.credential_id_label, value: s(p.primary_license_number) ?? "" },
      { label: "Licensed in", value: s(p.primary_license_state) ?? "" },
      { label: "In business since", value: s(attrs.year_started) ?? "" },
      { label: "Languages", value: graph.languages.join(", ") },
      { label: "Time zone", value: s(attrs.timezone) ?? s(graph.timezone) ?? "" },
    ].filter((f) => !!f.value),
    specialties: dedupe(taxonomy.specializations, graph.specialties),
    services: dedupe(taxonomy.services, graph.services),
    credentials: mergeCredentials(
      (credsRes.data ?? []) as CredentialRow[],
      graph.graphCredentials,
    ),
    menu: graph.menu,
    hours: graph.hours,
    hoursNotes: graph.hoursNotes,
    timezone: graph.timezone,
    listings: graph.listings,
    gallery: [...graph.gallery, ...media],
    staff: [],
    team: graph.team,
    languages: graph.languages,
    directory: [],
    serviceAreas: [...areas],
    socials: graph.socials,
    reviews,
    ratings,
    content,
    voce,
    parent: orgRef(office),
    grandparent: orgRef(company),
    ctaUrl: s(attrs.prequalify_url) ?? s(attrs.cta_url),
    disclaimer: s(attrs.disclaimer),
    canonical: `${SITE_ORIGIN}/p/${p.slug ?? slug}`,
    expertise,
  };
}

export async function loadOrgBundle(kind: "o" | "c", slug: string): Promise<ProfileBundle | null> {
  const raw = await loadRaw<RawOrg>(`/search/profile/${kind}/${encodeURIComponent(slug)}`);
  if (!raw) return null;
  const o = raw.org;
  const gcid = (o.gcid as string | null) ?? null;
  const lane = kind === "c" ? "brand" : orgLane(o.entity_type as string | null);
  const parent = raw.parent;

  const template = pageTemplateFrom(raw.templateRows, gcid, lane);
  const config = profileConfigFrom(raw.configRows, gcid);
  const label = gcid ? categoryLabelFrom(raw.category) : null;
  const graph = graphSectionsFrom(raw.graphNodes);
  const ratings = ratingsFrom(raw.ratings);
  const reviews = raw.reviews;
  const content = raw.content;
  const media = galleryFrom(raw.media);
  const childRes = { data: raw.children };
  const staffRes = { data: raw.staff };
  const taxonomy = categoryServicesFrom(raw.taxonomy);

  const attrs = graph.attrs as Record<string, unknown>;
  const voce = await loadAuthorArticles(String(o.id), String(o.name ?? ""));


  const staff: PersonRef[] = ((staffRes.data ?? []) as AnyRow[]).map((r) => ({
    id: String(r.id),
    name:
      (r.display_name as string) || [r.first_name, r.last_name].filter(Boolean).join(" ") || "—",
    slug: (r.slug as string | null) ?? null,
    photo_url: (r.photo_url as string | null) ?? null,
    subtitle: (r.job_title as string | null) ?? null,
  }));

  const directory: OrgRef[] = ((childRes.data ?? []) as AnyRow[]).map(
    (r) => orgRef(r) as OrgRef,
  );

  return {
    kind,
    lane,
    gcid,
    categoryLabel: label,
    template,
    config,
    identity: {
      id: String(o.id),
      name: String(o.name ?? ""),
      slug: String(o.slug ?? slug),
      headline: (o.short_description as string | null) ?? null,
      jobTitle: null,
      photo_url: (o.logo_url as string | null) ?? null,
      cover_url: (o.cover_photo_url as string | null) ?? null,
      phone: (o.phone as string | null) ?? null,
      email: (o.email as string | null) ?? null,
      website_url: (o.website_url as string | null) ?? null,
      street: (o.address_street as string | null) ?? null,
      city: (o.address_city as string | null) ?? null,
      state: (o.address_state as string | null) ?? null,
      zip: (o.address_zip as string | null) ?? null,
      latitude: num(o.latitude),
      longitude: num(o.longitude),
      claimed: !!o.claimed,
      score: num(o.search_rank_score),
      localRank: null,
      localRankOf: null,
      licenseNumber: null,
      licenseState: null,
    },
    about: (o.description as string | null) ?? null,
    facts: [
      { label: "Legal name", value: s(o.legal_name) ?? "" },
      { label: "In business since", value: s(attrs.year_started) ?? "" },
    ].filter((f) => !!f.value),
    specialties: dedupe(taxonomy.specializations, graph.specialties),
    services: dedupe(taxonomy.services, graph.services),
    credentials: graph.graphCredentials,
    menu: graph.menu,
    hours: graph.hours,
    hoursNotes: graph.hoursNotes,
    timezone: graph.timezone,
    listings: graph.listings,
    gallery: [...graph.gallery, ...media],
    staff,
    team: graph.team,
    languages: graph.languages,
    directory,
    serviceAreas: graph.serviceAreas,
    socials: graph.socials,
    reviews,
    ratings,
    content,
    voce,
    parent: orgRef(parent),
    grandparent: null,
    ctaUrl: s(attrs.reservation_url) ?? s(attrs.order_url) ?? s(attrs.cta_url),
    disclaimer: s(attrs.disclaimer),
    canonical: `${SITE_ORIGIN}/${kind}/${o.slug ?? slug}`,
  };
}

/** Credential rows win; graph credential nodes top up ids the table lacks. */
function mergeCredentials(rows: CredentialRow[], graphRows: CredentialRow[]): CredentialRow[] {
  const seen = new Set(
    rows.map((r) => (r.identifier ?? r.name ?? "").replace(/\D/g, "")).filter(Boolean),
  );
  const extra = graphRows.filter((r) => {
    const key = (r.identifier ?? "").replace(/\D/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...rows, ...extra];
}

function dedupe(a: string[], b: string[]) {
  const seen = new Set<string>();
  return [...a, ...b].filter((t) => {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Section presence + completeness floor                               *
 * ------------------------------------------------------------------ */

const CTA_SECTIONS = new Set([
  "quote_cta",
  "reservation_cta",
  "order_cta",
  "rates_prequalify_cta",
]);
const SERVICE_SECTIONS = new Set([
  "services",
  "coverage_products",
  "loan_products",
]);

export function sectionHasData(section: string, b: ProfileBundle): boolean {
  if (SERVICE_SECTIONS.has(section)) return b.services.length > 0;
  if (CTA_SECTIONS.has(section)) return !!(b.ctaUrl || b.identity.phone || b.identity.website_url);
  switch (section) {
    case "hero":
      return !!b.identity.name;
    case "claim_cta":
      return true;
    case "about":
      return !!b.about || b.facts.length > 0;
    case "specialties":
      return b.specialties.length > 0;
    case "credentials":
      return b.credentials.length > 0 || !!b.identity.licenseNumber;
    case "listings":
      return b.listings.length > 0;
    case "menu":
      return b.menu.length > 0;
    case "hours":
      return b.hours.length > 0 || b.hoursNotes.length > 0;
    case "team":
      return b.team.length > 0;
    case "languages":
      return b.languages.length > 0;
    case "staff":
    case "agents_directory":
      return b.staff.length > 0;
    case "directory":
      return b.directory.length > 0;
    case "service_areas":
      return b.serviceAreas.length > 0;
    case "map":
      return b.identity.latitude !== null && b.identity.longitude !== null;
    case "gallery":
      return b.gallery.length > 0;
    case "reviews":
      return b.reviews.length > 0 || !!b.ratings.overall;
    case "aggregate_reputation":
      return !!b.ratings.overall;
    case "content":
      return b.content.length > 0 || b.voce.length > 0;
    case "social":
      return b.socials.length > 0;
    case "contact":
      return !!(
        b.identity.phone ||
        b.identity.email ||
        b.identity.website_url ||
        b.identity.city
      );
    default:
      return false;
  }
}

export type Completeness = {
  pct: number;
  floor: number;
  indexable: boolean;
  present: string[];
  missing: string[];
};

export function completeness(b: ProfileBundle): Completeness {
  const req = b.template.required_sections;
  const present = req.filter((sec) => sectionHasData(sec, b));
  const missing = req.filter((sec) => !sectionHasData(sec, b));
  const pct = req.length === 0 ? 100 : Math.round((present.length / req.length) * 100);
  return { pct, floor: b.template.completeness_floor, indexable: pct >= b.template.completeness_floor, present, missing };
}

/**
 * Universal graph-fed sections. They render on any category when the entity has
 * the data and the template did not already ask for them, and stay hidden otherwise.
 */
const GRAPH_SECTIONS = ["team", "hours", "languages", "gallery", "social"];

/** Sections the template asks for that actually have data, in template order. */
export function renderableSections(b: ProfileBundle): string[] {
  const fromTemplate = b.template.sections.filter((sec) => sectionHasData(sec, b));
  const extra = GRAPH_SECTIONS.filter(
    (sec) => !b.template.sections.includes(sec) && sectionHasData(sec, b),
  );
  return [...fromTemplate, ...extra];
}

/* ------------------------------------------------------------------ *
 * JSON-LD @graph, generated from the rings                            *
 * ------------------------------------------------------------------ */

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    )
      delete o[k];
  }
  return o;
}

export function schemaTypeFor(b: ProfileBundle): string {
  // A professional is always a Person; the category's business type belongs to
  // the organization they work for, emitted as a related node.
  if (b.lane === "professional") return "Person";
  return (
    b.template.schema_type ||
    b.config.schema_type ||
    (b.lane === "brand" ? "Organization" : "LocalBusiness")
  );
}

/** The category's business type, used for the professional's employer node. */
function orgSchemaTypeFor(b: ProfileBundle): string {
  const t = b.template.schema_type || b.config.schema_type;
  return t && t !== "Person" ? t : "LocalBusiness";
}

export function buildJsonLd(b: ProfileBundle): Record<string, unknown> {
  const id = `${b.canonical}#entity`;
  const i = b.identity;
  const city = [i.city, i.state].filter(Boolean).join(", ");
  const sections = new Set(renderableSections(b));
  const nodes: Record<string, unknown>[] = [];

  const main: Record<string, unknown> = {
    "@type": schemaTypeFor(b),
    "@id": id,
    url: b.canonical,
    name: i.name,
    description: b.about ?? undefined,
    image: i.photo_url ?? i.cover_url ?? undefined,
    telephone: schemaPhone(i.phone),
    email: i.email ?? undefined,
    sameAs: b.socials.map((x) => x.url).filter(Boolean),
  };
  if (b.lane === "professional") {
    main.jobTitle = i.jobTitle ?? undefined;
  }
  if (b.languages.length > 0) main.knowsLanguage = b.languages;
  if (b.team.length > 0) {
    main.employee = b.team.map((m) =>
      clean({ "@type": "Person", name: m.name, jobTitle: m.role ?? undefined }),
    );
  }
  if (i.street || i.city) {
    main.address = clean({
      "@type": "PostalAddress",
      streetAddress: i.street ?? undefined,
      addressLocality: i.city ?? undefined,
      addressRegion: i.state ?? undefined,
      postalCode: i.zip ?? undefined,
      addressCountry: "US",
    });
  }
  if (sections.has("map") && i.latitude !== null && i.longitude !== null) {
    main.geo = { "@type": "GeoCoordinates", latitude: i.latitude, longitude: i.longitude };
  }
  if (i.licenseNumber) {
    main.identifier = {
      "@type": "PropertyValue",
      propertyID: b.config.credential_id_label,
      value: i.licenseNumber,
    };
  }
  if (b.credentials.length > 0) {
    main.hasCredential = b.credentials.map((c) =>
      clean({
        "@type": "EducationalOccupationalCredential",
        name: c.name ?? undefined,
        identifier: c.identifier ?? undefined,
        credentialCategory: c.issuing_state ?? undefined,
        recognizedBy: c.issuing_org ? { "@type": "Organization", name: c.issuing_org } : undefined,
        url: c.verification_url ?? undefined,
      }),
    );
  }
  if (b.services.length > 0) {
    main.makesOffer = b.services.slice(0, 60).map((sv) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: sv },
    }));
  }
  const knowsAbout = [
    ...new Set([
      ...b.specialties,
      ...b.voce.flatMap((a) => a.knows_about.map((k) => k.replace(/_/g, " "))),
    ]),
  ];
  if (knowsAbout.length > 0) main.knowsAbout = knowsAbout.slice(0, 60);
  if (b.serviceAreas.length > 0) {
    main.areaServed = b.serviceAreas.slice(0, 60).map((a) => ({ "@type": "Place", name: a }));
  }
  if (b.ratings.overall) {
    main.aggregateRating = clean({
      "@type": "AggregateRating",
      ratingValue: b.ratings.overall.rating_value ?? undefined,
      reviewCount: b.ratings.overall.review_count ?? undefined,
      bestRating: 5,
      worstRating: 1,
    });
  }
  if (b.reviews.length > 0) {
    main.review = b.reviews.slice(0, 10).map((r) =>
      clean({
        "@type": "Review",
        author: { "@type": "Person", name: r.reviewer_name ?? "Verified client" },
        datePublished: r.review_date ?? undefined,
        reviewBody: r.body ?? undefined,
        reviewRating: {
          "@type": "Rating",
          ratingValue: r.rating ?? undefined,
          bestRating: 5,
        },
      }),
    );
  }
  if (b.hours.length > 0) {
    main.openingHoursSpecification = b.hours.map((h) =>
      clean({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: h.day,
        opens: h.opens ?? undefined,
        closes: h.closes ?? undefined,
      }),
    );
  }
  if (sections.has("menu") && b.menu.length > 0) {
    const bySection = new Map<string, MenuItem[]>();
    for (const item of b.menu) {
      const key = item.section ?? "Menu";
      bySection.set(key, [...(bySection.get(key) ?? []), item]);
    }
    main.hasMenu = {
      "@type": "Menu",
      name: `${i.name} menu`,
      hasMenuSection: [...bySection.entries()].map(([secName, items]) => ({
        "@type": "MenuSection",
        name: secName,
        hasMenuItem: items.map((item) =>
          clean({
            "@type": "MenuItem",
            name: item.name,
            description: item.description ?? undefined,
            image: item.image ?? undefined,
            offers: item.price
              ? { "@type": "Offer", price: item.price.replace(/[^0-9.]/g, ""), priceCurrency: "USD" }
              : undefined,
          }),
        ),
      })),
    };
  }
  if (b.parent) {
    const parentId = `${SITE_ORIGIN}/o/${b.parent.slug ?? b.parent.id}#entity`;
    main[b.lane === "professional" ? "worksFor" : "parentOrganization"] = { "@id": parentId };
    const isEmployer = b.lane === "professional";
    nodes.push(
      clean({
        "@type": isEmployer ? orgSchemaTypeFor(b) : "Organization",
        "@id": parentId,
        name: b.parent.name,
        url: b.parent.slug ? `${SITE_ORIGIN}/o/${b.parent.slug}` : undefined,
        logo: b.parent.logo_url ?? undefined,
        telephone: isEmployer ? schemaPhone(i.phone) : undefined,
        address: isEmployer ? (main.address as Record<string, unknown> | undefined) : undefined,
        employee: isEmployer ? [{ "@id": id }] : undefined,
      }),
    );
  }
  if (b.grandparent) {
    const gpId = `${SITE_ORIGIN}/c/${b.grandparent.slug ?? b.grandparent.id}#entity`;
    nodes.push(
      clean({
        "@type": "Organization",
        "@id": gpId,
        name: b.grandparent.name,
        url: b.grandparent.slug ? `${SITE_ORIGIN}/c/${b.grandparent.slug}` : undefined,
        logo: b.grandparent.logo_url ?? undefined,
      }),
    );
  }
  if (b.staff.length > 0 && (sections.has("staff") || sections.has("agents_directory"))) {
    main.employee = b.staff.slice(0, 40).map((p) =>
      clean({
        "@type": "Person",
        name: p.name,
        url: p.slug ? `${SITE_ORIGIN}/p/${p.slug}` : undefined,
      }),
    );
  }
  if (b.directory.length > 0 && sections.has("directory")) {
    main.subOrganization = b.directory.slice(0, 40).map((o) =>
      clean({
        "@type": "Organization",
        name: o.name,
        url: o.slug ? `${SITE_ORIGIN}/o/${o.slug}` : undefined,
      }),
    );
  }

  nodes.unshift(clean(main));

  for (const a of b.content) {
    nodes.push(
      clean({
        "@type": "Article",
        headline: a.title ?? undefined,
        datePublished: a.published_at ?? undefined,
        image: a.cover_image_url ?? undefined,
        author: { "@id": id },
        about: b.specialties.slice(0, 10),
      }),
    );
  }

  // VOCE articles: authored by this profile, carrying their knowsAbout topics
  // into the graph so the entity's topical authority compounds.
  for (const a of b.voce) {
    nodes.push(clean(articleNode(a, id, a.slug ? `/voce/${a.slug}` : null)));
  }


  nodes.push({
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs(b).map((c, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: c.name,
      item: c.url ? `${SITE_ORIGIN}${c.url}` : b.canonical,
    })),
  });

  return { "@context": "https://schema.org", "@graph": nodes };
}

export function breadcrumbs(b: ProfileBundle): { name: string; url: string | null }[] {
  const crumbs: { name: string; url: string | null }[] = [{ name: "Home", url: "/" }];
  if (b.categoryLabel) crumbs.push({ name: b.categoryLabel, url: null });
  const city = [b.identity.city, b.identity.state].filter(Boolean).join(", ");
  if (city) crumbs.push({ name: city, url: null });
  crumbs.push({ name: b.identity.name, url: null });
  return crumbs;
}

/** Top-level @types in the emitted graph — used by verification. */
export function graphTypes(jsonld: Record<string, unknown>): string[] {
  const g = (jsonld["@graph"] ?? []) as Record<string, unknown>[];
  return g.map((n) => String(n["@type"]));
}

export { FALLBACK_PROFILE_CONFIG };
export type { ProfileConfig, RatingRow, ReviewRow };
