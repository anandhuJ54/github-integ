import { BlockRenderer } from "@v3/shared/public/components/blocks";
import { SiteShell } from "@v3/shared/public/components/site-chrome";
import type { PublicPage } from "@v3/shared/public/utils/public-site";

/** Shared body for CMS-driven marketing routes (/product, /platform, /trust). */
export function MarketingPage({ page, kind }: { page: PublicPage | null; kind: string }) {
  if (!page) {
    return (
      <SiteShell>
        <div className="mx-auto max-w-2xl px-6 py-32 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-[#12294D]">Page not published</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            No published {kind} page exists at this address yet. Create it in the console under Website →
            CMS and publish it.
          </p>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      {page.body.length ? (
        <BlockRenderer blocks={page.body} />
      ) : (
        <div className="mx-auto max-w-3xl px-6 py-28">
          <h1 className="text-4xl font-semibold tracking-tight text-[#12294D]">{page.title}</h1>
          <p className="mt-4 text-sm text-slate-500">This page has no content blocks yet.</p>
        </div>
      )}
    </SiteShell>
  );
}

export function marketingHead(page: PublicPage | null, fallbackTitle: string) {
  const title = page?.seo_title ?? page?.title ?? fallbackTitle;
  const description =
    page?.seo_desc ??
    "Experience.com organizes the proof that you're the best so customers and AI can find it.";
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  };
}
