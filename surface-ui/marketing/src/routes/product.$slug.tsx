import { createFileRoute, redirect } from "@tanstack/react-router";
import { getPublicPage } from "@v3/ui/lib/public-site.functions";
import { MarketingPage, marketingHead } from "@v3/ui/components/public/marketing-page";
import { SiteShell } from "@v3/ui/components/public/site-chrome";

export const Route = createFileRoute("/product/$slug")({
  loader: async ({ params }) => {
    const page = await getPublicPage({ data: { slug: params.slug, pageType: "product" } });
    // Pages whose design lives in code render at their own route; never serve the text-only copy.
    if (page?.code_rendered && page.route_path) throw redirect({ href: page.route_path });
    return page;
  },
  head: ({ loaderData }) => marketingHead(loaderData ?? null, "Product — Experience.com"),
  component: () => <MarketingPage page={Route.useLoaderData()} kind="product" />,
  errorComponent: () => (
    <SiteShell>
      <div className="mx-auto max-w-2xl px-6 py-32 text-center text-[#12294D]">
        <h1 className="text-2xl font-semibold">This page didn't load</h1>
      </div>
    </SiteShell>
  ),
  notFoundComponent: () => <MarketingPage page={null} kind="product" />,
});
