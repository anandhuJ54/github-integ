import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@/components/marketing/pages/cms-marketing-page";

const SLUG = "competitor-analytics";

export const Route = createFileRoute("/competitor-analytics")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "Competitor Analytics | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="Competitor Analytics" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="Competitor Analytics" />,
});
