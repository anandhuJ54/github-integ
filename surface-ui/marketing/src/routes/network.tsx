import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/ui/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "network";

export const Route = createFileRoute("/network")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Network | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Network" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Network" />,
});
