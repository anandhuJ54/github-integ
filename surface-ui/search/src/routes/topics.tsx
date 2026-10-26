import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@v3/shared/public/components/site-chrome";
import { getHomeData } from "@v3/shared/public/utils/home.functions";
import { DEFAULT_QUERY } from "@v3/shared/public/utils/search";

const TITLE = "Topics people search on Experience.com";
const DESCRIPTION =
  "Browse the live topics and categories behind Experience.com search — every hub built from real indexed profiles and published expertise.";

export const Route = createFileRoute("/topics")({
  loader: () => getHomeData(),
  staleTime: 10 * 60_000,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://experiencesrp.lovable.app/topics" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://experiencesrp.lovable.app/topics" }],
  }),
  component: TopicsPage,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-sm text-muted-foreground">
        Topics are unavailable right now.
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

function TopicsPage() {
  const data = Route.useLoaderData();
  const categories = data?.categories ?? [];
  const topics = data?.topics ?? [];

  return (
    <SiteShell>
      <section className="border-b border-border bg-gradient-to-b from-accent/50 to-background px-5 py-14 sm:px-6">
        <div className="mx-auto w-full max-w-[1320px]">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Topics</h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Every topic hub is built from live indexed profiles and published expertise.
          </p>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-6">
        <div className="mx-auto w-full max-w-[1320px]">
          <h2 className="text-lg font-semibold text-foreground">Category hubs</h2>
          {categories.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
              Category hubs appear as soon as profiles are indexed.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((c) => (
                <Link
                  key={c.gcid}
                  to="/topic/$gcid"
                  params={{ gcid: c.gcid }}
                  className="rounded-2xl border border-border p-5 transition-shadow hover:shadow-lg"
                >
                  <span className="block text-base font-semibold text-foreground">{c.label}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {c.count.toLocaleString()} profiles
                  </span>
                </Link>
              ))}
            </div>
          )}

          <h2 className="mt-12 text-lg font-semibold text-foreground">Published expertise</h2>
          {topics.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground">
              No published articles yet.
            </p>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((t) => (
                <li key={t.id} className="rounded-2xl border border-border p-5">
                  {t.gcid ? (
                    <Link
                      to="/topic/$gcid"
                      params={{ gcid: t.gcid }}
                      className="text-base font-semibold text-foreground hover:text-primary"
                    >
                      {t.title}
                    </Link>
                  ) : (
                    <p className="text-base font-semibold text-foreground">{t.title}</p>
                  )}
                  {t.topic ? (
                    <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                      {t.topic}
                    </p>
                  ) : null}
                  {t.excerpt ? (
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{t.excerpt}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-10">
            <Link
              to="/find"
              search={DEFAULT_QUERY}
              className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
            >
              Search everything
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
