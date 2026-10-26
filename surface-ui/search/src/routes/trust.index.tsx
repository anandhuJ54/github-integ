import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getPublicTrustDocs } from "@v3/ui/lib/public-site.functions";
import { SiteShell } from "@v3/ui/components/public/site-chrome";
import {
  DATA_REQUEST_URL,
  TRUST_CATEGORIES,
  formatTrustDate,
  trustMeta,
} from "@v3/search/lib/trust";

const TITLE = "Trust Center — Experience.com";
const DESCRIPTION =
  "Experience.com Trust Center: legal terms, privacy notices, security disclosure and compliance statements, organized by category and always current.";

export const Route = createFileRoute("/trust/")({
  loader: () => getPublicTrustDocs(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrustIndex,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center text-[#12294D]">
        <h1 className="text-2xl font-semibold">The Trust Center didn't load</h1>
      </div>
    </SiteShell>
  ),
});

function TrustIndex() {
  const pages = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const docs = useMemo(
    () =>
      pages.map((page) => ({
        page,
        meta: trustMeta(page),
      })),
    [pages],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter(({ page, meta }) => {
      if (category !== "All" && meta.category !== category) return false;
      if (!q) return true;
      return `${page.title ?? ""} ${meta.summary} ${meta.category}`.toLowerCase().includes(q);
    });
  }, [docs, query, category]);

  const groups = TRUST_CATEGORIES.map((cat) => ({
    cat,
    items: filtered.filter((d) => d.meta.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <SiteShell>
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto w-full max-w-[1100px] px-6 py-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Trust Center
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-[#12294D]">
            Our legal, privacy, security and compliance documents — in one organized place
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">
            Every policy that governs how Experience.com operates, published in full and kept
            current. Pick a category, or search for the document you need.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={DATA_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-full bg-[#12294D] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1b3a68]"
            >
              Submit a data / privacy request
            </a>
            <a
              href="mailto:privacy@experience.com"
              className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-[#12294D] transition-colors hover:border-[#12294D]"
            >
              Contact our privacy team
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1100px] px-6 py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {["All", ...TRUST_CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`h-8 rounded-full px-4 text-xs font-semibold transition-colors ${
                  category === cat
                    ? "bg-[#12294D] text-white"
                    : "border border-slate-300 bg-white text-slate-600 hover:border-[#12294D]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <label className="sm:w-72">
            <span className="sr-only">Search Trust Center documents</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              className="h-9 w-full rounded-full border border-slate-300 px-4 text-sm text-slate-700 outline-none focus:border-[#12294D]"
            />
          </label>
        </div>

        {groups.length === 0 ? (
          <p className="mt-12 text-sm text-slate-500">
            No documents match that search.
          </p>
        ) : (
          <div className="mt-10 space-y-12">
            {groups.map(({ cat, items }) => (
              <div key={cat}>
                <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                  {cat}
                </h2>
                <ul className="mt-4 grid gap-4 md:grid-cols-2">
                  {items.map(({ page, meta }) => (
                    <li
                      key={page.id}
                      className="rounded-2xl border border-slate-200 bg-white p-6 transition-colors hover:border-[#12294D]"
                    >
                      <Link
                        to="/trust/$slug"
                        params={{ slug: page.slug ?? "" }}
                        className="text-lg font-semibold text-[#12294D]"
                      >
                        {page.title}
                      </Link>
                      {meta.summary ? (
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">{meta.summary}</p>
                      ) : null}
                      <p className="mt-4 text-xs text-slate-400">
                        Last updated {formatTrustDate(page.updated_at ?? page.published_at)}
                        {meta.importPending ? " · import pending" : ""}
                      </p>
                      {meta.sourceUrl ? (
                        <a
                          href={meta.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs font-semibold text-slate-500 underline hover:text-[#12294D]"
                        >
                          Live source
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </SiteShell>
  );
}
