import { createFileRoute, Link } from "@tanstack/react-router";
import { getPublicPage } from "@v3/shared/public/utils/public-site.functions";
import { marketingHead } from "@v3/shared/public/components/marketing-page";
import { BlockRenderer } from "@v3/shared/public/components/blocks";
import { SiteShell } from "@v3/shared/public/components/site-chrome";
import { DATA_REQUEST_URL, formatTrustDate, trustBlocks, trustMeta } from "@v3/search/utils/trust";

export const Route = createFileRoute("/trust/$slug")({
  loader: ({ params }) => getPublicPage({ data: { slug: params.slug, pageType: "trust" } }),
  head: ({ loaderData }) => marketingHead(loaderData ?? null, "Trust — Experience.com"),
  component: TrustDoc,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center text-[#12294D]">
        <h1 className="text-2xl font-semibold">This page didn't load</h1>
      </div>
    </SiteShell>
  ),
  notFoundComponent: () => <NotPublished />,
});

function NotPublished() {
  return (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-[#12294D]">Document not published</h1>
        <p className="mt-4 text-sm text-slate-600">
          <Link to="/trust" className="underline">
            Back to the Trust Center
          </Link>
        </p>
      </div>
    </SiteShell>
  );
}

function TrustDoc() {
  const page = Route.useLoaderData();
  if (!page) return <NotPublished />;

  const meta = trustMeta(page);
  const blocks = trustBlocks(page);

  return (
    <SiteShell>
      <article className="mx-auto w-full max-w-3xl px-6 py-16">
        <nav className="text-xs text-slate-500">
          <Link to="/trust" className="font-semibold hover:text-[#12294D]">
            Trust Center
          </Link>
          <span className="mx-2 text-slate-300">/</span>
          <span>{meta.category}</span>
        </nav>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#12294D]">{page.title}</h1>
        {meta.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{meta.summary}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>Last updated {formatTrustDate(page.updated_at ?? page.published_at)}</span>
          {meta.sourceUrl ? (
            <a
              href={meta.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-[#12294D]"
            >
              Live source
            </a>
          ) : null}
        </div>

        {meta.importPending ? (
          <p className="mt-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Import pending — this document's text is maintained on the live source page and has not
            been imported here yet. An admin can paste the current text into the CMS editor.
          </p>
        ) : null}

        <div className="trust-doc mt-10">
          <BlockRenderer blocks={blocks} />
        </div>

        <div className="mt-14 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <p className="text-sm font-semibold text-[#12294D]">Need to exercise a privacy right?</p>
          <a
            href={DATA_REQUEST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-9 items-center rounded-full bg-[#12294D] px-4 text-sm font-semibold text-white hover:bg-[#1b3a68]"
          >
            Submit a data / privacy request
          </a>
        </div>
      </article>
    </SiteShell>
  );
}
