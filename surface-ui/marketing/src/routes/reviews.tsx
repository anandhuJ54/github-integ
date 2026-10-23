import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/ui/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "reviews";

export const Route = createFileRoute("/reviews")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Reviews | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Reviews" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Reviews" />,
});
