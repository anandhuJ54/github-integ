import { MarketingPage } from "@/components/marketing/layouts/marketing-page";
import { PageBreadcrumb } from "@/components/marketing/PageBreadcrumb";
import { MarketingSections } from "@/components/marketing/sections/premium/MarketingSections";
import { ogImageUrl } from "@/lib/marketing/seo";
import type { PublicPage } from "@/lib/public-site";

/**
 * Renders a marketing page entirely from its CMS content
 * (exp_web_pages.body → premium section renderer). No copy lives in code.
 */
export function CmsMarketingPage({ page, label }: { page: PublicPage | null; label: string }) {
  return (
    <MarketingPage>
      <PageBreadcrumb label={label} parents={[{ label: "For Business", to: "/search-rank-platform" }]} />
      {page?.body?.length ? (
        <MarketingSections blocks={page.body} />
      ) : (
        <div className="mx-auto max-w-2xl px-6 py-32 text-center">
          <h1 className="font-heading text-3xl text-slate-900">{label}</h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            This page has no published content yet. Add sections in the console under Website → CMS.
          </p>
        </div>
      )}
    </MarketingPage>
  );
}

export function cmsMarketingHead(page: PublicPage | null, fallbackTitle: string) {
  const title = page?.seo_title ?? page?.title ?? fallbackTitle;
  const description =
    page?.seo_desc ??
    "Experience.com organizes the proof that you're the best so customers and AI can find it.";
  const slug = page?.slug ?? "";
  const url = `https://www.experience.com/${slug}`;
  const image = ogImageUrl(slug || "home");
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow, max-snippet:-1, max-image-preview:large" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:site_name", content: "Experience.com" },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
