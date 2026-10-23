import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "multi-post";

export const Route = createFileRoute("/multi-post")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Multi-Post | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Multi-Post" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Multi-Post" />,
});
