import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "search-rank-platform";

export const Route = createFileRoute("/search-rank-platform")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Search Rank Platform | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Search Rank Platform" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Search Rank Platform" />,
});
