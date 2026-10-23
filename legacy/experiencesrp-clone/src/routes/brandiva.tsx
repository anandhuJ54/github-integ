import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "brandiva";

export const Route = createFileRoute("/brandiva")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Brandiva | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Brandiva" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Brandiva" />,
});
