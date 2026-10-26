import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "multi-post";

export const Route = createFileRoute("/multi-post")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Multi-Post | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Multi-Post" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Multi-Post" />,
});
