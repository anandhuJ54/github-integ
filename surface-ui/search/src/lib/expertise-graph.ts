import { api } from "@v3/ui/lib/server-fn";

export type GraphKind = "professional" | "office" | "company";

export type GraphNode = {
  id: string;
  entity_type: string;
  entity_id: string;
  node_type: string;
  ring: number;
  title: string | null;
  url: string | null;
  source: string;
  source_id: string | null;
  source_url: string | null;
  verified: boolean | null;
  verified_at: string | null;
  schema_type: string | null;
  schema_property: string | null;
  score_points: number | null;
  score_counted: boolean | null;
  fetched_at: string | null;
  /** True for nodes derived from the entity record itself (identity, place, hierarchy). */
  structural?: boolean;
  /** Branch key used by the canvas layout. */
  branch?: BranchKey;
};

export type BranchKey =
  | "identity"
  | "credentials"
  | "services"
  | "presence"
  | "reviews"
  | "content"
  | "place"
  | "hierarchy";

export const BRANCHES: { key: BranchKey; label: string; color: string }[] = [
  { key: "identity", label: "Identity", color: "#60a5fa" },
  { key: "credentials", label: "Credentials & Licenses", color: "#a78bfa" },
  { key: "services", label: "Products & Services", color: "#34d399" },
  { key: "presence", label: "Social & sameAs", color: "#22d3ee" },
  { key: "reviews", label: "Reviews", color: "#fbbf24" },
  { key: "content", label: "Content", color: "#f472b6" },
  { key: "place", label: "Place & Geo", color: "#38bdf8" },
  { key: "hierarchy", label: "Hierarchy", color: "#e879f9" },
];

export function branchMeta(key: BranchKey) {
  return BRANCHES.find((b) => b.key === key) ?? BRANCHES[0];
}

export function branchOf(n: GraphNode): BranchKey {
  if (n.branch) return n.branch;
  const t = n.node_type;
  if (/credential|license|certif|award|education/i.test(t)) return "credentials";
  if (/product|service|offer|specialt/i.test(t)) return "services";
  if (/social|same_?as|profile_link|website/i.test(t)) return "presence";
  if (/review|rating|testimonial/i.test(t)) return "reviews";
  if (/article|content|post|video|media/i.test(t)) return "content";
  if (/place|geo|address|area|market|location/i.test(t)) return "place";
  if (/org|brand|team|office|employ|member/i.test(t)) return "hierarchy";
  if (n.ring <= 1) return "identity";
  if (n.ring === 2) return "presence";
  if (n.ring === 3) return "services";
  if (n.ring === 4) return "reviews";
  if (n.ring === 5) return "content";
  if (n.ring === 8) return "place";
  return "identity";
}


export type GraphEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  schema_property: string | null;
  weight: number | null;
};

export const RING_META: Record<
  number,
  { label: string; color: string }
> = {
  0: { label: "Identity", color: "#60a5fa" },
  1: { label: "Authority & Credentials", color: "#a78bfa" },
  2: { label: "Presence & Connections", color: "#22d3ee" },
  3: { label: "Services & Expertise", color: "#34d399" },
  4: { label: "Reputation & Reviews", color: "#fbbf24" },
  5: { label: "Content", color: "#f472b6" },
  6: { label: "Transactions", color: "#fb923c" },
  7: { label: "Performance", color: "#c084fc" },
  8: { label: "Coverage & Markets", color: "#38bdf8" },
  9: { label: "Media", color: "#f87171" },
  10: { label: "Compliance", color: "#94a3b8" },
  11: { label: "Signals", color: "#4ade80" },
  12: { label: "Relationships", color: "#e879f9" },
};

export function ringMeta(ring: number) {
  return RING_META[ring] ?? { label: `Ring ${ring}`, color: "#64748b" };
}

export function nodeLabel(n: GraphNode) {
  if (n.title && n.title.trim()) return n.title;
  return n.node_type.replace(/_/g, " ");
}

export type EntityHeader = {
  id: string;
  kind: GraphKind;
  entityType: "professional" | "organization";
  name: string;
  subtitle: string | null;
  slug: string;
  photoUrl: string | null;
  score: number | null;
  maxScore: number | null;
  gcid: string | null;
  profileHref: string;
  claimed: boolean | null;
  /** Raw record fields used to derive structural nodes. */
  record: Record<string, unknown>;
};

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * GET /graph/expertise/:kind/:slug — the rows loadExpertiseGraph() read with supabase-js: the
 * professional/organization row (null when the slug resolves to nothing), its active graph nodes,
 * score, review count, office + brand, the edges touching its nodes and the nodes at their other
 * ends. Node, edge and external-node reads are uncapped (ruling 2026-10-24).
 */
type ExpertiseRows = {
  entity: Rec;
  ownRows: GraphNode[];
  score: {
    total_score: number | null;
    max_possible: number | null;
    local_rank: number | null;
    local_rank_of: number | null;
  } | null;
  reviewCount: number | null;
  org: { id: string; name: string; slug: string | null; parent_org_id: string | null } | null;
  brand: { id: string; name: string; slug: string | null } | null;
  edges: GraphEdge[];
  external: GraphNode[];
} | null;

function resolveEntity(kind: GraphKind, slug: string, data: Rec): EntityHeader {
  if (kind === "professional") {
    const rec = data as Record<string, unknown>;
    return {
      id: data.id,
      kind,
      entityType: "professional",
      name:
        data.display_name ||
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
        "Unnamed",
      subtitle:
        data.headline ||
        [data.job_title, [data.address_city, data.address_state].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · ") ||
        null,
      slug: data.slug ?? slug,
      photoUrl: data.photo_url ?? null,
      score: null,
      maxScore: null,
      gcid: data.gcid ?? null,
      profileHref: `/p/${data.slug ?? slug}`,
      claimed: data.claimed ?? null,
      record: rec,
    };
  }

  return {
    id: data.id,
    kind,
    entityType: "organization",
    name: data.name,
    subtitle:
      [data.legal_name, [data.address_city, data.address_state].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · ") || null,
    slug: data.slug ?? slug,
    photoUrl: data.logo_url ?? null,
    score: null,
    maxScore: null,
    gcid: data.gcid ?? null,
    profileHref: kind === "company" ? `/c/${data.slug ?? slug}` : `/o/${data.slug ?? slug}`,
    claimed: data.claimed ?? null,
    record: data as Record<string, unknown>,
  };
}

function synth(
  entity: EntityHeader,
  branch: BranchKey,
  node_type: string,
  title: string,
  extra?: Partial<GraphNode>,
): GraphNode {
  return {
    id: `synth:${branch}:${node_type}:${title}`.slice(0, 200),
    entity_type: entity.entityType,
    entity_id: entity.id,
    node_type,
    ring: branch === "identity" ? 0 : branch === "place" ? 8 : branch === "hierarchy" ? 12 : 0,
    title,
    url: null,
    source: "record",
    source_id: null,
    source_url: null,
    verified: null,
    verified_at: null,
    schema_type: null,
    schema_property: null,
    score_points: null,
    score_counted: null,
    fetched_at: null,
    structural: true,
    branch,
    ...extra,
  };
}

/** Structural nodes derived from real record fields only — never invented. */
function structuralNodes(
  entity: EntityHeader,
  org: { id: string; name: string; slug: string | null; city?: string | null; state?: string | null } | null,
  brand: { id: string; name: string; slug: string | null } | null,
): GraphNode[] {
  const r = entity.record;
  const out: GraphNode[] = [];
  const str = (k: string) => {
    const v = r[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  out.push(synth(entity, "identity", "legal_name", entity.name, { schema_property: "name" }));
  const jt = str("job_title") ?? str("headline");
  if (jt) out.push(synth(entity, "identity", "job_title", jt, { schema_property: "jobTitle" }));
  const photo = str("photo_url") ?? str("logo_url");
  if (photo)
    out.push(
      synth(entity, "identity", "photo", "Profile photo", {
        schema_property: "image",
        url: photo,
      }),
    );
  const bio = str("bio") ?? str("short_bio") ?? str("description");
  if (bio)
    out.push(
      synth(entity, "identity", "bio", "Biography", {
        schema_property: "description",
      }),
    );
  const phone = str("phone");
  if (phone) out.push(synth(entity, "identity", "phone", phone, { schema_property: "telephone" }));
  const email = str("email");
  if (email) out.push(synth(entity, "identity", "email", email, { schema_property: "email" }));
  const site = str("website_url") ?? str("canonical_url");
  if (site)
    out.push(
      synth(entity, "presence", "website", "Website", { schema_property: "url", url: site }),
    );
  const langs = r["languages"];
  if (Array.isArray(langs))
    langs
      .filter((l): l is string => typeof l === "string" && !!l.trim())
      .forEach((l) =>
        out.push(synth(entity, "identity", "language", l, { schema_property: "knowsLanguage" })),
      );

  const lic = str("primary_license_number");
  if (lic)
    out.push(
      synth(
        entity,
        "credentials",
        "primary_license",
        `${str("primary_license_type") ?? "License"} ${lic}${str("primary_license_state") ? ` (${str("primary_license_state")})` : ""}`,
        { verified: (r["primary_license_verified"] as boolean) ?? null, schema_property: "hasCredential" },
      ),
    );

  const city = str("address_city");
  const state = str("address_state");
  if (city || state)
    out.push(
      synth(entity, "place", "address", [city, state, str("address_zip")].filter(Boolean).join(", "), {
        schema_property: "address",
      }),
    );
  const place = str("gbp_place_id");
  if (place)
    out.push(
      synth(entity, "place", "google_place", "Google Business Profile", {
        schema_property: "identifier",
        source_id: place,
        verified: true,
      }),
    );
  const markets = r["markets_served"];
  if (Array.isArray(markets))
    markets
      .filter((m): m is string => typeof m === "string" && !!m.trim())
      .slice(0, 12)
      .forEach((m) =>
        out.push(synth(entity, "place", "market", m, { schema_property: "areaServed" })),
      );

  if (org)
    out.push(
      synth(entity, "hierarchy", "office", org.name, {
        schema_property: "worksFor",
        url: org.slug ? `/o/${org.slug}` : null,
      }),
    );
  if (brand)
    out.push(
      synth(entity, "hierarchy", "brand", brand.name, {
        schema_property: "parentOrganization",
        url: brand.slug ? `/c/${brand.slug}` : null,
      }),
    );

  return out;
}

export type BranchSummary = {
  key: BranchKey;
  label: string;
  color: string;
  count: number;
  verified: number;
  /** Honest state: populated from live data, or not yet captured. */
  populated: boolean;
};

export async function loadExpertiseGraph(kind: GraphKind, slug: string) {
  const rows = await api.get<ExpertiseRows>(
    `/graph/expertise/${kind}/${encodeURIComponent(slug)}`,
  );
  if (!rows) return null;
  const entity = resolveEntity(kind, slug, rows.entity);
  const { score: scoreRow, reviewCount } = rows;

  entity.score = scoreRow?.total_score ?? null;
  entity.maxScore = scoreRow?.max_possible ?? 850;

  // Hierarchy: office (primary org) and the brand above it.
  let org: { id: string; name: string; slug: string | null } | null = null;
  let brand: { id: string; name: string; slug: string | null } | null = null;
  const o = rows.org;
  if (o) {
    org = { id: o.id, name: o.name, slug: o.slug ?? null };
    const b = o.parent_org_id ? rows.brand : null;
    if (b) brand = { id: b.id, name: b.name, slug: b.slug ?? null };
  }
  if (entity.entityType === "organization" && org) {
    brand = org;
    org = null;
  }

  const own = (rows.ownRows ?? []) as GraphNode[];
  // Edges touching the entity's own nodes (from or to), and the nodes at their other ends that
  // aren't its own — both resolved server-side.
  const edges: GraphEdge[] = own.length ? rows.edges : [];
  const external: GraphNode[] = rows.external;

  const live = [...own, ...external].map((n) => ({ ...n, branch: branchOf(n) }));
  const derived = structuralNodes(entity, org, brand);
  const nodes = [...live, ...derived];

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => nodeIds.has(e.from_node_id) && nodeIds.has(e.to_node_id),
  );

  const summary: BranchSummary[] = BRANCHES.map((b) => {
    const items = nodes.filter((n) => (n.branch ?? branchOf(n)) === b.key);
    const count = b.key === "reviews" ? Math.max(items.length, reviewCount ?? 0) : items.length;
    return {
      key: b.key,
      label: b.label,
      color: b.color,
      count,
      verified: items.filter((n) => n.verified).length,
      populated: count > 0,
    };
  });

  return {
    entity,
    nodes,
    edges: validEdges,
    ownCount: own.length,
    liveCount: live.length,
    derivedCount: derived.length,
    reviewCount: reviewCount ?? 0,
    localRank: scoreRow?.local_rank ?? null,
    localRankOf: scoreRow?.local_rank_of ?? null,
    office: org,
    brand,
    summary,
  };
}

export type ExpertiseGraphData = NonNullable<
  Awaited<ReturnType<typeof loadExpertiseGraph>>
>;

