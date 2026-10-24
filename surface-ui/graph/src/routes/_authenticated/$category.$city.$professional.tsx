import { BrandWordmark } from "@v3/ui/components/brand/logo";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { api } from "@v3/ui/lib/server-fn";
import type { Database, Tables } from "@v3/ui/integrations/supabase/types";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Card, CardContent } from "@v3/ui/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@v3/ui/components/ui/avatar";
import { Separator } from "@v3/ui/components/ui/separator";
import {
  BadgeCheck,
  Star,
  Phone,
  Mail,
  Share2,
  Award,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { buildProfileGraph, type GraphInput } from "@v3/graph/lib/profile-graph";
import { getCachedSchema, cacheSchema } from "@v3/graph/lib/schema-cache.functions";

function slugify(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type ProfileData = Awaited<ReturnType<typeof loadProfile>>;

type TableName = keyof Database["public"]["Tables"];
/** The columns a supabase-js select("a, b") returned from table T. */
type Row<T extends TableName, K extends keyof Tables<T>> = Pick<Tables<T>, K>;

/** GET /graph/profile/:slug — the rows loadProfile() read with supabase-js, under its names. */
type ProfileRows = {
  profile: Tables<"v_professional_profile"> | null;
  reviews: Row<"reviews", "id" | "rating" | "title" | "body" | "reviewer_name" | "review_date" | "reply_body" | "reply_date" | "source" | "is_verified">[];
  content: Row<"content_items", "id" | "title" | "slug" | "excerpt" | "cover_image_url" | "published_at">[];
  credentials: Row<"credentials", "id" | "credential_type" | "name" | "identifier" | "issuing_org" | "issuing_org_url" | "issuing_state" | "valid_until" | "verified" | "schema_credential_category" | "wikidata_id">[];
  pro: Row<"professionals", "id" | "canonical_url" | "phone" | "email" | "website_url" | "address_zip" | "wikidata_id" | "primary_org_id"> | null;
  graphNodes: Row<"graph_nodes", "node_type" | "url" | "title" | "schema_property" | "source">[];
  taxonomy: Row<"exp_taxonomy", "term" | "level" | "wikidata_id">[];
  transactionSignals: Row<"transaction_signals", "city" | "state" | "zip_code" | "transaction_type">[];
  aggregateRating: Row<"aggregate_ratings", "rating_value" | "review_count" | "rating_1" | "rating_2" | "rating_3" | "rating_4" | "rating_5"> | null;
  org: Row<"organizations", "id" | "name" | "slug" | "schema_type" | "website_url" | "canonical_url" | "logo_url" | "phone" | "address_street" | "address_city" | "address_state" | "address_zip" | "address_country" | "same_as" | "wikidata_id"> | null;
};

async function loadProfile(params: {
  category: string;
  city: string;
  professional: string;
}) {
  // One request: the view row, then (server-side, in one round trip) the side reads and the org.
  const rows = await api.get<ProfileRows>(`/graph/profile/${encodeURIComponent(params.professional)}`);
  const prof = rows.profile;
  if (!prof) throw notFound();

  // Validate slugs match (for canonicalization / 404 on mismatch)
  const cityOk = slugify(prof.address_city) === params.city;
  const catOk =
    slugify(prof.category_name) === params.category ||
    (prof.gcid ?? "").replace("gcid:", "").replace(/_/g, "-") ===
      params.category;
  if (!cityOk || !catOk) throw notFound();

  const profId = prof.id as string;
  // Org (Ring 7)
  // loadOrg(proRes.primary_org_id), read with the rest
  const org = rows.org;

  const path = `/${params.category}/${params.city}/${params.professional}`;

  // Try cached @graph first
  let schemaJson: string;
  const cached = await getCachedSchema({
    data: { entityType: "professional", entityId: profId, pageType: "profile" },
  }).catch(() => null);

  if (cached?.schemaJson) {
    schemaJson = cached.schemaJson;
  } else {
    const input: GraphInput = {
      path,
      origin: null,
      professional: {
        id: profId,
        display_name: prof.display_name,
        job_title: prof.job_title,
        headline: prof.headline,
        bio: prof.bio,
        photo_url: prof.photo_url,
        canonical_url: (rows.pro?.canonical_url as string | null) ?? null,
        address_city: prof.address_city,
        address_state: prof.address_state,
        address_zip: (rows.pro?.address_zip as string | null) ?? null,
        phone: (rows.pro?.phone as string | null) ?? null,
        email: (rows.pro?.email as string | null) ?? null,
        website_url: (rows.pro?.website_url as string | null) ?? null,
        gcid: prof.gcid,
        wikidata_id: (rows.pro?.wikidata_id as string | null) ?? null,
        same_as: (prof.same_as as string[] | null) ?? null,
        markets_served: (prof.markets_served as string[] | null) ?? null,
        category_name: prof.category_name,
      },
      org: org
        ? {
            id: org.id,
            name: org.name,
            slug: org.slug,
            schema_type: org.schema_type,
            website_url: org.website_url,
            canonical_url: org.canonical_url,
            logo_url: org.logo_url,
            phone: org.phone,
            address_street: org.address_street,
            address_city: org.address_city,
            address_state: org.address_state,
            address_zip: org.address_zip,
            address_country: org.address_country,
            same_as: org.same_as as string[] | null,
            wikidata_id: org.wikidata_id,
          }
        : null,
      credentials: (rows.credentials ?? []) as GraphInput["credentials"],
      graphNodes: (rows.graphNodes ?? []) as GraphInput["graphNodes"],
      taxonomy: (rows.taxonomy ?? []) as GraphInput["taxonomy"],
      transactionSignals: (rows.transactionSignals ?? []) as GraphInput["transactionSignals"],
      aggregateRating: (rows.aggregateRating ?? null) as GraphInput["aggregateRating"],
      reviews: (rows.reviews ?? []) as GraphInput["reviews"],
      breadcrumbs: [
        { name: "Home", path: "/" },
        { name: prof.category_name ?? params.category, path: `/${params.category}` },
        { name: prof.address_city ?? params.city, path: `/${params.category}/${params.city}` },
        { name: prof.display_name ?? params.professional, path },
      ],
    };
    const built = buildProfileGraph(input);
    schemaJson = JSON.stringify(built.graph);
    // Fire-and-forget cache write
    cacheSchema({
      data: {
        entityType: "professional",
        entityId: profId,
        pageType: "profile",
        schemaJson,
        nodeCount: built.nodeCount,
      },
    }).catch(() => undefined);
  }

  return {
    profile: prof,
    proExtras: (rows.pro ?? null) as
      | {
          canonical_url: string | null;
          phone: string | null;
          email: string | null;
          website_url: string | null;
          address_zip: string | null;
          wikidata_id: string | null;
        }
      | null,
    reviews: rows.reviews ?? [],
    content: rows.content ?? [],
    credentials: rows.credentials ?? [],
    graphNodes: rows.graphNodes ?? [],
    taxonomy: rows.taxonomy ?? [],
    transactionSignals: rows.transactionSignals ?? [],
    aggregateRating: rows.aggregateRating ?? null,
    org,
    schemaJson,
  };
}

function profileQueryOptions(params: {
  category: string;
  city: string;
  professional: string;
}) {
  return queryOptions({
    queryKey: ["srp-profile", params],
    queryFn: () => loadProfile(params),
  });
}

export const Route = createFileRoute("/_authenticated/$category/$city/$professional")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(profileQueryOptions(params)),
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    const d = loaderData as ProfileData;
    const p = d.profile;
    const path = `/${params.category}/${params.city}/${params.professional}`;
    const title = `${p.display_name}${p.job_title ? `, ${p.job_title}` : ""} — ${p.category_name ?? ""} in ${p.address_city ?? ""}, ${p.address_state ?? ""}`;
    const desc =
      p.headline ??
      (p.bio ? p.bio.slice(0, 155) : `${p.display_name} — ${p.category_name} serving ${p.address_city}, ${p.address_state}.`);

    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: path },
        ...(p.photo_url
          ? [{ property: "og:image", content: p.photo_url }]
          : []),
      ],
      links: [{ rel: "canonical", href: path }],
      scripts: [
        {
          type: "application/ld+json",
          children: d.schemaJson,
        },
      ],
    };
  },
  component: ProfilePage,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Profile not found</h1>
        <p className="mt-2 text-muted-foreground">
          We couldn't find this professional.
        </p>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Error loading profile: {error instanceof Error ? error.message : String(error)}</p>
    </div>
  ),
});

function StarRating({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= full ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
        />
      ))}
    </div>
  );
}

function ProfilePage() {
  const params = Route.useParams();
  const { data } = useSuspenseQuery(profileQueryOptions(params));
  const { profile: p, reviews, content, credentials } = data;

  const initials = (p.display_name ?? "")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <main className="min-h-screen bg-[color:var(--color-surface-2)]">
      {/* Public top nav */}
      <nav className="bg-white border-b border-[color:var(--color-hairline)] sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-6">
          <a href="/" className="inline-flex items-center">
            <BrandWordmark size={22} />
          </a>
          <div className="hidden md:flex flex-1 max-w-2xl">
            <div className="relative w-full">
              <input className="w-full h-11 pl-12 pr-4 rounded-full bg-[color:var(--color-surface-2)] border border-transparent text-sm focus:outline-none focus:bg-white focus:border-[color:var(--color-g-blue)] focus:shadow-[0_2px_12px_rgba(66,133,244,0.15)] transition-all" placeholder="Find a professional, service, or business" />
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-3)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
          </div>
          <a href="/auth" className="hidden sm:inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-[color:var(--color-g-blue)] hover:bg-[color:var(--color-g-blue-soft)] transition-colors">Sign in</a>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
          {/* MAIN COLUMN */}
          <div className="space-y-8">
            {/* 1. HERO — animated Gemini header */}
            <section className="relative overflow-hidden rounded-3xl bg-ink text-white shadow-[0_24px_60px_-20px_rgba(66,133,244,0.4)]">
              <div className="absolute inset-0 opacity-90" style={{ background: "var(--gradient-gemini)", backgroundSize: "200% 200%", animation: "gemini-drift 14s ease infinite" }} />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent" />
              <div className="relative p-6 sm:p-10">
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 sm:gap-6">
                  <div className="relative">
                    <div aria-hidden className="absolute -inset-1 rounded-full" style={{ background: "var(--gradient-gemini-ribbon)" }} />
                    <Avatar className="relative h-24 w-24 shrink-0 ring-4 ring-white sm:h-32 sm:w-32">
                      <AvatarImage src={p.photo_url ?? undefined} alt={p.display_name ?? ""} />
                      <AvatarFallback className="text-xl bg-white text-ink">{initials}</AvatarFallback>
                    </Avatar>
                    {p.top_pct != null && p.top_pct <= 25 && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-yellow)] px-2 py-0.5 text-[10px] font-bold text-ink whitespace-nowrap">
                        <Award className="h-3 w-3" /> TOP {p.top_pct}%
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-3xl font-bold tracking-tight sm:text-5xl">
                        {p.display_name}
                      </h1>
                      {p.claimed && (
                        <BadgeCheck className="h-6 w-6 shrink-0 text-[color:var(--color-g-blue)] fill-white" aria-label="Verified" />
                      )}
                    </div>
                    {p.job_title && (
                      <p className="mt-2 text-base text-white/85 sm:text-lg">
                        {p.job_title}{p.org_name ? <> · <span className="font-semibold text-white">{p.org_name}</span></> : null}
                      </p>
                    )}
                    {(p.address_city || p.address_state) && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-white/75">
                        <MapPin className="h-3.5 w-3.5" />
                        {p.address_city}{p.address_state ? `, ${p.address_state}` : ""}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {p.primary_license_number && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-semibold text-white border border-white/20">
                          {p.primary_license_verified && <BadgeCheck className="h-3 w-3" />}
                          {p.primary_license_type ?? "License"} #{p.primary_license_number}
                        </span>
                      )}
                      {p.avg_rating && p.review_count ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-semibold text-white border border-white/20">
                          <Star className="h-3 w-3 fill-[color:var(--color-g-yellow)] text-[color:var(--color-g-yellow)]" />
                          {Number(p.avg_rating).toFixed(2)} · {p.review_count} reviews
                        </span>
                      ) : null}
                      {p.local_rank && p.local_rank_of ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 backdrop-blur px-3 py-1 text-xs font-semibold text-white border border-white/20">
                          <TrendingUp className="h-3 w-3" /> Ranked #{p.local_rank} of {p.local_rank_of}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-6 flex flex-wrap gap-2">
                      <button className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink shadow hover:-translate-y-0.5 transition-transform">
                        <Phone className="h-4 w-4" /> Contact {(p.display_name ?? "").split(" ")[0]}
                      </button>
                      <button className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
                        <Share2 className="h-4 w-4" /> Refer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. ABOUT */}
            <Section title="About">
              {p.bio ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                  {p.bio}
                </p>
              ) : p.claimed ? (
                <p className="text-sm italic text-muted-foreground">
                  {p.display_name} hasn't added a bio yet.
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No bio available.
                </p>
              )}
            </Section>

            {/* 4. SERVICES */}
            <ServicesSection gcid={p.gcid} />

            {/* 5. MARKETS SERVED */}
            {p.markets_served && p.markets_served.length > 0 && (
              <Section title="Markets served">
                <div className="flex flex-wrap gap-2">
                  {p.markets_served.map((m: string) => (
                    <Badge key={m} variant="secondary" className="font-normal">
                      {m}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* 6. REVIEWS */}
            <Section
              title="Reviews"
              action={
                p.review_count && p.review_count > 5 ? (
                  <a href="#" className="text-sm text-blue-600 hover:underline">
                    See all reviews
                  </a>
                ) : null
              }
            >
              {reviews.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">No reviews yet.</p>
              ) : (
                <div className="space-y-4">
                  {reviews.map((r) => (
                    <Card key={r.id}>
                      <CardContent className="space-y-2 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <StarRating value={Number(r.rating)} />
                            <span className="text-sm font-medium">{r.reviewer_name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {r.review_date}
                          </span>
                        </div>
                        {r.title && <p className="text-sm font-semibold">{r.title}</p>}
                        {r.body && (
                          <p className="text-sm text-foreground/90">{r.body}</p>
                        )}
                        {r.reply_body && (
                          <div className="mt-2 rounded-md bg-muted/50 p-3 text-sm">
                            <p className="text-xs font-semibold text-muted-foreground">
                              Reply from {p.display_name}
                            </p>
                            <p className="mt-1 text-foreground/90">{r.reply_body}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </Section>

            {/* 7. CONTENT */}
            {content.length > 0 && (
              <Section title="Latest articles">
                <div className="grid gap-4 sm:grid-cols-3">
                  {content.map((c) => (
                    <Card key={c.id} className="overflow-hidden">
                      {c.cover_image_url && (
                        <img
                          src={c.cover_image_url}
                          alt={c.title ?? ""}
                          className="h-32 w-full object-cover"
                          loading="lazy"
                        />
                      )}
                      <CardContent className="p-4">
                        <h3 className="line-clamp-2 text-sm font-semibold">
                          {c.title}
                        </h3>
                        {c.excerpt && (
                          <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                            {c.excerpt}
                          </p>
                        )}
                        {c.published_at && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {new Date(c.published_at).toLocaleDateString()}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </Section>
            )}

            {/* 8. CREDENTIALS */}
            {credentials.length > 0 && (
              <Section title="Credentials">
                <div className="flex flex-wrap gap-2">
                  {credentials.map((c) => (
                    <Badge
                      key={c.id}
                      variant="outline"
                      className="gap-1 px-3 py-1.5 text-sm font-normal"
                    >
                      {c.verified && (
                        <BadgeCheck className="h-3.5 w-3.5 text-blue-600" />
                      )}
                      {c.name}
                      {c.identifier ? ` · ${c.identifier}` : ""}
                      {c.issuing_state ? ` (${c.issuing_state})` : ""}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* Disclaimers */}
            {p.required_disclaimers && p.required_disclaimers.length > 0 && (
              <div className="space-y-2 border-t pt-6 text-xs text-muted-foreground">
                {p.required_disclaimers.map((d: string, i: number) => (
                  <p key={i}>{d}</p>
                ))}
              </div>
            )}
          </div>

          {/* 9. CONTACT SIDEBAR */}
          <aside className="mt-10 lg:mt-0">
            <div className="lg:sticky lg:top-8">
              <Card>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Contact {p.display_name?.split(" ")[0]}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Get in touch directly.
                    </p>
                  </div>
                  <Separator />
                  <form className="space-y-3">
                    <input
                      type="text"
                      placeholder="Your name"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <input
                      type="tel"
                      placeholder="Phone"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <textarea
                      placeholder="How can I help?"
                      rows={4}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <Button type="button" className="w-full">
                      <Mail className="mr-2 h-4 w-4" /> Send message
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ServicesSection({ gcid }: { gcid: string | null }) {
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["srp-services", gcid],
      queryFn: async () => {
        if (!gcid) return [];
        return api.get<Row<"exp_taxonomy", "id" | "term" | "level">[]>("/graph/profile-services", {
          params: { gcid },
        });
      },
    }),
  );
  if (!data || data.length === 0) return null;
  return (
    <Section title="Services">
      <div className="flex flex-wrap gap-2">
        {data.map((t) => (
          <Badge key={t.id} variant="secondary" className="font-normal">
            {t.term}
          </Badge>
        ))}
      </div>
    </Section>
  );
}
