import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/shared/public/utils/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "competitor-analytics";

export const Route = createFileRoute("/competitor-analytics")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Competitor Analytics | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Competitor Analytics" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Competitor Analytics" />,
});
