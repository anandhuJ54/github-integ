import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "brandiva";

export const Route = createFileRoute("/brandiva")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Brandiva | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Brandiva" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Brandiva" />,
});
