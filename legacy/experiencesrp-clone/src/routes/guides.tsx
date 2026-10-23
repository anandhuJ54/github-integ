import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/public/site-chrome";
import { getHomeData } from "@/lib/home.functions";
import { DEFAULT_QUERY } from "@/lib/search";

const TITLE = "Guides & Q&A from verified professionals | Experience.com";
const DESCRIPTION =
  "Practical answers and guides written by verified professionals, organised by the categories people actually search.";

export const Route = createFileRoute("/guides")({
  loader: () => getHomeData(),
  staleTime: 10 * 60_000,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://experiencesrp.lovable.app/guides" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://experiencesrp.lovable.app/guides" }],
  }),
  component: GuidesPage,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-sm text-muted-foreground">
        Guides are unavailable right now.
      </div>
    </SiteShell>
  ),
  notFoundComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-sm text-muted-foreground">
        Not found.
      </div>
    </SiteShell>
  ),
});

function GuidesPage() {
  const data = Route.useLoaderData();
  const guides = data?.guides ?? [];
  const categories = data?.categories ?? [];

  return (
    <SiteShell>
      <section className="border-b border-border bg-gradient-to-b from-accent/50 to-background px-5 py-14 sm:px-6">
        <div className="mx-auto w-full max-w-[1320px]">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Guides &amp; Q&amp;A
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Answers written by verified professionals, published against the category they know.
          </p>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-6">
        <div className="mx-auto w-full max-w-[1320px]">
          {guides.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-8">
              <h2 className="text-lg font-semibold text-foreground">No published guides yet</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Nothing is published in the content library at the moment. Guides appear here
                automatically as professionals publish them.
              </p>
              {categories.length > 0 ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  {categories.slice(0, 6).map((c) => (
                    <Link
                      key={c.gcid}
                      to="/find"
                      search={{ ...DEFAULT_QUERY, gcid: c.gcid }}
                      className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      Browse {c.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map((g) => (
                <li key={g.id} className="rounded-2xl border border-border p-5">
                  <h2 className="text-base font-semibold text-foreground">{g.title}</h2>
                  {g.excerpt ? (
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{g.excerpt}</p>
                  ) : null}
                  {g.published_at ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {new Date(g.published_at).toLocaleDateString()}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
