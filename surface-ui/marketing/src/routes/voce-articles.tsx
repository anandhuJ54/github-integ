import { createFileRoute } from "@tanstack/react-router";
import { getPublicPageBySlug } from "@v3/ui/lib/public-site.functions";
import { CmsMarketingPage, cmsMarketingHead } from "@v3/marketing/components/marketing/pages/cms-marketing-page";

const SLUG = "voce-articles";

export const Route = createFileRoute("/voce-articles")({
  loader: () => getPublicPageBySlug({ data: { slug: SLUG } }),
  head: ({ loaderData }) => cmsMarketingHead(loaderData ?? null, "VOCE Articles | Experience.com"),
  component: () => <CmsMarketingPage page={Route.useLoaderData()} label="VOCE Articles" />,
  notFoundComponent: () => <CmsMarketingPage page={null} label="VOCE Articles" />,
});
