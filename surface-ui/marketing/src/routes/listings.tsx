import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "listings";

export const Route = createFileRoute("/listings")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Listings | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Listings" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Listings" />,
});
