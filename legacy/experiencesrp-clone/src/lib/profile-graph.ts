/**
 * Builds a complete schema.org @graph JSON-LD object for a public
 * professional profile page. Pure function — no I/O. Pass in everything
 * the loader has already fetched.
 *
 * Rings represented:
 *  - Ring 0: Person core identity (name, photo, bio, jobTitle, @id)
 *  - Ring 1: hasCredential from `credentials`
 *  - Ring 2: sameAs from graph_nodes (profiles_presence ring)
 *  - Ring 3+: knowsAbout from exp_taxonomy specializations (+ wikidata)
 *  - Ring 5: aggregateRating + recent Review nodes
 *  - Ring 6: areaServed from markets_served + transaction_signals
 *  - Ring 7: worksFor → Organization / LocalBusiness
 */

import { schemaPhone } from "@/lib/us-phone";

export type GraphInput = {
  path: string; // route path e.g. /mortgage-broker/chicago/jane-doe
  origin?: string | null; // host origin (built absolute IDs / URLs)
  professional: {
    id: string;
    display_name: string | null;
    job_title: string | null;
    headline: string | null;
    bio: string | null;
    photo_url: string | null;
    canonical_url: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    phone: string | null;
    email: string | null;
    website_url: string | null;
    gcid: string | null;
    wikidata_id: string | null;
    same_as: string[] | null;
    markets_served: string[] | null;
    category_name?: string | null;
  };
  org?: {
    id: string;
    name: string;
    slug: string | null;
    schema_type: string | null; // 'Organization' | 'LocalBusiness' | etc.
    website_url: string | null;
    canonical_url: string | null;
    logo_url: string | null;
    phone: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    address_country: string | null;
    same_as: string[] | null;
    wikidata_id: string | null;
  } | null;
  credentials: Array<{
    name: string | null;
    identifier: string | null;
    credential_type: string | null;
    schema_credential_category: string | null;
    issuing_org: string | null;
    issuing_org_url: string | null;
    issuing_state: string | null;
    valid_until: string | null;
    verified: boolean | null;
    wikidata_id: string | null;
  }>;
  graphNodes: Array<{
    node_type: string;
    url: string | null;
    title: string | null;
    schema_property: string | null;
    source: string | null;
  }>;
  taxonomy: Array<{
    term: string;
    level: string | null;
    wikidata_id: string | null;
    wikipedia_url?: string | null;
  }>;
  transactionSignals: Array<{
    city: string | null;
    state: string | null;
    zip_code: string | null;
    transaction_type: string | null;
  }>;
  aggregateRating: {
    rating_value: number | null;
    review_count: number | null;
    rating_1: number | null;
    rating_2: number | null;
    rating_3: number | null;
    rating_4: number | null;
    rating_5: number | null;
  } | null;
  reviews: Array<{
    id: string;
    rating: number | null;
    title: string | null;
    body: string | null;
    reviewer_name: string | null;
    review_date: string | null;
    source: string | null;
  }>;
  breadcrumbs: Array<{ name: string; path: string }>;
};

const PUBLISHER_ID = "https://experience.com/#org";
const WEBSITE_ID = "https://experience.com/#website";

function abs(origin: string | null | undefined, pathOrUrl: string | null): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!origin) return pathOrUrl;
  return `${origin.replace(/\/+$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/**
 * Rank a sameAs URL so we can sort: Wikidata, Wikipedia, LinkedIn, then
 * everything else alphabetically by host. Lower = higher priority.
 */
function sameAsPriority(url: string): number {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes("wikidata.org")) return 0;
    if (host.includes("wikipedia.org")) return 1;
    if (host.includes("linkedin.com")) return 2;
    if (host.includes("google.com") || host.includes("g.page")) return 3;
    if (host.includes("facebook.com")) return 4;
    if (host.includes("instagram.com")) return 5;
    if (host.includes("youtube.com")) return 6;
    if (host.includes("twitter.com") || host.includes("x.com")) return 7;
    return 50;
  } catch {
    return 99;
  }
}

function sortSameAs(urls: string[]): string[] {
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u)));
  return unique.sort((a, b) => {
    const pa = sameAsPriority(a);
    const pb = sameAsPriority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

function strip<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

export function buildProfileGraph(input: GraphInput): {
  graph: { "@context": string; "@graph": Record<string, unknown>[] };
  nodeCount: number;
} {
  const { path, origin, professional: p, org, credentials, graphNodes, taxonomy, transactionSignals, aggregateRating, reviews, breadcrumbs } = input;

  const pageUrl = abs(origin, path) ?? path;
  const personId = p.canonical_url ?? `${pageUrl}#person`;
  const orgId = org ? (org.canonical_url ?? abs(origin, `/firm/${org.slug ?? org.id}`) ?? `${pageUrl}#firm`) : null;
  const pageId = `${pageUrl}#page`;

  const nodes: Record<string, unknown>[] = [];

  // 1. WebSite
  nodes.push(strip({
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: "https://experience.com",
    name: "Experience.com",
    publisher: { "@id": PUBLISHER_ID },
  }));

  // 2. Organization (publisher)
  nodes.push(strip({
    "@type": "Organization",
    "@id": PUBLISHER_ID,
    name: "Experience.com",
    url: "https://experience.com",
    logo: "https://experience.com/logo.png",
  }));

  // 3. ProfilePage
  nodes.push(strip({
    "@type": "ProfilePage",
    "@id": pageId,
    url: pageUrl,
    name: `${p.display_name ?? ""}${p.job_title ? `, ${p.job_title}` : ""}`,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": personId },
    mainEntity: { "@id": personId },
    dateModified: new Date().toISOString(),
  }));

  // sameAs: combine professional.same_as + Ring 2 graph_nodes (profile URLs)
  const sameAsUrls: string[] = [];
  if (p.same_as) sameAsUrls.push(...p.same_as);
  for (const n of graphNodes) {
    if (n.url && (n.schema_property === "sameAs" || n.node_type?.startsWith("profile") || n.node_type === "directory")) {
      sameAsUrls.push(n.url);
    }
  }
  if (p.wikidata_id) sameAsUrls.push(`https://www.wikidata.org/wiki/${p.wikidata_id}`);
  const sameAs = sortSameAs(sameAsUrls);

  // hasCredential (Ring 1)
  const hasCredential = credentials.map((c) =>
    strip({
      "@type": "EducationalOccupationalCredential",
      name: c.name,
      identifier: c.identifier,
      credentialCategory: c.schema_credential_category ?? c.credential_type,
      recognizedBy: c.issuing_org
        ? strip({
            "@type": "Organization",
            name: c.issuing_org,
            url: c.issuing_org_url,
          })
        : undefined,
      validThrough: c.valid_until,
      ...(c.wikidata_id
        ? { sameAs: [`https://www.wikidata.org/wiki/${c.wikidata_id}`] }
        : {}),
    }),
  );

  // knowsAbout (Ring 3 — specializations / topics)
  const knowsAbout = taxonomy
    .filter((t) => t.level === "specialization" || t.level === "topic" || t.level === "service")
    .map((t) =>
      t.wikidata_id || t.wikipedia_url
        ? strip({
            "@type": "Thing",
            name: t.term,
            sameAs: [
              t.wikidata_id ? `https://www.wikidata.org/wiki/${t.wikidata_id}` : null,
              t.wikipedia_url,
            ].filter(Boolean),
          })
        : t.term,
    );

  // areaServed: combine markets_served + transaction_signals cities
  const places = new Map<string, Record<string, unknown>>();
  for (const m of p.markets_served ?? []) {
    places.set(m.toLowerCase(), { "@type": "Place", name: m });
  }
  for (const s of transactionSignals) {
    const key = `${s.city ?? ""}|${s.state ?? ""}`.toLowerCase().trim();
    if (!key || key === "|") continue;
    if (places.has(key)) continue;
    places.set(
      key,
      strip({
        "@type": "City",
        name: s.city,
        address: strip({
          "@type": "PostalAddress",
          addressLocality: s.city,
          addressRegion: s.state,
          postalCode: s.zip_code,
        }),
      }),
    );
  }
  const areaServed = Array.from(places.values());

  // hasOfferCatalog from taxonomy product_service / service
  const offers = taxonomy
    .filter((t) => t.level === "product_service" || t.level === "product" || t.level === "service")
    .map((t) =>
      strip({
        "@type": "Offer",
        itemOffered: strip({
          "@type": "Service",
          name: t.term,
          ...(t.wikidata_id
            ? { sameAs: [`https://www.wikidata.org/wiki/${t.wikidata_id}`] }
            : {}),
        }),
      }),
    );
  const hasOfferCatalog =
    offers.length > 0
      ? strip({
          "@type": "OfferCatalog",
          name: `${p.category_name ?? "Services"} offered by ${p.display_name ?? ""}`,
          itemListElement: offers,
        })
      : undefined;

  // aggregateRating
  let aggregateRatingNode: Record<string, unknown> | undefined;
  if (aggregateRating && aggregateRating.rating_value != null && aggregateRating.review_count != null) {
    aggregateRatingNode = strip({
      "@type": "AggregateRating",
      ratingValue: aggregateRating.rating_value,
      reviewCount: aggregateRating.review_count,
      bestRating: 5,
      worstRating: 1,
    });
  }

  // worksFor
  const worksFor = org && orgId ? { "@id": orgId } : undefined;

  // 4. Person
  nodes.push(strip({
    "@type": "Person",
    "@id": personId,
    name: p.display_name,
    givenName: undefined,
    jobTitle: p.job_title,
    description: p.bio ?? p.headline,
    image: p.photo_url,
    url: pageUrl,
    mainEntityOfPage: { "@id": pageId },
    telephone: schemaPhone(p.phone),
    email: p.email,
    address: strip({
      "@type": "PostalAddress",
      addressLocality: p.address_city,
      addressRegion: p.address_state,
      postalCode: p.address_zip,
      addressCountry: "US",
    }),
    sameAs,
    hasCredential,
    knowsAbout,
    areaServed,
    hasOfferCatalog,
    aggregateRating: aggregateRatingNode,
    worksFor,
  }));

  // 5. Organization / LocalBusiness for their firm
  if (org && orgId) {
    nodes.push(strip({
      "@type": org.schema_type || "Organization",
      "@id": orgId,
      name: org.name,
      url: org.website_url ?? org.canonical_url,
      logo: org.logo_url,
      telephone: schemaPhone(org.phone),
      address: strip({
        "@type": "PostalAddress",
        streetAddress: org.address_street,
        addressLocality: org.address_city,
        addressRegion: org.address_state,
        postalCode: org.address_zip,
        addressCountry: org.address_country ?? "US",
      }),
      sameAs: sortSameAs([
        ...(org.same_as ?? []),
        ...(org.wikidata_id ? [`https://www.wikidata.org/wiki/${org.wikidata_id}`] : []),
      ]),
      employee: { "@id": personId },
    }));
  }

  // 6. Up to 3 most recent Reviews
  for (const r of reviews.slice(0, 3)) {
    nodes.push(strip({
      "@type": "Review",
      itemReviewed: { "@id": personId },
      author: r.reviewer_name ? { "@type": "Person", name: r.reviewer_name } : undefined,
      datePublished: r.review_date,
      name: r.title,
      reviewBody: r.body,
      reviewRating: r.rating != null
        ? strip({ "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 })
        : undefined,
      publisher: r.source ? strip({ "@type": "Organization", name: r.source }) : undefined,
    }));
  }

  // 7. BreadcrumbList
  if (breadcrumbs.length > 0) {
    nodes.push({
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: abs(origin, b.path) ?? b.path,
      })),
    });
  }

  return {
    graph: { "@context": "https://schema.org", "@graph": nodes },
    nodeCount: nodes.length,
  };
}
