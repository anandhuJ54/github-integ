import { Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@v3/shared/public/components/site-chrome";
import { ResultCard } from "@v3/shared/public/components/serp-parts";
import { DEFAULT_QUERY } from "@v3/shared/public/utils/search";
import { hubPath, prettyTopic, servesIn, type VoceArticle } from "@v3/shared/public/utils/voce";
import { cn } from "@v3/shared/components/utils/utils";
import type { HubData } from "@v3/search/utils/voce-hub";

function ArticleCard({
  a,
  featured,
  gcid,
}: {
  a: VoceArticle;
  featured: boolean;
  gcid: string;
}) {
  return (
    <article
      className={cn(
        "rounded-2xl border bg-white p-4",
        featured ? "border-[color:var(--color-g-blue)]/40 bg-blue-50/40" : "border-slate-200",
      )}
    >
      {featured ? (
        <span className="mb-2 inline-flex rounded-full bg-[color:var(--color-g-blue)]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--color-g-blue)]">
          Featured
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{a.title}</h3>
      {a.body_excerpt ? (
        <p className="mt-1 text-sm text-[color:var(--color-ink-3)]">{a.body_excerpt}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-ink-3)]">
        {a.author_name ? <span>By {a.author_name}</span> : null}
        {a.published_on ? <span>· {a.published_on}</span> : null}
        {a.topic ? (
          <Link
            to={hubPath(gcid, a.topic)}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[color:var(--color-ink-2)]"
          >
            {prettyTopic(a.topic)}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function TopicHub({ hub }: { hub: HubData }) {
  const placement = hub.topic ? "topic_hub" : "category_hub";
  const featured = hub.articles.filter((a) => servesIn(a, placement));
  const rest = hub.articles.filter((a) => !featured.some((f) => f.id === a.id));

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <SiteHeader />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <nav className="mb-2 text-xs text-[color:var(--color-ink-3)]">
            <Link to="/">Home</Link> ›{" "}
            {hub.topic ? (
              <>
                <Link to={hubPath(hub.gcid)}>{hub.label}</Link> › {prettyTopic(hub.topic)}
              </>
            ) : (
              hub.label
            )}
          </nav>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
            {hub.topic ? `${prettyTopic(hub.topic)} — ${hub.label}` : `${hub.label} insights`}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-ink-2)]">
            Expert articles and the top-ranked {hub.label.toLowerCase()} profiles, ranked by Search
            Rank Score.
          </p>
          {hub.topics.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {hub.topics.map((t) => (
                <Link
                  key={t}
                  to={hubPath(hub.gcid, t)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    t === hub.topic
                      ? "border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue)] text-white"
                      : "border-slate-200 bg-white text-[color:var(--color-ink-2)]",
                  )}
                >
                  {prettyTopic(t)}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Articles</h2>
          {hub.articles.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-[color:var(--color-ink-3)]">
              No published articles for this category yet.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {featured.map((a) => (
                <ArticleCard key={a.id} a={a} featured gcid={hub.gcid} />
              ))}
              {rest.map((a) => (
                <ArticleCard key={a.id} a={a} featured={false} gcid={hub.gcid} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">Top {hub.label} profiles</h2>
            <Link
              to="/find"
              search={{ ...DEFAULT_QUERY, gcid: hub.gcid }}
              className="text-sm font-medium text-[color:var(--color-g-blue)]"
            >
              See all {hub.directoryTotal.toLocaleString()} →
            </Link>
          </div>
          {hub.directory.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-[color:var(--color-ink-3)]">
              No indexed profiles in this category yet.
            </p>
          ) : (
            <div className="space-y-3">
              {hub.directory.map((d) => (
                <ResultCard key={d.id} doc={d} categoryLabel={hub.label} />
              ))}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
