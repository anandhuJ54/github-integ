import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "search-ranking";

export const Route = createFileRoute("/search-ranking")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Search Ranking | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Search Ranking" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Search Ranking" />,
});
